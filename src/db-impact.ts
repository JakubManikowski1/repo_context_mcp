import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

const MAX_FILE_BYTES = 250_000;
const MAX_TOTAL_CHARS = 160_000;

function category(path: string): string {
  const p = path.toLowerCase();

  if (p.includes("pb_migrations/") || p.includes("/migrations/")) {
    return "migration";
  }

  if (p.includes("/tests/") || p.includes(".test.") || p.includes(".spec.")) {
    return "test";
  }

  if (
    p.includes("/components/") ||
    p.includes("/pages/") ||
    p.includes("/views/") ||
    p.includes("/frontend/") ||
    p.includes("/web/")
  ) {
    return "frontend";
  }

  if (
    p.includes("/api/") ||
    p.includes("/routes/") ||
    p.includes("/controllers/") ||
    p.includes("/backend/") ||
    p.includes("/server/")
  ) {
    return "api";
  }

  if (p.includes("/scripts/")) {
    return "script";
  }

  return "other";
}

async function readFile(path: string, head: string) {
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

  if (response.data.size > MAX_FILE_BYTES) {
    return {
      path,
      skipped: true,
      reason: `File too large: ${response.data.size} bytes`,
    };
  }

  return {
    path,
    skipped: false,
    content: Buffer.from(
      response.data.content.replace(/\n/g, ""),
      "base64",
    ).toString("utf8"),
  };
}

export function registerDbImpactTools(server: McpServer) {
  server.registerTool(
    "db_impact",
    {
      description:
        "Analyze the code impact of changing a PocketBase/database collection or field. Searches migrations, backend, frontend, tests and scripts, ranks affected files and reads the most relevant ones. Use before database migrations or /db plan.",
      inputSchema: z.object({
        collection: z.string().min(1),
        field: z.string().min(1).optional(),
        extraQueries: z.array(z.string().min(1)).max(6).optional(),
        maxFiles: z.number().int().min(1).max(25).optional(),
      }),
    },
    async ({
      collection,
      field,
      extraQueries = [],
      maxFiles = 15,
    }) => {
      const octokit = getOctokit();

      const currentHead = await getRepositoryHead();

      const { index: treeIndex } =
        await getRepoTreeIndex(currentHead);

      const snapshotPaths = new Set(treeIndex.paths);

      const queries = [
        collection,
        field ? `${collection} ${field}` : null,
        field ?? null,
        ...extraQueries,
      ].filter((x): x is string => !!x);

      const searchResults = await Promise.all(
        [...new Set(queries)].map(async (query) => {
          try {
            const response = await octokit.rest.search.code({
              q: `${query} repo:${githubConfig.owner}/${githubConfig.repo}`,
              per_page: 50,
            });

            return {
              query,
              items: response.data.items
                .filter((item) => snapshotPaths.has(item.path))
                .map((item) => ({
                  path: item.path,
                  name: item.name,
                })),
            };
          } catch (error) {
            return {
              query,
              items: [],
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
            };
          }
        }),
      );

      const scores = new Map<string, number>();

      for (const search of searchResults) {
        for (const [index, item] of search.items.entries()) {
          let score = Math.max(1, 50 - index);

          switch (category(item.path)) {
            case "migration":
              score += 60;
              break;
            case "api":
              score += 40;
              break;
            case "test":
              score += 25;
              break;
            case "frontend":
              score += 20;
              break;
            case "script":
              score += 15;
              break;
          }

          scores.set(
            item.path,
            (scores.get(item.path) ?? 0) + score,
          );
        }
      }

      const selectedPaths = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxFiles)
        .map(([path]) => path);

      const readResults = await Promise.all(
        selectedPaths.map((path) => readFile(path, currentHead)),
      );

      const files = [];
      let usedChars = 0;

      for (const file of readResults) {
        if (!file) continue;

        if (file.skipped || file.content === undefined) {
          files.push(file);
          continue;
        }

        const remaining = MAX_TOTAL_CHARS - usedChars;

        if (remaining <= 0) {
          break;
        }

        const content =
          file.content.length > remaining
            ? file.content.slice(0, remaining) + "\n\n[TRUNCATED]"
            : file.content;

        usedChars += content.length;

        files.push({
          path: file.path,
          category: category(file.path),
          content,
        });
      }

      const groupedPaths: Record<string, string[]> = {};

      for (const path of selectedPaths) {
        const group = category(path);
        groupedPaths[group] ??= [];
        groupedPaths[group].push(path);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                repository: `${githubConfig.owner}/${githubConfig.repo}`,
                branch: githubConfig.branch,
                head: currentHead,
                collection,
                field: field ?? null,
                queries,
                groupedPaths,
                files,
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
