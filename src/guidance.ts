import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "./repository-snapshot.js";

const EXACT_NAMES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "CODESTYLE.md",
  "DEVELOPMENT.md",
]);

const SPECIAL_PREFIXES = [
  ".cursor/rules/",
  ".claude/commands/",
  ".github/instructions/",
  ".github/prompts/",
];

const MAX_FILE_BYTES = 150_000;
const MAX_TOTAL_CHARS = 120_000;

function normalizePath(path?: string): string {
  return (path ?? "").replace(/^\/+|\/+$/g, "");
}

function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function parentDirs(path: string): string[] {
  const normalized = normalizePath(path);

  if (!normalized) {
    return [""];
  }

  const result = [""];
  const parts = normalized.split("/");

  for (let i = 1; i <= parts.length; i++) {
    result.push(parts.slice(0, i).join("/"));
  }

  return result;
}

function isGuidanceFile(path: string): boolean {
  const name = path.split("/").pop() ?? "";

  if (EXACT_NAMES.has(name)) {
    return true;
  }

  return SPECIAL_PREFIXES.some(
    (prefix) =>
      path.startsWith(prefix) ||
      path.includes(`/${prefix}`),
  );
}

function relevanceScore(filePath: string, targetPath: string): number {
  if (!targetPath) {
    return filePath.split("/").length === 1 ? 100 : 10;
  }

  const targetDirs = new Set(parentDirs(targetPath));
  const fileDir = dirname(filePath);

  let score = 0;

  if (targetDirs.has(fileDir)) {
    score += 100 + fileDir.split("/").filter(Boolean).length * 10;
  }

  if (filePath.startsWith(".cursor/rules/")) {
    score += 40;
  }

  if (filePath.startsWith(".claude/commands/")) {
    score += 35;
  }

  if (
    filePath.includes("/.cursor/rules/") ||
    filePath.includes("/.claude/commands/")
  ) {
    score += 30;
  }

  if (filePath.endsWith("AGENTS.md")) {
    score += 25;
  }

  if (filePath.endsWith("CLAUDE.md")) {
    score += 20;
  }

  if (filePath.endsWith("CONTRIBUTING.md")) {
    score += 10;
  }

  return score;
}

async function readTextFile(path: string, head: string) {
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

  const content = Buffer.from(
    response.data.content.replace(/\n/g, ""),
    "base64",
  ).toString("utf8");

  return {
    path,
    skipped: false,
    content,
  };
}

export function registerGuidanceTools(server: McpServer) {
  server.registerTool(
    "repo_guidance",
    {
      description:
        "Find and read repository instructions relevant to a path. Includes AGENTS.md, CLAUDE.md, CONTRIBUTING.md, Cursor rules, Claude commands and similar repository guidance. Use this before planning or modifying code so repository-specific rules are followed.",
      inputSchema: z.object({
        path: z.string().optional(),
        maxFiles: z.number().int().min(1).max(30).optional(),
      }),
    },
    async ({ path, maxFiles = 15 }) => {
      const octokit = getOctokit();
      const targetPath = normalizePath(path);

      const currentHead = await getRepositoryHead();

      const { index: treeIndex } =
        await getRepoTreeIndex(currentHead);

      const candidates = treeIndex.paths
        .filter(isGuidanceFile)
        .map((path) => ({
          path,
          score: relevanceScore(path, targetPath),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxFiles);

      const files = await Promise.all(
        candidates.map((candidate) =>
          readTextFile(candidate.path, currentHead),
        ),
      );

      const output = [];
      let usedChars = 0;

      for (const file of files) {
        if (!file) continue;

        if (file.skipped || file.content === undefined) {
          output.push(file);
          continue;
        }

        const remaining = MAX_TOTAL_CHARS - usedChars;

        if (remaining <= 0) {
          break;
        }

        const content =
          file.content.length > remaining
            ? file.content.slice(0, remaining) +
            "\n\n[TRUNCATED]"
            : file.content;

        usedChars += content.length;

        output.push({
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
                targetPath: targetPath || null,
                guidanceFiles: output,
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
