import assert from "node:assert/strict";

import type {
  AddressInfo,
} from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

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
  RepositoryToolAccess,
} from "../src/repository-access.js";

import type {
  RepositoryContext,
} from "../src/repository-context.js";

import {
  getRepositoryHead,
  getRepoTreeIndex,
} from "../src/repository-snapshot.js";

import {
  registerRepoCodeTools,
} from "../src/repo-code.js";


type RunningClient = Readonly<{
  client: Client;
  close(): Promise<void>;
}>;


function providerError(
  status: number,
): Error & {
  status: number;
} {
  const error =
    new Error(
      `Simulated GitHub provider failure: ${status}`,
    ) as Error & {
      status: number;
    };

  error.status = status;

  return error;
}


async function startClient(
  access: RepositoryToolAccess,
  requestId: string,
): Promise<RunningClient> {
  const handler =
    createMcpHandler(() => {
      const server =
        new McpServer({
          name:
            "provider-revocation-test",
          version:
            "1.0.0",
        });

      registerRepoCodeTools(
        server,
        access,
        requestId,
      );

      return server;
    });

  const app =
    createMcpExpressApp();

  const nodeHandler =
    toNodeHandler(handler);

  app.all(
    "/mcp",
    (req, res) => {
      void nodeHandler(
        req,
        res,
        req.body,
      );
    },
  );

  const httpServer =
    await new Promise<
      ReturnType<typeof app.listen>
    >((resolve) => {
      const server =
        app.listen(
          0,
          "127.0.0.1",
          () => resolve(server),
        );
    });

  const address =
    httpServer.address() as AddressInfo;

  const client =
    new Client({
      name:
        "provider-revocation-client",
      version:
        "1.0.0",
    });

  const transport =
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${address.port}/mcp`,
      ),
    );

  await client.connect(
    transport,
  );

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


async function expectRepoCodeDenied(
  client: Client,
  repositoryId: string,
): Promise<void> {
  try {
    const result =
      await client.callTool({
        name:
          "repo_code",

        arguments: {
          repository_id:
            repositoryId,

          queries: [
            "provider-revocation-query",
          ],

          maxFiles: 2,
          maxLinesPerFile: 30,
          maxChars: 5000,
        },
      });

    assert.equal(
      result.isError,
      true,
      "repo_code unexpectedly succeeded after provider revocation",
    );
  } catch {
    // Protocol-level tool error is also the expected result.
  }
}


async function runCase(
  status: 401 | 403 | 404,
): Promise<void> {
  const repositoryId =
    `provider_revoked_${status}`;

  const head =
    `head-${status}`;

  let providerAvailable =
    true;

  let getBranchCalls =
    0;

  let getTreeCalls =
    0;

  let searchCalls =
    0;

  let getContentCalls =
    0;

  const fakeOctokit = {
    rest: {
      repos: {
        async getBranch() {
          getBranchCalls += 1;

          if (!providerAvailable) {
            throw providerError(
              status,
            );
          }

          return {
            data: {
              commit: {
                sha: head,
              },
            },
          };
        },

        async getContent() {
          getContentCalls += 1;

          return {
            data: {
              type:
                "file",
              size:
                20,
              sha:
                `file-${status}`,
              content:
                Buffer.from(
                  '{"name":"fixture"}',
                  "utf8",
                ).toString(
                  "base64",
                ),
            },
          };
        },
      },

      git: {
        async getTree() {
          getTreeCalls += 1;

          return {
            data: {
              truncated:
                false,

              tree: [
                {
                  type:
                    "blob",
                  path:
                    "package.json",
                },
              ],
            },
          };
        },
      },

      search: {
        async code() {
          searchCalls += 1;

          return {
            data: {
              items: [],
            },
          };
        },
      },
    },
  } as unknown as RepositoryContext["octokit"];

  const repository:
    RepositoryContext = {
      source:
        "connection",

      provider:
        "github",

      key:
        `connection:${repositoryId}`,

      owner:
        "provider-test-owner",

      repo:
        "provider-test-repository",

      branch:
        "main",

      octokit:
        fakeOctokit,
    };


  // ---------------------------------------------
  // Warm the exact RepositoryContext tree cache.
  // ---------------------------------------------

  const warmHead =
    await getRepositoryHead(
      repository,
    );

  assert.equal(
    warmHead,
    head,
  );

  const firstTree =
    await getRepoTreeIndex(
      warmHead,
      repository,
    );

  assert.equal(
    firstTree.cacheHit,
    false,
    `${status}: first tree load must miss cache`,
  );

  const cachedTree =
    await getRepoTreeIndex(
      warmHead,
      repository,
    );

  assert.equal(
    cachedTree.cacheHit,
    true,
    `${status}: tree cache was not warmed`,
  );

  assert.equal(
    getBranchCalls,
    1,
  );

  assert.equal(
    getTreeCalls,
    1,
  );


  // ---------------------------------------------
  // Provider access disappears after cache warm.
  // ---------------------------------------------

  providerAvailable =
    false;

  const access:
    RepositoryToolAccess = {
      async list() {
        return [
          {
            repositoryId,
            provider:
              "github",
            owner:
              repository.owner,
            name:
              repository.repo,
            branch:
              repository.branch,
          },
        ];
      },

      async resolve(
        requestedRepositoryId,
      ) {
        assert.equal(
          requestedRepositoryId,
          repositoryId,
        );

        return repository;
      },
    };

  const running =
    await startClient(
      access,
      `provider-revocation-${status}`,
    );

  try {
    const branchCallsBefore =
      getBranchCalls;

    const treeCallsBefore =
      getTreeCalls;

    const searchCallsBefore =
      searchCalls;

    const contentCallsBefore =
      getContentCalls;

    await expectRepoCodeDenied(
      running.client,
      repositoryId,
    );


    // Critical invariant:
    //
    // repo_code must contact GitHub for HEAD before it
    // can consume the already-warm tree cache.
    assert.equal(
      getBranchCalls,
      branchCallsBefore + 1,
      `${status}: repo_code did not revalidate provider access through getBranch`,
    );

    // The failing HEAD check must stop execution before
    // tree cache/search/file retrieval can be consumed.
    assert.equal(
      getTreeCalls,
      treeCallsBefore,
      `${status}: tree lookup continued after provider denial`,
    );

    assert.equal(
      searchCalls,
      searchCallsBefore,
      `${status}: code search continued after provider denial`,
    );

    assert.equal(
      getContentCalls,
      contentCallsBefore,
      `${status}: file retrieval continued after provider denial`,
    );
  } finally {
    await running.close();
  }
}


async function main(): Promise<void> {
  await runCase(401);
  await runCase(403);
  await runCase(404);

  console.log(
    "Provider revocation after warm cache: OK",
  );

  console.log(
    "401/403/404 fail before cached repository data: OK",
  );

  console.log(
    "repo_code rechecks provider HEAD on every call: OK",
  );
}


main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
