import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import {
  decryptRepositoryConnection,
  deriveUserLookup,
  encryptRepositoryConnection,
} from "../src/connections/crypto.js";

import {
  SqliteRepositoryConnectionStore,
} from "../src/connections/sqlite-store.js";

import type {
  PrincipalIdentity,
  RepositoryConnectionPayload,
} from "../src/connections/types.js";

const lookupKey = randomBytes(32);
const encryptionKey = randomBytes(32);

const principalA: PrincipalIdentity = {
  issuer:
    "https://identity-a.example.test/tenant-sensitive-alpha",
  subject:
    "oauth-subject-sensitive-user-alpha-8c74fc",
};

const principalB: PrincipalIdentity = {
  issuer:
    "https://identity-b.example.test/tenant-sensitive-beta",
  subject:
    "oauth-subject-sensitive-user-beta-92bd31",
};

const payloadA: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId:
    "installation-sensitive-alpha-824791635",
  repositoryId:
    "repository-id-sensitive-alpha-519284736",
  owner:
    "private-owner-sensitive-alpha-7d31e4",
  name:
    "private-repository-sensitive-alpha-f862c9",
  branch:
    "private-branch-sensitive-alpha-a918d3",
};

const payloadB: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId:
    "installation-sensitive-beta-173946285",
  repositoryId:
    "repository-id-sensitive-beta-638251947",
  owner:
    "private-owner-sensitive-beta-4c81a2",
  name:
    "private-repository-sensitive-beta-e137bc",
  branch:
    "private-branch-sensitive-beta-b732f1",
};

const connectionA = "conn_test_alpha";
const connectionB = "conn_test_beta";

const createdAtA =
  "2026-10-07T10:00:00.000Z";

const createdAtB =
  "2026-10-07T10:01:00.000Z";

const revokedAt =
  "2026-10-07T11:00:00.000Z";

const userLookupA = deriveUserLookup(
  principalA,
  lookupKey,
);

const userLookupB = deriveUserLookup(
  principalB,
  lookupKey,
);

const encryptedA =
  encryptRepositoryConnection(
    payloadA,
    encryptionKey,
    connectionA,
    userLookupA,
  );

const encryptedB =
  encryptRepositoryConnection(
    payloadB,
    encryptionKey,
    connectionB,
    userLookupB,
  );

const sensitivePlaintext = [
  principalA.issuer,
  principalA.subject,
  principalB.issuer,
  principalB.subject,

  payloadA.installationId,
  payloadA.repositoryId,
  payloadA.owner,
  payloadA.name,
  payloadA.branch,

  payloadB.installationId,
  payloadB.repositoryId,
  payloadB.owner,
  payloadB.name,
  payloadB.branch,
];

function assertNoSensitivePlaintext(
  directory: string,
  stage: string,
): void {
  const files = readdirSync(directory);

  assert.ok(
    files.length > 0,
    `${stage}: expected SQLite files`,
  );

  for (const filename of files) {
    const path = join(
      directory,
      filename,
    );

    const bytes = readFileSync(path);

    for (const secret of sensitivePlaintext) {
      assert.equal(
        bytes.includes(
          Buffer.from(secret, "utf8"),
        ),
        false,
        `${stage}: plaintext leaked into ${filename}: ${secret}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const directory = mkdtempSync(
    join(
      tmpdir(),
      "repo-context-connection-store-",
    ),
  );

  const databasePath = join(
    directory,
    "connections.sqlite",
  );

  try {
    // -----------------------------------------------------
    // Initial write
    // -----------------------------------------------------

    let store =
      new SqliteRepositoryConnectionStore(
        databasePath,
      );

    await store.create({
      id: connectionA,
      userLookup: userLookupA,
      encryptedPayload: encryptedA,
      createdAt: createdAtA,
    });

    await store.create({
      id: connectionB,
      userLookup: userLookupB,
      encryptedPayload: encryptedB,
      createdAt: createdAtB,
    });

    // -----------------------------------------------------
    // User isolation
    // -----------------------------------------------------

    const listA =
      await store.listActiveByUserLookup(
        userLookupA,
      );

    const listB =
      await store.listActiveByUserLookup(
        userLookupB,
      );

    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);

    assert.equal(
      listA[0]?.id,
      connectionA,
    );

    assert.equal(
      listB[0]?.id,
      connectionB,
    );

    assert.equal(
      await store.findActiveByIdForUser(
        userLookupA,
        connectionB,
      ),
      null,
      "user A must not read user B connection",
    );

    assert.equal(
      await store.findActiveByIdForUser(
        userLookupB,
        connectionA,
      ),
      null,
      "user B must not read user A connection",
    );

    // Check the actual SQLite/WAL files while WAL is active.
    assertNoSensitivePlaintext(
      directory,
      "open database",
    );

    store.close();

    // -----------------------------------------------------
    // Persistence across reopen
    // -----------------------------------------------------

    store =
      new SqliteRepositoryConnectionStore(
        databasePath,
      );

    const reopenedA =
      await store.findActiveByIdForUser(
        userLookupA,
        connectionA,
      );

    const reopenedB =
      await store.findActiveByIdForUser(
        userLookupB,
        connectionB,
      );

    assert.ok(reopenedA);
    assert.ok(reopenedB);

    assert.equal(
      reopenedA.userLookup,
      userLookupA,
    );

    assert.equal(
      reopenedB.userLookup,
      userLookupB,
    );

    assert.deepEqual(
      decryptRepositoryConnection(
        reopenedA.encryptedPayload,
        encryptionKey,
        reopenedA.id,
        reopenedA.userLookup,
      ),
      payloadA,
    );

    assert.deepEqual(
      decryptRepositoryConnection(
        reopenedB.encryptedPayload,
        encryptionKey,
        reopenedB.id,
        reopenedB.userLookup,
      ),
      payloadB,
    );

    // -----------------------------------------------------
    // Revocation
    // -----------------------------------------------------

    assert.equal(
      await store.revokeByIdForUser(
        userLookupA,
        connectionA,
        revokedAt,
      ),
      true,
    );

    assert.equal(
      await store.revokeByIdForUser(
        userLookupA,
        connectionA,
        revokedAt,
      ),
      false,
      "revoking an already revoked connection must not succeed twice",
    );

    assert.equal(
      await store.findActiveByIdForUser(
        userLookupA,
        connectionA,
      ),
      null,
    );

    assert.deepEqual(
      await store.listActiveByUserLookup(
        userLookupA,
      ),
      [],
    );

    assert.ok(
      await store.findActiveByIdForUser(
        userLookupB,
        connectionB,
      ),
      "revoking user A must not affect user B",
    );

    store.close();

    // -----------------------------------------------------
    // Inspect persisted schema and raw records directly.
    // -----------------------------------------------------

    const rawDb = new Database(
      databasePath,
      {
        readonly: true,
      },
    );

    try {
      const columns = rawDb
        .prepare(
          "PRAGMA table_info(repository_connections)",
        )
        .all() as Array<{
          name: string;
        }>;

      assert.deepEqual(
        columns.map(
          (column) => column.name,
        ),
        [
          "id",
          "user_lookup",
          "encrypted_payload",
          "created_at",
          "revoked_at",
        ],
        "database must contain only the minimal storage columns",
      );

      const rows = rawDb
        .prepare(`
          SELECT
            id,
            user_lookup,
            encrypted_payload,
            created_at,
            revoked_at
          FROM repository_connections
          ORDER BY id ASC
        `)
        .all() as Array<{
          id: string;
          user_lookup: string;
          encrypted_payload: string;
          created_at: string;
          revoked_at: string | null;
        }>;

      assert.equal(rows.length, 2);

      for (const row of rows) {
        assert.match(
          row.user_lookup,
          /^ul1_[A-Za-z0-9_-]+$/,
        );

        assert.match(
          row.encrypted_payload,
          /^rc1\./,
        );

        const serialized =
          JSON.stringify(row);

        for (
          const secret of
          sensitivePlaintext
        ) {
          assert.equal(
            serialized.includes(secret),
            false,
            `plaintext leaked into SQL row: ${secret}`,
          );
        }
      }

      const persistedA = rows.find(
        (row) =>
          row.id === connectionA,
      );

      const persistedB = rows.find(
        (row) =>
          row.id === connectionB,
      );

      assert.ok(persistedA);
      assert.ok(persistedB);

      assert.equal(
        persistedA.revoked_at,
        revokedAt,
      );

      assert.equal(
        persistedB.revoked_at,
        null,
      );
    } finally {
      rawDb.close();
    }

    // Check final on-disk database state after close/checkpoint.
    assertNoSensitivePlaintext(
      directory,
      "closed database",
    );

    console.log(
      "SQLite connection persistence: OK",
    );
    console.log(
      "Cross-user isolation: OK",
    );
    console.log(
      "Restart persistence: OK",
    );
    console.log(
      "Encrypted payload round trip: OK",
    );
    console.log(
      "Revocation isolation: OK",
    );
    console.log(
      "Minimal raw schema: OK",
    );
    console.log(
      "SQLite/WAL plaintext leakage check: OK",
    );
  } finally {
    rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
