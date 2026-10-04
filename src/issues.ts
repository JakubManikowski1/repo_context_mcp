import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import { fetchIssueDetails } from "./issue-details.js";

export function registerIssueTools(server: McpServer) {
  server.registerTool(
    "issues_list",
    {
      description:
        "List GitHub issues from the configured repository. Pull requests are excluded.",
      inputSchema: z.object({
        state: z.enum(["open", "closed", "all"]).optional(),
        labels: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ state = "open", labels, limit = 20 }) => {
      const octokit = getOctokit();

      const response = await octokit.rest.issues.listForRepo({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        state,
        labels: labels?.join(","),
        per_page: Math.min(100, limit * 2),
        sort: "updated",
        direction: "desc",
      });

      const issues = response.data
        .filter((issue) => !issue.pull_request)
        .slice(0, limit)
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          labels: issue.labels.map((label) =>
            typeof label === "string" ? label : label.name,
          ),
          assignees: issue.assignees?.map((a) => a.login) ?? [],
          comments: issue.comments,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          html_url: issue.html_url,
        }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(issues, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "issue_get",
    {
      description:
        "Get one GitHub issue including its body, labels, assignees and comments.",
      inputSchema: z.object({
        number: z.number().int().positive(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ number }) => {
      const result = await fetchIssueDetails(number);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
