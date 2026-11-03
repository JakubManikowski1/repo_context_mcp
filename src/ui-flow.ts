import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

import {
  buildUiGraph,
  extractUiFlowEvents,
  extractUiInventoryItems,
  resolveUiComponentUsages,
  renderUiGraphMermaid,
} from "./ui-graph.js";

import type {
  UiFlowFile,
} from "./ui-graph.js";

import {
  resolveExpressRouteTree,
} from "./backend-graph.js";

import type {
  BackendSourceFile,
} from "./backend-graph.js";

import {
  buildProcessGraph,
  collectBackendDbDependencyPaths,
  linkBackendRoutesToDirectDbCollections,
  matchUiApiCallsToBackend,
  renderProcessGraphMermaid,
} from "./process-graph.js";

const EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
const MAX_FILE_BYTES = 250_000;

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

export function registerUiFlowTools(server: McpServer) {
  server.registerTool(
    "ui_flow",
    {
      description:
        "PRIMARY UI FLOW TOOL after ui_context. Analyze the user flow for a route. Finds navigation, clicks, form submissions, overlays, guards, API calls and loading/error/empty states across relevant frontend files. Also returns an evidence-backed cross-layer process graph when matching backend routes and direct database access can be resolved. Use this when planning UX changes across multiple screens or interactions.",
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
            events: extractUiFlowEvents(
              content,
            ),
            components:
              resolveUiComponentUsages(
                path,
                content,
                treeIndex.paths,
              ),
            inventory:
              extractUiInventoryItems(
                content,
              ),
          };
        }),
      );

      const graphFiles:
        UiFlowFile[] =
        files.flatMap(
          (file) => {
            if (
              !("events" in file)
              || !Array.isArray(
                file.events,
              )
            ) {
              return [];
            }

            return [
              {
                path:
                  file.path,
                events:
                  file.events,
                components:
                  "components" in file
                  && Array.isArray(
                    file.components,
                  )
                    ? file.components
                    : [],
                inventory:
                  "inventory" in file
                  && Array.isArray(
                    file.inventory,
                  )
                    ? file.inventory
                    : [],
              },
            ];
          },
        );

      const summary:
        Record<
          string,
          number
        > = {};

      for (
        const file
        of graphFiles
      ) {
        for (
          const event
          of file.events
        ) {
          summary[
            event.type
          ] =
            (
              summary[
                event.type
              ]
              ?? 0
            )
            + 1;
        }
      }

      const graph =
        buildUiGraph(
          normalizedRoute,
          graphFiles,
        );

      const mermaid =
        renderUiGraphMermaid(
          graph,
        );


      const backendEntryPaths =
        [
          "apps/api/src/app.js",
          "apps/api/src/app.ts",
        ].filter(
          (path) =>
            snapshotPaths.has(
              path,
            ),
        );

      const backendRoutePaths =
        treeIndex.paths.filter(
          (path) =>
            isSourceFile(
              path,
            )
            && (
              backendEntryPaths.includes(
                path,
              )
              || path.startsWith(
                "apps/api/src/routes/",
              )
            ),
        );

      const backendRouteReadResults =
        await Promise.all(
          backendRoutePaths.map(
            async (
              path,
            ) => {
              const content =
                await readFile(
                  path,
                  currentHead,
                );

              if (!content) {
                return undefined;
              }

              return {
                path,
                content,
              };
            },
          ),
        );

      const backendRouteFiles:
        BackendSourceFile[] =
        backendRouteReadResults.flatMap(
          (file) =>
            file
              ? [
                  file,
                ]
              : [],
        );

      const backendRoutes =
        backendEntryPaths.length
          > 0
          ? resolveExpressRouteTree(
              backendRouteFiles,
              treeIndex.paths,
              backendEntryPaths,
            )
          : [];

      const uiBackendLinks =
        matchUiApiCallsToBackend(
          graphFiles,
          backendRoutes,
        );

      const matchedBackendRoutes =
        [
          ...new Map(
            uiBackendLinks.map(
              (link) => [
                [
                  link.backend.method,
                  link.backend.fullPath,
                  link.backend.sourcePath,
                  link.backend.line,
                ].join(
                  "|",
                ),
                link.backend,
              ],
            ),
          ).values(),
        ];

      const backendDependencyFiles =
        new Map<
          string,
          BackendSourceFile
        >();

      for (
        let round = 0;
        round < 3;
        round++
      ) {
        const neededPaths =
          collectBackendDbDependencyPaths(
            matchedBackendRoutes,
            [
              ...backendDependencyFiles.values(),
            ],
            treeIndex.paths,
          ).filter(
            (path) =>
              !backendDependencyFiles.has(
                path,
              ),
          );

        if (
          neededPaths.length
            === 0
        ) {
          break;
        }

        const loaded =
          await Promise.all(
            neededPaths.map(
              async (
                path,
              ) => {
                const content =
                  await readFile(
                    path,
                    currentHead,
                  );

                if (!content) {
                  return undefined;
                }

                return {
                  path,
                  content,
                };
              },
            ),
          );

        for (
          const file
          of loaded
        ) {
          if (!file) {
            continue;
          }

          backendDependencyFiles.set(
            file.path,
            file,
          );
        }
      }

      const backendDbLinks =
        linkBackendRoutesToDirectDbCollections(
          matchedBackendRoutes,
          [
            ...backendDependencyFiles.values(),
          ],
          treeIndex.paths,
        );

      const processGraph =
        buildProcessGraph(
          uiBackendLinks,
          backendDbLinks,
        );

      const processMermaid =
        renderProcessGraphMermaid(
          processGraph,
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
                route: normalizedRoute,
                summary,
                files,
                graph,
                mermaid,
                processGraph,
                processMermaid,
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
