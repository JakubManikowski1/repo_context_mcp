import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";

import { featureConfig } from "./config.js";

import { registerIssueTools } from "./issues.js";
import { registerUiTools } from "./ui.js";
import { registerUiInventoryTools } from "./ui-inventory.js";
import { registerUiFlowTools } from "./ui-flow.js";
import { registerHistoryTools } from "./history.js";
import { registerGuidanceTools } from "./guidance.js";
import { registerCommandTools } from "./commands.js";
import { registerRepoCodeTools } from "./repo-code.js";
import { registerIssueLookupTools } from "./issue-lookup.js";
import { registerDbTools } from "./db.js";
import { registerDbImpactTools } from "./db-impact.js";
import { registerDbMermaidTools } from "./db-mermaid.js";

const handler = createMcpHandler((ctx) => {
  const server = new McpServer(
    {
      name: "repo_context_mcp",
      version: "1.0.0",
    },
    {
      instructions: `
Repo Context MCP is a fast, read-only interface to the configured GitHub repository.

PRIMARY GOAL
- Minimize latency and tool calls.
- A normal repository task should require 1-2 MCP calls.
- Do not gather context "just in case".
- Interpretation, reasoning and planning belong to ChatGPT.

ISSUES
- If the exact GitHub issue number is known, use issue_get.
- If the user gives an internal issue ID, title, description, or otherwise refers to an issue without a certain GitHub issue number, use issue_lookup.
- issue_lookup can use an optional repository issue index when configured, with GitHub Issues always remaining the source of truth.
- Do not call both issue_lookup and issue_get for the same issue after issue_lookup has already returned its full GitHub Issue content.

CODE
- repo_code is the primary general-purpose code-access tool.
- Optional specialized profiles may expose database, UI-analysis, repository-history, or repository-workflow tools. Use them only when they directly match the task.
- After reading an issue, inspect its body and comments for repository references.
- Use repo_code with paths ONLY when full repository-relative paths are known, for example src/services/example.ts.
- A filename alone, module name, symbol, feature name, route name, collection name, or other identifier is NOT a path.
- If the issue names filenames or identifiers without full repository-relative paths, use them as precise repo_code queries so the tool can locate the real files.
- If references are mixed between full paths and partial names, prefer queries for the relevant filenames/identifiers instead of guessing paths.
- Do not invent directory prefixes or send partial filenames in paths.
- Use repo_code with queries whenever relevant full paths are not known.
- Never provide both queries and paths in the same call.
- Prefer one well-targeted repo_code call.
- Make a second repo_code call only when the first result leaves a specific unanswered question.
- Do not search broadly or repeatedly for synonyms once sufficient relevant code has been returned.

WORKFLOW
- If workflow tools are enabled, use repo_guidance only when repository-specific instructions may materially affect the requested work.
- Use repo_commands only when the task depends on project-specific test, build, migration, deployment, or development commands.
- Do not call workflow tools routinely or "just in case".
- Prefer repo_code alone when the requested task can be answered from code context.

PERFORMANCE
- A normal repository task should use 1-2 MCP calls total.
- For a known issue number: issue_get, then usually one repo_code call.
- For an internal issue ID/title/description: issue_lookup, then usually one repo_code call.
- Do not gather repository context "just in case".
- Do not perform broad repository exploration unless the user explicitly requests it.

PLANNING TASKS
- For implementation plans, optimize for a decision-ready plan, not exhaustive repository proof.
- Read the issue once.
- Use repo_code at most 3 productive times per repository HEAD:
  1. primary implementation search,
  2. one targeted follow-up for missing implementation details,
  3. optionally one targeted tests/docs follow-up.
- If repo_code returns mode=repository_changed, discard repository conclusions from the previous HEAD and restart repository analysis from the beginning against the new HEAD. That drift-detection call does not consume the new HEAD budget.
- After 3 productive repo_code calls on the same HEAD, stop repository exploration and state remaining uncertainties instead of searching further.
- Do not re-read the same issue.
- Do not repeatedly inspect the same files or search synonyms after sufficient context has been returned.
- Do not use web research unless the user explicitly asks to verify external facts, law, documentation, or current information.
- Separate the plan into:
  - required by the issue,
  - confirmed by current main,
  - recommended additional hardening.
- Do not expand implementation scope merely because adjacent improvements are possible.

GENERAL
- Never invent repository facts.
- Stay on the configured branch.
- Repository access is read-only.
`.trim(),
    },
  );



  registerIssueTools(server);
  registerRepoCodeTools(
    server,
    ctx.requestInfo?.headers.get(
      "x-request-id",
    ) ?? undefined,
  );
  registerIssueLookupTools(server);
  if (featureConfig.ui) {
    registerUiTools(server);
    registerUiInventoryTools(server);
    registerUiFlowTools(server);
  }

  if (featureConfig.history) {
    registerHistoryTools(server);
  }

  if (featureConfig.workflow) {
    registerGuidanceTools(server);
    registerCommandTools(server);
  }

  if (featureConfig.db) {
    registerDbTools(server);
    registerDbImpactTools(server);
    registerDbMermaidTools(server);
  }


  return server;
});

const app = createMcpExpressApp();
const nodeHandler = toNodeHandler(handler);

app.all("/mcp", (req, res) => {
  void nodeHandler(req, res, req.body);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "repo_context_mcp",
  });
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, "127.0.0.1", () => {
  console.log(`Repo Context MCP running at http://127.0.0.1:${port}/mcp`);
});
