import assert from "node:assert/strict";

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import * as path from "node:path";

import type {
  PageRenderExecutionProfile,
} from "../src/page-render-execution-profile.js";

import {
  PageRenderExecutionSessionError,
  startPageRenderExecutionSession,
  withPageRenderExecutionSession,
} from "../src/page-render-execution-session.js";

function sessionErrorCode(
  code: string,
) {
  return (
    error: unknown,
  ) =>
    error
      instanceof PageRenderExecutionSessionError
    && error.code === code;
}

async function assertOriginStopped(
  origin: string,
) {
  await assert.rejects(
    () =>
      fetch(
        `${origin}/`,
        {
          signal:
            AbortSignal.timeout(
              500,
            ),
        },
      ),
  );
}

const temporaryRoot =
  mkdtempSync(
    path.join(
      tmpdir(),
      "repo-context-render-session-",
    ),
  );

try {
  const workspace =
    path.join(
      temporaryRoot,
      "workspace",
    );

  const cwd =
    path.join(
      workspace,
      "apps",
      "web",
    );

  mkdirSync(
    cwd,
    {
      recursive:
        true,
    },
  );

  const serverSource =
    [
      'import http from "node:http";',
      "",
      "const host = process.argv[2];",
      "const port = Number(process.argv[3]);",
      "",
      "const server = http.createServer(",
      "  (_request, response) => {",
      "    response.statusCode = 200;",
      '    response.setHeader("content-type", "text/plain");',
      '    response.end("ready");',
      "  },",
      ");",
      "",
      "server.listen(port, host);",
      "",
      "function stop() {",
      "  server.close(() => process.exit(0));",
      "}",
      "",
      'process.on("SIGTERM", stop);',
      'process.on("SIGINT", stop);',
      "",
    ].join(
      "\n",
    );

  writeFileSync(
    path.join(
      cwd,
      "server.mjs",
    ),
    serverSource,
    "utf8",
  );

  const profile:
    PageRenderExecutionProfile = {
      repositoryId:
        "lf",

      strategy:
        "local-workspace",

      workspace,

      cwd:
        "apps/web",

      command:
        process.execPath,

      args: [
        "server.mjs",
        "{host}",
        "{port}",
      ],
    };

  const repositoryKey =
    "static:lf:123:owner/lf:main";

  const session =
    await startPageRenderExecutionSession({
      profile,
      repositoryKey,
      browserExecutablePath:
        process.execPath,
      startupTimeoutMs:
        3_000,
      pollIntervalMs:
        25,
    });

  assert.equal(
    session.target.repositoryKey,
    repositoryKey,
  );

  assert.match(
    session.target.origin,
    /^http:\/\/127\.0\.0\.1:\d+$/,
  );

  const response =
    await fetch(
      `${session.target.origin}/`,
    );

  assert.equal(
    response.status,
    200,
  );

  assert.equal(
    await response.text(),
    "ready",
  );

  const stoppedOrigin =
    session.target.origin;

  await session.stop();

  // Idempotent cleanup.
  await session.stop();

  await assertOriginStopped(
    stoppedOrigin,
  );


  let failedRenderOrigin:
    string | undefined;

  await assert.rejects(
    () =>
      withPageRenderExecutionSession(
        {
          profile,
          repositoryKey,
          browserExecutablePath:
            process.execPath,
          startupTimeoutMs:
            3_000,
          pollIntervalMs:
            25,
        },
        async (
          target,
        ) => {
          failedRenderOrigin =
            target.origin;

          const active =
            await fetch(
              `${target.origin}/`,
            );

          assert.equal(
            await active.text(),
            "ready",
          );

          throw new Error(
            "synthetic render failure",
          );
        },
      ),
    /synthetic render failure/,
  );

  assert.ok(
    failedRenderOrigin,
  );

  await assertOriginStopped(
    failedRenderOrigin,
  );


  await assert.rejects(
    () =>
      startPageRenderExecutionSession({
        profile: {
          ...profile,
          workspace:
            path.join(
              temporaryRoot,
              "missing",
            ),
        },
        repositoryKey,
        browserExecutablePath:
          process.execPath,
      }),
    sessionErrorCode(
      "render_execution_workspace_unavailable",
    ),
  );


  await assert.rejects(
    () =>
      startPageRenderExecutionSession({
        profile: {
          ...profile,
          command:
            path.join(
              temporaryRoot,
              "missing-command",
            ),
        },
        repositoryKey,
        browserExecutablePath:
          process.execPath,
        startupTimeoutMs:
          1_000,
        pollIntervalMs:
          25,
      }),
    sessionErrorCode(
      "render_execution_launch_failed",
    ),
  );


  await assert.rejects(
    () =>
      startPageRenderExecutionSession({
        profile: {
          ...profile,
          args: [
            "-e",
            "setTimeout(() => {}, 5000)",
            "{host}",
            "{port}",
          ],
        },
        repositoryKey,
        browserExecutablePath:
          process.execPath,
        startupTimeoutMs:
          250,
        pollIntervalMs:
          25,
      }),
    sessionErrorCode(
      "render_execution_startup_timeout",
    ),
  );


  await assert.rejects(
    () =>
      startPageRenderExecutionSession({
        profile,
        repositoryKey:
          "   ",
        browserExecutablePath:
          process.execPath,
      }),
    sessionErrorCode(
      "render_execution_repository_key_invalid",
    ),
  );

  console.log(
    "Page render execution sessions: OK",
  );
} finally {
  rmSync(
    temporaryRoot,
    {
      recursive:
        true,
      force:
        true,
    },
  );
}
