import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

import {
  buildDbGraph,
  parsePocketBaseMigrations,
  parsePocketBaseSchema,
  renderDbGraphMermaid,
} from "./db-graph.js";

import type {
  DbCollection,
} from "./db-graph.js";

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

  if (response.data.size > 1_000_000) {
    return null;
  }

  return Buffer.from(
    response.data.content.replace(/\n/g, ""),
    "base64",
  ).toString("utf8");
}

export function registerDbMermaidTools(server: McpServer) {
  server.registerTool(
    "db_mermaid",
    {
      description:
        "Generate a Mermaid ER diagram from the repository's PocketBase schema or migrations. Useful for understanding database structure and planning schema changes. Treat migration-derived diagrams as best-effort and verify important relations against db_context.",
      inputSchema: z.object({
        collections: z.array(z.string().min(1)).max(30).optional(),
      }),
    },
    async ({ collections: requestedCollections }) => {
      const octokit = getOctokit();

      const currentHead = await getRepositoryHead();

      const { index: treeIndex } =
        await getRepoTreeIndex(currentHead);

      const paths = treeIndex.paths;

      const schemaPath = paths.find(
        (path) =>
          path.endsWith("pb_schema.json") ||
          path.endsWith("/pb_schema.json"),
      );

      let parsedCollections: DbCollection[] = [];
      let source: "schema" | "migrations" = "migrations";
      let sourceFiles: string[] = [];

      if (schemaPath) {
        const raw = await readFile(schemaPath, currentHead);

        if (raw) {
          try {
            parsedCollections =
              parsePocketBaseSchema(
                raw,
                schemaPath,
              );
            source = "schema";
            sourceFiles = [schemaPath];
          } catch {
            // Fall through to migration parsing.
          }
        }
      }

      if (parsedCollections.length === 0) {
        const migrationPaths = paths
          .filter(
            (path) =>
              path.includes("pb_migrations/") &&
              /\.(js|ts)$/.test(path),
          )
          .sort();

        const migrationContents = await Promise.all(
          migrationPaths.map(async (path) => ({
            path,
            content: await readFile(path, currentHead),
          })),
        );

        const readable = migrationContents
          .filter(
            (
              item,
            ): item is {
              path: string;
              content: string;
            } => typeof item.content === "string",
          );

        parsedCollections =
          parsePocketBaseMigrations(
            readable,
          );
        sourceFiles = readable.map((x) => x.path);
      }

      if (requestedCollections?.length) {
        const wanted = new Set(
          requestedCollections.map((x) => x.toLowerCase()),
        );

        parsedCollections = parsedCollections.filter((collection) =>
          wanted.has(collection.name.toLowerCase()),
        );
      }

      const graph =
        buildDbGraph(
          parsedCollections,
        );

      const diagram =
        renderDbGraphMermaid(
          graph,
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
                source,
                sourceFiles,
                collectionCount: parsedCollections.length,
                collections: parsedCollections.map((collection) => ({
                  name:
                    collection.name,
                  fields:
                    [
                      ...collection
                        .fields
                        .values(),
                    ].map(
                      (field) => ({
                        name:
                          field.name,
                        type:
                          field.type,
                        required:
                          !!field.required,
                        targetCollection:
                          field.targetCollection,
                      }),
                    ),
                })),
                graph,
                mermaid: diagram,
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
