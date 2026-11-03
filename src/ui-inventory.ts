import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

import {
  extractUiInventoryItems,
} from "./ui-graph.js";

const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
const MAX_FILE_BYTES = 250_000;

function normalizeRoute(route: string): string {
  if (route.trim() === "/") return "/";
  return "/" + route.trim().replace(/^\/+|\/+$/g, "");
}

function tokensForRoute(route: string): string[] {
  return route
    .split("/")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function scorePath(path: string, tokens: string[]): number {
  const p = path.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (p.includes(`/${token}/`)) score += 50;
    if (p.includes(token)) score += 20;
  }

  if (/\/(page|layout|index)\.(tsx|jsx|ts|js)$/.test(p)) score += 40;
  if (p.includes("/components/")) score += 20;

  return score;
}

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
    !("content" in response.data) ||
    response.data.size > MAX_FILE_BYTES
  ) {
    return null;
  }

  return Buffer.from(
    response.data.content.replace(/\n/g, ""),
    "base64",
  ).toString("utf8");
}

export function registerUiInventoryTools(server: McpServer) {
  server.registerTool(
    "ui_inventory",
    {
      description:
        "PRIMARY UI AUDIT TOOL after ui_context. Build a UX-oriented inventory for a route: headings, buttons, links, form controls, labels, placeholders, accessibility labels and loading/error/empty states. Use together with ui_context when auditing or redesigning a screen.",
      inputSchema: z.object({
        route: z.string().min(1),
        keywords: z.array(z.string().min(1)).max(8).optional(),
        maxFiles: z.number().int().min(1).max(30).optional(),
      }),
    },
    async ({ route, keywords = [], maxFiles = 15 }) => {
      const octokit = getOctokit();

      const normalizedRoute = normalizeRoute(route);

      const tokens = [
        ...new Set([
          ...tokensForRoute(normalizedRoute),
          ...keywords.map((x) => x.toLowerCase()),
        ]),
      ];

      const currentHead = await getRepositoryHead();

      const { index: treeIndex } =
        await getRepoTreeIndex(currentHead);

      const snapshotPaths = new Set(treeIndex.paths);

      const candidates = new Map<string, number>();

      for (const path of treeIndex.paths) {
        if (!isSourceFile(path)) {
          continue;
        }

        const score = scorePath(path, tokens);

        if (score > 0) {
          candidates.set(path, score);
        }
      }

      const queries = [
        normalizedRoute,
        ...tokens,
      ].filter((x, i, arr) => arr.indexOf(x) === i);

      const searches = await Promise.all(
        queries.slice(0, 8).map(async (query) => {
          try {
            const response = await octokit.rest.search.code({
              q: `"${query}" repo:${githubConfig.owner}/${githubConfig.repo}`,
              per_page: 10,
            });

            return response.data.items;
          } catch {
            return [];
          }
        }),
      );

      for (const results of searches) {
        for (const item of results) {
          if (
            !isSourceFile(item.path) ||
            !snapshotPaths.has(item.path)
          ) {
            continue;
          }

          candidates.set(
            item.path,
            Math.max(
              candidates.get(item.path) ?? 0,
              100 + scorePath(item.path, tokens),
            ),
          );
        }
      }

      const paths = [...candidates.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxFiles)
        .map(([path]) => path);

      const files = await Promise.all(
        paths.map(async (path) => {
          const content = await readFile(path, currentHead);

          if (!content) {
            return {
              path,
              error: "Could not read file",
            };
          }

          return {
            path,
            inventory:
              extractUiInventoryItems(
                content,
              ),
          };
        }),
      );

      const totals: Record<string, number> = {};

      for (const file of files) {
        if (!("inventory" in file) || !Array.isArray(file.inventory)) {
          continue;
        }

        for (const item of file.inventory) {
          totals[item.type] = (totals[item.type] ?? 0) + 1;
        }
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
                route: normalizedRoute,
                totals,
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
