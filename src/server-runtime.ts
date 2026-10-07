import type {
  AuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import {
  RepositoryAccessResolver,
} from "./connections/resolver.js";

import {
  SqliteRepositoryConnectionStore,
} from "./connections/sqlite-store.js";

import {
  getLegacyRepositoryContext,
  type RepositoryContext,
} from "./repository-context.js";

import {
  createConnectionRepositoryAccess,
  createLegacyRepositoryAccess,
  type RepositoryToolAccess,
} from "./repository-access.js";

import {
  getAuthenticatedPrincipal,
} from "./auth/principal.js";

import {
  createJwtAccessTokenVerifier,
} from "./auth/jwt-verifier.js";

export type LegacyServerRuntime =
  Readonly<{
    mode: "legacy";
  }>;

export type OAuthServerRuntime =
  Readonly<{
    mode: "oauth";
    mcpServerUrl: URL;
    oauthMetadata: OAuthMetadata;
    verifier: OAuthTokenVerifier;
    requiredScopes: readonly string[];
    resolver: RepositoryAccessResolver;
    store: SqliteRepositoryConnectionStore;
  }>;

export type ServerRuntime =
  LegacyServerRuntime |
  OAuthServerRuntime;

export type RequestRepositoryAccess =
  Readonly<{
    repositoryAccess: RepositoryToolAccess;
    legacyRepository: RepositoryContext | null;
  }>;

function requiredString(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required in OAuth mode`,
    );
  }

  return value;
}

function validatedUrl(
  env: NodeJS.ProcessEnv,
  name: string,
): URL {
  const value =
    requiredString(env, name);

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${name} must be a valid absolute URL`,
    );
  }

  if (url.username || url.password) {
    throw new Error(
      `${name} must not contain URL credentials`,
    );
  }

  return url;
}

function exactIssuer(
  env: NodeJS.ProcessEnv,
): string {
  const value =
    requiredString(
      env,
      "REPO_CONTEXT_OAUTH_ISSUER",
    );

  try {
    const url = new URL(value);

    if (url.username || url.password) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "REPO_CONTEXT_OAUTH_ISSUER must be a valid absolute URL",
    );
  }

  // Keep the exact configured string because JWT `iss`
  // matching is exact, including a possible trailing slash.
  return value;
}

function base64Key(
  env: NodeJS.ProcessEnv,
  name: string,
): Buffer {
  const encoded =
    requiredString(env, name);

  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(
      encoded,
    )
  ) {
    throw new Error(
      `${name} must be standard base64`,
    );
  }

  const decoded =
    Buffer.from(encoded, "base64");

  if (decoded.length !== 32) {
    throw new Error(
      `${name} must decode to exactly 32 bytes`,
    );
  }

  const canonical =
    decoded
      .toString("base64")
      .replace(/=+$/, "");

  if (
    canonical !==
    encoded.replace(/=+$/, "")
  ) {
    throw new Error(
      `${name} must contain canonical base64`,
    );
  }

  return decoded;
}

function hasOptionalProfiles(
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    env.REPO_CONTEXT_FEATURES ??
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .some(Boolean);
}

export function loadServerRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServerRuntime {
  const mode =
    (
      env.REPO_CONTEXT_AUTH_MODE ??
      "legacy"
    )
      .trim()
      .toLowerCase();

  if (mode === "legacy") {
    return {
      mode: "legacy",
    };
  }

  if (mode !== "oauth") {
    throw new Error(
      "REPO_CONTEXT_AUTH_MODE must be either legacy or oauth",
    );
  }

  if (hasOptionalProfiles(env)) {
    throw new Error(
      "Optional profiles are legacy-only and must be disabled in OAuth mode",
    );
  }

  const mcpServerUrl =
    validatedUrl(
      env,
      "REPO_CONTEXT_MCP_URL",
    );

  if (
    mcpServerUrl.pathname !== "/mcp" ||
    mcpServerUrl.search ||
    mcpServerUrl.hash
  ) {
    throw new Error(
      "REPO_CONTEXT_MCP_URL must point exactly to the /mcp endpoint",
    );
  }

  const issuer =
    exactIssuer(env);

  const authorizationEndpoint =
    validatedUrl(
      env,
      "REPO_CONTEXT_OAUTH_AUTHORIZATION_ENDPOINT",
    );

  const tokenEndpoint =
    validatedUrl(
      env,
      "REPO_CONTEXT_OAUTH_TOKEN_ENDPOINT",
    );

  const jwksUrl =
    validatedUrl(
      env,
      "REPO_CONTEXT_OAUTH_JWKS_URL",
    );

  const databasePath =
    requiredString(
      env,
      "REPO_CONTEXT_CONNECTION_DB_PATH",
    );

  const lookupKey =
    base64Key(
      env,
      "REPO_CONTEXT_USER_LOOKUP_KEY",
    );

  const encryptionKey =
    base64Key(
      env,
      "REPO_CONTEXT_CONNECTION_ENCRYPTION_KEY",
    );

  if (
    lookupKey.equals(
      encryptionKey,
    )
  ) {
    throw new Error(
      "Repository connection lookup and encryption keys must be different",
    );
  }

  const store =
    new SqliteRepositoryConnectionStore(
      databasePath,
    );

  const resolver =
    new RepositoryAccessResolver({
      store,
      lookupKey,
      encryptionKey,
    });

  const oauthMetadata: OAuthMetadata = {
    issuer,

    authorization_endpoint:
      authorizationEndpoint.href,

    token_endpoint:
      tokenEndpoint.href,

    response_types_supported: [
      "code",
    ],

    grant_types_supported: [
      "authorization_code",
      "refresh_token",
    ],

    code_challenge_methods_supported: [
      "S256",
    ],
  };

  return {
    mode: "oauth",
    mcpServerUrl,
    oauthMetadata,

    verifier:
      createJwtAccessTokenVerifier({
        issuer,
        audience:
          mcpServerUrl.href,
        jwksUrl,
      }),

    requiredScopes: ["mcp"],
    resolver,
    store,
  };
}

export function createRequestRepositoryAccess(
  runtime: ServerRuntime,
  authInfo: AuthInfo | undefined,
): RequestRepositoryAccess {
  if (runtime.mode === "legacy") {
    const repository =
      getLegacyRepositoryContext();

    return {
      repositoryAccess:
        createLegacyRepositoryAccess(
          repository,
        ),

      legacyRepository:
        repository,
    };
  }

  const principal =
    getAuthenticatedPrincipal(
      authInfo,
    );

  return {
    repositoryAccess:
      createConnectionRepositoryAccess(
        runtime.resolver,
        principal,
      ),

    legacyRepository: null,
  };
}
