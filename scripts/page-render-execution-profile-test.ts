import assert from "node:assert/strict";

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import * as path from "node:path";

import {
  PageRenderExecutionProfileError,
  createPageRenderExecutionProfileAccess,
  loadPageRenderExecutionProfiles,
  parsePageRenderExecutionProfiles,
} from "../src/page-render-execution-profile.js";

function profileErrorCode(
  fn: () => unknown,
  code: string,
) {
  assert.throws(
    fn,
    (
      error,
    ) =>
      error
        instanceof PageRenderExecutionProfileError
      && error.code
        === code,
  );
}

const temporaryRoot =
  mkdtempSync(
    path.join(
      tmpdir(),
      "repo-context-render-profile-",
    ),
  );

try {
  const workspace =
    path.join(
      temporaryRoot,
      "lf-workspace",
    );

  const document = {
    version:
      1,

    profiles: [
      {
        repositoryId:
          "lf",

        strategy:
          "local-workspace",

        workspace,

        cwd:
          "apps/web",

        command:
          "npm",

        args: [
          "run",
          "dev",
          "--",
          "--host",
          "{host}",
          "--port",
          "{port}",
          "--strictPort",
        ],
      },
    ],
  };

  const profiles =
    parsePageRenderExecutionProfiles(
      document,
    );

  assert.equal(
    profiles.length,
    1,
  );

  assert.deepEqual(
    profiles[0],
    {
      repositoryId:
        "lf",

      strategy:
        "local-workspace",

      workspace:
        path.resolve(
          workspace,
        ),

      cwd:
        path.normalize(
          "apps/web",
        ),

      command:
        "npm",

      args: [
        "run",
        "dev",
        "--",
        "--host",
        "{host}",
        "--port",
        "{port}",
        "--strictPort",
      ],
    },
  );

  const access =
    createPageRenderExecutionProfileAccess(
      profiles,
    );

  assert.equal(
    access.list().length,
    1,
  );

  assert.deepEqual(
    access.resolve(
      "lf",
    ),
    profiles[0],
  );

  assert.equal(
    access.resolve(
      "self",
    ),
    null,
  );

  profileErrorCode(
    () =>
      parsePageRenderExecutionProfiles({
        ...document,

        profiles: [
          document.profiles[0],
          document.profiles[0],
        ],
      }),
    "render_execution_profile_duplicate",
  );

  profileErrorCode(
    () =>
      parsePageRenderExecutionProfiles({
        version:
          1,

        profiles: [
          {
            ...document.profiles[0],

            workspace:
              "relative/workspace",
          },
        ],
      }),
    "render_execution_profile_invalid",
  );

  profileErrorCode(
    () =>
      parsePageRenderExecutionProfiles({
        version:
          1,

        profiles: [
          {
            ...document.profiles[0],

            cwd:
              "../outside",
          },
        ],
      }),
    "render_execution_profile_invalid",
  );

  profileErrorCode(
    () =>
      parsePageRenderExecutionProfiles({
        version:
          1,

        profiles: [
          {
            ...document.profiles[0],

            args: [
              "run",
              "dev",
              "--",
              "--host",
              "{host}",
            ],
          },
        ],
      }),
    "render_execution_profile_invalid",
  );

  profileErrorCode(
    () =>
      parsePageRenderExecutionProfiles({
        version:
          1,

        profiles: [
          {
            ...document.profiles[0],

            strategy:
              "remote-agent",
          },
        ],
      }),
    "render_execution_profile_invalid",
  );

  const filePath =
    path.join(
      temporaryRoot,
      "render-profiles.json",
    );

  writeFileSync(
    filePath,
    JSON.stringify(
      document,
      null,
      2,
    ),
    "utf8",
  );

  assert.deepEqual(
    loadPageRenderExecutionProfiles(
      filePath,
    ),
    profiles,
  );

  profileErrorCode(
    () =>
      loadPageRenderExecutionProfiles(
        path.join(
          temporaryRoot,
          "missing.json",
        ),
      ),
    "render_execution_profile_file_invalid",
  );

  console.log(
    "Page render execution profiles: OK",
  );
} finally {
  rmSync(
    temporaryRoot,
    {
      recursive:
        true,

      force:
        true,
    },
  );
}
