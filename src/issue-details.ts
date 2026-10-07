import type {
  RepositoryContext,
} from "./repository-context.js";

export async function fetchIssueDetails(
  number: number,
  repository: RepositoryContext,
) {
  const octokit = repository.octokit;

  const [issueResponse, commentsResponse] = await Promise.all([
    octokit.rest.issues.get({
      owner: repository.owner,
      repo: repository.repo,
      issue_number: number,
    }),

    octokit.rest.issues.listComments({
      owner: repository.owner,
      repo: repository.repo,
      issue_number: number,
      per_page: 100,
    }),
  ]);

  if (issueResponse.data.pull_request) {
    throw new Error(`#${number} is a pull request, not an issue`);
  }

  const issue = issueResponse.data;

  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body,
    labels: issue.labels.map((label) =>
      typeof label === "string" ? label : label.name,
    ),
    assignees: issue.assignees?.map((user) => user.login) ?? [],
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    html_url: issue.html_url,
    comments_total: issue.comments,
    comments: commentsResponse.data.map((comment) => ({
      author: comment.user?.login ?? null,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      body: comment.body,
    })),
  };
}
