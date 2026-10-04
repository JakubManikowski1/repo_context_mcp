import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

const COMMAND_PREFIXES = [
  ".claude/commands/",
  ".github/prompts/",
  ".cursor/commands/",
];

async function readFile(path: string, head: string): Promise<string | null> {
  const octokit = getOctokit();

  const response = await octokit.rest.repos.getContent({
    owner: githubConfig.owner,
    repo: githubConfig.repo,
    path,
    ref: head,
  });

  if (
    Array.isArray(response.data) ||
    response.data.type !== "file" ||
    !("content" in response.data)
  ) {
    return null;
  }

  if (response.data.size > 200_000) {
    return null;
  }

  return Buffer.from(
    response.data.content.replace(/\n/g, ""),
    "base64",
  ).toString("utf8");
}

export function registerCommandTools(server: McpServer) {
  server.registerTool(
    "repo_commands",
    {
      description:
        "Discover repository commands and development workflows. Returns npm scripts from package.json files plus repository command definitions such as Claude commands, GitHub prompts and Cursor commands. Use this before planning work to discover project-specific procedures such as database planning, migrations, tests or deployment commands.",
      inputSchema: z.object({
        maxPackages: z.number().int().min(1).max(50).optional(),
        maxCommandFiles: z.number().int().min(1).max(50).optional(),
      }),
    },
    async ({ maxPackages = 20, maxCommandFiles = 30 }) => {
      const octokit = getOctokit();

      const currentHead = await getRepositoryHead();

      const { index: treeIndex } =
        await getRepoTreeIndex(currentHead);

      const paths = treeIndex.paths;

      const packagePaths = paths
        .filter((path) => path === "package.json" || path.endsWith("/package.json"))
        .slice(0, maxPackages);

      const commandPaths = paths
        .filter((path) =>
          COMMAND_PREFIXES.some(
            (prefix) =>
              path.startsWith(prefix) ||
              path.includes(`/${prefix}`),
          ),
        )
        .slice(0, maxCommandFiles);

      const packageResults = await Promise.all(
        packagePaths.map(async (path) => {
          const content = await readFile(path, currentHead);

          if (!content) {
            return { path, error: "Could not read package.json" };
          }

          try {
            const parsed = JSON.parse(content);

            return {
              path,
              name: parsed.name ?? null,
              scripts: parsed.scripts ?? {},
            };
          } catch {
            return {
              path,
              error: "Invalid package.json",
            };
          }
        }),
      );

      const commandResults = await Promise.all(
        commandPaths.map(async (path) => {
          const content = await readFile(path, currentHead);

          return {
            path,
            content,
          };
        }),
      );

      const specialFiles = [
        "Makefile",
        "Taskfile.yml",
        "Taskfile.yaml",
        "justfile",
      ].filter((path) => paths.includes(path));

      const specialResults = await Promise.all(
        specialFiles.map(async (path) => ({
          path,
          content: await readFile(path, currentHead),
        })),
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                repository: `${githubConfig.owner}/${githubConfig.repo}`,
                branch: githubConfig.branch,
                head: currentHead,
                packages: packageResults,
                commandFiles: commandResults,
                specialCommandFiles: specialResults,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
