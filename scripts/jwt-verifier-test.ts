import assert from "node:assert/strict";

import {
  createServer,
} from "node:http";

import type {
  AddressInfo,
} from "node:net";

import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import {
  getAuthenticatedPrincipal,
} from "../src/auth/principal.js";

import {
  createJwtAccessTokenVerifier,
} from "../src/auth/jwt-verifier.js";

async function expectInvalid(
  verify:
    ReturnType<
      typeof createJwtAccessTokenVerifier
    >["verifyAccessToken"],
  token: string,
): Promise<void> {
  await assert.rejects(
    () => verify(token),
    /Invalid|Access token/,
  );
}

async function main(): Promise<void> {
  const {
    publicKey,
    privateKey,
  } =
    await generateKeyPair(
      "RS256",
    );

  const publicJwk =
    await exportJWK(publicKey);

  const kid = "test-key-1";

  const jwks = {
    keys: [
      {
        ...publicJwk,
        kid,
        alg: "RS256",
        use: "sig",
      },
    ],
  };

  const server =
    createServer(
      (req, res) => {
        if (
          req.url !==
          "/.well-known/jwks.json"
        ) {
          res.statusCode = 404;
          res.end();
          return;
        }

        res.setHeader(
          "content-type",
          "application/json",
        );

        res.end(
          JSON.stringify(jwks),
        );
      },
    );

  await new Promise<void>(
    (resolve) => {
      server.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const address =
    server.address() as AddressInfo;

  const jwksUrl =
    new URL(
      `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    );

  const issuer =
    "https://auth.example.test";

  const audience =
    "https://mcp.example.test/mcp";

  const verifier =
    createJwtAccessTokenVerifier({
      issuer,
      audience,
      jwksUrl,
      algorithms: ["RS256"],
      clockToleranceSeconds: 0,
    });

  async function sign(
    claims:
      Record<string, unknown>,
  ): Promise<string> {
    const now =
      Math.floor(
        Date.now() / 1000,
      );

    return new SignJWT(
      claims,
    )
      .setProtectedHeader({
        alg: "RS256",
        kid,
      })
      .setIssuer(
        issuer,
      )
      .setAudience(
        audience,
      )
      .setIssuedAt(now)
      .setExpirationTime(
        now + 3600,
      )
      .sign(privateKey);
  }

  try {
    // -------------------------------------------------
    // Valid token.
    // -------------------------------------------------

    const validToken =
      await sign({
        sub: "user_123",
        client_id:
          "chatgpt-mcp-client",
        scope:
          "mcp profile",
      });

    const auth =
      await verifier
        .verifyAccessToken(
          validToken,
        );

    assert.equal(
      auth.clientId,
      "chatgpt-mcp-client",
    );

    assert.deepEqual(
      auth.scopes,
      ["mcp", "profile"],
    );

    assert.equal(
      auth.resource?.href,
      audience,
    );

    const principal =
      getAuthenticatedPrincipal(
        auth,
      );

    assert.deepEqual(
      principal,
      {
        issuer,
        subject: "user_123",
      },
    );

    assert.notEqual(
      auth.clientId,
      principal.subject,
      "OAuth client and human subject must remain distinct",
    );

    // -------------------------------------------------
    // azp fallback for providers that use it instead of
    // client_id.
    // -------------------------------------------------

    const azpToken =
      await sign({
        sub: "user_123",
        azp:
          "authorized-party",
        scp: [
          "mcp",
          "repo:read",
        ],
      });

    const azpAuth =
      await verifier
        .verifyAccessToken(
          azpToken,
        );

    assert.equal(
      azpAuth.clientId,
      "authorized-party",
    );

    assert.deepEqual(
      azpAuth.scopes,
      [
        "mcp",
        "repo:read",
      ],
    );

    // -------------------------------------------------
    // Wrong issuer.
    // -------------------------------------------------

    const now =
      Math.floor(
        Date.now() / 1000,
      );

    const wrongIssuer =
      await new SignJWT({
        sub: "user_123",
        client_id: "client",
        scope: "mcp",
      })
        .setProtectedHeader({
          alg: "RS256",
          kid,
        })
        .setIssuer(
          "https://evil.example.test",
        )
        .setAudience(
          audience,
        )
        .setIssuedAt(now)
        .setExpirationTime(
          now + 3600,
        )
        .sign(privateKey);

    await expectInvalid(
      verifier.verifyAccessToken,
      wrongIssuer,
    );

    // -------------------------------------------------
    // Wrong audience/resource.
    // -------------------------------------------------

    const wrongAudience =
      await new SignJWT({
        sub: "user_123",
        client_id: "client",
        scope: "mcp",
      })
        .setProtectedHeader({
          alg: "RS256",
          kid,
        })
        .setIssuer(
          issuer,
        )
        .setAudience(
          "https://other.example.test/mcp",
        )
        .setIssuedAt(now)
        .setExpirationTime(
          now + 3600,
        )
        .sign(privateKey);

    await expectInvalid(
      verifier.verifyAccessToken,
      wrongAudience,
    );

    // -------------------------------------------------
    // Expired.
    // -------------------------------------------------

    const expired =
      await new SignJWT({
        sub: "user_123",
        client_id: "client",
        scope: "mcp",
      })
        .setProtectedHeader({
          alg: "RS256",
          kid,
        })
        .setIssuer(
          issuer,
        )
        .setAudience(
          audience,
        )
        .setIssuedAt(
          now - 120,
        )
        .setExpirationTime(
          now - 60,
        )
        .sign(privateKey);

    await expectInvalid(
      verifier.verifyAccessToken,
      expired,
    );

    // -------------------------------------------------
    // Missing human subject.
    // -------------------------------------------------

    const noSubject =
      await sign({
        client_id:
          "chatgpt-mcp-client",
        scope: "mcp",
      });

    await expectInvalid(
      verifier.verifyAccessToken,
      noSubject,
    );

    // -------------------------------------------------
    // Missing OAuth client identity.
    // -------------------------------------------------

    const noClient =
      await sign({
        sub: "user_123",
        scope: "mcp",
      });

    await expectInvalid(
      verifier.verifyAccessToken,
      noClient,
    );

    // -------------------------------------------------
    // Tampered signature.
    // -------------------------------------------------

    const [
      header,
      payload,
      signature,
    ] =
      validToken.split(".");

    assert.ok(
      header &&
      payload &&
      signature,
      "JWT must contain header, payload, and signature",
    );

    const replacement =
      signature[0] === "A"
        ? "B"
        : "A";

    const tampered =
      `${header}.${payload}.${replacement}${signature.slice(1)}`;

    assert.notEqual(
      tampered,
      validToken,
    );

    await expectInvalid(
      verifier.verifyAccessToken,
      tampered,
    );

    console.log(
      "JWT/JWKS access-token verifier: OK",
    );
    console.log(
      "Signature verification: OK",
    );
    console.log(
      "Issuer validation: OK",
    );
    console.log(
      "Audience/resource validation: OK",
    );
    console.log(
      "Expiry validation: OK",
    );
    console.log(
      "Human subject extraction: OK",
    );
    console.log(
      "OAuth client identity separated from subject: OK",
    );
    console.log(
      "scope/scp parsing: OK",
    );
  } finally {
    await new Promise<void>(
      (resolve, reject) => {
        server.close(
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
