export type DbGraphEvidence = {
  source:
    | "schema"
    | "migration";
  path: string;
};

export type DbField = {
  name: string;
  type: string;
  required?: boolean;
  targetCollection?: string;
  evidence?: DbGraphEvidence[];
};

export type DbCollection = {
  name: string;
  fields: Map<string, DbField>;
  evidence?: DbGraphEvidence[];
};

export type DbMigrationFile = {
  path: string;
  content: string;
};

export type DbGraphField = {
  name: string;
  type: string;
  required: boolean;
};

export type DbGraphNode = {
  id: string;
  kind: "collection";
  name: string;
  fields: DbGraphField[];
  evidence: DbGraphEvidence[];
};

export type DbGraphEdge = {
  id: string;
  kind: "relation";
  source: string;
  target: string;
  field: string;
  evidence: DbGraphEvidence[];
};

export type DbGraph = {
  nodes: DbGraphNode[];
  edges: DbGraphEdge[];
  evidence: DbGraphEvidence[];
};

function evidenceKey(
  evidence: DbGraphEvidence,
): string {
  return [
    evidence.source,
    evidence.path,
  ].join(
    ":",
  );
}

function mergeEvidence(
  ...groups:
    Array<
      readonly DbGraphEvidence[]
      | undefined
    >
): DbGraphEvidence[] {
  const merged =
    new Map<
      string,
      DbGraphEvidence
    >();

  for (
    const group
    of groups
  ) {
    if (!group) {
      continue;
    }

    for (
      const evidence
      of group
    ) {
      merged.set(
        evidenceKey(
          evidence,
        ),
        {
          source:
            evidence.source,
          path:
            evidence.path,
        },
      );
    }
  }

  return [
    ...merged.values(),
  ];
}

function collectionId(
  name: string,
): string {
  return (
    "collection:"
    + encodeURIComponent(
      name,
    )
  );
}

function relationId(
  source: string,
  field: string,
  target: string,
): string {
  return [
    "relation",
    encodeURIComponent(source),
    encodeURIComponent(field),
    encodeURIComponent(target),
  ].join(
    ":",
  );
}

export function parsePocketBaseSchema(
  raw: string,
  path: string,
): DbCollection[] {
  const parsed =
    JSON.parse(
      raw,
    );

  const evidence:
    DbGraphEvidence[] = [
      {
        source:
          "schema",
        path,
      },
    ];

  const collectionsRaw =
    Array.isArray(
      parsed,
    )
      ? parsed
      : Array.isArray(
          parsed.collections,
        )
        ? parsed.collections
        : [];

  return collectionsRaw
    .filter(
      (collection: any) =>
        collection?.name,
    )
    .map(
      (collection: any) => {
        const fields =
          new Map<
            string,
            DbField
          >();

        const sourceFields =
          collection.fields
          ?? collection.schema
          ?? [];

        for (
          const field
          of sourceFields
        ) {
          if (
            !field?.name
          ) {
            continue;
          }

          fields.set(
            field.name,
            {
              name:
                field.name,
              type:
                field.type
                ?? "text",
              required:
                !!field.required,
              targetCollection:
                field.collectionName
                ?? field.options
                  ?.collectionName
                ?? field.options
                  ?.collectionId
                ?? undefined,
              evidence:
                mergeEvidence(
                  evidence,
                ),
            },
          );
        }

        return {
          name:
            collection.name,
          fields,
          evidence:
            mergeEvidence(
              evidence,
            ),
        };
      },
    );
}

export function parsePocketBaseMigrations(
  files:
    readonly DbMigrationFile[],
): DbCollection[] {
  const collections =
    new Map<
      string,
      DbCollection
    >();

  function ensureCollection(
    name: string,
    evidence:
      readonly DbGraphEvidence[],
  ): DbCollection {
    let value =
      collections.get(
        name,
      );

    if (!value) {
      value = {
        name,
        fields:
          new Map(),
        evidence: [],
      };

      collections.set(
        name,
        value,
      );
    }

    value.evidence =
      mergeEvidence(
        value.evidence,
        evidence,
      );

    return value;
  }

  for (
    const file
    of files
  ) {
    const text =
      file.content;

    const evidence:
      DbGraphEvidence[] = [
        {
          source:
            "migration",
          path:
            file.path,
        },
      ];

    const collectionPatterns = [
      /name\s*:\s*["'`]([^"'`]+)["'`]/g,
      /new\s+Collection\s*\(\s*\{[\s\S]*?name\s*:\s*["'`]([^"'`]+)["'`]/g,
    ];

    const candidateNames =
      new Set<string>();

    for (
      const pattern
      of collectionPatterns
    ) {
      let match;

      while (
        (
          match =
            pattern.exec(
              text,
            )
        )
        !== null
      ) {
        const name =
          match[1];

        if (
          name
          && !name.startsWith(
            "_",
          )
          && name.length
            < 100
        ) {
          candidateNames.add(
            name,
          );
        }
      }
    }

    for (
      const name
      of candidateNames
    ) {
      ensureCollection(
        name,
        evidence,
      );
    }

    const fieldRegex =
      /new\s+([A-Za-z]+Field)\s*\(\s*\{([\s\S]*?)\}\s*\)/g;

    let fieldMatch;

    while (
      (
        fieldMatch =
          fieldRegex.exec(
            text,
          )
      )
      !== null
    ) {
      const fieldClass =
        fieldMatch[1];

      const body =
        fieldMatch[2];

      const nameMatch =
        body.match(
          /name\s*:\s*["'`]([^"'`]+)["'`]/,
        );

      if (
        !nameMatch
      ) {
        continue;
      }

      const fieldName =
        nameMatch[1];

      const collectionContext =
        text
          .slice(
            Math.max(
              0,
              fieldMatch.index
              - 5000,
            ),
            fieldMatch.index,
          )
          .match(
            /name\s*:\s*["'`]([^"'`]+)["'`]/g,
          );

      const lastCollectionRaw =
        collectionContext
          ?.at(
            -1,
          );

      const collectionName =
        lastCollectionRaw
          ?.match(
            /["'`]([^"'`]+)["'`]/,
          )
          ?.[1];

      if (
        !collectionName
      ) {
        continue;
      }

      const required =
        /required\s*:\s*true/.test(
          body,
        );

      const target =
        body.match(
          /collection(?:Id|Name)?\s*:\s*["'`]([^"'`]+)["'`]/,
        )
        ?.[1];

      const collection =
        ensureCollection(
          collectionName,
          evidence,
        );

      const previous =
        collection
          .fields
          .get(
            fieldName,
          );

      collection
        .fields
        .set(
          fieldName,
          {
            name:
              fieldName,
            type:
              fieldClass.replace(
                /Field$/,
                "",
              ),
            required,
            targetCollection:
              target,
            evidence:
              mergeEvidence(
                previous
                  ?.evidence,
                evidence,
              ),
          },
        );
    }
  }

  return [
    ...collections.values(),
  ];
}

export function buildDbGraph(
  collections:
    readonly DbCollection[],
  fallbackEvidence:
    readonly DbGraphEvidence[] = [],
): DbGraph {
  const nodeFields =
    new Map<
      string,
      Map<
        string,
        DbGraphField
      >
    >();

  const nodeEvidence =
    new Map<
      string,
      DbGraphEvidence[]
    >();

  const edges =
    new Map<
      string,
      DbGraphEdge
    >();

  for (
    const collection
    of collections
  ) {
    let fields =
      nodeFields.get(
        collection.name,
      );

    if (!fields) {
      fields =
        new Map();

      nodeFields.set(
        collection.name,
        fields,
      );
    }

    const collectionEvidence =
      collection
        .evidence
        ?.length
        ? collection.evidence
        : fallbackEvidence;

    nodeEvidence.set(
      collection.name,
      mergeEvidence(
        nodeEvidence.get(
          collection.name,
        ),
        collectionEvidence,
      ),
    );

    for (
      const field
      of collection
        .fields
        .values()
    ) {
      fields.set(
        field.name,
        {
          name:
            field.name,
          type:
            field.type,
          required:
            !!field.required,
        },
      );

      if (
        !field
          .targetCollection
      ) {
        continue;
      }

      const id =
        relationId(
          collection.name,
          field.name,
          field
            .targetCollection,
        );

      const edgeEvidence =
        field
          .evidence
          ?.length
          ? field.evidence
          : collectionEvidence;

      const existing =
        edges.get(
          id,
        );

      if (existing) {
        existing.evidence =
          mergeEvidence(
            existing.evidence,
            edgeEvidence,
          );

        continue;
      }

      edges.set(
        id,
        {
          id,
          kind:
            "relation",
          source:
            collection.name,
          target:
            field
              .targetCollection,
          field:
            field.name,
          evidence:
            mergeEvidence(
              edgeEvidence,
            ),
        },
      );
    }
  }

  const nodes:
    DbGraphNode[] =
    [];

  for (
    const [
      name,
      fields,
    ]
    of nodeFields
  ) {
    nodes.push({
      id:
        collectionId(
          name,
        ),
      kind:
        "collection",
      name,
      fields:
        [
          ...fields.values(),
        ],
      evidence:
        mergeEvidence(
          nodeEvidence.get(
            name,
          ),
        ),
    });
  }

  const edgeValues =
    [
      ...edges.values(),
    ];

  const evidence =
    mergeEvidence(
      fallbackEvidence,
      ...nodes.map(
        (node) =>
          node.evidence,
      ),
      ...edgeValues.map(
        (edge) =>
          edge.evidence,
      ),
    );

  return {
    nodes,
    edges:
      edgeValues,
    evidence,
  };
}

function safeMermaidName(
  value: string,
): string {
  return value.replace(
    /[^a-zA-Z0-9_]/g,
    "_",
  );
}

function mermaidType(
  type: string,
): string {
  const lower =
    type.toLowerCase();

  if (
    lower.includes(
      "bool",
    )
  ) {
    return "boolean";
  }

  if (
    lower.includes(
      "number",
    )
  ) {
    return "number";
  }

  if (
    lower.includes(
      "date",
    )
  ) {
    return "datetime";
  }

  if (
    lower.includes(
      "json",
    )
  ) {
    return "json";
  }

  if (
    lower.includes(
      "relation",
    )
  ) {
    return "relation";
  }

  if (
    lower.includes(
      "file",
    )
  ) {
    return "file";
  }

  if (
    lower.includes(
      "email",
    )
  ) {
    return "email";
  }

  if (
    lower.includes(
      "url",
    )
  ) {
    return "url";
  }

  return "string";
}

export function renderDbGraphMermaid(
  graph: DbGraph,
): string {
  const lines:
    string[] = [
      "erDiagram",
    ];

  for (
    const node
    of graph.nodes
  ) {
    const entity =
      safeMermaidName(
        node.name,
      );

    lines.push(
      `  ${entity} {`,
    );

    lines.push(
      "    string id",
    );

    for (
      const field
      of node.fields
    ) {
      lines.push(
        `    ${mermaidType(
          field.type,
        )} ${safeMermaidName(
          field.name,
        )}`,
      );
    }

    lines.push(
      "  }",
    );
  }

  const relations =
    new Set<string>();

  for (
    const edge
    of graph.edges
  ) {
    relations.add(
      `  ${safeMermaidName(
        edge.target,
      )} ||--o{ ${safeMermaidName(
        edge.source,
      )} : "${edge.field}"`,
    );
  }

  lines.push(
    ...relations,
  );

  return lines.join(
    "\n",
  );
}
