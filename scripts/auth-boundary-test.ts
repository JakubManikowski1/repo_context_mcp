import assert from "node:assert/strict";

import type {
  AddressInfo,
} from "node:net";

import type {
  AuthInfo,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import {
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";

import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
} from "@modelcontextprotocol/express";

import {
  AUTHENTICATED_PRINCIPAL_EXTRA_KEY,
  authenticatedPrincipalExtra,
  getAuthenticatedPrincipal,
} from "../src/auth/principal.js";

const principal = {
  issuer:
    "https://issuer.example.test",
  subject:
    "user_subject_123",
};

async function main(): Promise<void> {
  const app = createMcpExpressApp();

  const httpServer =
    await new Promise<
      ReturnType<typeof app.listen>
    >((resolve) => {
      const server = app.listen(
        0,
        "127.0.0.1",
        () => resolve(server),
      );
    });

  const address =
    httpServer.address() as AddressInfo;

  const mcpServerUrl =
    new URL(
      `http://127.0.0.1:${address.port}/mcp`,
    );

  const metadataUrl =
    getOAuthProtectedResourceMetadataUrl(
      mcpServerUrl,
    );

  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(
      token: string,
    ): Promise<AuthInfo> {
      if (token === "invalid") {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Invalid token",
        );
      }

      const scopes =
        token === "missing-scope"
          ? []
          : ["mcp"];

      const expiresAt =
        token === "expired"
          ? Math.floor(Date.now() / 1000) - 60
          : Math.floor(Date.now() / 1000) + 3600;

      const resource =
        token === "wrong-resource"
          ? new URL(
              "https://different.example.test/mcp",
            )
          : mcpServerUrl;

      return {
        token,

        // Deliberately NOT the end-user subject.
        clientId: "mcp-client-application",

        scopes,
        expiresAt,
        resource,

        extra:
          authenticatedPrincipalExtra(
            principal,
          ),
      };
    },
  };

  const auth =
    requireBearerAuth({
      verifier,
      requiredScopes: ["mcp"],
      expectedResource:
        mcpServerUrl,
      resourceMetadataUrl:
        metadataUrl,
    });

  app.get(
    "/probe",
    auth,
    (req, res) => {
      const authInfo =
        (
          req as unknown as {
            auth?: AuthInfo;
          }
        ).auth;

      const authenticated =
        getAuthenticatedPrincipal(
          authInfo,
        );

      res.json({
        issuer:
          authenticated.issuer,
        subject:
          authenticated.subject,
        clientId:
          authInfo?.clientId,
      });
    },
  );

  const probeUrl =
    `http://127.0.0.1:${address.port}/probe`;

  try {
    // Missing token.
    const missing =
      await fetch(probeUrl);

    assert.equal(
      missing.status,
      401,
    );

    assert.match(
      missing.headers.get(
        "www-authenticate",
      ) ?? "",
      /Bearer/i,
    );

    assert.match(
      missing.headers.get(
        "www-authenticate",
      ) ?? "",
      /resource_metadata=/,
    );

    // Invalid token.
    const invalid =
      await fetch(
        probeUrl,
        {
          headers: {
            Authorization:
              "Bearer invalid",
          },
        },
      );

    assert.equal(
      invalid.status,
      401,
    );

    // Expired token.
    const expired =
      await fetch(
        probeUrl,
        {
          headers: {
            Authorization:
              "Bearer expired",
          },
        },
      );

    assert.equal(
      expired.status,
      401,
    );

    // Missing required scope.
    const missingScope =
      await fetch(
        probeUrl,
        {
          headers: {
            Authorization:
              "Bearer missing-scope",
          },
        },
      );

    assert.equal(
      missingScope.status,
      403,
    );

    // Wrong audience/resource.
    const wrongResource =
      await fetch(
        probeUrl,
        {
          headers: {
            Authorization:
              "Bearer wrong-resource",
          },
        },
      );

    assert.equal(
      wrongResource.status,
      401,
    );

    // Valid token.
    const valid =
      await fetch(
        probeUrl,
        {
          headers: {
            Authorization:
              "Bearer valid",
          },
        },
      );

    assert.equal(
      valid.status,
      200,
    );

    const body =
      await valid.json() as {
        issuer: string;
        subject: string;
        clientId: string;
      };

    assert.equal(
      body.issuer,
      principal.issuer,
    );

    assert.equal(
      body.subject,
      principal.subject,
    );

    assert.equal(
      body.clientId,
      "mcp-client-application",
    );

    assert.notEqual(
      body.subject,
      body.clientId,
      "OAuth clientId must not be treated as the end-user subject",
    );

    // Principal extraction itself must fail closed.
    assert.throws(
      () =>
        getAuthenticatedPrincipal(
          undefined,
        ),
      /Authentication is required/,
    );

    assert.throws(
      () =>
        getAuthenticatedPrincipal({
          token: "test",
          clientId: "client-only",
          scopes: ["mcp"],
          expiresAt:
            Math.floor(
              Date.now() / 1000,
            ) + 3600,
        }),
      /does not contain an authenticated principal/,
    );

    const malformedExtra = {
      token: "test",
      clientId: "client",
      scopes: ["mcp"],
      expiresAt:
        Math.floor(
          Date.now() / 1000,
        ) + 3600,
      extra: {
        [AUTHENTICATED_PRINCIPAL_EXTRA_KEY]: {
          issuer: principal.issuer,
          subject: "",
        },
      },
    } satisfies AuthInfo;

    assert.throws(
      () =>
        getAuthenticatedPrincipal(
          malformedExtra,
        ),
      /invalid authenticated principal/,
    );

    console.log(
      "Bearer auth boundary: OK",
    );
    console.log(
      "Missing/invalid/expired token rejection: OK",
    );
    console.log(
      "Required scope enforcement: OK",
    );
    console.log(
      "Resource/audience binding: OK",
    );
    console.log(
      "Authenticated principal extraction: OK",
    );
    console.log(
      "OAuth clientId != end-user subject: OK",
    );
  } finally {
    await new Promise<void>(
      (resolve, reject) => {
        httpServer.close(
          (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          },
        );
      },
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
