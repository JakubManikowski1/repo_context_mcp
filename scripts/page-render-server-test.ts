import assert from "node:assert/strict";

import type {
  RepositoryContext,
} from "../src/repository-context.js";

import {
  PageRenderServerConfigError,
  pageRenderServerBindingFromEnv,
  pageRenderTargetAccessForRequest,
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

console.log(
  "Page render server binding: OK",
);
