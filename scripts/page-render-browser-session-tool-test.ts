import assert from "node:assert/strict";

import type {
  McpServer,
} from "@modelcontextprotocol/server";

import type {
  RepositoryToolAccess,
} from "../src/repository-access.js";

import type {
  PageRenderBrowserSessionManager,
} from "../src/page-render-browser-session-manager.js";

import {
  registerPageRenderBrowserSessionTools,
  runBrowserSessionClickTool,
  runBrowserSessionCloseTool,
  runBrowserSessionNavigateTool,
  runBrowserSessionOpenTool,
  runBrowserSessionStateTool,
} from "../src/page-render-browser-session-tool.js";

const screenshot = {
  mimeType:
    "image/jpeg" as const,
  data:
    Buffer.from(
      "fake-image",
      "utf8",
    ).toString(
      "base64",
    ),
};

function info(
  route: string,
) {
  return {
    sessionId:
      "session_123",
    repositoryKey:
      "static:lf",
    createdAt:
      "2026-11-05T10:00:00.000Z",
    lastAccessAt:
      "2026-11-05T10:01:00.000Z",
    snapshot: {
      requestedUrl:
        `http://127.0.0.1:5173${route}`,
      finalUrl:
        `http://127.0.0.1:5173${route}`,
      status:
        200,
      title:
        "Lhotse Finance",
      viewport: {
        width:
          1280,
        height:
          720,
      },
      text:
        "Rendered",
      textTruncated:
        false,
      elements:
        [],
      elementsTruncated:
        false,
      screenshot,
      warnings:
        [],
    },
  };
}

let resolvedRepositoryId:
  string | undefined;

const repositoryAccess = {
  async list() {
    return [];
  },

  async resolve(
    repositoryId:
      string | undefined,
  ) {
    resolvedRepositoryId =
      repositoryId;

    return {
      source:
        "static-registry",
      key:
        "static:lf",
      provider:
        "github",
      owner:
        "JakubManikowski1",
      repo:
        "LF_WebSite_CICD",
      branch:
        "main",
      installationId:
        "12345",
    };
  },
} as unknown as RepositoryToolAccess;

const calls:
  string[] = [];

const manager = {
  async open(
    repositoryKey: string,
    route: string,
  ) {
    calls.push(
      `open:${repositoryKey}:${route}`,
    );

    return info(
      route,
    );
  },

  async state(
    sessionId: string,
  ) {
    calls.push(
      `state:${sessionId}`,
    );

    return info(
      "/",
    );
  },

  async render(
    sessionId: string,
    route: string,
  ) {
    calls.push(
      `navigate:${sessionId}:${route}`,
    );

    return info(
      route,
    );
  },

  async click(
    sessionId: string,
    selector: string,
  ) {
    calls.push(`click:${sessionId}:${selector}`);
    return info("/clicked");
  },

  async close(
    sessionId: string,
  ) {
    calls.push(
      `close:${sessionId}`,
    );

    return true;
  },

  async cleanupExpired() {
    return 0;
  },

  async closeAll() {
    return 0;
  },
} satisfies
  PageRenderBrowserSessionManager;


const opened =
  await runBrowserSessionOpenTool(
    repositoryAccess,
    manager,
    {
      repository_id:
        "lf",
      route:
        "/",
    },
  );

assert.equal(
  resolvedRepositoryId,
  "lf",
);

assert.equal(
  opened.info.repositoryKey,
  "static:lf",
);

assert.deepEqual(
  opened.repository,
  {
    provider:
      "github",
    owner:
      "JakubManikowski1",
    name:
      "LF_WebSite_CICD",
    branch:
      "main",
  },
);

await runBrowserSessionStateTool(
  manager,
  {
    session_id:
      "session_123",
  },
);

const navigated =
  await runBrowserSessionNavigateTool(
    manager,
    {
      session_id:
        "session_123",
      route:
        "/kontakt",
    },
  );

assert.equal(
  navigated.snapshot.finalUrl,
  "http://127.0.0.1:5173/kontakt",
);

const clickedInfo = await runBrowserSessionClickTool(
  manager,
  {
    session_id: "session_123",
    selector: "#nav",
  },
);

assert.equal(
  clickedInfo.snapshot.finalUrl,
  "http://127.0.0.1:5173/clicked",
);

const closed =
  await runBrowserSessionCloseTool(
    manager,
    {
      session_id:
        "session_123",
    },
  );

assert.equal(
  closed.closed,
  true,
);

assert.deepEqual(
  calls,
  [
    "open:static:lf:/",
    "state:session_123",
    "navigate:session_123:/kontakt",
    "click:session_123:#nav",
    "close:session_123",
  ],
);


type ToolHandler =
  (
    input:
      Record<
        string,
        unknown
      >,
  ) => Promise<unknown>;

const handlers =
  new Map<
    string,
    ToolHandler
  >();

const fakeServer = {
  registerTool(
    name: string,
    _configuration:
      unknown,
    handler:
      ToolHandler,
  ) {
    handlers.set(
      name,
      handler,
    );
  },
} as unknown as McpServer;

registerPageRenderBrowserSessionTools(
  fakeServer,
  repositoryAccess,
  manager,
);

assert.deepEqual(
  [...handlers.keys()],
  [
    "browser_session_open",
    "browser_session_state",
    "browser_session_navigate",
    "browser_session_click",
    "browser_session_close",
  ],
);

const clickResult = await handlers.get(
  "browser_session_click",
)!({
  session_id: "session_123",
  selector: "#nav",
}) as {
  content: Array<{ type: string; text?: string }>;
};

assert.equal(clickResult.content.length, 2);

assert.equal(
  JSON.parse(
    clickResult.content[0]?.text ?? "{}",
  ).render.finalUrl,
  "http://127.0.0.1:5173/clicked",
);

const openResult =
  await handlers.get(
    "browser_session_open",
  )!({
    repository_id:
      "lf",
    route:
      "/",
  }) as {
    content:
      Array<
        | {
            type:
              "text";
            text:
              string;
          }
        | {
            type:
              "image";
            data:
              string;
            mimeType:
              string;
          }
      >;
  };

assert.equal(
  openResult.content.length,
  2,
);

assert.equal(
  openResult.content[0]?.type,
  "text",
);

assert.equal(
  openResult.content[1]?.type,
  "image",
);

if (
  openResult.content[0]?.type
  !== "text"
) {
  throw new Error(
    "Expected text metadata block",
  );
}

const metadata =
  JSON.parse(
    openResult.content[0].text,
  );

assert.equal(
  metadata.repository.name,
  "LF_WebSite_CICD",
);

assert.equal(
  metadata.session.session_id,
  "session_123",
);

assert.equal(
  metadata.render.screenshot.mimeType,
  "image/jpeg",
);

assert.equal(
  metadata.render.screenshot.bytes,
  Buffer.from(
    screenshot.data,
    "base64",
  ).byteLength,
);

assert.equal(
  "repositoryKey"
    in metadata,
  false,
);

console.log(
  "Page render browser session MCP tools: OK",
);
