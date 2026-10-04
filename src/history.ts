import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { getOctokit, githubConfig } from "./github.js";
import { getRepositoryHead } from "./repository-snapshot.js";

const MAX_PATCH_CHARS = 120_000;

export function registerHistoryTools(server: McpServer) {
  server.registerTool(
    "repo_file_history",
    {
      description:
        "Show recent commits affecting a specific file on the configured branch. Use when investigating why code exists, regressions, previous implementations, or the history of a suspicious file.",
      inputSchema: z.object({
        path: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ path, limit = 20 }) => {
      const octokit = getOctokit();
      const currentHead = await getRepositoryHead();

      const response = await octokit.rest.repos.listCommits({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        sha: currentHead,
        path,
        per_page: limit,
      });

      const commits = response.data.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author:
          commit.author?.login ??
          commit.commit.author?.name ??
          null,
        date:
          commit.commit.author?.date ??
          commit.commit.committer?.date ??
          null,
        url: commit.html_url,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                repository: `${githubConfig.owner}/${githubConfig.repo}`,
                branch: githubConfig.branch,
                head: currentHead,
                path,
                commits,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "repo_diff",
    {
      description:
        "Compare two Git refs in the repository and return changed files, stats, commits and patches. Use to inspect a commit range, understand an implementation change, investigate regressions, or review what changed before planning follow-up work.",
      inputSchema: z.object({
        base: z.string().min(1),
        head: z.string().min(1).optional(),
        includePatch: z.boolean().optional(),
      }),
    },
    async ({
      base,
      head,
      includePatch = true,
    }) => {
      const octokit = getOctokit();

      const resolvedHead =
        head ?? await getRepositoryHead();

      const response =
        await octokit.rest.repos.compareCommitsWithBasehead({
          owner: githubConfig.owner,
          repo: githubConfig.repo,
          basehead: `${base}...${resolvedHead}`,
          per_page: 100,
        });

      let patchChars = 0;

      const files = (response.data.files ?? []).map((file) => {
        let patch: string | undefined;

        if (includePatch && file.patch) {
          const remaining = MAX_PATCH_CHARS - patchChars;

          if (remaining > 0) {
            patch =
              file.patch.length > remaining
                ? file.patch.slice(0, remaining) +
                  "\n[PATCH TRUNCATED]"
                : file.patch;

            patchChars += patch.length;
          }
        }

        return {
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          previousFilename:
            file.previous_filename ?? null,
          patch,
        };
      });

      const commits = response.data.commits.map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author:
          commit.author?.login ??
          commit.commit.author?.name ??
          null,
        date:
          commit.commit.author?.date ??
          commit.commit.committer?.date ??
          null,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                repository: `${githubConfig.owner}/${githubConfig.repo}`,
                base,
                head: resolvedHead,
                requestedHead: head ?? null,
                status: response.data.status,
                aheadBy: response.data.ahead_by,
                behindBy: response.data.behind_by,
                totalCommits: response.data.total_commits,
                commits,
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
