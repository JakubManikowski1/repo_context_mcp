import assert from "node:assert/strict";

import {
  mkdtempSync,
  rmSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  randomBytes,
} from "node:crypto";

import Database from "better-sqlite3";

import {
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

import {
  OperatorRevealError,
  OperatorSensitiveDataRevealService,
} from "../src/operator/reveal.js";

const directory =
  mkdtempSync(
    join(
      tmpdir(),
      "repo-context-operator-reveal-",
    ),
  );

const databasePath =
  join(
    directory,
    "connections.sqlite",
  );

const lookupKey =
  randomBytes(32);

const encryptionKey =
  randomBytes(32);

const principal:
  PrincipalIdentity = {
    issuer:
      "https://auth.example.test",

    subject:
      "operator-reveal-test-user",
  };

const userLookup =
  deriveUserLookup(
    principal,
    lookupKey,
  );

const payload:
  RepositoryConnectionPayload = {
    version: 1,
    provider: "github",
    installationId: "123456",
    repositoryId: "900001",
    owner: "example-owner",
    name: "private-repository",
    branch: "main",
  };

const now =
  () =>
    new Date(
      "2026-10-07T12:00:00.000Z",
    );

async function expectRevealError(
  action: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await action();

    assert.fail(
      "Expected reveal to fail",
    );
  } catch (error) {
    assert.ok(
      error instanceof
        OperatorRevealError,
    );

    assert.equal(
      error.code,
      expectedCode,
    );
  }
}

async function main() {
  const store =
    new SqliteRepositoryConnectionStore(
      databasePath,
    );

  try {
    const connectionId =
      "connection-success";

    const createdAt =
      "2026-10-06T10:00:00.000Z";

    const encryptedPayload =
      encryptRepositoryConnection(
        payload,
        encryptionKey,
        connectionId,
        userLookup,
      );

    await store.create({
      id:
        connectionId,

      userLookup,

      encryptedPayload,

      createdAt,
    });

    const revokedAt =
      "2026-10-07T11:00:00.000Z";

    assert.equal(
      await store.revokeByIdForUser(
        userLookup,
        connectionId,
        revokedAt,
      ),
      true,
    );

    const service =
      new OperatorSensitiveDataRevealService({
        store,
        encryptionKey,
        operatorId:
          "primary-operator",
        now,
      });

    const revealed =
      await service.reveal(
        connectionId,
        "Investigate support case 123",
      );

    assert.equal(
      revealed.connectionId,
      connectionId,
    );

    assert.equal(
      revealed.userLookup,
      userLookup,
    );

    assert.equal(
      revealed.revokedAt,
      revokedAt,
    );

    assert.deepEqual(
      revealed.payload,
      payload,
    );

    await expectRevealError(
      () =>
        service.reveal(
          "missing-connection",
          "Investigate support case 124",
        ),
      "operator_reveal_not_found",
    );

    await store.create({
      id:
        "connection-corrupt",

      userLookup,

      encryptedPayload:
        "rc1.invalid",

      createdAt,
    });

    await expectRevealError(
      () =>
        service.reveal(
          "connection-corrupt",
          "Investigate support case 125",
        ),
      "operator_reveal_failed",
    );

    const failingAuditStore = {
      findByIdForOperator:
        (requestedConnectionId: string) =>
          store.findByIdForOperator(
            requestedConnectionId,
          ),

      appendRevealAudit:
        async () => {
          throw new Error(
            "audit unavailable",
          );
        },
    };

    const auditFailureService =
      new OperatorSensitiveDataRevealService({
        store:
          failingAuditStore,

        encryptionKey,

        operatorId:
          "primary-operator",

        now,
      });

    await assert.rejects(
      () =>
        auditFailureService.reveal(
          connectionId,
          "Investigate support case 126",
        ),
      /audit unavailable/,
    );

    const inspect =
      new Database(
        databasePath,
      );

    try {
      const rows =
        inspect.prepare(`
          SELECT
            operator_id,
            connection_id,
            reason,
            outcome,
            created_at
          FROM operator_reveal_audit
          ORDER BY rowid ASC
        `).all() as Array<{
          operator_id: string;
          connection_id: string;
          reason: string;
          outcome: string;
          created_at: string;
        }>;

      assert.deepEqual(
        rows.map(
          (row) => ({
            operatorId:
              row.operator_id,

            connectionId:
              row.connection_id,

            reason:
              row.reason,

            outcome:
              row.outcome,

            createdAt:
              row.created_at,
          }),
        ),
        [
          {
            operatorId:
              "primary-operator",

            connectionId:
              "connection-success",

            reason:
              "Investigate support case 123",

            outcome:
              "success",

            createdAt:
              "2026-10-07T12:00:00.000Z",
          },
          {
            operatorId:
              "primary-operator",

            connectionId:
              "missing-connection",

            reason:
              "Investigate support case 124",

            outcome:
              "not_found",

            createdAt:
              "2026-10-07T12:00:00.000Z",
          },
          {
            operatorId:
              "primary-operator",

            connectionId:
              "connection-corrupt",

            reason:
              "Investigate support case 125",

            outcome:
              "decrypt_failed",

            createdAt:
              "2026-10-07T12:00:00.000Z",
          },
        ],
      );

      assert.throws(
        () => {
          inspect.prepare(`
            UPDATE operator_reveal_audit
            SET reason = 'changed'
          `).run();
        },
        /append-only/,
      );

      assert.throws(
        () => {
          inspect.prepare(`
            DELETE FROM operator_reveal_audit
          `).run();
        },
        /append-only/,
      );
    } finally {
      inspect.close();
    }

    console.log(
      "Operator sensitive-data reveal: OK",
    );
  } finally {
    store.close();

    rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
