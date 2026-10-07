import assert from "node:assert/strict";

import type {
  AddressInfo,
} from "node:net";

import type {
  AuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import {
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";

import {
  createMcpExpressApp,
} from "@modelcontextprotocol/express";

import {
  authenticatedPrincipalExtra,
} from "../src/auth/principal.js";

import {
  configureOAuthResourceServer,
} from "../src/auth/resource-server.js";

async function main(): Promise<void> {
  const app =
    createMcpExpressApp();

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

  const origin =
    `http://127.0.0.1:${address.port}`;

  const mcpServerUrl =
    new URL(`${origin}/mcp`);

  const oauthMetadata:
    OAuthMetadata = {
      issuer:
        "https://auth.example.test",

      authorization_endpoint:
        "https://auth.example.test/authorize",

      token_endpoint:
        "https://auth.example.test/token",

      response_types_supported:
        ["code"],

      grant_types_supported:
        [
          "authorization_code",
          "refresh_token",
        ],

      code_challenge_methods_supported:
        ["S256"],
    };

  const verifier:
    OAuthTokenVerifier = {
      async verifyAccessToken(
        token: string,
      ): Promise<AuthInfo> {
        if (token !== "valid") {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            "Invalid token",
          );
        }

        return {
          token,
          clientId:
            "test-mcp-client",

          scopes: ["mcp"],

          expiresAt:
            Math.floor(
              Date.now() / 1000,
            ) + 3600,

          resource:
            mcpServerUrl,

          extra:
            authenticatedPrincipalExtra({
              issuer:
                oauthMetadata.issuer,
              subject:
                "test-user",
            }),
        };
      },
    };

  const {
    auth,
    resourceMetadataUrl,
  } =
    configureOAuthResourceServer(
      app,
      {
        mcpServerUrl,
        oauthMetadata,
        verifier,
        requiredScopes: ["mcp"],
        resourceName:
          "repo_context_mcp test",
      },
    );

  app.all(
    "/mcp",
    auth,
    (req, res) => {
      res.json({
        ok: true,
        authenticated:
          Boolean(
            (
              req as unknown as {
                auth?: AuthInfo;
              }
            ).auth,
          ),
      });
    },
  );

  try {
    // ---------------------------------------------------
    // Missing bearer token → RFC 9728 challenge.
    // ---------------------------------------------------

    const unauthorized =
      await fetch(
        mcpServerUrl,
      );

    assert.equal(
      unauthorized.status,
      401,
    );

    const challenge =
      unauthorized.headers.get(
        "www-authenticate",
      ) ?? "";

    assert.match(
      challenge,
      /^Bearer /i,
    );

    assert.ok(
      challenge.includes(
        "resource_metadata=",
      ),
    );

    assert.ok(
      challenge.includes(
        encodeURIComponent(
          resourceMetadataUrl,
        ),
      ) ||
      challenge.includes(
        resourceMetadataUrl,
      ),
      "401 challenge must advertise Protected Resource Metadata",
    );

    // ---------------------------------------------------
    // Path-aware RFC 9728 metadata.
    // ---------------------------------------------------

    const metadataResponse =
      await fetch(
        resourceMetadataUrl,
      );

    assert.equal(
      metadataResponse.status,
      200,
    );

    const protectedMetadata =
      await metadataResponse.json() as {
        resource: string;
        authorization_servers?: string[];
        scopes_supported?: string[];
        resource_name?: string;
      };

    assert.equal(
      protectedMetadata.resource,
      mcpServerUrl.href,
    );

    assert.ok(
      protectedMetadata
        .authorization_servers
        ?.includes(
          oauthMetadata.issuer,
        ),
    );

    assert.ok(
      protectedMetadata
        .scopes_supported
        ?.includes("mcp"),
    );

    // ---------------------------------------------------
    // Authorization Server metadata mirror.
    // ---------------------------------------------------

    const asMetadataResponse =
      await fetch(
        `${origin}/.well-known/oauth-authorization-server`,
      );

    assert.equal(
      asMetadataResponse.status,
      200,
    );

    const mirroredMetadata =
      await asMetadataResponse.json() as {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
      };

    assert.equal(
      mirroredMetadata.issuer,
      oauthMetadata.issuer,
    );

    assert.equal(
      mirroredMetadata
        .authorization_endpoint,
      oauthMetadata
        .authorization_endpoint,
    );

    assert.equal(
      mirroredMetadata
        .token_endpoint,
      oauthMetadata
        .token_endpoint,
    );

    // ---------------------------------------------------
    // Invalid bearer.
    // ---------------------------------------------------

    const invalid =
      await fetch(
        mcpServerUrl,
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

    // ---------------------------------------------------
    // Valid bearer reaches protected route.
    // ---------------------------------------------------

    const valid =
      await fetch(
        mcpServerUrl,
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

    assert.deepEqual(
      await valid.json(),
      {
        ok: true,
        authenticated: true,
      },
    );

    console.log(
      "OAuth resource-server wiring: OK",
    );

    console.log(
      "Protected /mcp bearer gate: OK",
    );

    console.log(
      "WWW-Authenticate resource_metadata: OK",
    );

    console.log(
      "Path-aware RFC 9728 metadata: OK",
    );

    console.log(
      "Authorization Server metadata mirror: OK",
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
