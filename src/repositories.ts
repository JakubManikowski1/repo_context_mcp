import type {
  McpServer,
} from "@modelcontextprotocol/server";

import * as z from "zod/v4";

import {
  type RepositoryToolAccess,
} from "./repository-access.js";

export function registerRepositoryTools(
  server: McpServer,
  access:
    RepositoryToolAccess,
): void {
  server.registerTool(
    "repositories_list",
    {
      description:
        "List repositories available to the current request identity. repository_id is an opaque connection identifier and does not grant access by itself.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const repositories =
        await access.list();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              repositories.map(
                (repository) => ({
                  repository_id:
                    repository.repositoryId,
                  provider:
                    repository.provider,
                  owner:
                    repository.owner,
                  name:
                    repository.name,
                  branch:
                    repository.branch,
                }),
              ),
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
