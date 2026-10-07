import { getOctokit, githubConfig } from "./github.js";

export type RepositoryContext = {
  provider: "github";
  key: string;
  owner: string;
  repo: string;
  branch: string;
  octokit: ReturnType<typeof getOctokit>;
};

export function getLegacyRepositoryContext(): RepositoryContext {
  const owner = githubConfig.owner;
  const repo = githubConfig.repo;
  const branch = githubConfig.branch;
  const installationId = githubConfig.installationId;

  return {
    provider: "github",
    key: `github:${installationId}:${owner}/${repo}:${branch}`,
    owner,
    repo,
    branch,
    octokit: getOctokit(),
  };
}
