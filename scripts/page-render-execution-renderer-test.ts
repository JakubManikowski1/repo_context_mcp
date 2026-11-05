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
  PageRenderExecutionRendererError,
  createPageRenderExecutionToolRenderer,
} from "../src/page-render-execution-renderer.js";

function rendererErrorCode(
  code: string,
) {
  return (
    error: unknown,
  ) =>
    error
      instanceof PageRenderExecutionRendererError
    && error.code
      === code;
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
      "repo-context-render-execution-renderer-",
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

  let activeOrigin:
    string | undefined;

  const renderer =
    createPageRenderExecutionToolRenderer(
      [
        {
          repositoryKey,
          profile,
        },
      ],
      process.execPath,
      async (
        options,
      ) => {
        activeOrigin =
          options.origin;

        assert.equal(
          options.route,
          "/admin/customers",
        );

        assert.equal(
          options.browserExecutablePath,
          process.execPath,
        );

        assert.match(
          options.origin,
          /^http:\/\/127\.0\.0\.1:\d+$/,
        );

        const response =
          await fetch(
            `${options.origin}/`,
          );

        assert.equal(
          response.status,
          200,
        );

        assert.equal(
          await response.text(),
          "ready",
        );

        return {
          requestedUrl:
            `${options.origin}/admin/customers`,
          finalUrl:
            `${options.origin}/admin/customers`,
          status:
            200,
          title:
            "Customers",
          viewport: {
            width:
              1280,
            height:
              720,
          },
          text:
            "Customers",
          textTruncated:
            false,
          elements:
            [],
          elementsTruncated:
            false,
          warnings:
            [],
        };
      },
    );

  const snapshot =
    await renderer.render(
      repositoryKey,
      "/admin/customers",
    );

  assert.equal(
    snapshot.title,
    "Customers",
  );

  assert.ok(
    activeOrigin,
  );

  await assertOriginStopped(
    activeOrigin,
  );


  await assert.rejects(
    () =>
      renderer.render(
        "static:self:123:owner/self:main",
        "/",
      ),
    rendererErrorCode(
      "render_execution_profile_not_found",
    ),
  );


  assert.throws(
    () =>
      createPageRenderExecutionToolRenderer(
        [
          {
            repositoryKey,
            profile,
          },
          {
            repositoryKey,
            profile,
          },
        ],
        process.execPath,
      ),
    rendererErrorCode(
      "render_execution_binding_duplicate",
    ),
  );


  assert.throws(
    () =>
      createPageRenderExecutionToolRenderer(
        [
          {
            repositoryKey:
              "   ",
            profile,
          },
        ],
        process.execPath,
      ),
    rendererErrorCode(
      "render_execution_binding_invalid",
    ),
  );

  console.log(
    "Page render execution renderer: OK",
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
