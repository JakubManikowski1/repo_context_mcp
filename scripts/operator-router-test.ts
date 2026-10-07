import assert from "node:assert/strict";

import {
  createServer,
  type Server,
} from "node:http";

import {
  mkdtempSync,
  rmSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  randomBytes,
} from "node:crypto";

import express, {
  type Request,
  type RequestHandler,
} from "express";

import {
  OperatorPrivilegedSessionService,
} from "../src/operator/privileged-session.js";

import {
  OperatorRevealError,
} from "../src/operator/reveal.js";

import {
  createOperatorRouter,
} from "../src/operator/router.js";

import {
  loadServerRuntimeFromEnv,
} from "../src/server-runtime.js";

import {
  decodeTotpSecret,
  generateTotpCode,
} from "../src/operator/totp.js";

const ISSUER =
  "https://auth.example.test";

const OPERATOR_SUBJECT =
  "operator-user";

const OTHER_SUBJECT =
  "ordinary-user";

const OPERATOR_ID =
  "primary-operator";

const TOTP_SECRET =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

async function startServer(
  server: Server,
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

async function stopServer(
  server: Server,
): Promise<void> {
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

async function main() {
  const runtimeDirectory =
    mkdtempSync(
      join(
        tmpdir(),
        "repo-context-operator-runtime-",
      ),
    );

  const runtimeDatabasePath =
    join(
      runtimeDirectory,
      "connections.sqlite",
    );

  const baseOAuthEnv:
    NodeJS.ProcessEnv = {
      REPO_CONTEXT_AUTH_MODE:
        "oauth",

      REPO_CONTEXT_FEATURES:
        "",

      REPO_CONTEXT_MCP_URL:
        "https://mcp.example.test/mcp",

      REPO_CONTEXT_OAUTH_ISSUER:
        ISSUER,

      REPO_CONTEXT_OAUTH_AUTHORIZATION_ENDPOINT:
        `${ISSUER}/authorize`,

      REPO_CONTEXT_OAUTH_TOKEN_ENDPOINT:
        `${ISSUER}/token`,

      REPO_CONTEXT_OAUTH_JWKS_URL:
        `${ISSUER}/jwks`,

      REPO_CONTEXT_CONNECTION_DB_PATH:
        runtimeDatabasePath,

      REPO_CONTEXT_USER_LOOKUP_KEY:
        randomBytes(
          32,
        ).toString(
          "base64",
        ),

      REPO_CONTEXT_CONNECTION_ENCRYPTION_KEY:
        randomBytes(
          32,
        ).toString(
          "base64",
        ),
    };

  /*
   * Operator configuration is optional.
   * OAuth mode without it remains valid.
   */
  const noOperatorRuntime =
    loadServerRuntimeFromEnv(
      baseOAuthEnv,
    );

  assert.equal(
    noOperatorRuntime.mode,
    "oauth",
  );

  if (
    noOperatorRuntime.mode !==
      "oauth"
  ) {
    assert.fail(
      "Expected OAuth runtime",
    );
  }

  assert.equal(
    noOperatorRuntime.operator,
    null,
  );

  noOperatorRuntime
    .store
    .close();

  /*
   * Partial operator configuration must
   * fail closed.
   */
  assert.throws(
    () =>
      loadServerRuntimeFromEnv({
        ...baseOAuthEnv,

        REPO_CONTEXT_OPERATOR_ID:
          OPERATOR_ID,
      }),
    /must provide .* together/,
  );

  assert.throws(
    () =>
      loadServerRuntimeFromEnv({
        ...baseOAuthEnv,

        REPO_CONTEXT_OPERATOR_ID:
          OPERATOR_ID,

        REPO_CONTEXT_OPERATOR_SUBJECT:
          OPERATOR_SUBJECT,
      }),
    /must provide .* together/,
  );

  /*
   * Operator reveal must never become
   * available in legacy mode.
   */
  assert.throws(
    () =>
      loadServerRuntimeFromEnv({
        REPO_CONTEXT_AUTH_MODE:
          "legacy",

        REPO_CONTEXT_OPERATOR_ID:
          OPERATOR_ID,

        REPO_CONTEXT_OPERATOR_SUBJECT:
          OPERATOR_SUBJECT,

        REPO_CONTEXT_OPERATOR_TOTP_SECRET:
          TOTP_SECRET,
      }),
    /only in OAuth mode/,
  );

  /*
   * Complete configuration binds the
   * operator to the OAuth issuer +
   * exact subject and creates both
   * security services.
   */
  const operatorRuntime =
    loadServerRuntimeFromEnv({
      ...baseOAuthEnv,

      REPO_CONTEXT_OPERATOR_ID:
        OPERATOR_ID,

      REPO_CONTEXT_OPERATOR_SUBJECT:
        OPERATOR_SUBJECT,

      REPO_CONTEXT_OPERATOR_TOTP_SECRET:
        TOTP_SECRET,
    });

  assert.equal(
    operatorRuntime.mode,
    "oauth",
  );

  if (
    operatorRuntime.mode !==
      "oauth"
  ) {
    assert.fail(
      "Expected OAuth runtime",
    );
  }

  assert.ok(
    operatorRuntime.operator,
  );

  assert.equal(
    operatorRuntime
      .operator
      ?.operatorId,
    OPERATOR_ID,
  );

  assert.deepEqual(
    operatorRuntime
      .operator
      ?.principal,
    {
      issuer:
        ISSUER,

      subject:
        OPERATOR_SUBJECT,
    },
  );

  operatorRuntime
    .store
    .close();

  let nowMs =
    59_000;

  const secret =
    decodeTotpSecret(
      TOTP_SECRET,
    );

  const sessions =
    new OperatorPrivilegedSessionService({
      operatorId:
        OPERATOR_ID,

      totpSecretBase32:
        TOTP_SECRET,

      now:
        () =>
          new Date(
            nowMs,
          ),
    });

  let revealCount =
    0;

  let lastReason:
    string | null =
      null;

  const reveal = {
    async reveal(
      connectionId: string,
      reason: string,
    ) {
      revealCount +=
        1;

      lastReason =
        reason;

      if (
        connectionId ===
          "missing"
      ) {
        throw new OperatorRevealError(
          "operator_reveal_not_found",
          "Repository connection not found",
        );
      }

      return {
        connectionId,

        userLookup:
          "ul1_should_not_leave_router",

        createdAt:
          "2026-10-01T12:00:00.000Z",

        revokedAt:
          null,

        payload: {
          version: 1 as const,
          provider:
            "github" as const,
          installationId:
            "123456",
          repositoryId:
            "900001",
          owner:
            "example-owner",
          name:
            "private-repository",
          branch:
            "main",
        },
      };
    },
  };

  const authenticate:
    RequestHandler = (
      request,
      response,
      next,
    ) => {
      const authorization =
        request.headers
          .authorization;

      if (
        authorization !==
          "Bearer operator-token" &&
        authorization !==
          "Bearer other-token"
      ) {
        response
          .status(401)
          .json({
            error:
              "unauthorized",
          });

        return;
      }

      next();
    };

  const getPrincipal =
    (
      request:
        Request,
    ) => ({
      issuer:
        ISSUER,

      subject:
        request.headers
          .authorization ===
        "Bearer operator-token"
          ? OPERATOR_SUBJECT
          : OTHER_SUBJECT,
    });

  const app =
    express();

  app.use(
    "/operator",

    createOperatorRouter({
      authenticate,
      getPrincipal,

      operatorId:
        OPERATOR_ID,

      operatorPrincipal: {
        issuer:
          ISSUER,

        subject:
          OPERATOR_SUBJECT,
      },

      sessions,
      reveal,
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
    const validCode =
      generateTotpCode(
        secret,
        nowMs,
      );

    /*
     * Valid OAuth identity that is not
     * the configured operator cannot
     * attempt MFA.
     */
    const forbidden =
      await fetch(
        `${base}/operator/session`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer other-token",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              totp_code:
                validCode,
            }),
        },
      );

    assert.equal(
      forbidden.status,
      403,
    );

    assert.equal(
      forbidden.headers.get(
        "cache-control",
      ),
      "no-store",
    );

    /*
     * The forbidden request must not
     * consume the operator's TOTP code.
     */
    const sessionResponse =
      await fetch(
        `${base}/operator/session`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer operator-token",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              totp_code:
                validCode,
            }),
        },
      );

    assert.equal(
      sessionResponse.status,
      201,
    );

    assert.equal(
      sessionResponse.headers.get(
        "cache-control",
      ),
      "no-store",
    );

    const sessionBody =
      await sessionResponse.json() as
        {
          session_token:
            string;

          expires_at:
            string;
        };

    assert.match(
      sessionBody
        .session_token,
      /^ops1\.[A-Za-z0-9_-]{43}$/,
    );

    /*
     * A valid privileged token is not
     * sufficient by itself. It remains
     * bound to the configured OAuth
     * operator identity.
     *
     * A forbidden principal must also
     * not consume the operator's token.
     */
    const stolenTokenAttempt =
      await fetch(
        `${base}/operator/reveal`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer other-token",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              session_token:
                sessionBody
                  .session_token,

              connection_id:
                "connection-123",

              reason:
                "Attempt stolen operator session",
            }),
        },
      );

    assert.equal(
      stolenTokenAttempt.status,
      403,
    );

    assert.equal(
      stolenTokenAttempt.headers.get(
        "cache-control",
      ),
      "no-store",
    );

    assert.equal(
      revealCount,
      0,
    );

    const revealResponse =
      await fetch(
        `${base}/operator/reveal`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer operator-token",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              session_token:
                sessionBody
                  .session_token,

              connection_id:
                "connection-123",

              reason:
                "Investigate support case 500",
            }),
        },
      );

    assert.equal(
      revealResponse.status,
      200,
    );

    assert.equal(
      revealResponse.headers.get(
        "cache-control",
      ),
      "no-store",
    );

    const revealBody =
      await revealResponse.json() as
        {
          connection: {
            id: string;
            created_at: string;
            revoked_at:
              string | null;
            payload:
              Record<
                string,
                unknown
              >;
            user_lookup?:
              string;
          };
        };

    assert.equal(
      revealBody
        .connection
        .id,
      "connection-123",
    );

    assert.equal(
      revealBody
        .connection
        .payload
        .name,
      "private-repository",
    );

    assert.equal(
      "user_lookup" in
        revealBody.connection,
      false,
    );

    assert.equal(
      lastReason,
      "Investigate support case 500",
    );

    assert.equal(
      revealCount,
      1,
    );

    /*
     * The privileged session is one-shot.
     */
    const replayResponse =
      await fetch(
        `${base}/operator/reveal`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer operator-token",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              session_token:
                sessionBody
                  .session_token,

              connection_id:
                "connection-123",

              reason:
                "Attempt token reuse",
            }),
        },
      );

    assert.equal(
      replayResponse.status,
      403,
    );

    assert.equal(
      revealCount,
      1,
    );

    /*
     * A fresh MFA step is required for
     * another reveal attempt.
     */
    nowMs =
      120_000;

    const secondSession =
      await fetch(
        `${base}/operator/session`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer operator-token",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              totp_code:
                generateTotpCode(
                  secret,
                  nowMs,
                ),
            }),
        },
      );

    assert.equal(
      secondSession.status,
      201,
    );

    const secondBody =
      await secondSession.json() as
        {
          session_token:
            string;
        };

    const missing =
      await fetch(
        `${base}/operator/reveal`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              "Bearer operator-token",

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              session_token:
                secondBody
                  .session_token,

              connection_id:
                "missing",

              reason:
                "Investigate support case 501",
            }),
        },
      );

    assert.equal(
      missing.status,
      404,
    );

    assert.equal(
      revealCount,
      2,
    );

    /*
     * No list/search endpoint exists.
     */
    const noList =
      await fetch(
        `${base}/operator`,
        {
          method:
            "GET",

          headers: {
            Authorization:
              "Bearer operator-token",
          },
        },
      );

    assert.equal(
      noList.status,
      404,
    );

    console.log(
      "Operator HTTP boundary: OK",
    );
  } finally {
    await stopServer(
      server,
    );

    rmSync(
      runtimeDirectory,
      {
        recursive: true,
        force: true,
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
