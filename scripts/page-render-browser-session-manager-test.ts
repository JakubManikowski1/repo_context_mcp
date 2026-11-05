import assert from "node:assert/strict";

import type {
  PageRenderExecutionProfile,
} from "../src/page-render-execution-profile.js";

import type {
  PageRenderExecutionSession,
} from "../src/page-render-execution-session.js";

import {
  createPageRenderBrowserSessionManager,
  PageRenderBrowserSessionManagerError,
} from "../src/page-render-browser-session-manager.js";

import type {
  PageRenderBrowserSession,
  PageRenderSnapshot,
} from "../src/page-renderer.js";

const profile:
  PageRenderExecutionProfile = {
    repositoryId:
      "lf",
    strategy:
      "local-workspace",
    workspace:
      "/tmp/lf-workspace",
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
    ],
  };

function snapshotFor(
  route: string,
): PageRenderSnapshot {
  return {
    requestedUrl:
      `http://127.0.0.1:5173${route}`,
    finalUrl:
      `http://127.0.0.1:5173${route}`,
    status:
      200,
    title:
      `Route ${route}`,
    viewport: {
      width:
        1280,
      height:
        720,
    },
    text:
      `Rendered ${route}`,
    textTruncated:
      false,
    elements:
      [],
    elementsTruncated:
      false,
    warnings:
      [],
  };
}

let now =
  Date.parse(
    "2026-11-05T08:00:00.000Z",
  );

const cleanupOrder:
  string[] = [];

let executionStarts =
  0;

let browserStarts =
  0;

let renderedRoutes:
  string[] = [];

const startExecutionSession =
  async (
    options: {
      repositoryKey: string;
      browserExecutablePath: string;
    },
  ): Promise<
    PageRenderExecutionSession
  > => {
    executionStarts +=
      1;

    assert.equal(
      options.repositoryKey,
      "static:lf",
    );

    assert.equal(
      options.browserExecutablePath,
      "/tmp/chrome",
    );

    return {
      target: {
        repositoryKey:
          options.repositoryKey,
        origin:
          "http://127.0.0.1:5173",
        browserExecutablePath:
          options.browserExecutablePath,
      },

      async stop() {
        cleanupOrder.push(
          "execution",
        );
      },
    };
  };

const startBrowserSession =
  async (
    options: {
      origin: string;
      browserExecutablePath: string;
    },
  ): Promise<
    PageRenderBrowserSession
  > => {
    browserStarts +=
      1;

    assert.equal(
      options.origin,
      "http://127.0.0.1:5173",
    );

    assert.equal(
      options.browserExecutablePath,
      "/tmp/chrome",
    );

    return {
      origin:
        options.origin,

      async render(
        route,
      ) {
        renderedRoutes.push(
          route,
        );

        return snapshotFor(
          route,
        );
      },

      async click(_selector) {
        return snapshotFor("/clicked");
      },

      async close() {
        cleanupOrder.push(
          "browser",
        );
      },
    };
  };

const ids = [
  "session_one",
  "session_two",
  "session_three",
];

const manager =
  createPageRenderBrowserSessionManager({
    bindings: [
      {
        repositoryKey:
          "static:lf",
        profile,
      },
    ],
    browserExecutablePath:
      "/tmp/chrome",
    ttlMs:
      60_000,
    now:
      () => now,
    createSessionId:
      () => {
        const id =
          ids.shift();

        assert.ok(
          id,
        );

        return id;
      },
    startExecutionSession:
      startExecutionSession as never,
    startBrowserSession:
      startBrowserSession as never,
  });

const opened =
  await manager.open(
    "static:lf",
    "/",
  );

assert.equal(
  opened.sessionId,
  "session_one",
);

assert.equal(
  opened.repositoryKey,
  "static:lf",
);

assert.equal(
  opened.snapshot.finalUrl,
  "http://127.0.0.1:5173/",
);

assert.equal(
  opened.createdAt,
  "2026-11-05T08:00:00.000Z",
);

assert.equal(
  opened.lastAccessAt,
  opened.createdAt,
);

assert.equal(
  executionStarts,
  1,
);

assert.equal(
  browserStarts,
  1,
);

assert.deepEqual(
  renderedRoutes,
  [
    "/",
  ],
);

now +=
  10_000;

const state =
  await manager.state(
    opened.sessionId,
  );

assert.equal(
  state.lastAccessAt,
  "2026-11-05T08:00:10.000Z",
);

now +=
  5_000;

const rendered =
  await manager.render(
    opened.sessionId,
    "/contact",
  );

assert.equal(
  rendered.snapshot.finalUrl,
  "http://127.0.0.1:5173/contact",
);

assert.equal(
  rendered.lastAccessAt,
  "2026-11-05T08:00:15.000Z",
);

const clickedInfo = await manager.click(
  opened.sessionId,
  "#nav",
);

assert.equal(
  clickedInfo.snapshot.finalUrl,
  "http://127.0.0.1:5173/clicked",
);

assert.equal(
  clickedInfo.lastAccessAt,
  "2026-11-05T08:00:15.000Z",
);

assert.deepEqual(
  renderedRoutes,
  [
    "/",
    "/contact",
  ],
);

assert.deepEqual(
  cleanupOrder,
  [],
);

assert.equal(
  await manager.close(
    opened.sessionId,
  ),
  true,
);

assert.deepEqual(
  cleanupOrder,
  [
    "browser",
    "execution",
  ],
);

assert.equal(
  await manager.close(
    opened.sessionId,
  ),
  false,
);

await assert.rejects(
  () =>
    manager.state(
      opened.sessionId,
    ),
  (
    error,
  ) =>
    error
      instanceof PageRenderBrowserSessionManagerError
    && error.code
      === "browser_session_not_found",
);


cleanupOrder.length =
  0;

renderedRoutes =
  [];

const expiring =
  await manager.open(
    "static:lf",
    "/expiring",
  );

now +=
  60_000;

assert.equal(
  await manager.cleanupExpired(),
  1,
);

assert.deepEqual(
  cleanupOrder,
  [
    "browser",
    "execution",
  ],
);

await assert.rejects(
  () =>
    manager.state(
      expiring.sessionId,
    ),
  (
    error,
  ) =>
    error
      instanceof PageRenderBrowserSessionManagerError
    && error.code
      === "browser_session_not_found",
);


await assert.rejects(
  () =>
    manager.open(
      "static:unknown",
      "/",
    ),
  (
    error,
  ) =>
    error
      instanceof PageRenderBrowserSessionManagerError
    && error.code
      === "browser_session_profile_not_found",
);


cleanupOrder.length =
  0;

const remaining =
  await manager.open(
    "static:lf",
    "/remaining",
  );

assert.equal(
  remaining.sessionId,
  "session_three",
);

assert.equal(
  await manager.closeAll(),
  1,
);

assert.deepEqual(
  cleanupOrder,
  [
    "browser",
    "execution",
  ],
);


let failedExecutionStopped =
  false;

const failingManager =
  createPageRenderBrowserSessionManager({
    bindings: [
      {
        repositoryKey:
          "static:lf",
        profile,
      },
    ],
    browserExecutablePath:
      "/tmp/chrome",
    now:
      () => now,
    createSessionId:
      () =>
        "failed_session",

    async startExecutionSession(
      options,
    ) {
      return {
        target: {
          repositoryKey:
            options.repositoryKey,
          origin:
            "http://127.0.0.1:5173",
          browserExecutablePath:
            options.browserExecutablePath,
        },

        async stop() {
          failedExecutionStopped =
            true;
        },
      };
    },

    async startBrowserSession() {
      throw new Error(
        "browser failed",
      );
    },
  });

await assert.rejects(
  () =>
    failingManager.open(
      "static:lf",
      "/",
    ),
  /browser failed/,
);

assert.equal(
  failedExecutionStopped,
  true,
);


assert.throws(
  () =>
    createPageRenderBrowserSessionManager({
      bindings: [
        {
          repositoryKey:
            "static:lf",
          profile,
        },
        {
          repositoryKey:
            "static:lf",
          profile,
        },
      ],
      browserExecutablePath:
        "/tmp/chrome",
    }),
  (
    error,
  ) =>
    error
      instanceof PageRenderBrowserSessionManagerError
    && error.code
      === "browser_session_binding_duplicate",
);

assert.throws(
  () =>
    createPageRenderBrowserSessionManager({
      bindings: [],
      browserExecutablePath:
        "/tmp/chrome",
      ttlMs:
        0,
    }),
  (
    error,
  ) =>
    error
      instanceof PageRenderBrowserSessionManagerError
    && error.code
      === "browser_session_ttl_invalid",
);

console.log(
  "Page render browser session manager: OK",
);
