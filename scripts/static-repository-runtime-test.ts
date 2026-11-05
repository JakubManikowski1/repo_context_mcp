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
  loadServerRuntimeFromEnv,
} from "../src/server-runtime.js";

const directory =
  mkdtempSync(
    join(
      tmpdir(),
      "repo-context-static-runtime-",
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
              222222,

            owner:
              "example-user",

            repo:
              "repo_context_mcp",

            branch:
              "main",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  const registryRuntime =
    loadServerRuntimeFromEnv({
      REPO_CONTEXT_AUTH_MODE:
        "legacy",

      REPO_CONTEXT_REPOSITORIES_FILE:
        filename,
    });

  assert.equal(
    registryRuntime.mode,
    "legacy",
  );

  if (
    registryRuntime.mode !==
      "legacy"
  ) {
    throw new Error(
      "Expected legacy runtime",
    );
  }

  assert.equal(
    registryRuntime
      .staticRepositoryDefinitions
      ?.length,
    2,
  );

  assert.deepEqual(
    registryRuntime
      .staticRepositoryDefinitions
      ?.map(
        (repository) =>
          repository.id,
      ),
    [
      "lf",
      "self",
    ],
  );

  const fallbackRuntime =
    loadServerRuntimeFromEnv({
      REPO_CONTEXT_AUTH_MODE:
        "legacy",
    });

  assert.equal(
    fallbackRuntime.mode,
    "legacy",
  );

  if (
    fallbackRuntime.mode !==
      "legacy"
  ) {
    throw new Error(
      "Expected legacy runtime",
    );
  }

  assert.equal(
    fallbackRuntime
      .staticRepositoryDefinitions,
    null,
  );

  assert.throws(
    () =>
      loadServerRuntimeFromEnv({
        REPO_CONTEXT_AUTH_MODE:
          "oauth",

        REPO_CONTEXT_REPOSITORIES_FILE:
          filename,
      }),
    /supported only in legacy mode/,
  );

  console.log(
    "Static repository runtime: OK",
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
