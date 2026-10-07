import assert from "node:assert/strict";

import {
  buildDbGraph,
  parsePocketBaseMigrations,
  parsePocketBaseSchema,
  renderDbGraphMermaid,
} from "../src/db-graph.js";

import type {
  DbCollection,
  DbGraphEvidence,
} from "../src/db-graph.js";

function collection(
  name: string,
  fields: Array<{
    name: string;
    type: string;
    required?: boolean;
    targetCollection?: string;
  }>,
): DbCollection {
  return {
    name,
    fields:
      new Map(
        fields.map(
          (field) => [
            field.name,
            field,
          ],
        ),
      ),
  };
}

function main() {
  const evidence:
    DbGraphEvidence[] = [
      {
        source:
          "schema",
        path:
          "apps/pocketbase/pb_schema.json",
      },
    ];

  const collections:
    DbCollection[] = [
      collection(
        "clients",
        [
          {
            name:
              "name",
            type:
              "text",
            required:
              true,
          },
        ],
      ),

      collection(
        "invoices",
        [
          {
            name:
              "client",
            type:
              "relation",
            required:
              true,
            targetCollection:
              "clients",
          },
          {
            name:
              "total",
            type:
              "number",
          },
        ],
      ),
    ];

  const graph =
    buildDbGraph(
      collections,
      evidence,
    );

  assert.equal(
    graph.nodes.length,
    2,
  );

  assert.equal(
    graph.edges.length,
    1,
  );

  assert.deepEqual(
    graph.evidence,
    evidence,
  );

  const clients =
    graph.nodes.find(
      (node) =>
        node.name
        === "clients",
    );

  assert.ok(
    clients,
  );

  assert.equal(
    clients.kind,
    "collection",
  );

  assert.deepEqual(
    clients.fields,
    [
      {
        name:
          "name",
        type:
          "text",
        required:
          true,
      },
    ],
  );

  assert.deepEqual(
    clients.evidence,
    evidence,
  );

  const invoices =
    graph.nodes.find(
      (node) =>
        node.name
        === "invoices",
    );

  assert.ok(
    invoices,
  );

  assert.deepEqual(
    invoices.fields,
    [
      {
        name:
          "client",
        type:
          "relation",
        required:
          true,
      },
      {
        name:
          "total",
        type:
          "number",
        required:
          false,
      },
    ],
  );

  assert.deepEqual(
    graph.edges[0],
    {
      id:
        "relation:invoices:client:clients",
      kind:
        "relation",
      source:
        "invoices",
      target:
        "clients",
      field:
        "client",
      evidence,
    },
  );

  const mermaid =
    renderDbGraphMermaid(
      graph,
    );

  assert.equal(
    mermaid,
    [
      "erDiagram",
      "  clients {",
      "    string id",
      "    string name",
      "  }",
      "  invoices {",
      "    string id",
      "    relation client",
      "    number total",
      "  }",
      '  clients ||--o{ invoices : "client"',
    ].join(
      "\n",
    ),
  );

  const duplicateGraph =
    buildDbGraph(
      [
        collections[0],
        collections[1],
        collections[1],
      ],
      evidence,
    );

  assert.equal(
    duplicateGraph
      .nodes
      .length,
    2,
  );

  assert.equal(
    duplicateGraph
      .edges
      .length,
    1,
  );

  const migrationEvidence:
    DbGraphEvidence[] = [
      {
        source:
          "migration",
        path:
          "pb_migrations/1700000000_schema.js",
      },
    ];

  const migrationGraph =
    buildDbGraph(
      [
        collection(
          "events",
          [],
        ),
      ],
      migrationEvidence,
    );

  assert.deepEqual(
    migrationGraph
      .nodes[0]
      .evidence,
    migrationEvidence,
  );

  assert.equal(
    renderDbGraphMermaid(
      migrationGraph,
    ),
    [
      "erDiagram",
      "  events {",
      "    string id",
      "  }",
    ].join(
      "\n",
    ),
  );

  const schemaPath =
    "apps/pocketbase/pb_schema.json";

  const parsedSchema =
    parsePocketBaseSchema(
      JSON.stringify({
        collections: [
          {
            name:
              "customers",
            fields: [
              {
                name:
                  "name",
                type:
                  "text",
              },
            ],
          },
          {
            name:
              "orders",
            fields: [
              {
                name:
                  "customer",
                type:
                  "relation",
                required:
                  true,
                collectionName:
                  "customers",
              },
            ],
          },
        ],
      }),
      schemaPath,
    );

  const schemaGraph =
    buildDbGraph(
      parsedSchema,
    );

  const schemaRelation =
    schemaGraph
      .edges
      .find(
        (edge) =>
          edge.source
            === "orders"
          && edge.field
            === "customer",
      );

  assert.ok(
    schemaRelation,
  );

  assert.deepEqual(
    schemaRelation
      .evidence,
    [
      {
        source:
          "schema",
        path:
          schemaPath,
      },
    ],
  );

  assert.deepEqual(
    schemaGraph
      .nodes
      .find(
        (node) =>
          node.name
            === "orders",
      )
      ?.evidence,
    [
      {
        source:
          "schema",
        path:
          schemaPath,
      },
    ],
  );

  const migrationPathA =
    "pb_migrations/1700000001_clients.js";

  const migrationPathB =
    "pb_migrations/1700000002_invoices.js";

  const parsedMigrations =
    parsePocketBaseMigrations(
      [
        {
          path:
            migrationPathA,
          content:
            'new Collection({ name: "clients" });',
        },
        {
          path:
            migrationPathB,
          content: [
            "new Collection({",
            '  name: "invoices",',
            "  fields: [",
            "    new RelationField({",
            '      name: "client",',
            '      collectionName: "clients",',
            "      required: true,",
            "    }),",
            "  ],",
            "});",
          ].join(
            "\n",
          ),
        },
      ],
    );

  const migrationProvenanceGraph =
    buildDbGraph(
      parsedMigrations,
    );

  const migrationRelation =
    migrationProvenanceGraph
      .edges
      .find(
        (edge) =>
          edge.source
            === "invoices"
          && edge.field
            === "client",
      );

  assert.ok(
    migrationRelation,
  );

  assert.deepEqual(
    migrationRelation
      .evidence,
    [
      {
        source:
          "migration",
        path:
          migrationPathB,
      },
    ],
  );

  const clientsNode =
    migrationProvenanceGraph
      .nodes
      .find(
        (node) =>
          node.name
            === "clients",
      );

  assert.ok(
    clientsNode,
  );

  assert.ok(
    clientsNode
      .evidence
      .some(
        (item) =>
          item.path
            === migrationPathA,
      ),
  );

  console.log(
    "DB structured graph: OK",
  );
}

main();
