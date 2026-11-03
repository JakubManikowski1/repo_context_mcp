import assert from "node:assert/strict";

import {
  PageRenderPolicyError,
  normalizePageRenderOrigin,
  pageRenderConfigFromEnv,
  resolvePageRenderUrl,
} from "../src/page-render-policy.js";

function errorCode(
  fn: () => unknown,
  code: string,
) {
  assert.throws(
    fn,
    (
      error,
    ) =>
      error
        instanceof PageRenderPolicyError
      && error.code
        === code,
  );
}

assert.deepEqual(
  pageRenderConfigFromEnv(
    {},
  ),
  {
    enabled: false,
  },
);

assert.deepEqual(
  pageRenderConfigFromEnv(
    {
      REPO_CONTEXT_RENDER_ORIGIN:
        "http://127.0.0.1:5173",
    },
  ),
  {
    enabled: true,
    origin:
      "http://127.0.0.1:5173",
  },
);

assert.equal(
  normalizePageRenderOrigin(
    "https://dev.example.com/",
  ),
  "https://dev.example.com",
);

errorCode(
  () =>
    normalizePageRenderOrigin(
      "ftp://localhost:5173",
    ),
  "render_origin_protocol_invalid",
);

errorCode(
  () =>
    normalizePageRenderOrigin(
      "http://user:secret@localhost:5173",
    ),
  "render_origin_credentials_forbidden",
);

errorCode(
  () =>
    normalizePageRenderOrigin(
      "http://localhost:5173/admin",
    ),
  "render_origin_must_be_origin",
);

errorCode(
  () =>
    normalizePageRenderOrigin(
      "http://localhost:5173/?mode=dev",
    ),
  "render_origin_must_be_origin",
);

errorCode(
  () =>
    normalizePageRenderOrigin(
      "http://localhost:5173/#debug",
    ),
  "render_origin_must_be_origin",
);

assert.equal(
  resolvePageRenderUrl(
    "http://127.0.0.1:5173",
    "/admin/customers?tab=active#top",
  ),
  "http://127.0.0.1:5173/admin/customers?tab=active#top",
);

assert.equal(
  resolvePageRenderUrl(
    "https://dev.example.com",
    "/",
  ),
  "https://dev.example.com/",
);

errorCode(
  () =>
    resolvePageRenderUrl(
      "http://localhost:5173",
      "admin",
    ),
  "render_route_invalid",
);

errorCode(
  () =>
    resolvePageRenderUrl(
      "http://localhost:5173",
      "//evil.example/path",
    ),
  "render_route_invalid",
);

errorCode(
  () =>
    resolvePageRenderUrl(
      "http://localhost:5173",
      "https://evil.example/path",
    ),
  "render_route_invalid",
);

errorCode(
  () =>
    resolvePageRenderUrl(
      "http://localhost:5173",
      "/\\evil.example/path",
    ),
  "render_route_invalid",
);

console.log(
  "Page render policy: OK",
);
