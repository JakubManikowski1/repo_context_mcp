import { getOctokit, githubConfig } from "../src/github.js";

async function main() {
  const octokit = getOctokit();

  const started = performance.now();

  const branchStarted = performance.now();

  const branch = await octokit.rest.repos.getBranch({
    owner: githubConfig.owner,
    repo: githubConfig.repo,
    branch: githubConfig.branch,
  });

  const branchMs = Math.round(
    performance.now() - branchStarted,
  );

  const head = branch.data.commit.sha;

  const treeStarted = performance.now();

  const tree = await octokit.rest.git.getTree({
    owner: githubConfig.owner,
    repo: githubConfig.repo,
    tree_sha: head,
    recursive: "true",
  });

  const treeMs = Math.round(
    performance.now() - treeStarted,
  );

  const paths = tree.data.tree
    .filter(
      (item) =>
        item.type === "blob" &&
        typeof item.path === "string",
    )
    .map((item) => item.path!);

  const needles = (
    process.env.BENCHMARK_QUERIES ??
    "README,package.json,server"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  console.log("head:", head);
  console.log("branchMs:", branchMs);
  console.log("treeMs:", treeMs);
  console.log(
    "totalMs:",
    Math.round(performance.now() - started),
  );
  console.log("truncated:", tree.data.truncated);
  console.log("blobPaths:", paths.length);

  for (const needle of needles) {
    const lower = needle.toLowerCase();

    const matches = paths.filter((path) =>
      path.toLowerCase().includes(lower),
    );

    console.log(`matches ${needle}:`);
    console.log(matches.slice(0, 20));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
