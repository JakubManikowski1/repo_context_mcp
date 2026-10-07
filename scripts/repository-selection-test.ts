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

const principalC: PrincipalIdentity = {
  issuer: "https://auth.example.test",
  subject: "user_without_repositories",
};

const payloadA1: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "111111",
  repositoryId: "900001",
  owner: "owner-alpha",
  name: "repo-alpha-one",
  branch: "main",
};

const payloadA2: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "222222",
  repositoryId: "900002",
  owner: "owner-alpha",
  name: "repo-alpha-two",
  branch: "develop",
};

const payloadB: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "333333",
  repositoryId: "900003",
  owner: "owner-beta",
  name: "repo-beta",
  branch: "main",
};

function accessError(
  code:
    | "repository_not_found"
    | "repository_required"
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
      "repo-context-selection-",
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

    async function add(
      id: string,
      userLookup: string,
      payload: RepositoryConnectionPayload,
      createdAt: string,
    ): Promise<void> {
      await store.create({
        id,
        userLookup,
        encryptedPayload:
          encryptRepositoryConnection(
            payload,
            encryptionKey,
            id,
            userLookup,
          ),
        createdAt,
      });
    }

    await add(
      "conn_a1",
      userLookupA,
      payloadA1,
      "2026-10-07T10:00:00.000Z",
    );

    await add(
      "conn_a2",
      userLookupA,
      payloadA2,
      "2026-10-07T10:01:00.000Z",
    );

    await add(
      "conn_b",
      userLookupB,
      payloadB,
      "2026-10-07T10:02:00.000Z",
    );

    const installationIds: string[] = [];

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
            installationIds.push(
              String(installationId),
            );
            return fakeClient;
          },
      });

    // ---------------------------------------------------
    // Listing is principal-scoped.
    // ---------------------------------------------------

    assert.deepEqual(
      await resolver.list(principalA),
      [
        {
          id: "conn_a1",
          provider: "github",
          owner: "owner-alpha",
          repo: "repo-alpha-one",
          branch: "main",
        },
        {
          id: "conn_a2",
          provider: "github",
          owner: "owner-alpha",
          repo: "repo-alpha-two",
          branch: "develop",
        },
      ],
    );

    assert.deepEqual(
      await resolver.list(principalB),
      [
        {
          id: "conn_b",
          provider: "github",
          owner: "owner-beta",
          repo: "repo-beta",
          branch: "main",
        },
      ],
    );

    assert.deepEqual(
      await resolver.list(principalC),
      [],
    );

    // Listing metadata must not create GitHub clients.
    assert.deepEqual(
      installationIds,
      [],
    );

    // ---------------------------------------------------
    // Multiple repositories require explicit selection.
    // ---------------------------------------------------

    await assert.rejects(
      () =>
        resolver.resolveSelected(
          principalA,
        ),
      accessError(
        "repository_required",
      ),
    );

    // ---------------------------------------------------
    // Explicit selection.
    // ---------------------------------------------------

    const explicitA =
      await resolver.resolveSelected(
        principalA,
        "conn_a2",
      );

    assert.equal(
      explicitA.key,
      "connection:conn_a2",
    );

    assert.equal(
      explicitA.repo,
      "repo-alpha-two",
    );

    assert.deepEqual(
      installationIds,
      ["222222"],
    );

    // Cross-user explicit selection still fails closed.
    await assert.rejects(
      () =>
        resolver.resolveSelected(
          principalA,
          "conn_b",
        ),
      accessError(
        "repository_not_found",
      ),
    );

    // ---------------------------------------------------
    // Single repository may be selected implicitly.
    // ---------------------------------------------------

    const implicitB =
      await resolver.resolveSelected(
        principalB,
      );

    assert.equal(
      implicitB.key,
      "connection:conn_b",
    );

    assert.equal(
      implicitB.repo,
      "repo-beta",
    );

    // ---------------------------------------------------
    // No repository means not found.
    // ---------------------------------------------------

    await assert.rejects(
      () =>
        resolver.resolveSelected(
          principalC,
        ),
      accessError(
        "repository_not_found",
      ),
    );

    // ---------------------------------------------------
    // Revocation changes selection immediately.
    // ---------------------------------------------------

    assert.equal(
      await store.revokeByIdForUser(
        userLookupA,
        "conn_a2",
        "2026-10-07T11:00:00.000Z",
      ),
      true,
    );

    assert.deepEqual(
      await resolver.list(principalA),
      [
        {
          id: "conn_a1",
          provider: "github",
          owner: "owner-alpha",
          repo: "repo-alpha-one",
          branch: "main",
        },
      ],
    );

    const implicitA =
      await resolver.resolveSelected(
        principalA,
      );

    assert.equal(
      implicitA.key,
      "connection:conn_a1",
    );

    assert.equal(
      implicitA.repo,
      "repo-alpha-one",
    );

    console.log(
      "Repository selection policy: OK",
    );
    console.log(
      "Principal-scoped repository listing: OK",
    );
    console.log(
      "Multiple repositories require repository_id: OK",
    );
    console.log(
      "Single repository implicit selection: OK",
    );
    console.log(
      "Cross-user explicit selection: OK",
    );
    console.log(
      "Revocation immediately affects selection: OK",
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
