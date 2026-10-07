import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  RepositoryContext,
} from "../src/repository-context.js";

import {
  deriveUserLookup,
  encryptRepositoryConnection,
} from "../src/connections/crypto.js";

import {
  RepositoryAccessError,
  RepositoryAccessResolver,
} from "../src/connections/resolver.js";

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
  issuer: "https://auth.example.test",
  subject: "user_alpha",
};

const principalB: PrincipalIdentity = {
  issuer: "https://auth.example.test",
  subject: "user_beta",
};

const payloadA: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "111111",
  repositoryId: "900001",
  owner: "owner-alpha",
  name: "repo-alpha",
  branch: "main",
};

const payloadB: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "222222",
  repositoryId: "900002",
  owner: "owner-beta",
  name: "repo-beta",
  branch: "develop",
};

function isRepositoryAccessError(
  code:
    | "repository_not_found"
    | "repository_connection_invalid",
) {
  return (error: unknown): boolean =>
    error instanceof RepositoryAccessError &&
    error.code === code;
}

async function main(): Promise<void> {
  const directory = mkdtempSync(
    join(
      tmpdir(),
      "repo-context-resolver-",
    ),
  );

  const databasePath = join(
    directory,
    "connections.sqlite",
  );

  const store =
    new SqliteRepositoryConnectionStore(
      databasePath,
    );

  try {
    const userLookupA =
      deriveUserLookup(
        principalA,
        lookupKey,
      );

    const userLookupB =
      deriveUserLookup(
        principalB,
        lookupKey,
      );

    const connectionA = "conn_alpha";
    const connectionB = "conn_beta";

    await store.create({
      id: connectionA,
      userLookup: userLookupA,
      encryptedPayload:
        encryptRepositoryConnection(
          payloadA,
          encryptionKey,
          connectionA,
          userLookupA,
        ),
      createdAt:
        "2026-10-07T10:00:00.000Z",
    });

    await store.create({
      id: connectionB,
      userLookup: userLookupB,
      encryptedPayload:
        encryptRepositoryConnection(
          payloadB,
          encryptionKey,
          connectionB,
          userLookupB,
        ),
      createdAt:
        "2026-10-07T10:01:00.000Z",
    });

    const requestedInstallationIds:
      string[] = [];

    const fakeClient =
      {
        testMarker: true,
      } as unknown as RepositoryContext["octokit"];

    const resolver =
      new RepositoryAccessResolver({
        store,
        lookupKey,
        encryptionKey,

        createGitHubClient:
          (installationId) => {
            requestedInstallationIds.push(
              String(installationId),
            );

            return fakeClient;
          },
      });

    // -----------------------------------------------------
    // Authorized connection
    // -----------------------------------------------------

    const resolvedA =
      await resolver.resolve(
        principalA,
        connectionA,
      );

    assert.equal(
      resolvedA.source,
      "connection",
    );

    assert.equal(
      resolvedA.provider,
      "github",
    );

    assert.equal(
      resolvedA.key,
      `connection:${connectionA}`,
    );

    assert.equal(
      resolvedA.owner,
      payloadA.owner,
    );

    assert.equal(
      resolvedA.repo,
      payloadA.name,
    );

    assert.equal(
      resolvedA.branch,
      payloadA.branch,
    );

    assert.equal(
      resolvedA.octokit,
      fakeClient,
    );

    assert.deepEqual(
      requestedInstallationIds,
      [payloadA.installationId],
    );

    // -----------------------------------------------------
    // Cross-user access must look exactly like absence.
    // -----------------------------------------------------

    await assert.rejects(
      () =>
        resolver.resolve(
          principalA,
          connectionB,
        ),
      isRepositoryAccessError(
        "repository_not_found",
      ),
    );

    assert.deepEqual(
      requestedInstallationIds,
      [payloadA.installationId],
      "cross-user access must not create a GitHub client",
    );

    // -----------------------------------------------------
    // Unknown connection.
    // -----------------------------------------------------

    await assert.rejects(
      () =>
        resolver.resolve(
          principalA,
          "conn_does_not_exist",
        ),
      isRepositoryAccessError(
        "repository_not_found",
      ),
    );

    // -----------------------------------------------------
    // Revoked connection.
    // -----------------------------------------------------

    assert.equal(
      await store.revokeByIdForUser(
        userLookupA,
        connectionA,
        "2026-10-07T11:00:00.000Z",
      ),
      true,
    );

    await assert.rejects(
      () =>
        resolver.resolve(
          principalA,
          connectionA,
        ),
      isRepositoryAccessError(
        "repository_not_found",
      ),
    );

    // -----------------------------------------------------
    // AAD binding:
    // ciphertext encrypted for one connection ID cannot
    // be moved to another database row.
    // -----------------------------------------------------

    const bindingSource =
      "conn_binding_source";

    const bindingTarget =
      "conn_binding_target";

    const boundCiphertext =
      encryptRepositoryConnection(
        payloadA,
        encryptionKey,
        bindingSource,
        userLookupA,
      );

    await store.create({
      id: bindingTarget,
      userLookup: userLookupA,
      encryptedPayload:
        boundCiphertext,
      createdAt:
        "2026-10-07T12:00:00.000Z",
    });

    await assert.rejects(
      () =>
        resolver.resolve(
          principalA,
          bindingTarget,
        ),
      isRepositoryAccessError(
        "repository_connection_invalid",
      ),
    );

    // -----------------------------------------------------
    // Wrong identity-lookup key must not find connections.
    // -----------------------------------------------------

    const wrongLookupResolver =
      new RepositoryAccessResolver({
        store,
        lookupKey: randomBytes(32),
        encryptionKey,

        createGitHubClient:
          () => fakeClient,
      });

    await assert.rejects(
      () =>
        wrongLookupResolver.resolve(
          principalB,
          connectionB,
        ),
      isRepositoryAccessError(
        "repository_not_found",
      ),
    );

    // -----------------------------------------------------
    // Key separation is a required invariant.
    // -----------------------------------------------------

    const sameKey = randomBytes(32);

    assert.throws(
      () =>
        new RepositoryAccessResolver({
          store,
          lookupKey: sameKey,
          encryptionKey: sameKey,

          createGitHubClient:
            () => fakeClient,
        }),
      /must be distinct/,
    );

    console.log(
      "Repository access resolver: OK",
    );
    console.log(
      "Authorized connection resolution: OK",
    );
    console.log(
      "Cross-user isolation: OK",
    );
    console.log(
      "Revoked connection rejection: OK",
    );
    console.log(
      "AAD connection binding: OK",
    );
    console.log(
      "Principal lookup enforcement: OK",
    );
    console.log(
      "Crypto key separation: OK",
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
