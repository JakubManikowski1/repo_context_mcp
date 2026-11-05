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
  startPageRenderBrowserSession,
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

let persistentLaunchCount =
  0;

let persistentCloseCount =
  0;

const persistentVisitedUrls:
  string[] = [];

let persistentCurrentUrl =
  "";

let persistentText =
  "Rendered body";

const persistentFakePage = {
  locator(selector: string) {
    return {
      async count() {
        if (selector === "#missing") return 0;
        if (selector === "#duplicate") return 2;
        return 1;
      },

      async click() {
        if (selector === "#toggle") {
          persistentText = "Clicked";
        }

        if (selector === "#next") {
          persistentCurrentUrl =
            "http://127.0.0.1:5173/next";
        }

        if (selector === "#external") {
          persistentCurrentUrl =
            "https://example.com/";
        }
      },
    };
  },

  mainFrame() {
    return {};
  },

  async goto(
    url: string,
  ) {
    persistentCurrentUrl =
      url;

    persistentVisitedUrls.push(
      url,
    );

    return {
      status() {
        return 200;
      },
    };
  },

  url() {
    return persistentCurrentUrl;
  },

  async waitForTimeout() {
    return;
  },

  async evaluate() {
    return {
      title:
        "Persistent browser test",
      text:
        persistentText,
      textTruncated:
        false,
      elements:
        [],
      elementsTruncated:
        false,
      viewport: {
        width:
          1280,
        height:
          720,
      },
    };
  },

  async screenshot() {
    return Buffer.from(
      "fake-jpeg",
      "utf8",
    );
  },
};

const persistentFakeContext = {
  async routeWebSocket() {
    return;
  },

  async newPage() {
    return persistentFakePage;
  },

  async route() {
    return;
  },
};

const persistentFakeBrowser = {
  async newContext() {
    return persistentFakeContext;
  },

  async close() {
    persistentCloseCount +=
      1;
  },
};

const persistentFakeLaunch =
  (async () => {
    persistentLaunchCount +=
      1;

    return persistentFakeBrowser;
  }) as unknown as
    typeof chromium.launch;

const persistentSession =
  await startPageRenderBrowserSession(
    {
      origin:
        "http://127.0.0.1:5173",
      browserExecutablePath:
        "/tmp/chromium",
    },
    persistentFakeLaunch,
  );

const persistentFirst =
  await persistentSession.render(
    "/first",
  );

const persistentSecond =
  await persistentSession.render(
    "/second",
  );

assert.equal(
  persistentLaunchCount,
  1,
);

assert.deepEqual(
  persistentVisitedUrls,
  [
    "http://127.0.0.1:5173/first",
    "http://127.0.0.1:5173/second",
  ],
);

assert.equal(
  persistentFirst.status,
  200,
);

assert.equal(
  persistentFirst.finalUrl,
  "http://127.0.0.1:5173/first",
);

assert.equal(
  persistentSecond.finalUrl,
  "http://127.0.0.1:5173/second",
);

assert.ok(
  persistentFirst.screenshot,
);

const clicked = await persistentSession.click("#toggle");

assert.equal(clicked.text, "Clicked");
assert.equal(clicked.status, null);

assert.equal(
  clicked.finalUrl,
  "http://127.0.0.1:5173/second",
);

assert.equal(persistentVisitedUrls.length, 2);

for (const selector of [" ", "x".repeat(513)]) {
  await assert.rejects(
    () => persistentSession.click(selector),
    (error) =>
      error instanceof PageRenderBrowserError
      && error.code === "render_interaction_selector_invalid",
  );
}

for (const selector of ["#missing", "#duplicate"]) {
  await assert.rejects(
    () => persistentSession.click(selector),
    (error) =>
      error instanceof PageRenderBrowserError
      && error.code === "render_interaction_target_invalid",
  );
}

const nextPage = await persistentSession.click("#next");

assert.equal(
  nextPage.finalUrl,
  "http://127.0.0.1:5173/next",
);

assert.equal(persistentVisitedUrls.length, 2);

await assert.rejects(
  () => persistentSession.click("#external"),
  (error) =>
    error instanceof PageRenderBrowserError
    && error.code === "render_navigation_cross_origin",
);

await persistentSession.close();
await persistentSession.close();

assert.equal(
  persistentCloseCount,
  1,
);

await assert.rejects(
  () => persistentSession.click("#toggle"),
  (error) =>
    error instanceof PageRenderBrowserError
    && error.code === "render_browser_session_closed",
);

await assert.rejects(
  () =>
    persistentSession.render(
      "/after-close",
    ),
  (
    error,
  ) =>
    error
      instanceof PageRenderBrowserError
    && error.code
      === "render_browser_session_closed",
);

console.log(
  "Page renderer: OK",
);
