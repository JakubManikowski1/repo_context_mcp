import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  const client = new Client({
    name: "repo-context-recall-benchmark",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp"),
  );

  await client.connect(transport);

  for (let i = 1; i <= 3; i++) {
    const started = performance.now();

    const result = await client.callTool({
      name: "repo_code",
      arguments: {
        queries: (
          process.env.BENCHMARK_QUERIES ??
          "README,package.json,server"
        )
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
    });

    const wallMs = Math.round(performance.now() - started);

    const text =
      Array.isArray(result.content) &&
      result.content[0]?.type === "text"
        ? result.content[0].text
        : "{}";

    const data = JSON.parse(text);

    console.log(`RUN ${i}`);
    console.log("wallMs:", wallMs);
    console.log("timing:", data.timing);
    console.log("searchTerms:", data.searchTerms);
    console.log("treeResolution:", data.treeResolution);
    console.log("codeSearch:", data.codeSearch);
    console.log("searchErrors:", data.searchErrors);
    console.log("top3:", data.selectedPaths?.slice(0, 3));
    console.log();
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
