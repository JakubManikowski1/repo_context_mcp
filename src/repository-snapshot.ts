import {
  getLegacyRepositoryContext,
  type RepositoryContext,
} from "./repository-context.js";

export type RepoTreeIndex = {
  head: string;
  paths: string[];
};

let repoTreeCache: {
  repositoryKey: string;
  index: RepoTreeIndex;
} | null = null;

let repoTreeInFlight: {
  repositoryKey: string;
  head: string;
  promise: Promise<RepoTreeIndex>;
} | null = null;

export async function getRepositoryHead(
  repository: RepositoryContext = getLegacyRepositoryContext(),
): Promise<string> {
  const response = await repository.octokit.rest.repos.getBranch({
    owner: repository.owner,
    repo: repository.repo,
    branch: repository.branch,
  });

  return response.data.commit.sha;
}

export async function getRepoTreeIndex(
  head: string,
  repository: RepositoryContext = getLegacyRepositoryContext(),
): Promise<{
  index: RepoTreeIndex;
  cacheHit: boolean;
  treeMs: number;
}> {
  if (
    repoTreeCache &&
    repoTreeCache.repositoryKey === repository.key &&
    repoTreeCache.index.head === head
  ) {
    return {
      index: repoTreeCache.index,
      cacheHit: true,
      treeMs: 0,
    };
  }

  if (
    repoTreeInFlight &&
    repoTreeInFlight.repositoryKey === repository.key &&
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

  const started = performance.now();

  const promise = (async () => {
    const response =
      await repository.octokit.rest.git.getTree({
        owner: repository.owner,
        repo: repository.repo,
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

    repoTreeCache = {
      repositoryKey: repository.key,
      index,
    };

    return index;
  })();

  repoTreeInFlight = {
    repositoryKey: repository.key,
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
    if (
      repoTreeInFlight?.repositoryKey === repository.key &&
      repoTreeInFlight.head === head
    ) {
      repoTreeInFlight = null;
    }
  }
}
