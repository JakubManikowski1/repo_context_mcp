import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { issueIndexConfig } from "./config.js";
import { fetchIssueDetails } from "./issue-details.js";
import type {
  RepositoryContext,
} from "./repository-context.js";

import {
  createLegacyRepositoryAccess,
  type RepositoryToolAccess,
} from "./repository-access.js";
import { getRepositoryHead } from "./repository-snapshot.js";

type IndexItem = {
  issue: number;
  id: string | null;
  title: string | null;
  text: string;
};

let indexCache:
  | {
      repositoryKey: string;
      path: string;
      sha: string;
      items: IndexItem[];
    }
  | undefined;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_#[\](){}<>:;,."'!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function parseIssueIndex(markdown: string): IndexItem[] {
  const items: IndexItem[] = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const issueMatch =
      rawLine.match(/\[#(\d+)\]\([^)]+\)/) ??
      rawLine.match(/(?:^|[\s|])#(\d+)\b/);

    if (!issueMatch) continue;

    const issue = Number(issueMatch[1]);

    if (!Number.isSafeInteger(issue) || issue <= 0) {
      continue;
    }

    const cells = rawLine
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    const idMatch = rawLine.match(/`([^`]+)`/);

    let title: string | null = null;

    if (cells.length >= 2) {
      const candidate = cells[1]
        .replace(/\*\*/g, "")
        .replace(/\\([*_])/g, "$1")
        .trim();

      if (candidate) {
        title = candidate;
      }
    }

    items.push({
      issue,
      id: idMatch?.[1]?.trim() || null,
      title,
      text: rawLine,
    });
  }

  return items;
}

async function getIssueIndex(
  repository: RepositoryContext,
): Promise<{
  items: IndexItem[];
  cacheHit: boolean;
  error: string | null;
}> {
  const path = issueIndexConfig.path;

  if (!path) {
    return {
      items: [],
      cacheHit: false,
      error: null,
    };
  }

  try {
    const octokit = repository.octokit;
    const head = await getRepositoryHead(repository);

    const response = await octokit.rest.repos.getContent({
      owner: repository.owner,
      repo: repository.repo,
      path,
      ref: head,
    });

    if (
      Array.isArray(response.data) ||
      response.data.type !== "file" ||
      !("content" in response.data)
    ) {
      return {
        items: [],
        cacheHit: false,
        error: `${path} is not a readable file`,
      };
    }

    if (
      indexCache &&
      indexCache.repositoryKey === repository.key &&
      indexCache.path === path &&
      indexCache.sha === response.data.sha
    ) {
      return {
        items: indexCache.items,
        cacheHit: true,
        error: null,
      };
    }

    const markdown = Buffer.from(
      response.data.content.replace(/\n/g, ""),
      "base64",
    ).toString("utf8");

    const items = parseIssueIndex(markdown);

    indexCache = {
      repositoryKey: repository.key,
      path,
      sha: response.data.sha,
      items,
    };

    return {
      items,
      cacheHit: false,
      error: null,
    };
  } catch (error) {
    return {
      items: [],
      cacheHit: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

function scoreIndexItem(
  item: IndexItem,
  rawQuery: string,
): number {
  const query = normalize(rawQuery);
  const id = normalize(item.id ?? "");
  const title = normalize(item.title ?? "");
  const text = normalize(item.text);

  if (query && query === id) return 10_000;
  if (query && query === title) return 9_000;

  let score = 0;

  if (query && id.includes(query)) score += 2_000;
  if (query && title.includes(query)) score += 1_500;
  if (query && text.includes(query)) score += 800;

  for (const token of queryTokens(rawQuery)) {
    if (id.includes(token)) score += 150;
    if (title.includes(token)) score += 120;
    if (text.includes(token)) score += 40;
  }

  return score;
}

function scoreGitHubIssue(
  issue: {
    title: string;
    body?: string | null;
  },
  rawQuery: string,
): number {
  const query = normalize(rawQuery);
  const title = normalize(issue.title);
  const body = normalize(issue.body ?? "");

  if (query && title === query) return 10_000;

  let score = 0;

  if (query && title.includes(query)) score += 4_000;
  if (query && body.includes(query)) score += 1_000;

  for (const token of queryTokens(rawQuery)) {
    if (title.includes(token)) score += 300;
    if (body.includes(token)) score += 50;
  }

  return score;
}

function explicitIssueNumber(query: string): number | null {
  const exact = query.match(/^\s*#?(\d+)\s*$/);

  if (exact) {
    return Number(exact[1]);
  }

  const named = query.match(/\bissue\s+#?(\d+)\b/i);

  return named ? Number(named[1]) : null;
}

export function registerIssueLookupTools(
  server: McpServer,
  access:
    RepositoryToolAccess =
      createLegacyRepositoryAccess(),
) {
  server.registerTool(
    "issue_lookup",
    {
      description:
        "Resolve a GitHub issue from an issue number, title, description or optional repository issue index. GitHub Issues remains the source of truth.",
      inputSchema: z.object({
        repository_id:
          z.string().min(1).optional(),
        query: z.string().min(1),
        maxCandidates: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      repository_id,
      query,
      maxCandidates = 5,
    }) => {
      const repository =
        await access.resolve(
          repository_id,
        );

      const started = performance.now();

      const directNumber = explicitIssueNumber(query);

      if (directNumber) {
        const issue = await fetchIssueDetails(directNumber, repository);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  resolved: true,
                  resolvedBy: "issue_number",
                  issue,
                  timing: {
                    totalMs: Math.round(
                      performance.now() - started,
                    ),
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const indexStarted = performance.now();

      const index = await getIssueIndex(repository);

      const indexMs = Math.round(
        performance.now() - indexStarted,
      );

      const rankedIndex = index.items
        .map((item) => ({
          ...item,
          score: scoreIndexItem(item, query),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

      const topIndex = rankedIndex[0];
      const secondIndex = rankedIndex[1];

      const indexConfident =
        !!topIndex &&
        (
          topIndex.score >= 9_000 ||
          (
            topIndex.score >= 800 &&
            (
              !secondIndex ||
              topIndex.score >= secondIndex.score + 300
            )
          )
        );

      if (indexConfident) {
        const issue = await fetchIssueDetails(topIndex.issue, repository);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  resolved: true,
                  resolvedBy: "repository_index",
                  index: {
                    path: issueIndexConfig.path,
                    id: topIndex.id,
                    title: topIndex.title,
                    cacheHit: index.cacheHit,
                  },
                  issue,
                  timing: {
                    indexMs,
                    totalMs: Math.round(
                      performance.now() - started,
                    ),
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const octokit = repository.octokit;

      const searchStarted = performance.now();

      const response =
        await octokit.rest.search.issuesAndPullRequests({
          q: `${query} repo:${repository.owner}/${repository.repo} is:issue`,
          per_page: Math.min(20, maxCandidates * 2),
        });

      const searchMs = Math.round(
        performance.now() - searchStarted,
      );

      const rankedGitHub = response.data.items
        .map((item, index) => ({
          number: item.number,
          title: item.title,
          state: item.state,
          url: item.html_url,
          score:
            scoreGitHubIssue(item, query) +
            Math.max(0, 100 - index),
        }))
        .sort((a, b) => b.score - a.score);

      const top = rankedGitHub[0];
      const second = rankedGitHub[1];

      const confident =
        !!top &&
        (
          top.score >= 4_000 ||
          (
            top.score >= 600 &&
            (
              !second ||
              top.score >= second.score + 300
            )
          )
        );

      const candidates = rankedGitHub
        .slice(0, maxCandidates);

      if (!confident) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  resolved: false,
                  candidates,
                  index: {
                    configured: !!issueIndexConfig.path,
                    path: issueIndexConfig.path,
                    cacheHit: index.cacheHit,
                    error: index.error,
                  },
                  timing: {
                    indexMs,
                    searchMs,
                    totalMs: Math.round(
                      performance.now() - started,
                    ),
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const issue = await fetchIssueDetails(top.number, repository);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                resolved: true,
                resolvedBy: "github_search",
                candidates,
                index: {
                  configured: !!issueIndexConfig.path,
                  path: issueIndexConfig.path,
                  cacheHit: index.cacheHit,
                  error: index.error,
                },
                issue,
                timing: {
                  indexMs,
                  searchMs,
                  totalMs: Math.round(
                    performance.now() - started,
                  ),
                },
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
