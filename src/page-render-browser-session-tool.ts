import type {
  McpServer,
} from "@modelcontextprotocol/server";

import * as z from "zod/v4";

import type {
  RepositoryToolAccess,
} from "./repository-access.js";

import type {
  PageRenderBrowserSessionInfo,
  PageRenderBrowserSessionManager,
} from "./page-render-browser-session-manager.js";

type BrowserSessionRepository =
  Readonly<{
    provider:
      "github";
    owner: string;
    name: string;
    branch: string;
  }>;

type BrowserSessionToolImage =
  Readonly<{
    type:
      "image";
    data: string;
    mimeType: string;
  }>;

type BrowserSessionToolText =
  Readonly<{
    type:
      "text";
    text: string;
  }>;

type BrowserSessionToolContent =
  BrowserSessionToolText
  | BrowserSessionToolImage;

function metadataForSession(
  info:
    PageRenderBrowserSessionInfo,
  repository?:
    BrowserSessionRepository,
) {
  const {
    screenshot,
    ...render
  } = info.snapshot;

  return {
    ...(
      repository
        ? {
            repository,
          }
        : {}
    ),

    session: {
      session_id:
        info.sessionId,
      created_at:
        info.createdAt,
      last_access_at:
        info.lastAccessAt,
    },

    render: {
      ...render,

      screenshot:
        screenshot
          ? {
              mimeType:
                screenshot.mimeType,
              bytes:
                Buffer.from(
                  screenshot.data,
                  "base64",
                ).byteLength,
            }
          : null,
    },
  };
}

function contentForSession(
  info:
    PageRenderBrowserSessionInfo,
  repository?:
    BrowserSessionRepository,
):
  BrowserSessionToolContent[] {
  const content:
    BrowserSessionToolContent[] = [
      {
        type:
          "text",
        text:
          JSON.stringify(
            metadataForSession(
              info,
              repository,
            ),
            null,
            2,
          ),
      },
    ];

  if (
    info.snapshot.screenshot
  ) {
    content.push({
      type:
        "image",
      data:
        info.snapshot
          .screenshot
          .data,
      mimeType:
        info.snapshot
          .screenshot
          .mimeType,
    });
  }

  return content;
}

export async function runBrowserSessionOpenTool(
  repositoryAccess:
    RepositoryToolAccess,
  manager:
    PageRenderBrowserSessionManager,
  input:
    Readonly<{
      repository_id?:
        string;
      route: string;
    }>,
) {
  const repository =
    await repositoryAccess.resolve(
      input.repository_id,
    );

  const info =
    await manager.open(
      repository.key,
      input.route,
    );

  return {
    info,

    repository: {
      provider:
        repository.provider,
      owner:
        repository.owner,
      name:
        repository.repo,
      branch:
        repository.branch,
    } satisfies
      BrowserSessionRepository,
  };
}

export async function runBrowserSessionStateTool(
  manager:
    PageRenderBrowserSessionManager,
  input:
    Readonly<{
      session_id: string;
    }>,
) {
  return manager.state(
    input.session_id,
  );
}

export async function runBrowserSessionNavigateTool(
  manager:
    PageRenderBrowserSessionManager,
  input:
    Readonly<{
      session_id: string;
      route: string;
    }>,
) {
  return manager.render(
    input.session_id,
    input.route,
  );
}

export async function runBrowserSessionClickTool(
  manager: PageRenderBrowserSessionManager,
  input: Readonly<{
    session_id: string;
    selector: string;
  }>,
) {
  return manager.click(
    input.session_id,
    input.selector,
  );
}

export async function runBrowserSessionCloseTool(
  manager:
    PageRenderBrowserSessionManager,
  input:
    Readonly<{
      session_id: string;
    }>,
) {
  return {
    session_id:
      input.session_id,
    closed:
      await manager.close(
        input.session_id,
      ),
  };
}

export function registerPageRenderBrowserSessionTools(
  server:
    McpServer,
  repositoryAccess:
    RepositoryToolAccess,
  manager:
    PageRenderBrowserSessionManager,
) {
  server.registerTool(
    "browser_session_open",
    {
      description:
        "Open a persistent browser session for a trusted repository render profile. The server selects the workspace, command, host, port and browser configuration. Returns the initial rendered state and an opaque session_id.",
      inputSchema:
        z.object({
          repository_id:
            z.string()
              .min(1)
              .optional(),
          route:
            z.string()
              .min(1),
        }),
      annotations: {
        readOnlyHint:
          true,
        destructiveHint:
          false,
        idempotentHint:
          false,
        openWorldHint:
          true,
      },
    },
    async (
      input,
    ) => {
      const {
        info,
        repository,
      } =
        await runBrowserSessionOpenTool(
          repositoryAccess,
          manager,
          input,
        );

      return {
        content:
          contentForSession(
            info,
            repository,
          ),
      };
    },
  );

  server.registerTool(
    "browser_session_state",
    {
      description:
        "Return the latest rendered state for an existing persistent browser session and refresh its activity TTL.",
      inputSchema:
        z.object({
          session_id:
            z.string()
              .min(1),
        }),
      annotations: {
        readOnlyHint:
          true,
        destructiveHint:
          false,
        idempotentHint:
          true,
        openWorldHint:
          false,
      },
    },
    async (
      input,
    ) => {
      const info =
        await runBrowserSessionStateTool(
          manager,
          input,
        );

      return {
        content:
          contentForSession(
            info,
          ),
      };
    },
  );

  server.registerTool(
    "browser_session_navigate",
    {
      description:
        "Navigate an existing persistent browser session to another same-origin route and return the updated rendered state.",
      inputSchema:
        z.object({
          session_id:
            z.string()
              .min(1),
          route:
            z.string()
              .min(1),
        }),
      annotations: {
        readOnlyHint:
          true,
        destructiveHint:
          false,
        idempotentHint:
          false,
        openWorldHint:
          true,
      },
    },
    async (
      input,
    ) => {
      const info =
        await runBrowserSessionNavigateTool(
          manager,
          input,
        );

      return {
        content:
          contentForSession(
            info,
          ),
      };
    },
  );

  server.registerTool(
    "browser_session_click",
    {
      description:
        "Click exactly one matching element in a trusted browser session and return current DOM and screenshot. May trigger application state changes.",
      inputSchema: z.object({
        session_id: z.string().min(1),
        selector: z.string().trim().min(1).max(512),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const info = await runBrowserSessionClickTool(
        manager,
        input,
      );

      return {
        content: contentForSession(info),
      };
    },
  );

  server.registerTool(
    "browser_session_close",
    {
      description:
        "Close a persistent browser session and stop its browser and trusted repository render process.",
      inputSchema:
        z.object({
          session_id:
            z.string()
              .min(1),
        }),
      annotations: {
        readOnlyHint:
          true,
        destructiveHint:
          false,
        idempotentHint:
          true,
        openWorldHint:
          false,
      },
    },
    async (
      input,
    ) => {
      const result =
        await runBrowserSessionCloseTool(
          manager,
          input,
        );

      return {
        content: [
          {
            type:
              "text" as const,
            text:
              JSON.stringify(
                result,
                null,
                2,
              ),
          },
        ],
      };
    },
  );
}
