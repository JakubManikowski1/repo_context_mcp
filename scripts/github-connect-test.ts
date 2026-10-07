import assert from "node:assert/strict";

import {
  randomBytes,
} from "node:crypto";

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  decryptRepositoryConnection,
  deriveUserLookup,
} from "../src/connections/crypto.js";

import {
  GitHubConnectError,
  GitHubRepositoryConnector,
} from "../src/connections/github-connect.js";

import {
  SqliteRepositoryConnectionStore,
} from "../src/connections/sqlite-store.js";

const principal = {
  issuer:
    "https://auth.example.test",
  subject:
    "connect-user-123",
};

const userToken =
  "ghu_TEST_SECRET_DO_NOT_PERSIST";

async function main(): Promise<void> {
  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        "repo-context-github-connect-",
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

  const requestedUrls:
    string[] = [];

  const connector =
    new GitHubRepositoryConnector({
      store,
      lookupKey,
      encryptionKey,

      createConnectionId:
        () => "conn_github_1",

      now:
        () =>
          new Date(
            "2026-10-07T12:00:00.000Z",
          ),

      fetch:
        async (
          input,
          init,
        ) => {
          const url =
            new URL(
              input.toString(),
            );

          requestedUrls.push(
            url.href,
          );

          assert.equal(
            init?.headers &&
              (
                init.headers as
                  Record<string, string>
              ).Authorization,
            `Bearer ${userToken}`,
          );

          assert.equal(
            init?.headers &&
              (
                init.headers as
                  Record<string, string>
              )[
                "X-GitHub-Api-Version"
              ],
            "2026-03-10",
          );

          if (
            url.pathname ===
            "/user/installations/999/repositories"
          ) {
            return new Response(
              JSON.stringify({
                message:
                  "Not Found",
              }),
              {
                status: 404,
                headers: {
                  "content-type":
                    "application/json",
                },
              },
            );
          }

          assert.equal(
            url.pathname,
            "/user/installations/123/repositories",
          );

          const page =
            url.searchParams.get(
              "page",
            );

          if (page === "1") {
            return Response.json({
              total_count: 2,
              repositories: [
                {
                  id: 1001,
                  name:
                    "repo-one",
                  default_branch:
                    "main",
                  owner: {
                    login:
                      "example-owner",
                  },
                },
              ],
            });
          }

          if (page === "2") {
            return Response.json({
              total_count: 2,
              repositories: [
                {
                  id: 1002,
                  name:
                    "repo-two",
                  default_branch:
                    "trunk",
                  owner: {
                    login:
                      "example-owner",
                  },
                },
              ],
            });
          }

          throw new Error(
            `Unexpected GitHub page: ${page}`,
          );
        },
    });

  let closed = false;

  try {
    const repositories =
      await connector.listRepositories(
        userToken,
        "123",
      );

    assert.deepEqual(
      repositories,
      [
        {
          repositoryId:
            "1001",
          owner:
            "example-owner",
          name:
            "repo-one",
          defaultBranch:
            "main",
        },
        {
          repositoryId:
            "1002",
          owner:
            "example-owner",
          name:
            "repo-two",
          defaultBranch:
            "trunk",
        },
      ],
    );

    assert.equal(
      requestedUrls.length,
      2,
      "pagination should fetch both pages",
    );

    const connected =
      await connector.connectRepository(
        principal,
        userToken,
        "123",
        "1002",
      );

    assert.deepEqual(
      connected,
      {
        connectionId:
          "conn_github_1",
        provider:
          "github",
        installationId:
          "123",
        repositoryId:
          "1002",
        owner:
          "example-owner",
        name:
          "repo-two",
        branch:
          "trunk",
      },
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
          "example-owner",
        name:
          "repo-two",
        branch:
          "trunk",
      },
    );

    assert.ok(
      !row.encryptedPayload.includes(
        userToken,
      ),
      "GitHub user token must never be stored in the encrypted repository payload",
    );

    await assert.rejects(
      () =>
        connector.connectRepository(
          principal,
          userToken,
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
        connector.listRepositories(
          userToken,
          "999",
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
      "failed connection attempts must not create rows",
    );

    store.close();
    closed = true;

    for (
      const filename
      of readdirSync(directory)
    ) {
      const path =
        join(
          directory,
          filename,
        );

      let bytes: Buffer;

      try {
        bytes =
          readFileSync(path);
      } catch {
        continue;
      }

      assert.equal(
        bytes.includes(
          Buffer.from(userToken),
        ),
        false,
        `GitHub user token leaked to ${filename}`,
      );
    }

    console.log(
      "GitHub repository connector: OK",
    );

    console.log(
      "User-authorized installation verification: OK",
    );

    console.log(
      "Repository selection verification: OK",
    );

    console.log(
      "Default branch capture: OK",
    );

    console.log(
      "Encrypted RepositoryConnection creation: OK",
    );

    console.log(
      "GitHub user token persistence: ABSENT",
    );

    console.log(
      "Spoofed/unavailable installation: FAIL CLOSED",
    );
  } finally {
    if (!closed) {
      store.close();
    }

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
