import { getOctokit, githubConfig } from "./github.js";

export type RepoTreeIndex = {
  head: string;
  paths: string[];
};

let repoTreeCache: RepoTreeIndex | null = null;

let repoTreeInFlight: {
  head: string;
  promise: Promise<RepoTreeIndex>;
} | null = null;

export async function getRepositoryHead(): Promise<string> {
  const octokit = getOctokit();

  const response = await octokit.rest.repos.getBranch({
    owner: githubConfig.owner,
    repo: githubConfig.repo,
    branch: githubConfig.branch,
  });

  return response.data.commit.sha;
}

export async function getRepoTreeIndex(
  head: string,
): Promise<{
  index: RepoTreeIndex;
  cacheHit: boolean;
  treeMs: number;
}> {
  if (
    repoTreeCache &&
    repoTreeCache.head === head
  ) {
    return {
      index: repoTreeCache,
      cacheHit: true,
      treeMs: 0,
    };
  }

  if (
    repoTreeInFlight &&
    repoTreeInFlight.head === head
  ) {
    const started = performance.now();

    const index = await repoTreeInFlight.promise;

    return {
      index,
      cacheHit: true,
      treeMs: Math.round(
        performance.now() - started,
      ),
    };
  }

  const octokit = getOctokit();
  const started = performance.now();

  const promise = (async () => {
    const response = await octokit.rest.git.getTree({
      owner: githubConfig.owner,
      repo: githubConfig.repo,
      tree_sha: head,
      recursive: "true",
    });

    if (response.data.truncated) {
      throw new Error(
        "GitHub returned a truncated repository tree",
      );
    }

    const index: RepoTreeIndex = {
      head,
      paths: response.data.tree
        .filter(
          (item) =>
            item.type === "blob" &&
            typeof item.path === "string",
        )
        .map((item) => item.path!),
    };

    repoTreeCache = index;

    return index;
  })();

  repoTreeInFlight = {
    head,
    promise,
  };

  try {
    const index = await promise;

    return {
      index,
      cacheHit: false,
      treeMs: Math.round(
        performance.now() - started,
      ),
    };
  } finally {
    if (repoTreeInFlight?.head === head) {
      repoTreeInFlight = null;
    }
  }
}
