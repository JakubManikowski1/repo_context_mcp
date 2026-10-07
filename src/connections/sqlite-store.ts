import Database from "better-sqlite3";

import type {
  NewRepositoryConnection,
  StoredRepositoryConnection,
} from "./types.js";

import type {
  RepositoryConnectionStore,
} from "./store.js";

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
  implements RepositoryConnectionStore
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

  close(): void {
    this.db.close();
  }
}
