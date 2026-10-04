import { getOctokit } from "../src/github.js";

async function main() {
  const octokit = getOctokit();

  const response = await octokit.rest.rateLimit.get();

  console.log(
    JSON.stringify(
      response.data.resources,
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
