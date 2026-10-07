import type {
  RepositoryConnectionPayload,
} from "../connections/types.js";

export type OperatorRevealAuditOutcome =
  | "success"
  | "not_found"
  | "decrypt_failed";

export type OperatorRevealAuditRecord =
  Readonly<{
    id: string;
    operatorId: string;
    connectionId: string;
    reason: string;
    outcome:
      OperatorRevealAuditOutcome;
    createdAt: string;
  }>;

export type OperatorSensitiveDataReveal =
  Readonly<{
    connectionId: string;
    userLookup: string;
    createdAt: string;
    revokedAt: string | null;
    payload:
      RepositoryConnectionPayload;
  }>;
