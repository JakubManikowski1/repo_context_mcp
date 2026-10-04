import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

const SOURCE_EXTENSIONS = [
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".css",
  ".scss",
  ".module.css",
  ".module.scss",
];

const MAX_FILE_BYTES = 250_000;
const MAX_TOTAL_CHARS = 160_000;

function normalizeRoute(route: string): string {
  const value = route.trim();

  if (!value || value === "/") {
    return "/";
  }

  return "/" + value.replace(/^\/+|\/+$/g, "");
}

function routeTokens(route: string): string[] {
  return normalizeRoute(route)
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function scorePath(path: string, tokens: string[]): number {
  const lower = path.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    const t = token.toLowerCase();

    if (lower.includes(`/${t}/`)) score += 40;
    if (lower.includes(t)) score += 15;
  }

  if (/\/(page|layout|index)\.(tsx|jsx|ts|js)$/.test(lower)) {
    score += 40;
  }

  if (lower.includes("/components/")) score += 20;
  if (lower.includes("/hooks/")) score += 12;
  if (lower.includes("/styles/")) score += 8;

  if (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.includes("/node_modules/")
  ) {
    score -= 100;
  }

  return score;
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

export function registerUiTools(server: McpServer) {
  server.registerTool(
    "ui_context",
    {
      description:
        "PRIMARY TOOL FOR KNOWN UI ROUTES. Collect code context for a UI route or screen. Finds likely page/layout files, components, hooks and styles related to the route, then reads the most relevant files. Use this before planning UX or UI changes.",
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
          ...routeTokens(normalizedRoute),
          ...keywords.map((x) => x.trim()).filter(Boolean),
        ]),
      ];

      const currentHead = await getRepositoryHead();

      const { index: treeIndex } =
        await getRepoTreeIndex(currentHead);

      const snapshotPaths = new Set(treeIndex.paths);

      const scoredTreePaths = treeIndex.paths
        .filter(isSourceFile)
        .map((path) => ({
          path,
          score: scorePath(path, tokens),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      const searchQueries = [
        normalizedRoute,
        ...tokens,
      ].filter((x, i, arr) => arr.indexOf(x) === i);

      const searchResults = await Promise.all(
        searchQueries.slice(0, 8).map(async (query) => {
          try {
            const response = await octokit.rest.search.code({
              q: `"${query}" repo:${githubConfig.owner}/${githubConfig.repo}`,
              per_page: 10,
            });

            return response.data.items
              .filter(
                (item) =>
                  isSourceFile(item.path) &&
                  snapshotPaths.has(item.path),
              )
              .map((item) => item.path);
          } catch {
            return [];
          }
        }),
      );

      const candidates = new Map<string, number>();

      for (const item of scoredTreePaths) {
        candidates.set(
          item.path,
          Math.max(candidates.get(item.path) ?? 0, item.score),
        );
      }

      for (const paths of searchResults) {
        for (const path of paths) {
          candidates.set(
            path,
            Math.max(
              candidates.get(path) ?? 0,
              80 + scorePath(path, tokens),
            ),
          );
        }
      }

      const selectedPaths = [...candidates.entries()]
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
                route: normalizedRoute,
                keywords,
                candidatePaths: selectedPaths,
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
