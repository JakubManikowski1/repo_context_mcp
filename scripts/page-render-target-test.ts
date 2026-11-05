import assert from "node:assert/strict";

import {
  PageRenderTargetError,
  createPageRenderTargetAccess,
  createSinglePageRenderTargetAccess,
  pageRenderTargetAccessFromEnv,
} from "../src/page-render-target.js";

function targetErrorCode(
  fn: () => unknown,
  code: string,
) {
  assert.throws(
    fn,
    (
      error,
    ) =>
      error
        instanceof PageRenderTargetError
      && error.code
        === code,
  );
}

assert.equal(
  pageRenderTargetAccessFromEnv(
    "github:1:owner/repo:main",
    {},
  ),
  null,
);

targetErrorCode(
  () =>
    pageRenderTargetAccessFromEnv(
      "github:1:owner/repo:main",
      {
        REPO_CONTEXT_RENDER_ORIGIN:
          "http://127.0.0.1:5173",
      },
    ),
  "render_target_configuration_incomplete",
);

targetErrorCode(
  () =>
    pageRenderTargetAccessFromEnv(
      "github:1:owner/repo:main",
      {
        REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
    ),
  "render_target_configuration_incomplete",
);

targetErrorCode(
  () =>
    pageRenderTargetAccessFromEnv(
      "   ",
      {
        REPO_CONTEXT_RENDER_ORIGIN:
          "http://127.0.0.1:5173",
        REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
    ),
  "render_target_repository_key_invalid",
);

const access =
  createSinglePageRenderTargetAccess({
    repositoryKey:
      "github:1:owner/repo:main",
    origin:
      "http://127.0.0.1:5173",
    browserExecutablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });

assert.deepEqual(
  await access.resolve(
    "github:1:owner/repo:main",
  ),
  {
    repositoryKey:
      "github:1:owner/repo:main",
    origin:
      "http://127.0.0.1:5173",
    browserExecutablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
);

assert.equal(
  await access.resolve(
    "github:2:other/repo:main",
  ),
  null,
);


const multiAccess =
  createPageRenderTargetAccess(
    [
      {
        repositoryKey:
          "static:lf:123:owner/lf:main",
        origin:
          "http://127.0.0.1:3000",
        browserExecutablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        repositoryKey:
          "static:self:123:owner/self:main",
        origin:
          "http://127.0.0.1:3001",
        browserExecutablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
    ],
  );

assert.deepEqual(
  await multiAccess.resolve(
    "static:lf:123:owner/lf:main",
  ),
  {
    repositoryKey:
      "static:lf:123:owner/lf:main",
    origin:
      "http://127.0.0.1:3000",
    browserExecutablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
);

assert.deepEqual(
  await multiAccess.resolve(
    "static:self:123:owner/self:main",
  ),
  {
    repositoryKey:
      "static:self:123:owner/self:main",
    origin:
      "http://127.0.0.1:3001",
    browserExecutablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
);

assert.equal(
  await multiAccess.resolve(
    "static:missing:123:owner/missing:main",
  ),
  null,
);

targetErrorCode(
  () =>
    createPageRenderTargetAccess(
      [
        {
          repositoryKey:
            "static:duplicate:123:owner/repo:main",
          origin:
            "http://127.0.0.1:3000",
          browserExecutablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
        {
          repositoryKey:
            "static:duplicate:123:owner/repo:main",
          origin:
            "http://127.0.0.1:3001",
          browserExecutablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        },
      ],
    ),
  "render_target_repository_key_duplicate",
);

assert.equal(
  await access.resolve(
    "github:1:owner/repo:develop",
  ),
  null,
);

const envAccess =
  pageRenderTargetAccessFromEnv(
    "github:1:owner/repo:main",
    {
      REPO_CONTEXT_RENDER_ORIGIN:
        "http://127.0.0.1:5173",
      REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  );

assert.ok(
  envAccess,
);

assert.deepEqual(
  await envAccess.resolve(
    "github:1:owner/repo:main",
  ),
  {
    repositoryKey:
      "github:1:owner/repo:main",
    origin:
      "http://127.0.0.1:5173",
    browserExecutablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
);

assert.equal(
  await envAccess.resolve(
    "github:1:owner/other:main",
  ),
  null,
);

console.log(
  "Page render target access: OK",
);
