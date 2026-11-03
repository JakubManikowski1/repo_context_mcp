import assert from "node:assert/strict";

import {
  chromium,
} from "playwright-core";

import {
  PageRenderBrowserError,
  normalizePageRenderBrowserExecutable,
  pageRenderBrowserExecutableFromEnv,
  pageRenderNetworkUrlAllowed,
  renderPageSnapshot,
} from "../src/page-renderer.js";

function browserErrorCode(
  fn: () => unknown,
  code: string,
) {
  assert.throws(
    fn,
    (
      error,
    ) =>
      error
        instanceof PageRenderBrowserError
      && error.code
        === code,
  );
}

assert.equal(
  typeof chromium.launch,
  "function",
);

assert.equal(
  pageRenderBrowserExecutableFromEnv(
    {},
  ),
  undefined,
);

assert.equal(
  pageRenderBrowserExecutableFromEnv(
    {
      REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  ),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
);

assert.equal(
  normalizePageRenderBrowserExecutable(
    "  /usr/bin/chromium  ",
  ),
  "/usr/bin/chromium",
);

browserErrorCode(
  () =>
    normalizePageRenderBrowserExecutable(
      "chromium",
    ),
  "render_browser_executable_not_absolute",
);

browserErrorCode(
  () =>
    normalizePageRenderBrowserExecutable(
      "/tmp/chromium\u0000evil",
    ),
  "render_browser_executable_invalid",
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5173/assets/app.js",
  ),
  true,
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "http://127.0.0.1:5173",
    "ws://127.0.0.1:5173/socket",
  ),
  true,
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "https://dev.example.com",
    "wss://dev.example.com/socket",
  ),
  true,
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000/api",
  ),
  false,
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "http://127.0.0.1:5173",
    "https://example.com/analytics.js",
  ),
  false,
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "http://127.0.0.1:5173",
    "ws://127.0.0.1:3000/socket",
  ),
  false,
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "http://127.0.0.1:5173",
    "file:///etc/passwd",
  ),
  false,
);

assert.equal(
  pageRenderNetworkUrlAllowed(
    "http://127.0.0.1:5173",
    "data:text/plain,hello",
  ),
  true,
);

await assert.rejects(
  () =>
    renderPageSnapshot({
      origin:
        "http://127.0.0.1:5173",
      route:
        "/admin",
      browserExecutablePath:
        "relative-browser",
    }),
  (
    error,
  ) =>
    error
      instanceof PageRenderBrowserError
    && error.code
      === "render_browser_executable_not_absolute",
);

console.log(
  "Page renderer: OK",
);
