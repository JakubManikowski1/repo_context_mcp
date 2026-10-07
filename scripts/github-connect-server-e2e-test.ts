import assert from "node:assert/strict";

import {
  randomBytes,
} from "node:crypto";

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  authenticatedPrincipalExtra,
} from "../src/auth/principal.js";

import type {
  GitHubOAuthFlowOptions,
} from "../src/connections/github-oauth-flow.js";

import {
  createRequestRepositoryAccess,
  loadServerRuntimeFromEnv,
} from "../src/server-runtime.js";

const principalA = {
  issuer:
    "https://auth.example.test",

  subject:
    "connect-runtime-user-a",
};

const principalB = {
  issuer:
    "https://auth.example.test",

  subject:
    "connect-runtime-user-b",
};

const userToken =
  "ghu_RUNTIME_E2E_MUST_NOT_PERSIST";

async function main(): Promise<void> {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        "repo-context-connect-runtime-",
      ),
    );

  const databasePath =
    join(
      directory,
      "connections.sqlite",
    );

  const lookupKey =
    randomBytes(32);

  const encryptionKey =
    randomBytes(32);

  let oauthExchangeCount =
    0;

  let userRepositoryLookupCount =
    0;

  let installationLookupCount =
    0;

  const fakeFetch:
    NonNullable<
      GitHubOAuthFlowOptions["fetch"]
    > =
    async (
      input,
      init,
    ) => {
      const url =
        new URL(
          input.toString(),
        );

      if (
        url.href ===
        "https://github.com/login/oauth/access_token"
      ) {
        oauthExchangeCount +=
          1;

        const body =
          new URLSearchParams(
            String(
              init?.body ??
              "",
            ),
          );

        assert.equal(
          body.get(
            "code",
          ),
          "runtime-e2e-code",
        );

        assert.ok(
          body.get(
            "code_verifier",
          ),
        );

        return Response.json({
          access_token:
            userToken,

          token_type:
            "bearer",

          refresh_token:
            "ghr_RUNTIME_E2E_MUST_NOT_ESCAPE",
        });
      }

      if (
        url.origin ===
          "https://api.github.com" &&
        url.pathname ===
          "/user/installations/12345/repositories"
      ) {
        userRepositoryLookupCount +=
          1;

        const headers =
          new Headers(
            init?.headers,
          );

        assert.equal(
          headers.get(
            "Authorization",
          ),
          `Bearer ${userToken}`,
        );

        assert.equal(
          url.searchParams.get(
            "per_page",
          ),
          "100",
        );

        assert.equal(
          url.searchParams.get(
            "page",
          ),
          "1",
        );

        return Response.json({
          total_count: 2,

          repositories: [
            {
              id: 1001,

              name:
                "repo-one",

              default_branch:
                "main",

              owner: {
                login:
                  "example-org",
              },
            },

            {
              id: 1002,

              name:
                "repo-two",

              default_branch:
                "trunk",

              owner: {
                login:
                  "example-org",
              },
            },
          ],
        });
      }

      throw new Error(
        `Unexpected fetch URL: ${url.href}`,
      );
    };

  const createGitHubClient =
    (
      (
        installationId:
          string | number,
      ) => {
        assert.equal(
          String(
            installationId,
          ),
          "12345",
        );

        return {
          async request(
            route: string,
            options:
              Record<string, unknown>,
          ) {
            installationLookupCount +=
              1;

            assert.equal(
              route,
              "GET /installation/repositories",
            );

            assert.equal(
              options.per_page,
              100,
            );

            assert.equal(
              options.page,
              1,
            );

            return {
              data: {
                total_count: 1,

                repositories: [
                  {
                    id: 1002,

                    name:
                      "repo-two",

                    default_branch:
                      "trunk",

                    owner: {
                      login:
                        "example-org",
                    },
                  },
                ],
              },
            };
          },
        };
      }
    ) as any;

  const env:
    NodeJS.ProcessEnv = {
      REPO_CONTEXT_AUTH_MODE:
        "oauth",

      REPO_CONTEXT_MCP_URL:
        "http://127.0.0.1:43123/mcp",

      REPO_CONTEXT_OAUTH_ISSUER:
        "https://auth.example.test",

      REPO_CONTEXT_OAUTH_AUTHORIZATION_ENDPOINT:
        "https://auth.example.test/authorize",

      REPO_CONTEXT_OAUTH_TOKEN_ENDPOINT:
        "https://auth.example.test/token",

      REPO_CONTEXT_OAUTH_JWKS_URL:
        "https://auth.example.test/.well-known/jwks.json",

      REPO_CONTEXT_CONNECTION_DB_PATH:
        databasePath,

      REPO_CONTEXT_USER_LOOKUP_KEY:
        lookupKey.toString(
          "base64",
        ),

      REPO_CONTEXT_CONNECTION_ENCRYPTION_KEY:
        encryptionKey.toString(
          "base64",
        ),

      REPO_CONTEXT_GITHUB_APP_SLUG:
        "repo-context-test",

      REPO_CONTEXT_GITHUB_CLIENT_ID:
        "Iv1.runtime-e2e",

      REPO_CONTEXT_GITHUB_CLIENT_SECRET:
        "runtime-e2e-client-secret",
    };

  const runtime =
    loadServerRuntimeFromEnv(
      env,
      {
        fetch:
          fakeFetch,

        createGitHubClient,
      },
    );

  if (
    runtime.mode !==
      "oauth"
  ) {
    throw new Error(
      "Expected OAuth runtime",
    );
  }

  if (
    !runtime.githubConnect
  ) {
    throw new Error(
      "Expected GitHub connect runtime",
    );
  }

  try {
    const installStart =
      runtime
        .githubConnect
        .oauthFlow
        .createInstallStart(
          principalA,
        );

    const installState =
      installStart
        .installationUrl
        .searchParams
        .get("state");

    assert.ok(
      installState,
    );

    const authorizationStart =
      runtime
        .githubConnect
        .oauthFlow
        .createAuthorizationStart(
          installState,
          installStart
            .browserNonce,
          "12345",
        );

    assert.equal(
      authorizationStart
        .authorizationUrl
        .searchParams
        .get(
          "redirect_uri",
        ),
      "http://127.0.0.1:43123/connect/github/callback",
    );

    const authorizationState =
      authorizationStart
        .authorizationUrl
        .searchParams
        .get("state");

    assert.ok(
      authorizationState,
    );

    const authorization =
      await runtime
        .githubConnect
        .oauthFlow
        .completeAuthorization(
          authorizationState,
          installStart
            .browserNonce,
          "runtime-e2e-code",
        );

    assert.deepEqual(
      authorization.principal,
      principalA,
    );

    assert.equal(
      authorization
        .installationId,
      "12345",
    );

    assert.equal(
      authorization
        .githubUserAccessToken,
      userToken,
    );

    const repositories =
      await runtime
        .githubConnect
        .userRepositoryConnector
        .listRepositories(
          authorization
            .githubUserAccessToken,

          authorization
            .installationId,
        );

    assert.deepEqual(
      repositories.map(
        (
          repository,
        ) =>
          repository.repositoryId,
      ),
      [
        "1001",
        "1002",
      ],
    );

    const selection =
      runtime
        .githubConnect
        .repositorySelection
        .create(
          authorization
            .principal,

          installStart
            .browserNonce,

          authorization
            .installationId,

          repositories,
        );

    const selected =
      runtime
        .githubConnect
        .repositorySelection
        .complete(
          selection
            .selectionToken,

          installStart
            .browserNonce,

          "1002",
        );

    const connected =
      await runtime
        .githubConnect
        .installationSelection
        .connect(
          selected
            .principal,

          selected
            .installationId,

          selected
            .repositoryId,
        );

    assert.equal(
      connected
        .repositoryId,
      "1002",
    );

    assert.equal(
      connected.owner,
      "example-org",
    );

    assert.equal(
      connected.name,
      "repo-two",
    );

    assert.equal(
      connected.branch,
      "trunk",
    );

    assert.equal(
      oauthExchangeCount,
      1,
    );

    assert.equal(
      userRepositoryLookupCount,
      1,
    );

    assert.equal(
      installationLookupCount,
      1,
    );

    const authInfoA = {
      token:
        "runtime-token-a",

      clientId:
        "runtime-client-a",

      scopes: [
        "mcp",
      ],

      expiresAt:
        Math.floor(
          Date.now() /
          1000,
        ) + 3600,

      extra:
        authenticatedPrincipalExtra(
          principalA,
        ),
    };

    const authInfoB = {
      token:
        "runtime-token-b",

      clientId:
        "runtime-client-b",

      scopes: [
        "mcp",
      ],

      expiresAt:
        Math.floor(
          Date.now() /
          1000,
        ) + 3600,

      extra:
        authenticatedPrincipalExtra(
          principalB,
        ),
    };

    const requestAccessA =
      createRequestRepositoryAccess(
        runtime,
        authInfoA,
      );

    const requestAccessB =
      createRequestRepositoryAccess(
        runtime,
        authInfoB,
      );

    assert.equal(
      requestAccessA
        .legacyRepository,
      null,
    );

    assert.equal(
      requestAccessB
        .legacyRepository,
      null,
    );

    const visibleA =
      await runtime
        .resolver
        .list(
          principalA,
        );

    const visibleB =
      await runtime
        .resolver
        .list(
          principalB,
        );

    assert.equal(
      visibleA.length,
      1,
      "connected repository must be visible to the owning principal",
    );

    assert.equal(
      visibleB.length,
      0,
      "connected repository must not be visible to another principal",
    );

    const visibleText =
      JSON.stringify(
        visibleA,
      );

    assert.equal(
      visibleText.includes(
        "repo-two",
      ),
      true,
    );

    assert.equal(
      visibleText.includes(
        "example-org",
      ),
      true,
    );

    const serverSource =
      readFileSync(
        new URL(
          "../src/server.ts",
          import.meta.url,
        ),
        "utf8",
      );

    assert.equal(
      serverSource.includes(
        '"/connect/github"',
      ),
      true,
      "server.ts must mount GitHub connect routes",
    );

    assert.equal(
      serverSource.includes(
        "getAuthenticatedPrincipal(",
      ),
      true,
      "server.ts must derive connect principal from verified AuthInfo",
    );

    assert.equal(
      serverSource.includes(
        "request.auth",
      ),
      true,
      "server.ts must use AuthInfo attached by bearer middleware",
    );

    console.log(
      "GitHub connect production runtime: OK",
    );

    console.log(
      "Shared OAuth bearer principal wiring: OK",
    );

    console.log(
      "Shared RepositoryConnection store: OK",
    );

    console.log(
      "GitHub OAuth callback URL derived from MCP origin: OK",
    );

    console.log(
      "User-authorized repository verification: OK",
    );

    console.log(
      "Installation-side final verification: OK",
    );

    console.log(
      "Connected repository visible to owning principal: OK",
    );

    console.log(
      "Connected repository hidden from other principal: OK",
    );

    console.log(
      "Legacy repository fallback in OAuth connect path: ABSENT",
    );
  } finally {
    runtime.store.close();
  }

  for (
    const name
    of readdirSync(
      directory,
    )
  ) {
    const path =
      join(
        directory,
        name,
      );

    let bytes:
      Buffer;

    try {
      bytes =
        readFileSync(
          path,
        );
    } catch {
      continue;
    }

    assert.equal(
      bytes.includes(
        Buffer.from(
          userToken,
          "utf8",
        ),
      ),
      false,
      `GitHub user token leaked into persisted file: ${name}`,
    );
  }

  console.log(
    "GitHub user token persistence: ABSENT",
  );

  rmSync(
    directory,
    {
      recursive: true,
      force: true,
    },
  );
}

main().catch(
  (error) => {
    console.error(
      error,
    );

    process.exit(1);
  },
);
