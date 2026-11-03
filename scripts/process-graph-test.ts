import assert from "node:assert/strict";

import type {
  BackendResolvedRoute,
} from "../src/backend-graph.js";

import {
  buildProcessGraph,
  linkBackendRoutesToDirectDbCollections,
  matchUiApiCallsToBackend,
  renderProcessGraphMermaid,
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

  const dbRouteFiles = [
    {
      path:
        "apps/api/src/controllers/contentController.js",
      content: [
        "import * as contentService from '../services/contentService.js';",
        "import { loadCompany as companyLookup } from '../services/companyService.js';",
        "",
        "const listPublicArticles = async (req, res) => {",
        "  const result = await contentService.listPublicContent({ type: 'article' });",
        "  res.json(result);",
        "};",
        "",
        "const getCompany = async (req, res) => {",
        "  const result = await companyLookup(req.params.id);",
        "  res.json(result);",
        "};",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/services/contentService.js",
      content: [
        "const helper = async () => {",
        "  return pb.collection('content_categories').getFullList();",
        "};",
        "",
        "const listPublicContent = async () => {",
        "  const rows = await pb.collection('content_items').getFullList();",
        "  await helper();",
        "  return rows;",
        "};",
        "",
        "const unrelated = async () => {",
        "  return pb.collection('should_not_link').getFullList();",
        "};",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/services/companyService.js",
      content: [
        "export const loadCompany = async (id) => {",
        "  return pb.collection('companies').getOne(id);",
        "};",
      ].join(
        "\n",
      ),
    },
  ];

  const dbRoutes:
    BackendResolvedRoute[] = [
      {
        method:
          "GET",
        path:
          "/articles",
        fullPath:
          "/content/articles",
        sourcePath:
          "apps/api/src/routes/contentRoutes.js",
        line:
          12,
        handler:
          "contentController.listPublicArticles",
        handlerImportedFrom:
          "apps/api/src/controllers/contentController.js",
        handlerImportLine:
          2,
        mountChain: [],
      },
      {
        method:
          "GET",
        path:
          "/companies/:id",
        fullPath:
          "/admin/companies/:id",
        sourcePath:
          "apps/api/src/routes/companyRoutes.js",
        line:
          20,
        handler:
          "getCompany",
        handlerImportedFrom:
          "apps/api/src/controllers/contentController.js",
        handlerImportLine:
          3,
        mountChain: [],
      },
    ];

  const dbLinks =
    linkBackendRoutesToDirectDbCollections(
      dbRoutes,
      dbRouteFiles,
    );

  assert.deepEqual(
    dbLinks.map(
      (link) => [
        link.route.fullPath,
        link.handler,
        link.serviceFunction,
        link.collection,
      ],
    ),
    [
      [
        "/content/articles",
        "contentController.listPublicArticles",
        "listPublicContent",
        "content_items",
      ],
      [
        "/admin/companies/:id",
        "getCompany",
        "loadCompany",
        "companies",
      ],
    ],
  );

  assert.ok(
    !dbLinks.some(
      (link) =>
        link.collection
          === "content_categories",
    ),
  );

  assert.ok(
    !dbLinks.some(
      (link) =>
        link.collection
          === "should_not_link",
    ),
  );

  assert.deepEqual(
    dbLinks[0]
      .evidence,
    [
      {
        path:
          "apps/api/src/routes/contentRoutes.js",
        line:
          12,
      },
      {
        path:
          "apps/api/src/controllers/contentController.js",
        line:
          5,
      },
      {
        path:
          "apps/api/src/services/contentService.js",
        line:
          6,
      },
    ],
  );

  const barrelDbFiles = [
    {
      path:
        "apps/api/src/controllers/pricingController.js",
      content: [
        "import * as pocketbaseService from '../services/pocketbaseService.js';",
        "",
        "const getParams = async (req, res) => {",
        "  const result = await pocketbaseService.getPricingParams();",
        "  res.json(result);",
        "};",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/services/pocketbaseService.js",
      content: [
        "export {",
        "  getPricingParams,",
        "  unrelatedPricingFunction,",
        "} from './pricingService.js';",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/services/pricingService.js",
      content: [
        "export const getPricingParams = async () => {",
        "  return pb.collection('pricing_params').getFullList();",
        "};",
        "",
        "export const unrelatedPricingFunction = async () => {",
        "  return pb.collection('should_not_link_from_barrel').getFullList();",
        "};",
      ].join(
        "\n",
      ),
    },
  ];

  const barrelDbRoutes:
    BackendResolvedRoute[] = [
      {
        method:
          "GET",
        path:
          "/pricing-params",
        fullPath:
          "/pricing-params",
        sourcePath:
          "apps/api/src/routes/pricingRoutes.js",
        line:
          18,
        handler:
          "pricingController.getParams",
        handlerImportedFrom:
          "apps/api/src/controllers/pricingController.js",
        handlerImportLine:
          2,
        mountChain: [],
      },
    ];

  const barrelDbLinks =
    linkBackendRoutesToDirectDbCollections(
      barrelDbRoutes,
      barrelDbFiles,
    );

  assert.deepEqual(
    barrelDbLinks.map(
      (link) => [
        link.route.fullPath,
        link.handler,
        link.servicePath,
        link.serviceFunction,
        link.collection,
      ],
    ),
    [
      [
        "/pricing-params",
        "pricingController.getParams",
        "apps/api/src/services/pricingService.js",
        "getPricingParams",
        "pricing_params",
      ],
    ],
  );

  assert.ok(
    !barrelDbLinks.some(
      (link) =>
        link.collection
          === "should_not_link_from_barrel",
    ),
  );

  assert.deepEqual(
    barrelDbLinks[0]
      .evidence,
    [
      {
        path:
          "apps/api/src/routes/pricingRoutes.js",
        line:
          18,
      },
      {
        path:
          "apps/api/src/controllers/pricingController.js",
        line:
          4,
      },
      {
        path:
          "apps/api/src/services/pocketbaseService.js",
        line:
          1,
      },
      {
        path:
          "apps/api/src/services/pricingService.js",
        line:
          2,
      },
    ],
  );

  const unifiedRoute:
    BackendResolvedRoute = {
      method:
        "GET",
      path:
        "/articles",
      fullPath:
        "/content/articles",
      sourcePath:
        "apps/api/src/routes/contentRoutes.js",
      line:
        12,
      handler:
        "contentController.listPublicArticles",
      handlerImportedFrom:
        "apps/api/src/controllers/contentController.js",
      handlerImportLine:
        2,
      mountChain: [],
    };

  const unifiedUiLinks = [
    {
      ui: {
        sourcePath:
          "apps/web/src/api/contentApi.js",
        line:
          7,
        target:
          "/content/articles",
        method:
          "GET" as const,
      },
      backend:
        unifiedRoute,
    },
  ];

  const unifiedDbLinks = [
    {
      route:
        unifiedRoute,
      handler:
        "contentController.listPublicArticles",
      controllerPath:
        "apps/api/src/controllers/contentController.js",
      servicePath:
        "apps/api/src/services/contentService.js",
      serviceFunction:
        "listPublicContent",
      collection:
        "content_items",
      evidence: [
        {
          path:
            "apps/api/src/routes/contentRoutes.js",
          line:
            12,
        },
        {
          path:
            "apps/api/src/controllers/contentController.js",
          line:
            5,
        },
        {
          path:
            "apps/api/src/services/pocketbaseService.js",
          line:
            80,
        },
        {
          path:
            "apps/api/src/services/contentService.js",
          line:
            220,
        },
      ],
    },
  ];

  const unifiedGraph =
    buildProcessGraph(
      unifiedUiLinks,
      unifiedDbLinks,
    );

  assert.deepEqual(
    unifiedGraph.nodes.map(
      (node) =>
        node.kind,
    ),
    [
      "ui_source",
      "api_route",
      "handler",
      "service_function",
      "db_collection",
    ],
  );

  assert.deepEqual(
    unifiedGraph.edges.map(
      (edge) =>
        edge.kind,
    ),
    [
      "handled_by",
      "calls_api",
      "calls_service",
      "accesses_collection",
    ],
  );

  const handlerServiceEdge =
    unifiedGraph.edges.find(
      (edge) =>
        edge.kind
          === "calls_service",
    );

  assert.deepEqual(
    handlerServiceEdge
      ?.evidence,
    [
      {
        path:
          "apps/api/src/controllers/contentController.js",
        line:
          5,
      },
      {
        path:
          "apps/api/src/services/pocketbaseService.js",
        line:
          80,
      },
    ],
  );

  const collectionEdge =
    unifiedGraph.edges.find(
      (edge) =>
        edge.kind
          === "accesses_collection",
    );

  assert.deepEqual(
    collectionEdge
      ?.evidence,
    [
      {
        path:
          "apps/api/src/services/contentService.js",
        line:
          220,
      },
    ],
  );

  const unifiedMermaid =
    renderProcessGraphMermaid(
      unifiedGraph,
    );

  assert.match(
    unifiedMermaid,
    /flowchart LR/,
  );

  assert.match(
    unifiedMermaid,
    /UI: apps\/web\/src\/api\/contentApi\.js:7/,
  );

  assert.match(
    unifiedMermaid,
    /API: GET \/content\/articles/,
  );

  assert.match(
    unifiedMermaid,
    /Handler: contentController\.listPublicArticles/,
  );

  assert.match(
    unifiedMermaid,
    /Service: listPublicContent/,
  );

  assert.match(
    unifiedMermaid,
    /DB: content_items/,
  );

  assert.match(
    unifiedMermaid,
    /calls API/,
  );

  assert.match(
    unifiedMermaid,
    /accesses/,
  );

  console.log(
    "Cross-layer process graph: OK",
  );
}

main();
