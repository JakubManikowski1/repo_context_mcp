import assert from "node:assert/strict";

import {
  randomBytes,
} from "node:crypto";

import {
  mkdtempSync,
  rmSync,
} from "node:fs";

import {
  createServer,
} from "node:http";

import type {
  AddressInfo,
} from "node:net";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  spawn,
} from "node:child_process";

import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import {
  Client,
} from "@modelcontextprotocol/sdk/client/index.js";

import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  deriveUserLookup,
  encryptRepositoryConnection,
} from "../src/connections/crypto.js";

import {
  SqliteRepositoryConnectionStore,
} from "../src/connections/sqlite-store.js";

import type {
  PrincipalIdentity,
  RepositoryConnectionPayload,
} from "../src/connections/types.js";

import {
  loadServerRuntimeFromEnv,
} from "../src/server-runtime.js";

async function freePort(): Promise<number> {
  const server =
    createServer();

  await new Promise<void>(
    (resolve) => {
      server.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const address =
    server.address() as AddressInfo;

  const port =
    address.port;

  await new Promise<void>(
    (resolve, reject) => {
      server.close(
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

  return port;
}

function parseTextResult(
  result: Awaited<
    ReturnType<Client["callTool"]>
  >,
): unknown {
  const entry =
    result.content?.find(
      (item) =>
        item.type === "text",
    );

  assert.ok(
    entry &&
      entry.type === "text",
  );

  return JSON.parse(
    entry.text,
  );
}

async function expectDenied(
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
    // Protocol-level denial is also fail-closed.
  }
}

async function makeClient(
  url: URL,
  token: string,
): Promise<Client> {
  const client =
    new Client({
      name:
        "oauth-server-mode-test",
      version:
        "1.0.0",
    });

  const transport =
    new StreamableHTTPClientTransport(
      url,
      {
        requestInit: {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        },
      },
    );

  await client.connect(
    transport,
  );

  return client;
}

async function main(): Promise<void> {
  assert.throws(
    () =>
      loadServerRuntimeFromEnv({
        REPO_CONTEXT_AUTH_MODE:
          "oauth",

        REPO_CONTEXT_FEATURES:
          "db",
      }),
    /legacy-only/,
  );

  const directory =
    mkdtempSync(
      join(
        tmpdir(),
        "repo-context-oauth-server-",
      ),
    );

  const databasePath =
    join(
      directory,
      "connections.sqlite",
    );

  const lookupKey =
    randomBytes(32);

  const encryptionKey =
    randomBytes(32);

  const {
    publicKey,
    privateKey,
  } =
    await generateKeyPair(
      "RS256",
    );

  const publicJwk =
    await exportJWK(
      publicKey,
    );

  const kid =
    "oauth-server-test-key";

  const jwks = {
    keys: [
      {
        ...publicJwk,
        kid,
        alg: "RS256",
        use: "sig",
      },
    ],
  };

  const authServer =
    createServer(
      (req, res) => {
        if (req.url === "/jwks") {
          res.setHeader(
            "content-type",
            "application/json",
          );

          res.end(
            JSON.stringify(jwks),
          );
          return;
        }

        res.statusCode = 404;
        res.end();
      },
    );

  await new Promise<void>(
    (resolve) => {
      authServer.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const authAddress =
    (
      authServer.address() as AddressInfo
    );

  const issuer =
    `http://127.0.0.1:${authAddress.port}/`;

  const principalA:
    PrincipalIdentity = {
      issuer,
      subject:
        "oauth-user-a",
    };

  const principalB:
    PrincipalIdentity = {
      issuer,
      subject:
        "oauth-user-b",
    };

  const payloadA:
    RepositoryConnectionPayload = {
      version: 1,
      provider: "github",
      installationId: "111111",
      repositoryId: "900001",
      owner: "owner-a",
      name: "repo-a",
      branch: "main",
    };

  const payloadB:
    RepositoryConnectionPayload = {
      version: 1,
      provider: "github",
      installationId: "222222",
      repositoryId: "900002",
      owner: "owner-b",
      name: "repo-b",
      branch: "main",
    };

  const mcpPort =
    await freePort();

  const mcpUrl =
    new URL(
      `http://127.0.0.1:${mcpPort}/mcp`,
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
      userLookup:
        userLookupA,

      encryptedPayload:
        encryptRepositoryConnection(
          payloadA,
          encryptionKey,
          "conn_a",
          userLookupA,
        ),

      createdAt:
        "2026-10-07T12:00:00.000Z",
    });

    await store.create({
      id: "conn_b",
      userLookup:
        userLookupB,

      encryptedPayload:
        encryptRepositoryConnection(
          payloadB,
          encryptionKey,
          "conn_b",
          userLookupB,
        ),

      createdAt:
        "2026-10-07T12:01:00.000Z",
    });
  } finally {
    store.close();
  }

  const now =
    Math.floor(
      Date.now() / 1000,
    );

  async function tokenFor(
    subject: string,
  ): Promise<string> {
    return new SignJWT({
      sub: subject,
      client_id:
        "chatgpt-test-client",
      scope: "mcp",
    })
      .setProtectedHeader({
        alg: "RS256",
        kid,
      })
      .setIssuer(issuer)
      .setAudience(
        mcpUrl.href,
      )
      .setIssuedAt(now)
      .setExpirationTime(
        now + 3600,
      )
      .sign(privateKey);
  }

  const tokenA =
    await tokenFor(
      principalA.subject,
    );

  const tokenB =
    await tokenFor(
      principalB.subject,
    );

  const child =
    spawn(
      process.execPath,
      ["dist/server.js"],
      {
        cwd: process.cwd(),

        env: {
          ...process.env,

          PORT:
            String(mcpPort),

          REPO_CONTEXT_AUTH_MODE:
            "oauth",

          REPO_CONTEXT_FEATURES:
            "",

          REPO_CONTEXT_MCP_URL:
            mcpUrl.href,

          REPO_CONTEXT_OAUTH_ISSUER:
            issuer,

          REPO_CONTEXT_OAUTH_AUTHORIZATION_ENDPOINT:
            `${issuer}authorize`,

          REPO_CONTEXT_OAUTH_TOKEN_ENDPOINT:
            `${issuer}token`,

          REPO_CONTEXT_OAUTH_JWKS_URL:
            `${issuer}jwks`,

          REPO_CONTEXT_CONNECTION_DB_PATH:
            databasePath,

          REPO_CONTEXT_USER_LOOKUP_KEY:
            lookupKey.toString(
              "base64",
            ),

          REPO_CONTEXT_CONNECTION_ENCRYPTION_KEY:
            encryptionKey.toString(
              "base64",
            ),

          // Deliberately remove the legacy repository.
          GITHUB_OWNER: "",
          GITHUB_REPO: "",
          GITHUB_INSTALLATION_ID: "",
        },

        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    );

  let stdout = "";
  let stderr = "";

  child.stdout?.on(
    "data",
    (chunk) => {
      stdout += chunk.toString();
    },
  );

  child.stderr?.on(
    "data",
    (chunk) => {
      stderr += chunk.toString();
    },
  );

  let clientA:
    Client | undefined;

  let clientB:
    Client | undefined;

  try {
    let healthy = false;

    for (
      let attempt = 0;
      attempt < 80;
      attempt += 1
    ) {
      if (
        child.exitCode !== null
      ) {
        break;
      }

      try {
        const response =
          await fetch(
            `http://127.0.0.1:${mcpPort}/health`,
          );

        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {}

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            100,
          ),
      );
    }

    if (!healthy) {
      throw new Error(
        "OAuth-mode server did not become healthy\n"
        + `stdout:\n${stdout}\n`
        + `stderr:\n${stderr}`,
      );
    }

    const unauthorized =
      await fetch(mcpUrl);

    assert.equal(
      unauthorized.status,
      401,
    );

    assert.match(
      unauthorized.headers.get(
        "www-authenticate",
      ) ?? "",
      /resource_metadata=/,
    );

    const metadataUrl =
      new URL(
        "/.well-known/oauth-protected-resource/mcp",
        mcpUrl,
      );

    const metadataResponse =
      await fetch(
        metadataUrl,
      );

    assert.equal(
      metadataResponse.status,
      200,
    );

    const metadata =
      (
        await metadataResponse.json()
      ) as {
        resource: string;
        authorization_servers?: string[];
      };

    assert.equal(
      metadata.resource,
      mcpUrl.href,
    );

    assert.ok(
      metadata
        .authorization_servers
        ?.includes(issuer),
    );

    clientA =
      await makeClient(
        mcpUrl,
        tokenA,
      );

    const listA =
      await clientA.callTool({
        name:
          "repositories_list",
        arguments: {},
      });

    const repositoriesA =
      parseTextResult(
        listA,
      ) as Array<{
        repository_id: string;
        owner: string;
      }>;

    assert.deepEqual(
      repositoriesA.map(
        (repository) =>
          repository.repository_id,
      ),
      ["conn_a"],
    );

    assert.equal(
      repositoriesA[0]?.owner,
      "owner-a",
    );

    clientB =
      await makeClient(
        mcpUrl,
        tokenB,
      );

    const listB =
      await clientB.callTool({
        name:
          "repositories_list",
        arguments: {},
      });

    const repositoriesB =
      parseTextResult(
        listB,
      ) as Array<{
        repository_id: string;
      }>;

    assert.deepEqual(
      repositoriesB.map(
        (repository) =>
          repository.repository_id,
      ),
      ["conn_b"],
    );

    await expectDenied(
      clientA,
      "issues_list",
      {
        repository_id:
          "conn_b",
        limit: 1,
      },
    );

    console.log(
      "OAuth production-mode activation: OK",
    );

    console.log(
      "Real /mcp bearer protection: OK",
    );

    console.log(
      "Real RFC 9728 metadata endpoint: OK",
    );

    console.log(
      "JWT principal reaches MCP factory: OK",
    );

    console.log(
      "Principal-bound repositories_list: OK",
    );

    console.log(
      "Cross-user repository_id rejected end-to-end: OK",
    );

    console.log(
      "OAuth mode has no legacy repository fallback: OK",
    );
  } finally {
    try {
      await clientA?.close();
    } catch {}

    try {
      await clientB?.close();
    } catch {}

    child.kill("SIGTERM");

    await Promise.race([
      new Promise<void>(
        (resolve) => {
          child.once(
            "exit",
            () => resolve(),
          );
        },
      ),

      new Promise<void>(
        (resolve) => {
          setTimeout(
            resolve,
            2000,
          );
        },
      ),
    ]);

    await new Promise<void>(
      (resolve, reject) => {
        authServer.close(
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
