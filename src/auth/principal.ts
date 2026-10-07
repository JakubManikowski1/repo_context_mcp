import type {
  AuthInfo,
} from "@modelcontextprotocol/server";

import type {
  PrincipalIdentity,
} from "../connections/types.js";

export type AuthenticatedPrincipal =
  PrincipalIdentity;

export const AUTHENTICATED_PRINCIPAL_EXTRA_KEY =
  "repositoryContextPrincipal";

export type AuthenticationErrorCode =
  | "authentication_required"
  | "authenticated_principal_invalid";

export class AuthenticationError extends Error {
  readonly code: AuthenticationErrorCode;

  constructor(
    code: AuthenticationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
  }
}

function validIdentityPart(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0")
  );
}

export function authenticatedPrincipalExtra(
  principal: AuthenticatedPrincipal,
): Record<string, unknown> {
  if (
    !validIdentityPart(principal.issuer) ||
    !validIdentityPart(principal.subject)
  ) {
    throw new AuthenticationError(
      "authenticated_principal_invalid",
      "Authenticated principal is invalid",
    );
  }

  return {
    [AUTHENTICATED_PRINCIPAL_EXTRA_KEY]: {
      issuer: principal.issuer,
      subject: principal.subject,
    },
  };
}

export function getAuthenticatedPrincipal(
  authInfo: AuthInfo | undefined,
): AuthenticatedPrincipal {
  if (!authInfo) {
    throw new AuthenticationError(
      "authentication_required",
      "Authentication is required",
    );
  }

  const value =
    authInfo.extra?.[
      AUTHENTICATED_PRINCIPAL_EXTRA_KEY
    ];

  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new AuthenticationError(
      "authenticated_principal_invalid",
      "Verified token does not contain an authenticated principal",
    );
  }

  const principal =
    value as Record<string, unknown>;

  if (
    !validIdentityPart(principal.issuer) ||
    !validIdentityPart(principal.subject)
  ) {
    throw new AuthenticationError(
      "authenticated_principal_invalid",
      "Verified token contains an invalid authenticated principal",
    );
  }

  return {
    issuer: principal.issuer,
    subject: principal.subject,
  };
}
