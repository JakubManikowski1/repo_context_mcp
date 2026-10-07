import Database from "better-sqlite3";

import type {
  NewRepositoryConnection,
  StoredRepositoryConnection,
} from "./types.js";

import type {
  RepositoryConnectionStore,
} from "./store.js";

import type {
  OperatorRepositoryConnectionStore,
} from "../operator/store.js";

import type {
  OperatorRevealAuditRecord,
} from "../operator/types.js";

type RepositoryConnectionRow = {
  id: string;
  user_lookup: string;
  encrypted_payload: string;
  created_at: string;
  revoked_at: string | null;
};

function mapRow(
  row: RepositoryConnectionRow,
): StoredRepositoryConnection {
  return {
    id: row.id,
    userLookup: row.user_lookup,
    encryptedPayload: row.encrypted_payload,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export class SqliteRepositoryConnectionStore
  implements
    RepositoryConnectionStore,
    OperatorRepositoryConnectionStore
{
  private readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repository_connections (
        id TEXT PRIMARY KEY,
        user_lookup TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS
        repository_connections_active_user_idx
      ON repository_connections (
        user_lookup,
        revoked_at
      );

      CREATE TABLE IF NOT EXISTS
        operator_reveal_audit (
          id TEXT PRIMARY KEY,
          operator_id TEXT NOT NULL,
          connection_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          outcome TEXT NOT NULL
            CHECK (
              outcome IN (
                'success',
                'not_found',
                'decrypt_failed'
              )
            ),
          created_at TEXT NOT NULL
        ) STRICT;

      CREATE INDEX IF NOT EXISTS
        operator_reveal_audit_created_idx
      ON operator_reveal_audit (
        created_at,
        id
      );

      CREATE TRIGGER IF NOT EXISTS
        operator_reveal_audit_no_update
      BEFORE UPDATE ON
        operator_reveal_audit
      BEGIN
        SELECT RAISE(
          ABORT,
          'operator_reveal_audit is append-only'
        );
      END;

      CREATE TRIGGER IF NOT EXISTS
        operator_reveal_audit_no_delete
      BEFORE DELETE ON
        operator_reveal_audit
      BEGIN
        SELECT RAISE(
          ABORT,
          'operator_reveal_audit is append-only'
        );
      END;
    `);
  }

  create(
    connection: NewRepositoryConnection,
  ): Promise<void> {
    this.db.prepare(`
      INSERT INTO repository_connections (
        id,
        user_lookup,
        encrypted_payload,
        created_at,
        revoked_at
      )
      VALUES (
        @id,
        @userLookup,
        @encryptedPayload,
        @createdAt,
        NULL
      )
    `).run({
      id: connection.id,
      userLookup: connection.userLookup,
      encryptedPayload:
        connection.encryptedPayload,
      createdAt: connection.createdAt,
    });

    return Promise.resolve();
  }

  listActiveByUserLookup(
    userLookup: string,
  ): Promise<readonly StoredRepositoryConnection[]> {
    const rows = this.db.prepare(`
      SELECT
        id,
        user_lookup,
        encrypted_payload,
        created_at,
        revoked_at
      FROM repository_connections
      WHERE
        user_lookup = ?
        AND revoked_at IS NULL
      ORDER BY
        created_at ASC,
        id ASC
    `).all(userLookup) as RepositoryConnectionRow[];

    return Promise.resolve(
      rows.map(mapRow),
    );
  }

  findActiveByIdForUser(
    userLookup: string,
    connectionId: string,
  ): Promise<StoredRepositoryConnection | null> {
    const row = this.db.prepare(`
      SELECT
        id,
        user_lookup,
        encrypted_payload,
        created_at,
        revoked_at
      FROM repository_connections
      WHERE
        id = ?
        AND user_lookup = ?
        AND revoked_at IS NULL
      LIMIT 1
    `).get(
      connectionId,
      userLookup,
    ) as RepositoryConnectionRow | undefined;

    return Promise.resolve(
      row ? mapRow(row) : null,
    );
  }

  revokeByIdForUser(
    userLookup: string,
    connectionId: string,
    revokedAt: string,
  ): Promise<boolean> {
    const result = this.db.prepare(`
      UPDATE repository_connections
      SET revoked_at = ?
      WHERE
        id = ?
        AND user_lookup = ?
        AND revoked_at IS NULL
    `).run(
      revokedAt,
      connectionId,
      userLookup,
    );

    return Promise.resolve(
      result.changes === 1,
    );
  }

  findByIdForOperator(
    connectionId: string,
  ): Promise<
    StoredRepositoryConnection | null
  > {
    const row = this.db.prepare(`
      SELECT
        id,
        user_lookup,
        encrypted_payload,
        created_at,
        revoked_at
      FROM repository_connections
      WHERE id = ?
      LIMIT 1
    `).get(
      connectionId,
    ) as
      RepositoryConnectionRow |
      undefined;

    return Promise.resolve(
      row ? mapRow(row) : null,
    );
  }

  appendRevealAudit(
    record:
      OperatorRevealAuditRecord,
  ): Promise<void> {
    this.db.prepare(`
      INSERT INTO operator_reveal_audit (
        id,
        operator_id,
        connection_id,
        reason,
        outcome,
        created_at
      )
      VALUES (
        @id,
        @operatorId,
        @connectionId,
        @reason,
        @outcome,
        @createdAt
      )
    `).run({
      id:
        record.id,

      operatorId:
        record.operatorId,

      connectionId:
        record.connectionId,

      reason:
        record.reason,

      outcome:
        record.outcome,

      createdAt:
        record.createdAt,
    });

    return Promise.resolve();
  }

  close(): void {
    this.db.close();
  }
}
