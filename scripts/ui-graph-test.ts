import assert from "node:assert/strict";

import {
  buildUiGraph,
  extractUiFlowEvents,
  renderUiGraphMermaid,
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

  const files:
    UiFlowFile[] = [
      {
        path:
          "src/pages/InvoicesPage.tsx",
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
    2,
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

  assert.equal(
    graph.edges.filter(
      (edge) =>
        edge.kind
          === "contains",
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

  console.log(
    "UI structured graph: OK",
  );
}

main();
