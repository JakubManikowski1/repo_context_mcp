import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import type {
  AddressInfo,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createMcpExpressApp,
} from "@modelcontextprotocol/express";
import {
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

import type {
  RepositoryContext,
} from "../src/repository-context.js";

import {
  createConnectionRepositoryAccess,
} from "../src/repository-access.js";

import {
  deriveUserLookup,
  encryptRepositoryConnection,
} from "../src/connections/crypto.js";

import {
  RepositoryAccessResolver,
} from "../src/connections/resolver.js";

import {
  SqliteRepositoryConnectionStore,
} from "../src/connections/sqlite-store.js";

import type {
  PrincipalIdentity,
  RepositoryConnectionPayload,
} from "../src/connections/types.js";

import {
  registerIssueTools,
} from "../src/issues.js";
import {
  registerIssueLookupTools,
} from "../src/issue-lookup.js";
import {
  registerRepoCodeTools,
} from "../src/repo-code.js";
import {
  registerRepositoryTools,
} from "../src/repositories.js";

const lookupKey = randomBytes(32);
const encryptionKey = randomBytes(32);

const principalA: PrincipalIdentity = {
  issuer: "https://auth.example.test",
  subject: "user_alpha",
};

const principalB: PrincipalIdentity = {
  issuer: "https://auth.example.test",
  subject: "user_beta",
};

const payloadA: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "111111",
  repositoryId: "900001",
  owner: "shared-owner",
  name: "shared-repository",
  branch: "main",
};

const payloadB: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "222222",
  repositoryId: "900002",
  owner: "shared-owner",
  name: "shared-repository",
  branch: "main",
};

type RunningClient = {
  client: Client;
  close(): Promise<void>;
};

async function startClient(
  access:
    ReturnType<
      typeof createConnectionRepositoryAccess
    >,
): Promise<RunningClient> {
  const handler =
    createMcpHandler(() => {
      const server =
        new McpServer({
          name: "tool-isolation-test",
          version: "1.0.0",
        });

      registerRepositoryTools(
        server,
        access,
      );

      registerIssueTools(
        server,
        access,
      );

      registerIssueLookupTools(
        server,
        access,
      );

      registerRepoCodeTools(
        server,
        access,
        "tool-isolation-request",
      );

      return server;
    });

  const app = createMcpExpressApp();
  const nodeHandler =
    toNodeHandler(handler);

  app.all("/mcp", (req, res) => {
    void nodeHandler(
      req,
      res,
      req.body,
    );
  });

  const httpServer =
    await new Promise<
      ReturnType<typeof app.listen>
    >((resolve) => {
      const server = app.listen(
        0,
        "127.0.0.1",
        () => resolve(server),
      );
    });

  const address =
    httpServer.address() as AddressInfo;

  const client =
    new Client({
      name: "tool-isolation-client",
      version: "1.0.0",
    });

  const transport =
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${address.port}/mcp`,
      ),
    );

  await client.connect(transport);

  return {
    client,

    async close() {
      try {
        await client.close();
      } finally {
        await new Promise<void>(
          (resolve, reject) => {
            httpServer.close(
              (error) => {
                if (error) {
                  reject(error);
                } else {
                  resolve();
                }
              },
            );
          },
        );
      }
    },
  };
}

async function expectToolDenied(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const result =
      await client.callTool({
        name,
        arguments: args,
      });

    assert.equal(
      result.isError,
      true,
      `${name} unexpectedly succeeded`,
    );
  } catch {
    // Protocol-level tool error is also an expected denial.
  }
}

function parseTextResult(
  result: unknown,
): unknown {
  const parsed =
    CallToolResultSchema.parse(result);

  const entry =
    parsed.content.find(
      (item) =>
        item.type === "text",
    );

  if (
    !entry ||
    entry.type !== "text"
  ) {
    throw new Error(
      "Expected text tool result",
    );
  }

  return JSON.parse(entry.text);
}

async function main(): Promise<void> {
  const directory = mkdtempSync(
    join(
      tmpdir(),
      "repo-context-tool-isolation-",
    ),
  );

  const databasePath = join(
    directory,
    "connections.sqlite",
  );

  const store =
    new SqliteRepositoryConnectionStore(
      databasePath,
    );

  try {
    const userLookupA =
      deriveUserLookup(
        principalA,
        lookupKey,
      );

    const userLookupB =
      deriveUserLookup(
        principalB,
        lookupKey,
      );

    await store.create({
      id: "conn_a",
      userLookup: userLookupA,
      encryptedPayload:
        encryptRepositoryConnection(
          payloadA,
          encryptionKey,
          "conn_a",
          userLookupA,
        ),
      createdAt:
        "2026-10-07T10:00:00.000Z",
    });

    await store.create({
      id: "conn_b",
      userLookup: userLookupB,
      encryptedPayload:
        encryptRepositoryConnection(
          payloadB,
          encryptionKey,
          "conn_b",
          userLookupB,
        ),
      createdAt:
        "2026-10-07T10:01:00.000Z",
    });

    let githubClientCreations = 0;

    const fakeOctokit =
      {} as RepositoryContext["octokit"];

    const resolver =
      new RepositoryAccessResolver({
        store,
        lookupKey,
        encryptionKey,

        createGitHubClient:
          () => {
            githubClientCreations += 1;
            return fakeOctokit;
          },
      });

    const accessA =
      createConnectionRepositoryAccess(
        resolver,
        principalA,
      );

    const running =
      await startClient(accessA);

    try {
      // -------------------------------------------------
      // repositories_list exposes only A.
      // -------------------------------------------------

      const listResult =
        await running.client.callTool({
          name: "repositories_list",
          arguments: {},
        });

      const repositories =
        parseTextResult(
          listResult,
        ) as Array<{
          repository_id: string;
        }>;

      assert.deepEqual(
        repositories.map(
          (repository) =>
            repository.repository_id,
        ),
        ["conn_a"],
      );

      assert.equal(
        githubClientCreations,
        0,
        "listing must not create a GitHub client",
      );

      // -------------------------------------------------
      // Every core repository tool must reject B's ID
      // before GitHub access.
      // -------------------------------------------------

      await expectToolDenied(
        running.client,
        "issues_list",
        {
          repository_id: "conn_b",
          limit: 1,
        },
      );

      await expectToolDenied(
        running.client,
        "issue_get",
        {
          repository_id: "conn_b",
          number: 1,
        },
      );

      await expectToolDenied(
        running.client,
        "issue_lookup",
        {
          repository_id: "conn_b",
          query: "1",
        },
      );

      await expectToolDenied(
        running.client,
        "repo_code",
        {
          repository_id: "conn_b",
          paths: ["package.json"],
          maxLinesPerFile: 20,
          maxChars: 2000,
        },
      );

      assert.equal(
        githubClientCreations,
        0,
        "cross-user tool calls must fail before GitHub client creation",
      );

      // -------------------------------------------------
      // Revoke A; next MCP call must immediately see it.
      // -------------------------------------------------

      assert.equal(
        await store.revokeByIdForUser(
          userLookupA,
          "conn_a",
          "2026-10-07T11:00:00.000Z",
        ),
        true,
      );

      const afterRevokeResult =
        await running.client.callTool({
          name: "repositories_list",
          arguments: {},
        });

      assert.deepEqual(
        parseTextResult(
          afterRevokeResult,
        ),
        [],
      );

      await expectToolDenied(
        running.client,
        "issues_list",
        {
          repository_id: "conn_a",
          limit: 1,
        },
      );

      await expectToolDenied(
        running.client,
        "repo_code",
        {
          repository_id: "conn_a",
          paths: ["package.json"],
          maxLinesPerFile: 20,
          maxChars: 2000,
        },
      );

      assert.equal(
        githubClientCreations,
        0,
        "revoked connection must fail before GitHub client creation",
      );
    } finally {
      await running.close();
    }

    // Same GitHub repository coordinates can exist in
    // different connections without sharing context keys.
    const userLookupA2 =
      deriveUserLookup(
        principalA,
        lookupKey,
      );

    await store.create({
      id: "conn_a_reconnected",
      userLookup: userLookupA2,
      encryptedPayload:
        encryptRepositoryConnection(
          payloadA,
          encryptionKey,
          "conn_a_reconnected",
          userLookupA2,
        ),
      createdAt:
        "2026-10-07T12:00:00.000Z",
    });

    const contextA =
      await resolver.resolve(
        principalA,
        "conn_a_reconnected",
      );

    const contextB =
      await resolver.resolve(
        principalB,
        "conn_b",
      );

    assert.notEqual(
      contextA.key,
      contextB.key,
      "cache/budget namespace must be connection-scoped",
    );

    assert.equal(
      contextA.key,
      "connection:conn_a_reconnected",
    );

    assert.equal(
      contextB.key,
      "connection:conn_b",
    );

    console.log(
      "MCP tool isolation: OK",
    );
    console.log(
      "repositories_list principal scope: OK",
    );
    console.log(
      "4 core tools reject cross-user repository_id: OK",
    );
    console.log(
      "Cross-user denial occurs before GitHub access: OK",
    );
    console.log(
      "Revocation effective on next tool call: OK",
    );
    console.log(
      "Connection-scoped cache/budget namespace: OK",
    );
  } finally {
    store.close();

    rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
