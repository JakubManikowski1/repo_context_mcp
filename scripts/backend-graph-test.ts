import assert from "node:assert/strict";

import {
  buildBackendGraph,
  extractExpressRouterMounts,
  extractExpressRoutes,
  renderBackendGraphMermaid,
  resolveExpressRouteTree,
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

  const mountRepositoryPaths = [
    "apps/api/src/app.js",
    "apps/api/src/routes/index.js",
    "apps/api/src/routes/adminRoutes.js",
    "apps/api/src/routes/admin/settingsRoutes.js",
    "apps/api/src/routes/admin/complianceRoutes.js",
    "apps/api/src/routes/contentRoutes.js",
    "apps/api/src/routes/webhookRoutes.js",
    "apps/api/src/middleware/authMiddleware.js",
    "apps/api/src/controllers/adminController.js",
    "apps/api/src/controllers/settingsController.js",
    "apps/api/src/controllers/complianceController.js",
    "apps/api/src/controllers/contentController.js",
    "apps/api/src/controllers/webhookController.js",
  ];

  const appContent = [
    "import express from 'express';",
    "import routes from './routes/index.js';",
    "import webhookRoutes from './routes/webhookRoutes.js';",
    "import errorHandler from './middleware/errorHandler.js';",
    "const app = express();",
    "app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);",
    "app.use('/', routes());",
    "app.use(errorHandler);",
  ].join(
    "\n",
  );

  const appMounts =
    extractExpressRouterMounts(
      appContent,
      "apps/api/src/app.js",
      mountRepositoryPaths,
    );

  assert.deepEqual(
    appMounts.map(
      (mount) => [
        mount.path,
        mount.router,
        mount.routerImportedFrom,
      ],
    ),
    [
      [
        "/webhooks",
        "webhookRoutes",
        "apps/api/src/routes/webhookRoutes.js",
      ],
      [
        "/",
        "routes",
        "apps/api/src/routes/index.js",
      ],
    ],
  );

  const mountFiles = [
    {
      path:
        "apps/api/src/app.js",
      content:
        appContent,
    },
    {
      path:
        "apps/api/src/routes/index.js",
      content: [
        "import { Router } from 'express';",
        "import adminRoutes from './adminRoutes.js';",
        "import contentRoutes from './contentRoutes.js';",
        "const router = Router();",
        "router.use('/admin', adminRoutes);",
        "router.use('/content', contentRoutes);",
        "export default () => router;",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/routes/adminRoutes.js",
      content: [
        "import express from 'express';",
        "import authMiddleware from '../middleware/authMiddleware.js';",
        "import settingsRoutes from './admin/settingsRoutes.js';",
        "import complianceRoutes from './admin/complianceRoutes.js';",
        "import * as adminController from '../controllers/adminController.js';",
        "const router = express.Router();",
        "router.use(authMiddleware);",
        "router.use('/settings', settingsRoutes);",
        "router.use(complianceRoutes);",
        "router.get('/health', adminController.health);",
        "export default router;",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/routes/admin/settingsRoutes.js",
      content: [
        "import express from 'express';",
        "import * as settingsController from '../../controllers/settingsController.js';",
        "const router = express.Router();",
        "router.patch('/profile', settingsController.updateProfile);",
        "export default router;",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/routes/admin/complianceRoutes.js",
      content: [
        "import express from 'express';",
        "import * as complianceController from '../../controllers/complianceController.js';",
        "const router = express.Router();",
        "router.get('/customers/:id/compliance', complianceController.getCompliance);",
        "export default router;",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/routes/contentRoutes.js",
      content: [
        "import express from 'express';",
        "import { listPublicArticles } from '../controllers/contentController.js';",
        "const router = express.Router();",
        "router.get('/articles', listPublicArticles);",
        "export default router;",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/routes/webhookRoutes.js",
      content: [
        "import express from 'express';",
        "import * as webhookController from '../controllers/webhookController.js';",
        "const router = express.Router();",
        "router.post('/stripe', webhookController.stripe);",
        "export default router;",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "apps/api/src/middleware/authMiddleware.js",
      content:
        "export default function authMiddleware(req, res, next) { next(); }",
    },
  ];

  const resolved =
    resolveExpressRouteTree(
      mountFiles,
      mountRepositoryPaths,
      [
        "apps/api/src/app.js",
      ],
    );

  assert.deepEqual(
    resolved.map(
      (route) => [
        route.method,
        route.fullPath,
      ],
    ),
    [
      [
        "POST",
        "/webhooks/stripe",
      ],
      [
        "GET",
        "/admin/health",
      ],
      [
        "PATCH",
        "/admin/settings/profile",
      ],
      [
        "GET",
        "/admin/customers/:id/compliance",
      ],
      [
        "GET",
        "/content/articles",
      ],
    ],
  );

  const profile =
    resolved.find(
      (route) =>
        route.fullPath
          === "/admin/settings/profile",
    );

  assert.ok(
    profile,
  );

  assert.equal(
    profile.sourcePath,
    "apps/api/src/routes/admin/settingsRoutes.js",
  );

  assert.deepEqual(
    profile.mountChain.map(
      (step) => [
        step.path,
        step.targetPath,
      ],
    ),
    [
      [
        "/",
        "apps/api/src/routes/index.js",
      ],
      [
        "/admin",
        "apps/api/src/routes/adminRoutes.js",
      ],
      [
        "/settings",
        "apps/api/src/routes/admin/settingsRoutes.js",
      ],
    ],
  );

  const compliance =
    resolved.find(
      (route) =>
        route.fullPath
          === "/admin/customers/:id/compliance",
    );

  assert.ok(
    compliance,
  );

  assert.equal(
    compliance.mountChain.at(
      -1,
    )?.path,
    "/",
  );

  assert.ok(
    !resolved.some(
      (route) =>
        route.sourcePath
          === "apps/api/src/middleware/authMiddleware.js",
    ),
  );

  const duplicateMountFiles = [
    {
      path:
        "src/app.js",
      content: [
        "import router from './router.js';",
        "app.use('/v1', router);",
        "app.use('/v2', router);",
      ].join(
        "\n",
      ),
    },
    {
      path:
        "src/router.js",
      content:
        "router.get('/health', controller.health);",
    },
  ];

  const duplicateMounted =
    resolveExpressRouteTree(
      duplicateMountFiles,
      [
        "src/app.js",
        "src/router.js",
      ],
      [
        "src/app.js",
      ],
    );

  assert.deepEqual(
    duplicateMounted.map(
      (route) =>
        route.fullPath,
    ),
    [
      "/v1/health",
      "/v2/health",
    ],
  );

  console.log(
    "Backend API graph: OK",
  );
}

main();
