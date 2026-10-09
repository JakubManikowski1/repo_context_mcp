import assert from "node:assert/strict";

import {
  buildBackendGraph,
  extractExpressRoutes,
  renderBackendGraphMermaid,
} from "../src/backend-graph.js";

function main() {
  const routePath =
    "apps/api/src/routes/admin/adminUserRoutes.js";

  const content = [
    "import express from 'express';",
    "import * as adminUserController from '../../controllers/adminUserController.js';",
    "import { listPublicArticles as listArticles } from '../../controllers/contentController.js';",
    "import validationMiddleware from '../../middleware/validationMiddleware.js';",
    "",
    "const router = express.Router();",
    "",
    "router.get('/users', adminUserController.listUsers);",
    "router.patch('/users/:id/role', validationMiddleware(roleSchema), adminUserController.updateUserRole);",
    "router.post(",
    "  '/articles',",
    "  validationMiddleware(articleSchema),",
    "  listArticles",
    ");",
    "router.get('/inline', (req, res) => res.json({ ok: true }));",
  ].join(
    "\n",
  );

  const repositoryPaths = [
    routePath,
    "apps/api/src/controllers/adminUserController.js",
    "apps/api/src/controllers/contentController.js",
    "apps/api/src/middleware/validationMiddleware.js",
  ];

  const routes =
    extractExpressRoutes(
      content,
      routePath,
      repositoryPaths,
    );

  assert.equal(
    routes.length,
    4,
  );

  assert.deepEqual(
    routes.map(
      (route) => [
        route.method,
        route.path,
        route.handler,
      ],
    ),
    [
      [
        "GET",
        "/users",
        "adminUserController.listUsers",
      ],
      [
        "PATCH",
        "/users/:id/role",
        "adminUserController.updateUserRole",
      ],
      [
        "POST",
        "/articles",
        "listArticles",
      ],
      [
        "GET",
        "/inline",
        undefined,
      ],
    ],
  );

  assert.equal(
    routes[0]
      .handlerImportedFrom,
    "apps/api/src/controllers/adminUserController.js",
  );

  assert.equal(
    routes[1]
      .handlerImportedFrom,
    "apps/api/src/controllers/adminUserController.js",
  );

  assert.equal(
    routes[2]
      .handlerImportedFrom,
    "apps/api/src/controllers/contentController.js",
  );

  assert.equal(
    routes[3]
      .handlerImportedFrom,
    undefined,
  );

  const graph =
    buildBackendGraph(
      routePath,
      routes,
    );

  assert.equal(
    graph.nodes.filter(
      (node) =>
        node.kind
          === "source_file",
    ).length,
    3,
  );

  assert.equal(
    graph.nodes.filter(
      (node) =>
        node.kind
          === "api_route",
    ).length,
    4,
  );

  assert.equal(
    graph.nodes.filter(
      (node) =>
        node.kind
          === "handler",
    ).length,
    3,
  );

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "declares",
    ).length,
    4,
  );

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "handled_by",
    ).length,
    3,
  );

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "imports_from",
    ).length,
    3,
  );

  const updateHandler =
    graph.nodes.find(
      (node) =>
        node.kind
          === "handler"
        && node.label
          === "adminUserController.updateUserRole",
    );

  assert.ok(
    updateHandler,
  );

  assert.ok(
    updateHandler
      .evidence
      .some(
        (evidence) =>
          evidence.path
            === routePath
          && evidence.line
            === 9,
      ),
  );

  const mermaid =
    renderBackendGraphMermaid(
      graph,
    );

  assert.ok(
    mermaid.startsWith(
      "flowchart LR\n",
    ),
  );

  assert.ok(
    mermaid.includes(
      "api_route: GET /users",
    ),
  );

  assert.ok(
    mermaid.includes(
      "handler: adminUserController.listUsers",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|declares|",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|handled by|",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|imports from|",
    ),
  );

  const tsRoutePath =
    "src/routes/widgets.ts";

  const tsRoutes =
    extractExpressRoutes(
      [
        'import widgetController from "../controllers/widgetController.js";',
        'router.get("/widgets", widgetController.list);',
      ].join(
        "\n",
      ),
      tsRoutePath,
      [
        tsRoutePath,
        "src/controllers/widgetController.ts",
      ],
    );

  assert.equal(
    tsRoutes.length,
    1,
  );

  assert.equal(
    tsRoutes[0]
      .handlerImportedFrom,
    "src/controllers/widgetController.ts",
  );

  const nestedMiddleware =
    extractExpressRoutes(
      [
        "router.post(",
        '  "/complex",',
        "  validate({",
        "    fields: [one(), two()],",
        "  }),",
        "  controller.create",
        ");",
      ].join(
        "\n",
      ),
      "src/routes/complex.js",
      [
        "src/routes/complex.js",
      ],
    );

  assert.equal(
    nestedMiddleware.length,
    1,
  );

  assert.equal(
    nestedMiddleware[0]
      .handler,
    "controller.create",
  );

  console.log(
    "Backend API graph: OK",
  );
}

main();
