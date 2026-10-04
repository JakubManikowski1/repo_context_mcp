import { getOctokit, githubConfig } from "../src/github.js";

async function main() {
  const octokit = getOctokit();

  for (let i = 1; i <= 3; i++) {
    const started = performance.now();

    try {
      const tree = await octokit.rest.git.getTree({
        owner: githubConfig.owner,
        repo: githubConfig.repo,
        tree_sha: githubConfig.branch,
        recursive: "true",
      });

      console.log(`RUN ${i}`);
      console.log(
        "totalMs:",
        Math.round(performance.now() - started),
      );
      console.log("treeSha:", tree.data.sha);
      console.log("truncated:", tree.data.truncated);
      console.log(
        "blobPaths:",
        tree.data.tree.filter(
          (item) => item.type === "blob",
        ).length,
      );
    } catch (error) {
      console.log(`RUN ${i}`);
      console.error(error);
    }

    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
