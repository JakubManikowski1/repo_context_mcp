import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function parseResult(result: any) {
  const text = result?.content?.find(
    (item: any) => item.type === "text",
  )?.text;

  return text ? JSON.parse(text) : null;
}

async function timedCall(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const start = performance.now();

  const result = await client.callTool({
    name,
    arguments: args,
  });

  return {
    ms: Math.round(performance.now() - start),
    data: parseResult(result),
  };
}

async function main() {
  const client = new Client({
    name: "repo-context-benchmark",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp"),
  );

  const connectStart = performance.now();
  await client.connect(transport);

  console.log(
    `MCP connect: ${Math.round(performance.now() - connectStart)} ms`,
  );

  const search = await timedCall(
    client,
    "repo_code",
    {
      queries: (
        process.env.BENCHMARK_QUERIES ??
        "README,package.json,server"
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      maxFiles: 20,
      maxLinesPerFile: 1000,
      maxChars: 100000,
    },
  );

  console.log(`repo_code search: ${search.ms} ms`);
  console.log("search timing:", search.data?.timing);
  console.log("limits:", search.data?.limits);
  console.log("candidateCount:", search.data?.candidateCount);
  console.log("omittedCandidateCount:", search.data?.omittedCandidateCount);
  console.log("otherCandidates:", search.data?.otherCandidates?.length);
  console.log("search paths:");
  for (const path of search.data?.selectedPaths ?? []) {
    console.log(`  - ${path}`);
  }
  console.log(
    `search payload: ${JSON.stringify(search.data ?? {}).length} chars`,
  );

  const fetchPaths = (search.data?.selectedPaths ?? []).slice(0, 4);

  const fetch = await timedCall(
    client,
    "repo_code",
    {
      paths: fetchPaths,
      maxLinesPerFile: 300,
    },
  );

  console.log(`repo_code fetch: ${fetch.ms} ms`);
  console.log("fetch timing:", fetch.data?.timing);
  console.log(
    `fetch payload: ${JSON.stringify(fetch.data ?? {}).length} chars`,
  );

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
