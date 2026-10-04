import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

type Field = {
  name: string;
  type: string;
  required?: boolean;
  targetCollection?: string;
};

type Collection = {
  name: string;
  fields: Map<string, Field>;
};

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

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mermaidType(type: string): string {
  const lower = type.toLowerCase();

  if (lower.includes("bool")) return "boolean";
  if (lower.includes("number")) return "number";
  if (lower.includes("date")) return "datetime";
  if (lower.includes("json")) return "json";
  if (lower.includes("relation")) return "relation";
  if (lower.includes("file")) return "file";
  if (lower.includes("email")) return "email";
  if (lower.includes("url")) return "url";

  return "string";
}

function parsePocketBaseSchema(raw: string): Collection[] {
  const parsed = JSON.parse(raw);

  const collectionsRaw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.collections)
      ? parsed.collections
      : [];

  return collectionsRaw
    .filter((collection: any) => collection?.name)
    .map((collection: any) => {
      const fields = new Map<string, Field>();

      const sourceFields =
        collection.fields ??
        collection.schema ??
        [];

      for (const field of sourceFields) {
        if (!field?.name) continue;

        fields.set(field.name, {
          name: field.name,
          type: field.type ?? "text",
          required: !!field.required,
          targetCollection:
            field.collectionName ??
            field.options?.collectionName ??
            field.options?.collectionId ??
            undefined,
        });
      }

      return {
        name: collection.name,
        fields,
      };
    });
}

function parseMigrations(files: Array<{ path: string; content: string }>): Collection[] {
  const collections = new Map<string, Collection>();

  function ensureCollection(name: string): Collection {
    let value = collections.get(name);

    if (!value) {
      value = {
        name,
        fields: new Map(),
      };
      collections.set(name, value);
    }

    return value;
  }

  for (const file of files) {
    const text = file.content;

    const collectionPatterns = [
      /name\s*:\s*["'`]([^"'`]+)["'`]/g,
      /new\s+Collection\s*\(\s*\{[\s\S]*?name\s*:\s*["'`]([^"'`]+)["'`]/g,
    ];

    const candidateNames = new Set<string>();

    for (const pattern of collectionPatterns) {
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];

        if (
          name &&
          !name.startsWith("_") &&
          name.length < 100
        ) {
          candidateNames.add(name);
        }
      }
    }

    for (const name of candidateNames) {
      ensureCollection(name);
    }

    const fieldRegex =
      /new\s+([A-Za-z]+Field)\s*\(\s*\{([\s\S]*?)\}\s*\)/g;

    let fieldMatch;

    while ((fieldMatch = fieldRegex.exec(text)) !== null) {
      const fieldClass = fieldMatch[1];
      const body = fieldMatch[2];

      const nameMatch =
        body.match(/name\s*:\s*["'`]([^"'`]+)["'`]/);

      if (!nameMatch) continue;

      const fieldName = nameMatch[1];

      const collectionContext = text
        .slice(Math.max(0, fieldMatch.index - 5000), fieldMatch.index)
        .match(/name\s*:\s*["'`]([^"'`]+)["'`]/g);

      const lastCollectionRaw =
        collectionContext?.at(-1);

      const collectionName =
        lastCollectionRaw?.match(/["'`]([^"'`]+)["'`]/)?.[1];

      if (!collectionName) continue;

      const required =
        /required\s*:\s*true/.test(body);

      const target =
        body.match(
          /collection(?:Id|Name)?\s*:\s*["'`]([^"'`]+)["'`]/,
        )?.[1];

      ensureCollection(collectionName).fields.set(fieldName, {
        name: fieldName,
        type: fieldClass.replace(/Field$/, ""),
        required,
        targetCollection: target,
      });
    }
  }

  return [...collections.values()];
}

function buildMermaid(collections: Collection[]): string {
  const lines: string[] = ["erDiagram"];

  for (const collection of collections) {
    const entity = safeName(collection.name);

    lines.push(`  ${entity} {`);

    if (collection.fields.size === 0) {
      lines.push("    string id");
    } else {
      lines.push("    string id");

      for (const field of collection.fields.values()) {
        lines.push(
          `    ${mermaidType(field.type)} ${safeName(field.name)}`,
        );
      }
    }

    lines.push("  }");
  }

  const relations = new Set<string>();

  for (const collection of collections) {
    for (const field of collection.fields.values()) {
      if (!field.targetCollection) continue;

      const from = safeName(collection.name);
      const to = safeName(field.targetCollection);

      relations.add(
        `  ${to} ||--o{ ${from} : "${field.name}"`,
      );
    }
  }

  lines.push(...relations);

  return lines.join("\n");
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

      let parsedCollections: Collection[] = [];
      let source: "schema" | "migrations" = "migrations";
      let sourceFiles: string[] = [];

      if (schemaPath) {
        const raw = await readFile(schemaPath, currentHead);

        if (raw) {
          try {
            parsedCollections = parsePocketBaseSchema(raw);
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

        parsedCollections = parseMigrations(readable);
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

      const diagram = buildMermaid(parsedCollections);

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
                  name: collection.name,
                  fields: [...collection.fields.values()],
                })),
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
