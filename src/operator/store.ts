import type {
  StoredRepositoryConnection,
} from "../connections/types.js";

import type {
  OperatorRevealAuditRecord,
} from "./types.js";

export interface OperatorRepositoryConnectionStore {
  findByIdForOperator(
    connectionId: string,
  ): Promise<
    StoredRepositoryConnection | null
  >;

  appendRevealAudit(
    record:
      OperatorRevealAuditRecord,
  ): Promise<void>;
}
