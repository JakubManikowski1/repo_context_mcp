import assert from "node:assert/strict";

import {
  buildUiGraph,
  extractUiComponentUsages,
  extractUiFlowEvents,
  extractUiInventoryItems,
  renderUiGraphMermaid,
  resolveUiComponentUsages,
} from "../src/ui-graph.js";

import type {
  UiFlowFile,
} from "../src/ui-graph.js";

function main() {
  const content = [
    '<a href="/clients">Clients</a>',
    'router.push("/invoices/new");',
    'fetch("/api/invoices");',
    '<form onSubmit={handleSubmit(save)}>',
    '<button onClick={pushAll}>Push all</button>',
    '<Drawer open={open}>',
    '<Button disabled={!canProceed}>Next</Button>',
    'if (isLoading) return <Spinner />;',
    'toast.error("Could not save");',
    'if (items.length === 0) return <Empty />;',
  ].join(
    "\n",
  );

  const events =
    extractUiFlowEvents(
      content,
    );

  const inventory =
    extractUiInventoryItems(
      [
        "<h1>Invoices</h1>",
        "<Button>Push all</Button>",
        "<label>Customer</label>",
        '<input placeholder="Search invoices" aria-label="Invoice search" />',
        '<Link href="/clients">Clients</Link>',
        "if (isLoading) return <Spinner />;",
        'toast.error("Failed");',
        "if (items.length === 0) return <Empty />;",
      ].join(
        "\n",
      ),
    );

  assert.ok(
    inventory.some(
      (item) =>
        item.type
          === "heading"
        && item.text
          === "Invoices",
    ),
  );

  assert.ok(
    inventory.some(
      (item) =>
        item.type
          === "button"
        && item.text
          === "Push all",
    ),
  );

  assert.ok(
    inventory.some(
      (item) =>
        item.type
          === "form_control",
    ),
  );

  assert.ok(
    inventory.some(
      (item) =>
        item.type
          === "placeholder"
        && item.text
          === "Search invoices",
    ),
  );

  assert.ok(
    inventory.some(
      (item) =>
        item.type
          === "aria-label"
        && item.text
          === "Invoice search",
    ),
  );

  const apiMethodEvents =
    extractUiFlowEvents(
      [
        'axios.get("/api/clients");',
        'axios.post("/api/invoices", payload);',
        'axios.patch("/api/invoices/123", payload);',
        'fetch("/api/unknown");',
        'fetch("/api/manual", { method: "PUT" });',
        "fetch('/api/delete', { method: 'delete' });",
      ].join(
        "\n",
      ),
    )
      .filter(
        (event) =>
          event.type
            === "api_call",
      );

  assert.deepEqual(
    apiMethodEvents.map(
      (event) => [
        event.target,
        event.method,
      ],
    ),
    [
      [
        "/api/clients",
        "GET",
      ],
      [
        "/api/invoices",
        "POST",
      ],
      [
        "/api/invoices/123",
        "PATCH",
      ],
      [
        "/api/unknown",
        undefined,
      ],
      [
        "/api/manual",
        "PUT",
      ],
      [
        "/api/delete",
        "DELETE",
      ],
    ],
  );

  const components =
    extractUiComponentUsages(
      content,
    );

  assert.deepEqual(
    components.map(
      (component) =>
        component.name,
    ),
    [
      "Drawer",
      "Button",
      "Spinner",
      "Empty",
    ],
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "navigation"
        && event.target
          === "/clients",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "navigation"
        && event.target
          === "/invoices/new",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "api_call"
        && event.target
          === "/api/invoices",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "form_submit",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "click_action"
        && event.text
          === "Push all",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "overlay",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "guard",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "loading_state",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "error_state",
    ),
  );

  assert.ok(
    events.some(
      (event) =>
        event.type
          === "empty_state",
    ),
  );

  const resolvedComponents =
    resolveUiComponentUsages(
      "src/pages/InvoicesPage.tsx",
      [
        'import InvoiceTable from "../components/InvoiceTable";',
        'import { PushAllButton as PushButton } from "../components/actions";',
        'import * as UI from "../components/ui";',
        'import { ExternalButton } from "@app/ui";',
        "<InvoiceTable />",
        "<PushButton />",
        "<UI.Drawer />",
        "<ExternalButton />",
      ].join(
        "\n",
      ),
      [
        "src/pages/InvoicesPage.tsx",
        "src/components/InvoiceTable.tsx",
        "src/components/actions/index.tsx",
        "src/components/ui/index.ts",
      ],
    );

  const resolvedByName =
    new Map(
      resolvedComponents.map(
        (component) => [
          component.name,
          component,
        ],
      ),
    );

  assert.equal(
    resolvedByName.get(
      "InvoiceTable",
    )?.importedFrom,
    "src/components/InvoiceTable.tsx",
  );

  assert.equal(
    resolvedByName.get(
      "PushButton",
    )?.importedFrom,
    "src/components/actions/index.tsx",
  );

  assert.equal(
    resolvedByName.get(
      "UI.Drawer",
    )?.importedFrom,
    "src/components/ui/index.ts",
  );

  assert.equal(
    resolvedByName.get(
      "ExternalButton",
    )?.importedFrom,
    undefined,
  );

  assert.equal(
    resolvedByName.get(
      "InvoiceTable",
    )?.importLine,
    1,
  );

  const files:
    UiFlowFile[] = [
      {
        path:
          "src/pages/InvoicesPage.tsx",
        components: [
          {
            name:
              "InvoiceTable",
            line:
              4,
            importedFrom:
              "src/components/InvoiceTable.tsx",
            importLine:
              1,
          },
          {
            name:
              "InvoiceTable",
            line:
              8,
            importedFrom:
              "src/components/InvoiceTable.tsx",
            importLine:
              1,
          },
          {
            name:
              "PushAllButton",
            line:
              11,
          },
        ],
        inventory: [
          {
            type:
              "heading",
            text:
              "Invoices",
            line:
              2,
          },
          {
            type:
              "button",
            text:
              "Push all",
            line:
              12,
          },
          {
            type:
              "form_control",
            line:
              15,
          },
          {
            type:
              "loading_state",
            line:
              40,
          },
          {
            type:
              "click_action",
            line:
              12,
          },
        ],
        events: [
          {
            type:
              "click_action",
            line:
              12,
            text:
              "Push all",
          },
          {
            type:
              "api_call",
            line:
              18,
            target:
              "/api/invoices",
          },
          {
            type:
              "navigation",
            line:
              30,
            target:
              "/clients",
          },
        ],
      },
      {
        path:
          "src/components/InvoiceDrawer.tsx",
        components: [
          {
            name:
              "InvoiceTable",
            line:
              3,
          },
          {
            name:
              "DrawerBody",
            line:
              7,
          },
        ],
        events: [
          {
            type:
              "overlay",
            line:
              5,
          },
          {
            type:
              "loading_state",
            line:
              20,
          },
          {
            type:
              "error_state",
            line:
              24,
          },
        ],
      },
    ];

  const graph =
    buildUiGraph(
      "/invoices",
      files,
    );

  assert.equal(
    graph.nodes.filter(
      (node) =>
        node.kind
          === "route",
    ).length,
    1,
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
          === "component",
    ).length,
    4,
  );

  assert.equal(
    graph.nodes.filter(
      (node) =>
        node.kind
          === "component"
        && node.label
          === "InvoiceTable",
    ).length,
    2,
  );

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "renders",
    ).length,
    4,
  );

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "imports_from",
    ).length,
    1,
  );

  const importEdge =
    graph.edges.find(
      (edge) =>
        edge.kind
          === "imports_from",
    );

  assert.ok(
    importEdge,
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "source_file"
        && node.label
          === "src/components/InvoiceTable.tsx",
    ),
  );

  assert.deepEqual(
    importEdge.evidence,
    [
      {
        path:
          "src/pages/InvoicesPage.tsx",
        line:
          1,
      },
      {
        path:
          "src/components/InvoiceTable.tsx",
      },
    ],
  );

  const pageInvoiceTable =
    graph.nodes.find(
      (node) =>
        node.kind
          === "component"
        && node.label
          === "InvoiceTable"
        && node.id.includes(
          encodeURIComponent(
            "src/pages/InvoicesPage.tsx",
          ),
        ),
    );

  assert.ok(
    pageInvoiceTable,
  );

  assert.deepEqual(
    pageInvoiceTable
      .evidence,
    [
      {
        path:
          "src/pages/InvoicesPage.tsx",
        line:
          4,
      },
      {
        path:
          "src/pages/InvoicesPage.tsx",
        line:
          8,
      },
    ],
  );

  assert.equal(
    graph.nodes.filter(
      (node) =>
        node.kind
          === "ui_element",
    ).length,
    3,
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "ui_element"
        && node.label
          === "heading: Invoices",
    ),
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "ui_element"
        && node.label
          === "button: Push all",
    ),
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "ui_element"
        && node.label
          === "form_control",
    ),
  );

  assert.ok(
    !graph.nodes.some(
      (node) =>
        node.kind
          === "ui_element"
        && (
          node.label
            === "loading_state"
          || node.label
            === "click_action"
        ),
    ),
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "api_endpoint"
        && node.label
          === "/api/invoices",
    ),
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "navigation_target"
        && node.label
          === "/clients",
    ),
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "interaction"
        && node.label
          === "click_action: Push all",
    ),
  );

  assert.ok(
    graph.nodes.some(
      (node) =>
        node.kind
          === "state"
        && node.label
          === "loading_state",
    ),
  );

  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.kind
          === "calls",
    ),
  );

  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.kind
          === "navigates_to",
    ),
  );

  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.kind
          === "shows_state",
    ),
  );

  const uiElementIds =
    new Set(
      graph.nodes
        .filter(
          (node) =>
            node.kind
              === "ui_element",
        )
        .map(
          (node) =>
            node.id,
        ),
    );

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "contains"
        && uiElementIds.has(
          edge.target,
        ),
    ).length,
    3,
  );

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "contains"
        && !uiElementIds.has(
          edge.target,
        ),
    ).length,
    4,
  );

  const apiNode =
    graph.nodes.find(
      (node) =>
        node.kind
          === "api_endpoint",
    );

  assert.ok(
    apiNode,
  );

  assert.deepEqual(
    apiNode.evidence,
    [
      {
        path:
          "src/pages/InvoicesPage.tsx",
        line:
          18,
      },
    ],
  );

  const mermaid =
    renderUiGraphMermaid(
      graph,
    );

  assert.ok(
    mermaid.startsWith(
      "flowchart LR\n",
    ),
  );

  assert.ok(
    mermaid.includes(
      "route: /invoices",
    ),
  );

  assert.ok(
    mermaid.includes(
      "source_file: src/pages/InvoicesPage.tsx",
    ),
  );

  assert.ok(
    mermaid.includes(
      "api_endpoint: /api/invoices",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|calls|",
    ),
  );

  assert.ok(
    mermaid.includes(
      "component: InvoiceTable",
    ),
  );

  assert.ok(
    mermaid.includes(
      "ui_element: heading: Invoices",
    ),
  );

  assert.ok(
    mermaid.includes(
      "ui_element: button: Push all",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|renders|",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|imports from|",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|navigates to|",
    ),
  );

  assert.ok(
    mermaid.includes(
      "|shows state|",
    ),
  );

  const sharedTargetGraph =
    buildUiGraph(
      "/example",
      [
        {
          path:
            "src/A.tsx",
          events: [
            {
              type:
                "api_call",
              line:
                1,
              target:
                "/api/shared",
            },
          ],
        },
        {
          path:
            "src/B.tsx",
          events: [
            {
              type:
                "api_call",
              line:
                2,
              target:
                "/api/shared",
            },
          ],
        },
      ],
    );

  assert.equal(
    sharedTargetGraph
      .nodes
      .filter(
        (node) =>
          node.kind
            === "api_endpoint"
          && node.label
            === "/api/shared",
      )
      .length,
    1,
  );

  assert.equal(
    sharedTargetGraph
      .edges
      .filter(
        (edge) =>
          edge.kind
            === "calls",
      )
      .length,
    2,
  );

  const htmlOnly =
    extractUiComponentUsages(
      [
        "<div>",
        "<button>Save</button>",
        "<input />",
        "</div>",
      ].join(
        "\n",
      ),
    );

  assert.deepEqual(
    htmlOnly,
    [],
  );

  console.log(
    "UI structured graph: OK",
  );
}

main();
