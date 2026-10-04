import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

const MAX_FILE_BYTES = 300_000;
const MAX_TOTAL_CHARS = 180_000;

function looksLikeDbFile(path: string): boolean {
  const lower = path.toLowerCase();

  return (
    lower.includes("pb_migrations/") ||
    lower.endsWith("pb_schema.json") ||
    lower.endsWith("schema.json") ||
    lower.includes("/migrations/") ||
    lower.includes("pocketbase")
  );
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

export function registerDbTools(server: McpServer) {
  server.registerTool(
    "db_context",
    {
      description:
        "Collect database and PocketBase schema context. Use it before planning database changes or drawing an ER diagram. Can focus on one collection or concept.",
      inputSchema: z.object({
        collection: z.string().min(1).optional(),
        maxFiles: z.number().int().min(1).max(40).optional(),
      }),
    },
    async ({ collection, maxFiles = 20 }) => {
      const octokit = getOctokit();

      const currentHead = await getRepositoryHead();

      const { index: treeIndex } =
        await getRepoTreeIndex(currentHead);

      const dbPaths = treeIndex.paths.filter(
        looksLikeDbFile,
      );

      const scored = new Map<string, number>();

      for (const path of dbPaths) {
        let score = 10;

        if (path.includes("pb_migrations/")) score += 30;
        if (path.endsWith("pb_schema.json")) score += 100;
        if (path.endsWith("schema.json")) score += 60;

        if (
          collection &&
          path.toLowerCase().includes(collection.toLowerCase())
        ) {
          score += 80;
        }

        scored.set(path, score);
      }

      if (collection) {
        try {
          const search = await octokit.rest.search.code({
            q: `"${collection}" repo:${githubConfig.owner}/${githubConfig.repo}`,
            per_page: 50,
          });

          for (const item of search.data.items) {
            const current = scored.get(item.path) ?? 0;

            scored.set(
              item.path,
              current + (looksLikeDbFile(item.path) ? 100 : 30),
            );
          }
        } catch {
          // Tree-based results are still useful if GitHub code search fails.
        }
      }

      const migrationPaths = dbPaths
        .filter((path) => path.includes("pb_migrations/"))
        .sort()
        .reverse();

      // Recent migrations are useful even when the collection name
      // doesn't appear in the filename.
      for (const [index, path] of migrationPaths.slice(0, 15).entries()) {
        scored.set(
          path,
          Math.max(scored.get(path) ?? 0, 50 - index),
        );
      }

      const selectedPaths = [...scored.entries()]
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
          content,
        });
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
                collection: collection ?? null,
                databaseFilesFound: dbPaths.length,
                migrationCount: migrationPaths.length,
                selectedPaths,
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
