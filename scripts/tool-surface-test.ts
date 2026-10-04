import { spawn } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const CORE_TOOLS = [
  "issue_get",
  "issue_lookup",
  "issues_list",
  "repo_code",
];

const FULL_TOOLS = [
  ...CORE_TOOLS,
  "db_context",
  "db_impact",
  "db_mermaid",
  "repo_commands",
  "repo_diff",
  "repo_file_history",
  "repo_guidance",
  "ui_context",
  "ui_flow",
  "ui_inventory",
].sort();

async function waitForHealth(port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`;

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // Server may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Server did not become healthy on port ${port}`);
}

async function listTools(
  port: number,
  features?: string,
): Promise<string[]> {
  const child = spawn(
    process.execPath,
    ["dist/server.js"],
    {
      env: {
        ...process.env,
        PORT: String(port),
        REPO_CONTEXT_FEATURES: features ?? "",
      },
      stdio: "ignore",
    },
  );

  try {
    await waitForHealth(port);

    const client = new Client({
      name: "tool-surface-test",
      version: "1.0.0",
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );

    await client.connect(transport);

    try {
      const result = await client.listTools();

      return result.tools
        .map((tool) => tool.name)
        .sort();
    } finally {
      await client.close();
    }
  } finally {
    child.kill("SIGTERM");
  }
}

function assertEqual(
  actual: string[],
  expected: string[],
  label: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} tool surface mismatch\n` +
      `expected: ${expected.join(", ")}\n` +
      `actual:   ${actual.join(", ")}`,
    );
  }
}

async function main() {
  const core = await listTools(3110);

  assertEqual(
    core,
    [...CORE_TOOLS].sort(),
    "core",
  );

  const full = await listTools(
    3111,
    "db,ui,history,workflow",
  );

  assertEqual(
    full,
    FULL_TOOLS,
    "full",
  );

  console.log("Tool surface: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
