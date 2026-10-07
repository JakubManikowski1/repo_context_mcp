import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import {
  authenticatedPrincipalExtra,
} from "./principal.js";

const DEFAULT_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

export type JwtAccessTokenVerifierOptions =
  Readonly<{
    issuer: string;
    audience: string;
    jwksUrl: URL;
    algorithms?: readonly string[];
    clockToleranceSeconds?: number;
  }>;

function nonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0
  );
}

function readClientId(
  payload: Record<string, unknown>,
): string {
  if (
    nonEmptyString(
      payload.client_id,
    )
  ) {
    return payload.client_id;
  }

  if (
    nonEmptyString(
      payload.azp,
    )
  ) {
    return payload.azp;
  }

  throw new OAuthError(
    OAuthErrorCode.InvalidToken,
    "Access token does not identify its OAuth client",
  );
}

function readScopes(
  payload: Record<string, unknown>,
): string[] {
  const scopes = new Set<string>();

  if (
    typeof payload.scope === "string"
  ) {
    for (
      const scope
      of payload.scope.split(/\s+/)
    ) {
      if (scope) {
        scopes.add(scope);
      }
    }
  }

  if (
    typeof payload.scp === "string"
  ) {
    for (
      const scope
      of payload.scp.split(/\s+/)
    ) {
      if (scope) {
        scopes.add(scope);
      }
    }
  }

  if (
    Array.isArray(payload.scp)
  ) {
    for (const scope of payload.scp) {
      if (nonEmptyString(scope)) {
        scopes.add(scope);
      }
    }
  }

  return [...scopes];
}

export function createJwtAccessTokenVerifier(
  options: JwtAccessTokenVerifierOptions,
): OAuthTokenVerifier {
  if (!nonEmptyString(options.issuer)) {
    throw new TypeError(
      "issuer must be a non-empty string",
    );
  }

  if (!nonEmptyString(options.audience)) {
    throw new TypeError(
      "audience must be a non-empty string",
    );
  }

  const algorithms = [
    ...(
      options.algorithms ??
      DEFAULT_ALGORITHMS
    ),
  ];

  if (algorithms.length === 0) {
    throw new TypeError(
      "at least one JWT algorithm is required",
    );
  }

  const resource =
    new URL(options.audience);

  const jwks =
    createRemoteJWKSet(
      options.jwksUrl,
    );

  return {
    async verifyAccessToken(
      token: string,
    ): Promise<AuthInfo> {
      try {
        const { payload } =
          await jwtVerify(
            token,
            jwks,
            {
              issuer:
                options.issuer,

              audience:
                options.audience,

              algorithms,

              clockTolerance:
                options
                  .clockToleranceSeconds ??
                5,
            },
          );

        if (
          !nonEmptyString(
            payload.sub,
          )
        ) {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            "Access token has no subject",
          );
        }

        if (
          typeof payload.exp !==
            "number" ||
          !Number.isFinite(
            payload.exp,
          )
        ) {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            "Access token has no valid expiry",
          );
        }

        const clientId =
          readClientId(
            payload as
              Record<string, unknown>,
          );

        const scopes =
          readScopes(
            payload as
              Record<string, unknown>,
          );

        return {
          token,
          clientId,
          scopes,
          expiresAt:
            payload.exp,

          // jwtVerify already proved that aud contains
          // this configured resource.
          resource,

          extra:
            authenticatedPrincipalExtra({
              issuer:
                options.issuer,
              subject:
                payload.sub,
            }),
        };
      } catch (error) {
        if (
          error instanceof OAuthError
        ) {
          throw error;
        }

        // Do not leak JWT/JWKS verification detail
        // through the public OAuth challenge.
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Invalid access token",
        );
      }
    },
  };
}
