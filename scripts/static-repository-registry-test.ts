import assert from "node:assert/strict";

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  RepositoryAccessError,
} from "../src/connections/resolver.js";

import {
  createStaticRepositoryAccess,
} from "../src/repository-access.js";

import type {
  RepositoryContext,
} from "../src/repository-context.js";

import {
  createStaticRepositoryRegistrations,
  loadStaticRepositoryRegistry,
  parseStaticRepositoryRegistry,
} from "../src/static-repository-registry.js";

async function main() {
  const definitions =
    parseStaticRepositoryRegistry({
      repositories: [
        {
          id:
            "lf",

          installationId:
            111111,

          owner:
            "example-org",

          repo:
            "application",

          branch:
            "main",
        },
        {
          id:
            "self",

          installationId:
            "222222",

          owner:
            "example-user",

          repo:
            "repo_context_mcp",

          branch:
            "main",
        },
      ],
    });

  assert.equal(
    definitions.length,
    2,
  );

  assert.deepEqual(
    definitions.map(
      (definition) =>
        definition.id,
    ),
    [
      "lf",
      "self",
    ],
  );

  const installationIds:
    Array<string | number> = [];

  const fakeOctokit =
    {} as RepositoryContext["octokit"];

  const registrations =
    createStaticRepositoryRegistrations(
      definitions,
      (installationId) => {
        installationIds.push(
          installationId,
        );

        return fakeOctokit;
      },
    );

  assert.deepEqual(
    installationIds,
    [
      111111,
      222222,
    ],
  );

  assert.equal(
    registrations[0]
      .repository.source,
    "static-registry",
  );

  assert.equal(
    registrations[0]
      .repository.key,
    "static:lf:111111:example-org/application:main",
  );

  const access =
    createStaticRepositoryAccess(
      registrations,
    );

  const listed =
    await access.list();

  assert.deepEqual(
    listed.map(
      (repository) => ({
        repositoryId:
          repository.repositoryId,
        name:
          repository.name,
      }),
    ),
    [
      {
        repositoryId:
          "lf",
        name:
          "application",
      },
      {
        repositoryId:
          "self",
        name:
          "repo_context_mcp",
      },
    ],
  );

  const selected =
    await access.resolve(
      "self",
    );

  assert.equal(
    selected.owner,
    "example-user",
  );

  assert.equal(
    selected.repo,
    "repo_context_mcp",
  );

  await assert.rejects(
    () =>
      access.resolve(),
    (
      error,
    ) =>
      error instanceof
        RepositoryAccessError
      && error.code ===
        "repository_required",
  );

  await assert.rejects(
    () =>
      access.resolve(
        "missing",
      ),
    (
      error,
    ) =>
      error instanceof
        RepositoryAccessError
      && error.code ===
        "repository_not_found",
  );

  const singleAccess =
    createStaticRepositoryAccess(
      registrations.slice(
        0,
        1,
      ),
    );

  assert.equal(
    (
      await singleAccess.resolve()
    ).repo,
    "application",
  );

  assert.throws(
    () =>
      parseStaticRepositoryRegistry({
        repositories: [
          {
            id:
              "duplicate",
            installationId:
              1,
            owner:
              "a",
            repo:
              "one",
            branch:
              "main",
          },
          {
            id:
              "duplicate",
            installationId:
              2,
            owner:
              "b",
            repo:
              "two",
            branch:
              "main",
          },
        ],
      }),
    /Duplicate repository id/,
  );

  assert.throws(
    () =>
      parseStaticRepositoryRegistry({
        repositories: [
          {
            id:
              "bad",
            installationId:
              0,
            owner:
              "a",
            repo:
              "one",
            branch:
              "main",
          },
        ],
      }),
    /positive integer/,
  );

  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        "repo-context-static-registry-",
      ),
    );

  try {
    const filename =
      join(
        directory,
        "repositories.json",
      );

    writeFileSync(
      filename,
      JSON.stringify(
        {
          repositories: [
            {
              id:
                "from-file",
              installationId:
                333333,
              owner:
                "file-owner",
              repo:
                "file-repo",
              branch:
                "develop",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded =
      loadStaticRepositoryRegistry(
        filename,
      );

    assert.equal(
      loaded[0].id,
      "from-file",
    );

    assert.equal(
      loaded[0].branch,
      "develop",
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

  console.log(
    "Static repository registry: OK",
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
