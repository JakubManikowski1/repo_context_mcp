import assert from "node:assert/strict";

import type {
  BackendResolvedRoute,
} from "../src/backend-graph.js";

import {
  matchUiApiCallsToBackend,
} from "../src/process-graph.js";

import {
  extractUiFlowEvents,
} from "../src/ui-graph.js";

function backendRoute(
  method:
    BackendResolvedRoute["method"],
  fullPath: string,
  line: number,
): BackendResolvedRoute {
  return {
    method,
    path:
      fullPath,
    fullPath,
    sourcePath:
      "apps/api/src/routes/testRoutes.js",
    line,
    handler:
      "controller.handler",
    mountChain: [],
  };
}

function main() {
  const clientEvents =
    extractUiFlowEvents(
      [
        'apiServerClient.get("/content/articles?status=published");',
        'apiServerClient.patch(`/admin/users/${id}`, payload);',
        'axios.post("/admin/items", payload);',
        'cache.get("/status");',
        'fetch("/status");',
        'fetch("/ambiguous");',
        'router.get("/must-not-be-a-call", handler);',
        'app.post("/also-not-a-call", handler);',
      ].join(
        "\n",
      ),
    );

  assert.deepEqual(
    clientEvents
      .filter(
        (event) =>
          event.type
            === "api_call",
      )
      .map(
        (event) => [
          event.target,
          event.method,
        ],
      ),
    [
      [
        "/content/articles?status=published",
        "GET",
      ],
      [
        "/admin/users/${id}",
        "PATCH",
      ],
      [
        "/admin/items",
        "POST",
      ],
      [
        "/status",
        undefined,
      ],
      [
        "/ambiguous",
        undefined,
      ],
    ],
  );

  const files = [
    {
      path:
        "apps/web/src/api/exampleApi.js",
      events:
        clientEvents,
    },
  ];

  const routes:
    BackendResolvedRoute[] = [
      backendRoute(
        "GET",
        "/content/articles",
        10,
      ),
      backendRoute(
        "GET",
        "/admin/users/:id",
        20,
      ),
      backendRoute(
        "PATCH",
        "/admin/users/:id",
        21,
      ),
      backendRoute(
        "POST",
        "/admin/items",
        30,
      ),
      backendRoute(
        "GET",
        "/status",
        40,
      ),
      backendRoute(
        "GET",
        "/ambiguous",
        50,
      ),
      backendRoute(
        "POST",
        "/ambiguous",
        51,
      ),
    ];

  const links =
    matchUiApiCallsToBackend(
      files,
      routes,
    );

  assert.deepEqual(
    links.map(
      (link) => [
        link.ui.target,
        link.ui.method,
        link.backend.method,
        link.backend.fullPath,
      ],
    ),
    [
      [
        "/content/articles?status=published",
        "GET",
        "GET",
        "/content/articles",
      ],
      [
        "/admin/users/${id}",
        "PATCH",
        "PATCH",
        "/admin/users/:id",
      ],
      [
        "/admin/items",
        "POST",
        "POST",
        "/admin/items",
      ],
      [
        "/status",
        undefined,
        "GET",
        "/status",
      ],
    ],
  );

  assert.ok(
    !links.some(
      (link) =>
        link.ui.target
          === "/ambiguous",
    ),
  );

  const methodMismatch =
    matchUiApiCallsToBackend(
      [
        {
          path:
            "apps/web/src/api/mismatch.js",
          events: [
            {
              type:
                "api_call",
              line:
                1,
              target:
                "/admin/items",
              method:
                "DELETE",
            },
          ],
        },
      ],
      routes,
    );

  assert.deepEqual(
    methodMismatch,
    [],
  );

  const concreteParameter =
    matchUiApiCallsToBackend(
      [
        {
          path:
            "apps/web/src/api/users.js",
          events: [
            {
              type:
                "api_call",
              line:
                1,
              target:
                "/admin/users/user-123?tab=profile",
              method:
                "PATCH",
            },
          ],
        },
      ],
      routes,
    );

  assert.equal(
    concreteParameter.length,
    1,
  );

  assert.equal(
    concreteParameter[0]
      .backend
      .fullPath,
    "/admin/users/:id",
  );

  const external =
    matchUiApiCallsToBackend(
      [
        {
          path:
            "apps/web/src/api/external.js",
          events: [
            {
              type:
                "api_call",
              line:
                1,
              target:
                "https://example.com/status",
              method:
                "GET",
            },
          ],
        },
      ],
      routes,
    );

  assert.deepEqual(
    external,
    [],
  );

  console.log(
    "Cross-layer process graph: OK",
  );
}

main();
