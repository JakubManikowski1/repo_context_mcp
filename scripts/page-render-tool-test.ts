import assert from "node:assert/strict";

import type {
  McpServer,
} from "@modelcontextprotocol/server";

import type {
  RepositoryToolAccess,
} from "../src/repository-access.js";

import type {
  PageRenderTargetAccess,
} from "../src/page-render-target.js";

import {
  registerPageRenderTools,
  runPageRenderTool,
} from "../src/page-render-tool.js";

let resolvedRepositoryId:
  string | undefined;

const repositoryAccess:
  RepositoryToolAccess = {
    async list() {
      return [];
    },

    async resolve(
      repositoryId,
    ) {
      resolvedRepositoryId =
        repositoryId;

      return {
        source:
          "connection",
        provider:
          "github",
        key:
          "connection:conn-a",
        owner:
          "owner",
        repo:
          "repo",
        branch:
          "main",
        octokit:
          {} as never,
      };
    },
  };

const targetAccess:
  PageRenderTargetAccess = {
    async resolve() {
      return null;
    },
  };

const fakeScreenshotData =
  Buffer.from(
    "fake-image",
    "utf8",
  ).toString(
    "base64",
  );

let receivedRepositoryKey:
  string | undefined;

let receivedRoute:
  string | undefined;

const execution =
  await runPageRenderTool(
    repositoryAccess,
    targetAccess,
    {
      repository_id:
        "conn-a",
      route:
        "/admin/customers",
    },
    async (
      receivedTargetAccess,
      repositoryKey,
      route,
    ) => {
      assert.equal(
        receivedTargetAccess,
        targetAccess,
      );

      receivedRepositoryKey =
        repositoryKey;

      receivedRoute =
        route;

      return {
        requestedUrl:
          "http://127.0.0.1:5173/admin/customers",
        finalUrl:
          "http://127.0.0.1:5173/admin/customers",
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
        elements: [
          {
            tag:
              "button",
            text:
              "Add customer",
          },
        ],
        elementsTruncated:
          false,
        screenshot: {
          mimeType:
            "image/jpeg",
          data:
            fakeScreenshotData,
        },
        warnings:
          [],
      };
    },
  );

assert.equal(
  resolvedRepositoryId,
  "conn-a",
);

assert.equal(
  receivedRepositoryKey,
  "connection:conn-a",
);

assert.equal(
  receivedRoute,
  "/admin/customers",
);

assert.deepEqual(
  execution.metadata.repository,
  {
    provider:
      "github",
    owner:
      "owner",
    name:
      "repo",
    branch:
      "main",
  },
);

assert.equal(
  execution.metadata
    .render
    .screenshot
    ?.mimeType,
  "image/jpeg",
);

assert.equal(
  execution.metadata
    .render
    .screenshot
    ?.bytes,
  Buffer.from(
    "fake-image",
    "utf8",
  ).byteLength,
);

assert.equal(
  execution.screenshot
    ?.data,
  fakeScreenshotData,
);

const serializedMetadata =
  JSON.stringify(
    execution.metadata,
  );

assert.equal(
  serializedMetadata.includes(
    "connection:conn-a",
  ),
  false,
);

assert.equal(
  serializedMetadata.includes(
    fakeScreenshotData,
  ),
  false,
);

let registeredName:
  string | undefined;

let registeredHandler:
  (
    input: {
      repository_id?: string;
      route: string;
    },
  ) => Promise<unknown>;

let registeredConfiguration:
  unknown =
    null;

const fakeServer = {
  registerTool(
    name: string,
    configuration: unknown,
    handler:
      (
        input: {
          repository_id?: string;
          route: string;
        },
      ) => Promise<unknown>,
  ) {
    registeredName =
      name;

    registeredConfiguration =
      configuration;

    registeredHandler =
      handler;
  },
} as unknown as McpServer;

registerPageRenderTools(
  fakeServer,
  repositoryAccess,
  targetAccess,
);

assert.equal(
  registeredName,
  "page_render",
);


const registeredInputSchema =
  (
    registeredConfiguration as {
      inputSchema: {
        shape:
          Record<string, unknown>;
      };
    }
  ).inputSchema;

assert.deepEqual(
  Object.keys(
    registeredInputSchema.shape,
  ).sort(),
  [
    "repository_id",
    "route",
  ],
);

assert.equal(
  typeof registeredHandler!,
  "function",
);

console.log(
  "Page render MCP tool: OK",
);
