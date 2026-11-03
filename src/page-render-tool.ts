import type {
  McpServer,
} from "@modelcontextprotocol/server";

import * as z from "zod/v4";

import type {
  RepositoryToolAccess,
} from "./repository-access.js";

import {
  renderPageForRepository,
  type PageRenderTargetAccess,
} from "./page-render-target.js";

import type {
  PageRenderSnapshot,
} from "./page-renderer.js";

export type PageRenderToolInput =
  Readonly<{
    repository_id?: string;
    route: string;
  }>;

export type PageRenderToolMetadata =
  Readonly<{
    repository:
      Readonly<{
        provider: "github";
        owner: string;
        name: string;
        branch: string;
      }>;
    render:
      Omit<
        PageRenderSnapshot,
        "screenshot"
      > & {
        screenshot:
          | Readonly<{
              mimeType:
                "image/jpeg";
              bytes: number;
            }>
          | null;
      };
  }>;

export type PageRenderToolExecution =
  Readonly<{
    metadata:
      PageRenderToolMetadata;
    screenshot?:
      Readonly<{
        mimeType:
          "image/jpeg";
        data: string;
      }>;
  }>;

export type RenderPageForRepository =
  (
    access:
      PageRenderTargetAccess,
    repositoryKey: string,
    route: string,
  ) => Promise<PageRenderSnapshot>;

export interface PageRenderToolRenderer {
  render(
    repositoryKey: string,
    route: string,
  ):
    Promise<PageRenderSnapshot>;
}

export function createPageRenderTargetToolRenderer(
  targetAccess:
    PageRenderTargetAccess,
  renderPage:
    RenderPageForRepository =
      renderPageForRepository,
):
  PageRenderToolRenderer {
  return {
    async render(
      repositoryKey,
      route,
    ) {
      return renderPage(
        targetAccess,
        repositoryKey,
        route,
      );
    },
  };
}

export async function runPageRenderTool(
  repositoryAccess:
    RepositoryToolAccess,
  renderer:
    PageRenderToolRenderer,
  input:
    PageRenderToolInput,
): Promise<PageRenderToolExecution> {
  const repository =
    await repositoryAccess.resolve(
      input.repository_id,
    );

  const snapshot =
    await renderer.render(
      repository.key,
      input.route,
    );

  const {
    screenshot,
    ...renderMetadata
  } = snapshot;

  return {
    metadata: {
      repository: {
        provider:
          repository.provider,
        owner:
          repository.owner,
        name:
          repository.repo,
        branch:
          repository.branch,
      },
      render: {
        ...renderMetadata,
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
    },
    ...(
      screenshot
        ? {
            screenshot,
          }
        : {}
    ),
  };
}

export function registerPageRenderTools(
  server:
    McpServer,
  repositoryAccess:
    RepositoryToolAccess,
  renderer:
    PageRenderToolRenderer,
) {
  server.registerTool(
    "page_render",
    {
      description:
        "Render a route from the selected repository using trusted server-side render configuration. Returns bounded rendered DOM context and, when available, a screenshot. Workspace, command, host, port, and origin are not model-controlled.",
      inputSchema:
        z.object({
          repository_id:
            z.string()
              .min(
                1,
              )
              .optional(),
          route:
            z.string()
              .min(
                1,
              ),
        }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (
      input,
    ) => {
      const execution =
        await runPageRenderTool(
          repositoryAccess,
          renderer,
          input,
        );

      const content:
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
        > = [
          {
            type:
              "text",
            text:
              JSON.stringify(
                execution.metadata,
                null,
                2,
              ),
          },
        ];

      if (
        execution.screenshot
      ) {
        content.push({
          type:
            "image",
          data:
            execution
              .screenshot
              .data,
          mimeType:
            execution
              .screenshot
              .mimeType,
        });
      }

      return {
        content,
      };
    },
  );
}
