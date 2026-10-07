import type {
  NewRepositoryConnection,
  StoredRepositoryConnection,
} from "./types.js";

export interface RepositoryConnectionStore {
  create(
    connection: NewRepositoryConnection,
  ): Promise<void>;

  listActiveByUserLookup(
    userLookup: string,
  ): Promise<readonly StoredRepositoryConnection[]>;

  findActiveByIdForUser(
    userLookup: string,
    connectionId: string,
  ): Promise<StoredRepositoryConnection | null>;

  revokeByIdForUser(
    userLookup: string,
    connectionId: string,
    revokedAt: string,
  ): Promise<boolean>;
}
