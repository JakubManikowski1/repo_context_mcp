import {
  Router,
  json,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import type {
  PrincipalIdentity,
} from "../connections/types.js";

import {
  OperatorMfaError,
  type PrivilegedSession,
  type PrivilegedSessionStart,
} from "./privileged-session.js";

import {
  OperatorRevealError,
} from "./reveal.js";

import type {
  OperatorSensitiveDataReveal,
} from "./types.js";

const MAX_JSON_BODY =
  "8kb";

type OperatorSessionLike =
  Readonly<{
    issueSession(
      totpCode: string,
    ): PrivilegedSessionStart;

    consumeSession(
      token: string,
    ): PrivilegedSession;
  }>;

type OperatorRevealLike =
  Readonly<{
    reveal(
      connectionId: string,
      reason: string,
    ): Promise<
      OperatorSensitiveDataReveal
    >;
  }>;

export type OperatorRouterOptions =
  Readonly<{
    authenticate:
      RequestHandler;

    getPrincipal(
      request: Request,
    ): PrincipalIdentity;

    operatorId: string;

    operatorPrincipal:
      PrincipalIdentity;

    sessions:
      OperatorSessionLike;

    reveal:
      OperatorRevealLike;
  }>;

class OperatorHttpError
  extends Error
{
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);

    this.name =
      "OperatorHttpError";
  }
}

function samePrincipal(
  left: PrincipalIdentity,
  right: PrincipalIdentity,
): boolean {
  return (
    left.issuer ===
      right.issuer &&
    left.subject ===
      right.subject
  );
}

function noStore(
  response: Response,
): void {
  response.setHeader(
    "Cache-Control",
    "no-store",
  );
}

function bodyString(
  request: Request,
  name: string,
  maxLength: number,
): string {
  const value =
    request.body?.[name];

  if (
    typeof value !==
      "string"
  ) {
    throw new OperatorHttpError(
      400,
      "operator_invalid_request",
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      maxLength
  ) {
    throw new OperatorHttpError(
      400,
      "operator_invalid_request",
    );
  }

  return normalized;
}

function requireOperator(
  request: Request,
  options:
    OperatorRouterOptions,
): void {
  const principal =
    options.getPrincipal(
      request,
    );

  if (
    !samePrincipal(
      principal,
      options.operatorPrincipal,
    )
  ) {
    throw new OperatorHttpError(
      403,
      "operator_forbidden",
    );
  }
}

function sendError(
  response: Response,
  error: unknown,
): void {
  if (
    error instanceof
      OperatorHttpError
  ) {
    response
      .status(
        error.status,
      )
      .json({
        error:
          error.code,
      });

    return;
  }

  if (
    error instanceof
      OperatorMfaError
  ) {
    if (
      error.code ===
        "operator_mfa_rate_limited"
    ) {
      response.setHeader(
        "Retry-After",
        "60",
      );

      response
        .status(429)
        .json({
          error:
            "operator_mfa_rate_limited",
        });

      return;
    }

    if (
      error.code ===
        "operator_session_invalid" ||
      error.code ===
        "operator_session_expired"
    ) {
      response
        .status(403)
        .json({
          error:
            "operator_session_invalid",
        });

      return;
    }

    response
      .status(403)
      .json({
        error:
          "operator_mfa_invalid",
      });

    return;
  }

  if (
    error instanceof
      OperatorRevealError
  ) {
    if (
      error.code ===
        "operator_reveal_invalid_request"
    ) {
      response
        .status(400)
        .json({
          error:
            "operator_invalid_request",
        });

      return;
    }

    if (
      error.code ===
        "operator_reveal_not_found"
    ) {
      response
        .status(404)
        .json({
          error:
            "operator_reveal_not_found",
        });

      return;
    }

    response
      .status(500)
      .json({
        error:
          "operator_reveal_failed",
      });

    return;
  }

  response
    .status(500)
    .json({
      error:
        "operator_internal_error",
    });
}

export function createOperatorRouter(
  options:
    OperatorRouterOptions,
): Router {
  const router =
    Router();

  /*
   * Sensitive responses and errors must
   * never be cached.
   */
  router.use(
    (
      _request,
      response,
      next,
    ) => {
      noStore(
        response,
      );

      next();
    },
  );

  /*
   * Every operator route requires the
   * normal OAuth bearer token first.
   */
  router.use(
    options.authenticate,
  );

  router.use(
    json({
      limit:
        MAX_JSON_BODY,
    }),
  );

  router.post(
    "/session",
    (
      request,
      response,
    ) => {
      try {
        requireOperator(
          request,
          options,
        );

        const totpCode =
          bodyString(
            request,
            "totp_code",
            16,
          );

        const session =
          options.sessions
            .issueSession(
              totpCode,
            );

        response
          .status(201)
          .json({
            session_token:
              session.token,

            expires_at:
              session.expiresAt,
          });
      } catch (error) {
        sendError(
          response,
          error,
        );
      }
    },
  );

  router.post(
    "/reveal",
    async (
      request,
      response,
    ) => {
      try {
        requireOperator(
          request,
          options,
        );

        const sessionToken =
          bodyString(
            request,
            "session_token",
            200,
          );

        const connectionId =
          bodyString(
            request,
            "connection_id",
            200,
          );

        const reason =
          bodyString(
            request,
            "reason",
            500,
          );

        /*
         * Consume before decrypting.
         * One fresh MFA session authorizes
         * exactly one reveal attempt.
         */
        const session =
          options.sessions
            .consumeSession(
              sessionToken,
            );

        if (
          session.operatorId !==
            options.operatorId
        ) {
          throw new OperatorHttpError(
            403,
            "operator_session_invalid",
          );
        }

        const revealed =
          await options.reveal
            .reveal(
              connectionId,
              reason,
            );

        /*
         * userLookup intentionally does not
         * leave the operator HTTP boundary.
         */
        response.json({
          connection: {
            id:
              revealed
                .connectionId,

            created_at:
              revealed
                .createdAt,

            revoked_at:
              revealed
                .revokedAt,

            payload:
              revealed.payload,
          },
        });
      } catch (error) {
        sendError(
          response,
          error,
        );
      }
    },
  );

  return router;
}
