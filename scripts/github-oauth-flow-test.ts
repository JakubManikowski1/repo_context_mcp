import assert from "node:assert/strict";

import {
  createHash,
  randomBytes,
} from "node:crypto";

import {
  deriveGitHubConnectStateKey,
  GitHubOAuthFlow,
  GitHubOAuthFlowError,
} from "../src/connections/github-oauth-flow.js";

const principal = {
  issuer:
    "https://auth.example.test",
  subject:
    "user-connect-123",
};

async function main(): Promise<void> {
  let now =
    new Date(
      "2026-10-07T12:00:00.000Z",
    );

  const rootKey =
    randomBytes(32);

  const stateKey =
    deriveGitHubConnectStateKey(
      rootKey,
    );

  assert.equal(
    stateKey.length,
    32,
  );

  assert.notDeepEqual(
    stateKey,
    rootKey,
    "connect state must use a derived key, not the RepositoryConnection encryption key directly",
  );

  let tokenExchangeBody:
    URLSearchParams | undefined;

  let expectedChallenge:
    string | undefined;

  const flow =
    new GitHubOAuthFlow({
      appSlug:
        "repo-context-test",

      clientId:
        "Iv1.test-client-id",

      clientSecret:
        "github-client-secret-MUST-NOT-LEAK",

      callbackUrl:
        new URL(
          "https://mcp.example.test/connect/github/callback",
        ),

      stateKey,

      now:
        () => now,

      fetch:
        async (
          input,
          init,
        ) => {
          assert.equal(
            input.toString(),
            "https://github.com/login/oauth/access_token",
          );

          assert.equal(
            init?.method,
            "POST",
          );

          assert.equal(
            (
              init?.headers as
                Record<string, string>
            )?.Accept,
            "application/json",
          );

          tokenExchangeBody =
            new URLSearchParams(
              String(
                init?.body ??
                "",
              ),
            );

          assert.equal(
            tokenExchangeBody.get(
              "client_id",
            ),
            "Iv1.test-client-id",
          );

          assert.equal(
            tokenExchangeBody.get(
              "client_secret",
            ),
            "github-client-secret-MUST-NOT-LEAK",
          );

          assert.equal(
            tokenExchangeBody.get(
              "code",
            ),
            "oauth-code-123",
          );

          assert.equal(
            tokenExchangeBody.get(
              "redirect_uri",
            ),
            "https://mcp.example.test/connect/github/callback",
          );

          const verifier =
            tokenExchangeBody.get(
              "code_verifier",
            );

          assert.ok(verifier);

          assert.equal(
            createHash("sha256")
              .update(
                verifier,
                "ascii",
              )
              .digest(
                "base64url",
              ),
            expectedChallenge,
            "PKCE verifier must match the authorization challenge",
          );

          return Response.json({
            access_token:
              "ghu_TRANSIENT_TEST_TOKEN",
            expires_in:
              28800,
            refresh_token:
              "ghr_MUST_NOT_ESCAPE",
            refresh_token_expires_in:
              15897600,
            scope: "",
            token_type:
              "bearer",
          });
        },
    });

  const start =
    flow.createInstallStart(
      principal,
    );

  assert.equal(
    start.installationUrl.origin,
    "https://github.com",
  );

  assert.equal(
    start.installationUrl.pathname,
    "/apps/repo-context-test/installations/new",
  );

  const installState =
    start.installationUrl
      .searchParams
      .get("state");

  assert.ok(
    installState,
  );

  assert.ok(
    installState.startsWith(
      "gcs1.",
    ),
  );

  assert.equal(
    start.installationUrl.href.includes(
      principal.subject,
    ),
    false,
    "principal subject must not leak into installation URL",
  );

  assert.equal(
    start.installationUrl.href.includes(
      principal.issuer,
    ),
    false,
    "principal issuer must not leak into installation URL",
  );

  assert.equal(
    start.installationUrl.href.includes(
      "github-client-secret",
    ),
    false,
  );

  await assert.rejects(
    async () => {
      flow.createAuthorizationStart(
        installState,
        randomBytes(32)
          .toString("base64url"),
        "12345",
      );
    },
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubOAuthFlowError &&
      error.code ===
        "github_connect_browser_mismatch",
  );

  const authorization =
    flow.createAuthorizationStart(
      installState,
      start.browserNonce,
      "12345",
    );

  assert.equal(
    authorization.authorizationUrl.origin,
    "https://github.com",
  );

  assert.equal(
    authorization.authorizationUrl.pathname,
    "/login/oauth/authorize",
  );

  assert.equal(
    authorization.authorizationUrl
      .searchParams
      .get("client_id"),
    "Iv1.test-client-id",
  );

  assert.equal(
    authorization.authorizationUrl
      .searchParams
      .get("redirect_uri"),
    "https://mcp.example.test/connect/github/callback",
  );

  assert.equal(
    authorization.authorizationUrl
      .searchParams
      .get(
        "code_challenge_method",
      ),
    "S256",
  );

  expectedChallenge =
    authorization.authorizationUrl
      .searchParams
      .get(
        "code_challenge",
      ) ??
    undefined;

  assert.ok(
    expectedChallenge,
  );

  assert.equal(
    expectedChallenge.length,
    43,
  );

  const authorizationState =
    authorization.authorizationUrl
      .searchParams
      .get("state");

  assert.ok(
    authorizationState,
  );

  assert.equal(
    authorization.authorizationUrl.href.includes(
      principal.subject,
    ),
    false,
  );

  assert.equal(
    authorization.authorizationUrl.href.includes(
      "github-client-secret-MUST-NOT-LEAK",
    ),
    false,
  );

  const result =
    await flow.completeAuthorization(
      authorizationState,
      start.browserNonce,
      "oauth-code-123",
    );

  assert.deepEqual(
    result,
    {
      principal,
      installationId:
        "12345",
      githubUserAccessToken:
        "ghu_TRANSIENT_TEST_TOKEN",
    },
  );

  assert.ok(
    tokenExchangeBody,
  );

  assert.equal(
    JSON.stringify(result).includes(
      "ghr_MUST_NOT_ESCAPE",
    ),
    false,
    "refresh token must never leave the OAuth exchange boundary",
  );

  await assert.rejects(
    () =>
      flow.completeAuthorization(
        authorizationState,
        randomBytes(32)
          .toString("base64url"),
        "oauth-code-123",
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubOAuthFlowError &&
      error.code ===
        "github_connect_browser_mismatch",
  );

  const tampered =
    authorizationState
      .split("")
      .map(
        (character, index) =>
          index ===
            authorizationState.length - 2
            ? (
                character === "A"
                  ? "B"
                  : "A"
              )
            : character,
      )
      .join("");

  await assert.rejects(
    () =>
      flow.completeAuthorization(
        tampered,
        start.browserNonce,
        "oauth-code-123",
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubOAuthFlowError &&
      error.code ===
        "github_connect_state_invalid",
  );

  const expiring =
    flow.createInstallStart(
      principal,
    );

  const expiringState =
    expiring.installationUrl
      .searchParams
      .get("state");

  assert.ok(
    expiringState,
  );

  now =
    new Date(
      "2026-10-07T12:11:00.000Z",
    );

  assert.throws(
    () =>
      flow.createAuthorizationStart(
        expiringState,
        expiring.browserNonce,
        "12345",
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubOAuthFlowError &&
      error.code ===
        "github_connect_state_expired",
  );

  console.log(
    "GitHub install/OAuth flow: OK",
  );

  console.log(
    "Opaque principal-bound installation state: OK",
  );

  console.log(
    "Browser nonce binding: OK",
  );

  console.log(
    "State expiry/tamper detection: OK",
  );

  console.log(
    "GitHub OAuth PKCE S256: OK",
  );

  console.log(
    "OAuth code exchange: OK",
  );

  console.log(
    "Refresh token persistence/exposure: ABSENT",
  );

  console.log(
    "GitHub client secret URL/state exposure: ABSENT",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
