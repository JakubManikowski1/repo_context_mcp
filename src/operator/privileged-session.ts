import {
  createHash,
  randomBytes,
} from "node:crypto";

import {
  decodeTotpSecret,
  verifyTotpCode,
} from "./totp.js";

const SESSION_PREFIX =
  "ops1";

const SESSION_RANDOM_BYTES =
  32;

export const PRIVILEGED_SESSION_TTL_MS =
  5 * 60 * 1000;

const MAX_OPERATOR_ID_LENGTH =
  200;

const MFA_FAILURE_WINDOW_MS =
  60 * 1000;

const MFA_MAX_FAILURES =
  5;

export type OperatorMfaErrorCode =
  | "operator_mfa_invalid"
  | "operator_mfa_replayed"
  | "operator_mfa_rate_limited"
  | "operator_session_invalid"
  | "operator_session_expired";

export class OperatorMfaError
  extends Error
{
  readonly code:
    OperatorMfaErrorCode;

  constructor(
    code:
      OperatorMfaErrorCode,
    message: string,
  ) {
    super(message);

    this.name =
      "OperatorMfaError";

    this.code = code;
  }
}

export type PrivilegedSessionStart =
  Readonly<{
    token: string;
    operatorId: string;
    expiresAt: string;
  }>;

export type PrivilegedSession =
  Readonly<{
    operatorId: string;
    authenticatedAt: string;
    expiresAt: string;
  }>;

type StoredSession =
  Readonly<{
    operatorId: string;
    authenticatedAtMs: number;
    expiresAtMs: number;
  }>;

function validOperatorId(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      MAX_OPERATOR_ID_LENGTH
  ) {
    throw new Error(
      "operatorId is invalid",
    );
  }

  return normalized;
}

function tokenHash(
  token: string,
): string {
  return createHash(
    "sha256",
  )
    .update(
      token,
      "utf8",
    )
    .digest(
      "base64url",
    );
}

function validSessionToken(
  rawToken: string,
): string | null {
  const token =
    rawToken.trim();

  if (
    !/^ops1\.[A-Za-z0-9_-]{43}$/.test(
      token,
    )
  ) {
    return null;
  }

  return token;
}

export class OperatorPrivilegedSessionService {
  private readonly operatorId:
    string;

  private readonly totpSecret:
    Buffer;

  private readonly now:
    () => Date;

  private readonly sessions =
    new Map<
      string,
      StoredSession
    >();

  private lastAcceptedCounter:
    number | null =
      null;

  private failedAttemptTimes:
    number[] = [];

  constructor(
    options: Readonly<{
      operatorId: string;
      totpSecretBase32: string;
      now?: () => Date;
    }>,
  ) {
    this.operatorId =
      validOperatorId(
        options.operatorId,
      );

    this.totpSecret =
      decodeTotpSecret(
        options.totpSecretBase32,
      );

    this.now =
      options.now ??
      (() => new Date());
  }

  private currentTimeMs():
    number {
    const value =
      this.now().getTime();

    if (
      !Number.isFinite(
        value,
      )
    ) {
      throw new Error(
        "Current time is invalid",
      );
    }

    return value;
  }

  issueSession(
    totpCode: string,
  ): PrivilegedSessionStart {
    const nowMs =
      this.currentTimeMs();

    this.failedAttemptTimes =
      this.failedAttemptTimes
        .filter(
          (attemptMs) =>
            nowMs -
              attemptMs <
            MFA_FAILURE_WINDOW_MS,
        );

    if (
      this.failedAttemptTimes
        .length >=
      MFA_MAX_FAILURES
    ) {
      throw new OperatorMfaError(
        "operator_mfa_rate_limited",
        "Too many invalid operator MFA attempts",
      );
    }

    const verification =
      verifyTotpCode(
        this.totpSecret,
        totpCode,
        nowMs,
      );

    if (!verification) {
      this.failedAttemptTimes
        .push(
          nowMs,
        );

      throw new OperatorMfaError(
        "operator_mfa_invalid",
        "Operator MFA code is invalid",
      );
    }

    if (
      this.lastAcceptedCounter !==
        null &&
      verification.counter <=
        this.lastAcceptedCounter
    ) {
      throw new OperatorMfaError(
        "operator_mfa_replayed",
        "Operator MFA code has already been used",
      );
    }

    this.failedAttemptTimes =
      [];

    this.lastAcceptedCounter =
      verification.counter;

    const token =
      [
        SESSION_PREFIX,
        randomBytes(
          SESSION_RANDOM_BYTES,
        ).toString(
          "base64url",
        ),
      ].join(
        ".",
      );

    const expiresAtMs =
      nowMs +
      PRIVILEGED_SESSION_TTL_MS;

    this.sessions.set(
      tokenHash(
        token,
      ),
      {
        operatorId:
          this.operatorId,

        authenticatedAtMs:
          nowMs,

        expiresAtMs,
      },
    );

    return {
      token,

      operatorId:
        this.operatorId,

      expiresAt:
        new Date(
          expiresAtMs,
        ).toISOString(),
    };
  }

  requireSession(
    rawToken: string,
  ): PrivilegedSession {
    const token =
      validSessionToken(
        rawToken,
      );

    if (!token) {
      throw new OperatorMfaError(
        "operator_session_invalid",
        "Privileged operator session is invalid",
      );
    }

    const key =
      tokenHash(
        token,
      );

    const session =
      this.sessions.get(
        key,
      );

    if (!session) {
      throw new OperatorMfaError(
        "operator_session_invalid",
        "Privileged operator session is invalid",
      );
    }

    const nowMs =
      this.currentTimeMs();

    if (
      session.expiresAtMs <=
        nowMs
    ) {
      this.sessions.delete(
        key,
      );

      throw new OperatorMfaError(
        "operator_session_expired",
        "Privileged operator session has expired",
      );
    }

    return {
      operatorId:
        session.operatorId,

      authenticatedAt:
        new Date(
          session.authenticatedAtMs,
        ).toISOString(),

      expiresAt:
        new Date(
          session.expiresAtMs,
        ).toISOString(),
    };
  }

  consumeSession(
    rawToken: string,
  ): PrivilegedSession {
    const session =
      this.requireSession(
        rawToken,
      );

    const token =
      validSessionToken(
        rawToken,
      );

    if (!token) {
      throw new OperatorMfaError(
        "operator_session_invalid",
        "Privileged operator session is invalid",
      );
    }

    this.sessions.delete(
      tokenHash(
        token,
      ),
    );

    return session;
  }

  revokeSession(
    rawToken: string,
  ): boolean {
    const token =
      validSessionToken(
        rawToken,
      );

    if (!token) {
      return false;
    }

    return this.sessions.delete(
      tokenHash(
        token,
      ),
    );
  }
}
