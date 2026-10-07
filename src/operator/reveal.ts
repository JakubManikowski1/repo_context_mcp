import {
  randomUUID,
} from "node:crypto";

import {
  decryptRepositoryConnection,
} from "../connections/crypto.js";

import type {
  OperatorRepositoryConnectionStore,
} from "./store.js";

import type {
  OperatorRevealAuditOutcome,
  OperatorSensitiveDataReveal,
} from "./types.js";

const MAX_CONNECTION_ID_LENGTH =
  200;

const MAX_OPERATOR_ID_LENGTH =
  200;

const MAX_REASON_LENGTH =
  500;

export type OperatorRevealErrorCode =
  | "operator_reveal_invalid_request"
  | "operator_reveal_not_found"
  | "operator_reveal_failed";

export class OperatorRevealError
  extends Error
{
  readonly code:
    OperatorRevealErrorCode;

  constructor(
    code:
      OperatorRevealErrorCode,
    message: string,
  ) {
    super(message);

    this.name =
      "OperatorRevealError";

    this.code = code;
  }
}

function requiredText(
  value: string,
  label: string,
  maxLength: number,
): string {
  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      maxLength
  ) {
    throw new OperatorRevealError(
      "operator_reveal_invalid_request",
      `${label} is invalid`,
    );
  }

  return normalized;
}

export class OperatorSensitiveDataRevealService {
  private readonly store:
    OperatorRepositoryConnectionStore;

  private readonly encryptionKey:
    Buffer;

  private readonly operatorId:
    string;

  private readonly now:
    () => Date;

  constructor(
    options: Readonly<{
      store:
        OperatorRepositoryConnectionStore;

      encryptionKey:
        Buffer;

      operatorId:
        string;

      now?: () => Date;
    }>,
  ) {
    this.store =
      options.store;

    this.encryptionKey =
      options.encryptionKey;

    this.operatorId =
      requiredText(
        options.operatorId,
        "operatorId",
        MAX_OPERATOR_ID_LENGTH,
      );

    this.now =
      options.now ??
      (() => new Date());
  }

  private async audit(
    connectionId: string,
    reason: string,
    outcome:
      OperatorRevealAuditOutcome,
  ): Promise<void> {
    await this.store
      .appendRevealAudit({
        id:
          randomUUID(),

        operatorId:
          this.operatorId,

        connectionId,

        reason,

        outcome,

        createdAt:
          this.now()
            .toISOString(),
      });
  }

  async reveal(
    rawConnectionId: string,
    rawReason: string,
  ): Promise<
    OperatorSensitiveDataReveal
  > {
    const connectionId =
      requiredText(
        rawConnectionId,
        "connectionId",
        MAX_CONNECTION_ID_LENGTH,
      );

    const reason =
      requiredText(
        rawReason,
        "reason",
        MAX_REASON_LENGTH,
      );

    const connection =
      await this.store
        .findByIdForOperator(
          connectionId,
        );

    if (!connection) {
      await this.audit(
        connectionId,
        reason,
        "not_found",
      );

      throw new OperatorRevealError(
        "operator_reveal_not_found",
        "Repository connection not found",
      );
    }

    let payload;

    try {
      payload =
        decryptRepositoryConnection(
          connection
            .encryptedPayload,
          this.encryptionKey,
          connection.id,
          connection.userLookup,
        );
    } catch {
      await this.audit(
        connectionId,
        reason,
        "decrypt_failed",
      );

      throw new OperatorRevealError(
        "operator_reveal_failed",
        "Repository connection could not be revealed",
      );
    }

    /*
     * Audit MUST succeed before plaintext
     * leaves this service.
     */
    await this.audit(
      connectionId,
      reason,
      "success",
    );

    return {
      connectionId:
        connection.id,

      userLookup:
        connection.userLookup,

      createdAt:
        connection.createdAt,

      revokedAt:
        connection.revokedAt,

      payload,
    };
  }
}
