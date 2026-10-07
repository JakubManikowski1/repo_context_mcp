import assert from "node:assert/strict";

import {
  randomBytes,
} from "node:crypto";

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

import type {
  RepositoryContext,
} from "../src/repository-context.js";

import {
  decryptRepositoryConnection,
  deriveUserLookup,
} from "../src/connections/crypto.js";

import {
  GitHubConnectError,
} from "../src/connections/github-connect.js";

import {
  GitHubInstallationSelection,
} from "../src/connections/github-installation-selection.js";

import {
  SqliteRepositoryConnectionStore,
} from "../src/connections/sqlite-store.js";

const principal = {
  issuer:
    "https://auth.example.test",

  subject:
    "installation-selection-user",
};

async function main(): Promise<void> {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        "repo-context-installation-selection-",
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

  const store =
    new SqliteRepositoryConnectionStore(
      databasePath,
    );

  const requests:
    Array<{
      route: string;
      page: number;
      installationId: string;
    }> = [];

  const fakeClient =
    (
      installationId:
        string | number,
    ) => {
      return {
        async request(
          route: string,
          options:
            Record<string, unknown>,
        ) {
          const page =
            Number(
              options.page,
            );

          requests.push({
            route,
            page,
            installationId:
              String(
                installationId,
              ),
          });

          if (
            String(
              installationId,
            ) === "999"
          ) {
            throw Object.assign(
              new Error(
                "Forbidden",
              ),
              {
                status: 403,
              },
            );
          }

          assert.equal(
            route,
            "GET /installation/repositories",
          );

          assert.equal(
            options.per_page,
            100,
          );

          if (page === 1) {
            return {
              data: {
                total_count: 101,

                repositories:
                  Array.from(
                    {
                      length: 100,
                    },
                    (
                      _,
                      index,
                    ) => ({
                      id:
                        2000 + index,

                      name:
                        `filler-repo-${index}`,

                      default_branch:
                        "main",

                      owner: {
                        login:
                          "example-org",
                      },
                    }),
                  ),
              },
            };
          }

          if (page === 2) {
            return {
              data: {
                total_count: 101,

                repositories: [
                  {
                    id: 1002,

                    name:
                      "repo-two",

                    default_branch:
                      "trunk",

                    owner: {
                      login:
                        "example-org",
                    },
                  },
                ],
              },
            };
          }

          throw new Error(
            `Unexpected page: ${page}`,
          );
        },
      } as unknown as
        RepositoryContext["octokit"];
    };

  const connector =
    new GitHubInstallationSelection({
      store,
      lookupKey,
      encryptionKey,

      createGitHubClient:
        fakeClient,

      createConnectionId:
        () =>
          "conn_selected_1",

      now:
        () =>
          new Date(
            "2026-10-07T13:00:00.000Z",
          ),
    });

  try {
    const connected =
      await connector.connect(
        principal,
        "123",
        "1002",
      );

    assert.deepEqual(
      connected,
      {
        connectionId:
          "conn_selected_1",

        provider:
          "github",

        installationId:
          "123",

        repositoryId:
          "1002",

        owner:
          "example-org",

        name:
          "repo-two",

        branch:
          "trunk",
      },
    );

    assert.deepEqual(
      requests.map(
        (request) => ({
          route:
            request.route,

          page:
            request.page,

          installationId:
            request.installationId,
        }),
      ),
      [
        {
          route:
            "GET /installation/repositories",

          page: 1,

          installationId:
            "123",
        },
        {
          route:
            "GET /installation/repositories",

          page: 2,

          installationId:
            "123",
        },
      ],
    );

    const userLookup =
      deriveUserLookup(
        principal,
        lookupKey,
      );

    const rows =
      await store
        .listActiveByUserLookup(
          userLookup,
        );

    assert.equal(
      rows.length,
      1,
    );

    const row =
      rows[0];

    assert.ok(row);

    const payload =
      decryptRepositoryConnection(
        row.encryptedPayload,
        encryptionKey,
        row.id,
        row.userLookup,
      );

    assert.deepEqual(
      payload,
      {
        version: 1,
        provider: "github",

        installationId:
          "123",

        repositoryId:
          "1002",

        owner:
          "example-org",

        name:
          "repo-two",

        branch:
          "trunk",
      },
    );

    await assert.rejects(
      () =>
        connector.connect(
          principal,
          "123",
          "999999",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GitHubConnectError &&
        error.code ===
          "github_repository_unavailable",
    );

    await assert.rejects(
      () =>
        connector.connect(
          principal,
          "999",
          "1001",
        ),
      (
        error: unknown,
      ) =>
        error instanceof
          GitHubConnectError &&
        error.code ===
          "github_installation_unavailable",
    );

    assert.equal(
      (
        await store
          .listActiveByUserLookup(
            userLookup,
          )
      ).length,
      1,
      "failed selections must not create RepositoryConnection rows",
    );

    console.log(
      "GitHub installation selection: OK",
    );

    console.log(
      "Installation-token repository verification: OK",
    );

    console.log(
      "Repository metadata resolved after user token disposal: OK",
    );

    console.log(
      "Encrypted RepositoryConnection creation: OK",
    );

    console.log(
      "Unavailable repository: FAIL CLOSED",
    );

    console.log(
      "Unavailable installation: FAIL CLOSED",
    );

    console.log(
      "GitHub user token required after callback: NO",
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
