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

import type {
  RepositoryContext,
} from "../src/repository-context.js";

import {
  PageRenderServerConfigError,
  pageRenderServerBindingFromEnv,
  pageRenderTargetAccessForRequest,
  staticPageRenderExecutionToolRendererFromEnv,
} from "../src/page-render-server.js";

const renderEnv = {
  REPO_CONTEXT_RENDER_ORIGIN:
    "http://127.0.0.1:5173",
  REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
    "/tmp/chromium",
};

function serverErrorCode(
  fn: () => unknown,
  code: string,
) {
  assert.throws(
    fn,
    (
      error,
    ) =>
      error
        instanceof PageRenderServerConfigError
      && error.code
        === code,
  );
}

assert.deepEqual(
  pageRenderServerBindingFromEnv(
    "legacy",
    {},
  ),
  {
    enabled: false,
  },
);

assert.deepEqual(
  pageRenderServerBindingFromEnv(
    "oauth",
    {},
  ),
  {
    enabled: false,
  },
);

serverErrorCode(
  () =>
    pageRenderServerBindingFromEnv(
      "legacy",
      {
        REPO_CONTEXT_RENDER_ORIGIN:
          "http://127.0.0.1:5173",
      },
    ),
  "render_server_configuration_incomplete",
);

serverErrorCode(
  () =>
    pageRenderServerBindingFromEnv(
      "oauth",
      {
        ...renderEnv,
      },
    ),
  "render_server_repository_id_required",
);

serverErrorCode(
  () =>
    pageRenderServerBindingFromEnv(
      "legacy",
      {
        ...renderEnv,
        REPO_CONTEXT_RENDER_REPOSITORY_ID:
          "conn_a",
      },
    ),
  "render_server_repository_id_forbidden",
);

const legacyBinding =
  pageRenderServerBindingFromEnv(
    "legacy",
    renderEnv,
  );

assert.deepEqual(
  legacyBinding,
  {
    enabled:
      true,
    kind:
      "legacy",
  },
);

const oauthEnv = {
  ...renderEnv,
  REPO_CONTEXT_RENDER_REPOSITORY_ID:
    "conn_a",
};

const oauthBinding =
  pageRenderServerBindingFromEnv(
    "oauth",
    oauthEnv,
  );

assert.deepEqual(
  oauthBinding,
  {
    enabled:
      true,
    kind:
      "connection",
    repositoryId:
      "conn_a",
  },
);

const legacyRepository:
  RepositoryContext = {
    source:
      "legacy-env",
    provider:
      "github",
    key:
      "github:123:owner/repo:main",
    owner:
      "owner",
    repo:
      "repo",
    branch:
      "main",
    octokit:
      {} as never,
  };

const legacyAccess =
  pageRenderTargetAccessForRequest(
    legacyBinding,
    legacyRepository,
    renderEnv,
  );

assert.ok(
  legacyAccess,
);

assert.ok(
  await legacyAccess.resolve(
    "github:123:owner/repo:main",
  ),
);

assert.equal(
  await legacyAccess.resolve(
    "github:999:other/repo:main",
  ),
  null,
);

const oauthAccess =
  pageRenderTargetAccessForRequest(
    oauthBinding,
    null,
    oauthEnv,
  );

assert.ok(
  oauthAccess,
);

assert.ok(
  await oauthAccess.resolve(
    "connection:conn_a",
  ),
);

assert.equal(
  await oauthAccess.resolve(
    "connection:conn_b",
  ),
  null,
);

assert.equal(
  pageRenderTargetAccessForRequest(
    {
      enabled:
        false,
    },
    null,
    {},
  ),
  null,
);

serverErrorCode(
  () =>
    pageRenderTargetAccessForRequest(
      {
        enabled:
          true,
        kind:
          "legacy",
      },
      null,
      renderEnv,
    ),
  "render_server_legacy_repository_missing",
);

const temporaryDirectory =
  mkdtempSync(
    join(
      tmpdir(),
      "repo-context-render-server-",
    ),
  );

try {
  const profilesFile =
    join(
      temporaryDirectory,
      "render-profiles.json",
    );

  writeFileSync(
    profilesFile,
    JSON.stringify({
      version: 1,
      profiles: [
        {
          repositoryId:
            "lf",
          strategy:
            "local-workspace",
          workspace:
            temporaryDirectory,
          cwd:
            ".",
          command:
            process.execPath,
          args: [
            "server.mjs",
            "{host}",
            "{port}",
          ],
        },
      ],
    }),
    "utf8",
  );

  const definitions = [
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
  ];

  assert.equal(
    staticPageRenderExecutionToolRendererFromEnv(
      definitions,
      {},
    ),
    null,
  );

  assert.ok(
    staticPageRenderExecutionToolRendererFromEnv(
      definitions,
      {
        REPO_CONTEXT_RENDER_PROFILES_FILE:
          profilesFile,
        REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
          process.execPath,
      },
    ),
  );

  serverErrorCode(
    () =>
      staticPageRenderExecutionToolRendererFromEnv(
        null,
        {
          REPO_CONTEXT_RENDER_PROFILES_FILE:
            profilesFile,
          REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
            process.execPath,
        },
      ),
    "render_server_execution_registry_required",
  );

  serverErrorCode(
    () =>
      staticPageRenderExecutionToolRendererFromEnv(
        definitions,
        {
          REPO_CONTEXT_RENDER_PROFILES_FILE:
            profilesFile,
        },
      ),
    "render_server_execution_browser_required",
  );

  serverErrorCode(
    () =>
      staticPageRenderExecutionToolRendererFromEnv(
        definitions,
        {
          REPO_CONTEXT_RENDER_PROFILES_FILE:
            profilesFile,
          REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
            process.execPath,
          REPO_CONTEXT_RENDER_ORIGIN:
            "http://127.0.0.1:5173",
        },
      ),
    "render_server_execution_configuration_conflict",
  );

  const unknownProfilesFile =
    join(
      temporaryDirectory,
      "unknown-render-profiles.json",
    );

  writeFileSync(
    unknownProfilesFile,
    JSON.stringify({
      version: 1,
      profiles: [
        {
          repositoryId:
            "unknown",
          strategy:
            "local-workspace",
          workspace:
            temporaryDirectory,
          cwd:
            ".",
          command:
            process.execPath,
          args: [
            "server.mjs",
            "{host}",
            "{port}",
          ],
        },
      ],
    }),
    "utf8",
  );

  serverErrorCode(
    () =>
      staticPageRenderExecutionToolRendererFromEnv(
        definitions,
        {
          REPO_CONTEXT_RENDER_PROFILES_FILE:
            unknownProfilesFile,
          REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
            process.execPath,
        },
      ),
    "render_server_execution_repository_unknown",
  );
} finally {
  rmSync(
    temporaryDirectory,
    {
      recursive:
        true,
      force:
        true,
    },
  );
}

console.log(
  "Page render server binding: OK",
);
