import assert from "node:assert/strict";

import {
  createServer,
  type Server,
} from "node:http";

import {
  randomBytes,
} from "node:crypto";

import express, {
  type Request,
  type RequestHandler,
} from "express";

import {
  GitHubOAuthFlow,
} from "../src/connections/github-oauth-flow.js";

import {
  GitHubRepositorySelection,
} from "../src/connections/github-selection.js";

import {
  createGitHubConnectRouter,
} from "../src/connections/github-connect-router.js";

const principalA = {
  issuer:
    "https://auth.example.test",
  subject:
    "connect-user-a",
};

const principalB = {
  issuer:
    "https://auth.example.test",
  subject:
    "connect-user-b",
};

function cookiePair(
  setCookie:
    string | null,
): string {
  assert.ok(
    setCookie,
    "Set-Cookie header missing",
  );

  return (
    setCookie
      .split(";")[0] ??
    ""
  );
}

async function startServer(
  server:
    Server,
): Promise<number> {
  await new Promise<void>(
    (
      resolve,
      reject,
    ) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        0,
        "127.0.0.1",
        () => {
          server.off(
            "error",
            reject,
          );

          resolve();
        },
      );
    },
  );

  const address =
    server.address();

  assert.ok(
    address &&
    typeof address !==
      "string",
  );

  return address.port;
}

async function main(): Promise<void> {
  let tokenExchangeCount =
    0;

  let userRepositoryLookupCount =
    0;

  let installationConnectCount =
    0;

  const transientUserToken =
    "ghu_TRANSIENT_ROUTER_TOKEN";

  const oauthFlow =
    new GitHubOAuthFlow({
      appSlug:
        "repo-context-test",

      clientId:
        "Iv1.router-test",

      clientSecret:
        "router-client-secret",

      callbackUrl:
        new URL(
          "https://mcp.example.test/connect/github/callback",
        ),

      stateKey:
        randomBytes(32),

      fetch:
        async (
          input,
          init,
        ) => {
          tokenExchangeCount +=
            1;

          assert.equal(
            input.toString(),
            "https://github.com/login/oauth/access_token",
          );

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
            "github-oauth-code",
          );

          assert.ok(
            body.get(
              "code_verifier",
            ),
          );

          return Response.json({
            access_token:
              transientUserToken,

            token_type:
              "bearer",

            refresh_token:
              "ghr_ROUTER_SECRET",
          });
        },
    });

  const repositorySelection =
    new GitHubRepositorySelection({
      stateKey:
        randomBytes(32),
    });

  const authenticate:
    RequestHandler =
    (
      request,
      response,
      next,
    ) => {
      const authorization =
        request.headers
          .authorization;

      if (
        authorization !==
          "Bearer app-token-a" &&
        authorization !==
          "Bearer app-token-b"
      ) {
        response
          .status(401)
          .json({
            error:
              "invalid_token",
          });

        return;
      }

      next();
    };

  const getPrincipal =
    (
      request:
        Request,
    ) => {
      if (
        request.headers
          .authorization ===
        "Bearer app-token-b"
      ) {
        return principalB;
      }

      return principalA;
    };

  const app =
    express();

  app.use(
    "/connect/github",

    createGitHubConnectRouter({
      authenticate,
      getPrincipal,
      oauthFlow,
      repositorySelection,

      userRepositoryConnector: {
        async listRepositories(
          githubUserAccessToken,
          installationId,
        ) {
          userRepositoryLookupCount +=
            1;

          assert.equal(
            githubUserAccessToken,
            transientUserToken,
          );

          assert.equal(
            installationId,
            "12345",
          );

          return [
            {
              repositoryId:
                "1001",

              owner:
                "example-org",

              name:
                "repo-one",

              defaultBranch:
                "main",
            },

            {
              repositoryId:
                "1002",

              owner:
                "example-org",

              name:
                "repo-two",

              defaultBranch:
                "trunk",
            },
          ];
        },
      },

      installationSelection: {
        async connect(
          principal,
          installationId,
          repositoryId,
        ) {
          installationConnectCount +=
            1;

          assert.deepEqual(
            principal,
            principalA,
          );

          assert.equal(
            installationId,
            "12345",
          );

          assert.equal(
            repositoryId,
            "1002",
          );

          return {
            connectionId:
              "conn-http-1",

            provider:
              "github",

            installationId:
              "12345",

            repositoryId:
              "1002",

            owner:
              "example-org",

            name:
              "repo-two",

            branch:
              "trunk",
          };
        },
      },

      cookieSecure:
        true,
    }),
  );

  const server =
    createServer(
      app,
    );

  const port =
    await startServer(
      server,
    );

  const base =
    `http://127.0.0.1:${port}`;

  try {
    const unauthenticatedStart =
      await fetch(
        `${base}/connect/github/start`,
        {
          method:
            "POST",
        },
      );

    assert.equal(
      unauthenticatedStart.status,
      401,
    );

    const startResponse =
      await fetch(
        `${base}/connect/github/start`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer app-token-a",
          },
        },
      );

    assert.equal(
      startResponse.status,
      200,
    );

    assert.equal(
      startResponse.headers.get(
        "cache-control",
      ),
      "no-store",
    );

    const setCookie =
      startResponse.headers.get(
        "set-cookie",
      );

    assert.ok(
      setCookie,
    );

    assert.match(
      setCookie,
      /HttpOnly/i,
    );

    assert.match(
      setCookie,
      /Secure/i,
    );

    assert.match(
      setCookie,
      /SameSite=Lax/i,
    );

    assert.match(
      setCookie,
      /Path=\/connect\/github/i,
    );

    const cookie =
      cookiePair(
        setCookie,
      );

    const startBody =
      await startResponse.json() as
        {
          installation_url:
            string;
          expires_at:
            string;
        };

    const installationUrl =
      new URL(
        startBody.installation_url,
      );

    const installState =
      installationUrl
        .searchParams
        .get("state");

    assert.ok(
      installState,
    );

    assert.equal(
      startBody.installation_url
        .includes(
          principalA.subject,
        ),
      false,
    );

    const setupUrl =
      new URL(
        `${base}/connect/github/setup`,
      );

    setupUrl.searchParams.set(
      "installation_id",
      "12345",
    );

    setupUrl.searchParams.set(
      "state",
      installState,
    );

    const setupResponse =
      await fetch(
        setupUrl,
        {
          redirect:
            "manual",

          headers: {
            Cookie:
              cookie,
          },
        },
      );

    assert.equal(
      setupResponse.status,
      303,
    );

    const authorizationLocation =
      setupResponse.headers.get(
        "location",
      );

    assert.ok(
      authorizationLocation,
    );

    const authorizationUrl =
      new URL(
        authorizationLocation,
      );

    assert.equal(
      authorizationUrl.origin,
      "https://github.com",
    );

    assert.equal(
      authorizationUrl.pathname,
      "/login/oauth/authorize",
    );

    assert.equal(
      authorizationUrl
        .searchParams
        .get(
          "code_challenge_method",
        ),
      "S256",
    );

    const authorizationState =
      authorizationUrl
        .searchParams
        .get("state");

    assert.ok(
      authorizationState,
    );

    const callbackWithoutCookie =
      new URL(
        `${base}/connect/github/callback`,
      );

    callbackWithoutCookie
      .searchParams
      .set(
        "code",
        "github-oauth-code",
      );

    callbackWithoutCookie
      .searchParams
      .set(
        "state",
        authorizationState,
      );

    const missingCookieResponse =
      await fetch(
        callbackWithoutCookie,
      );

    assert.equal(
      missingCookieResponse.status,
      400,
    );

    const callbackResponse =
      await fetch(
        callbackWithoutCookie,
        {
          headers: {
            Cookie:
              cookie,
          },
        },
      );

    assert.equal(
      callbackResponse.status,
      200,
    );

    assert.equal(
      tokenExchangeCount,
      1,
    );

    assert.equal(
      userRepositoryLookupCount,
      1,
    );

    const callbackText =
      await callbackResponse.text();

    assert.equal(
      callbackText.includes(
        transientUserToken,
      ),
      false,
    );

    assert.equal(
      callbackText.includes(
        "ghr_ROUTER_SECRET",
      ),
      false,
    );

    const callbackBody =
      JSON.parse(
        callbackText,
      ) as {
        repositories:
          Array<{
            repositoryId:
              string;
          }>;

        selection_token:
          string;

        expires_at:
          string;
      };

    assert.deepEqual(
      callbackBody.repositories.map(
        (
          repository,
        ) =>
          repository
            .repositoryId,
      ),
      [
        "1001",
        "1002",
      ],
    );

    assert.ok(
      callbackBody
        .selection_token
        .startsWith(
          "grs1.",
        ),
    );

    const crossPrincipalResponse =
      await fetch(
        `${base}/connect/github/select`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer app-token-b",

            Cookie:
              cookie,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              selection_token:
                callbackBody
                  .selection_token,

              repository_id:
                "1002",
            }),
        },
      );

    assert.equal(
      crossPrincipalResponse.status,
      403,
    );

    assert.equal(
      installationConnectCount,
      0,
      "cross-principal selection must fail before installation access",
    );

    const unavailableRepositoryResponse =
      await fetch(
        `${base}/connect/github/select`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer app-token-a",

            Cookie:
              cookie,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              selection_token:
                callbackBody
                  .selection_token,

              repository_id:
                "9999",
            }),
        },
      );

    assert.equal(
      unavailableRepositoryResponse.status,
      404,
    );

    assert.equal(
      installationConnectCount,
      0,
      "unverified repository ID must fail before installation access",
    );

    const selectResponse =
      await fetch(
        `${base}/connect/github/select`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer app-token-a",

            Cookie:
              cookie,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              selection_token:
                callbackBody
                  .selection_token,

              repository_id:
                "1002",
            }),
        },
      );

    assert.equal(
      selectResponse.status,
      201,
    );

    assert.equal(
      installationConnectCount,
      1,
    );

    const selectBody =
      await selectResponse.json() as
        {
          connection:
            {
              connectionId:
                string;

              repositoryId:
                string;
            };
        };

    assert.deepEqual(
      selectBody.connection,
      {
        connectionId:
          "conn-http-1",

        provider:
          "github",

        installationId:
          "12345",

        repositoryId:
          "1002",

        owner:
          "example-org",

        name:
          "repo-two",

        branch:
          "trunk",
      },
    );

    const clearCookie =
      selectResponse.headers.get(
        "set-cookie",
      );

    assert.ok(
      clearCookie,
      "successful selection must clear connect cookie",
    );

    assert.match(
      clearCookie,
      /Max-Age=0|Expires=/i,
    );

    console.log(
      "GitHub connect HTTP router: OK",
    );

    console.log(
      "Authenticated start route: OK",
    );

    console.log(
      "HttpOnly Secure SameSite=Lax browser binding: OK",
    );

    console.log(
      "GitHub setup redirect + PKCE: OK",
    );

    console.log(
      "Callback without browser binding: FAIL CLOSED",
    );

    console.log(
      "Transient GitHub user token exposure: ABSENT",
    );

    console.log(
      "Cross-principal final selection: FAIL CLOSED",
    );

    console.log(
      "Unverified repository selection: FAIL CLOSED",
    );

    console.log(
      "Successful connection clears browser binding: OK",
    );
  } finally {
    await new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        server.close(
          (error) => {
            if (error) {
              reject(
                error,
              );

              return;
            }

            resolve();
          },
        );
      },
    );
  }
}

main().catch(
  (error) => {
    console.error(
      error,
    );

    process.exit(1);
  },
);
