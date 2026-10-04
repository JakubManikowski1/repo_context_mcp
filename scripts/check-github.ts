import {
  getOctokit,
  githubConfig,
} from "../src/github.js";
import { getRepositoryHead } from "../src/repository-snapshot.js";

async function main() {
  const octokit = getOctokit();

  const [head, issues] = await Promise.all([
    getRepositoryHead(),

    octokit.rest.issues.listForRepo({
      owner: githubConfig.owner,
      repo: githubConfig.repo,
      state: "open",
      per_page: 5,
    }),
  ]);

  const realIssues = issues.data.filter(
    (issue) => !issue.pull_request,
  );

  console.log("GitHub App auth: OK");
  console.log(
    `Repository: ${githubConfig.owner}/${githubConfig.repo}`,
  );
  console.log(`Branch: ${githubConfig.branch}`);
  console.log(`HEAD: ${head}`);
  console.log(`Open issues fetched: ${realIssues.length}`);

  for (const issue of realIssues) {
    console.log(`#${issue.number}: ${issue.title}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
