import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

const EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
const MAX_FILE_BYTES = 250_000;

type FlowEvent = {
  type: string;
  line: number;
  target?: string;
  text?: string;
};

function normalizeRoute(route: string): string {
  if (route.trim() === "/") return "/";
  return "/" + route.trim().replace(/^\/+|\/+$/g, "");
}

function isSourceFile(path: string): boolean {
  return EXTENSIONS.some((ext) => path.endsWith(ext));
}

function routeTokens(route: string): string[] {
  return normalizeRoute(route)
    .split("/")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
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
  if (p.includes("/hooks/")) score += 15;

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

function clean(value?: string): string | undefined {
  if (!value) return undefined;

  const result = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

  return result || undefined;
}

function extractFlowEvents(content: string): FlowEvent[] {
  const lines = content.split(/\r?\n/);
  const events: FlowEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const href =
      line.match(/\bhref\s*=\s*["'`]([^"'`]+)["'`]/)?.[1];

    if (href) {
      events.push({
        type: "navigation",
        line: lineNo,
        target: href,
      });
    }

    const routerPush =
      line.match(
        /\b(?:router\.(?:push|replace)|navigate)\s*\(\s*["'`]([^"'`]+)["'`]/,
      )?.[1];

    if (routerPush) {
      events.push({
        type: "navigation",
        line: lineNo,
        target: routerPush,
      });
    }

    const apiCall =
      line.match(
        /\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*["'`]([^"'`]+)["'`]/,
      )?.[1];

    if (apiCall) {
      events.push({
        type: "api_call",
        line: lineNo,
        target: apiCall,
      });
    }

    if (/\bonSubmit\s*=|handleSubmit\s*\(/.test(line)) {
      events.push({
        type: "form_submit",
        line: lineNo,
      });
    }

    if (/\bonClick\s*=/.test(line)) {
      events.push({
        type: "click_action",
        line: lineNo,
        text: clean(
          line.match(/>([^<>]{1,120})</)?.[1],
        ),
      });
    }

    if (
      /\b(Dialog|Modal|Drawer|Sheet|Popover)\b/.test(line)
    ) {
      events.push({
        type: "overlay",
        line: lineNo,
      });
    }

    if (
      /\b(disabled|isDisabled|canSubmit|canProceed|hasPermission|isAllowed)\b/.test(
        line,
      )
    ) {
      events.push({
        type: "guard",
        line: lineNo,
        text: clean(line),
      });
    }

    if (
      /\b(isLoading|loading|Loading|Spinner|Skeleton)\b/.test(line)
    ) {
      events.push({
        type: "loading_state",
        line: lineNo,
      });
    }

    if (
      /\b(isError|errorMessage|toast\.error|setError|Error)\b/.test(line)
    ) {
      events.push({
        type: "error_state",
        line: lineNo,
      });
    }

    if (
      /\b(empty|Empty|noData|NoData|length\s*===\s*0)\b/.test(line)
    ) {
      events.push({
        type: "empty_state",
        line: lineNo,
      });
    }
  }

  return events;
}

export function registerUiFlowTools(server: McpServer) {
  server.registerTool(
    "ui_flow",
    {
      description:
        "PRIMARY UI FLOW TOOL after ui_context. Analyze the user flow for a route. Finds navigation, clicks, form submissions, overlays, guards, API calls and loading/error/empty states across relevant frontend files. Use this when planning UX changes across multiple screens or interactions.",
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
            events: extractFlowEvents(content),
          };
        }),
      );

      const summary: Record<string, number> = {};

      for (const file of files) {
        if (!("events" in file) || !Array.isArray(file.events)) {
          continue;
        }

        for (const event of file.events) {
          summary[event.type] = (summary[event.type] ?? 0) + 1;
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
                summary,
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
