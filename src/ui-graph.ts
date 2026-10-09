export type UiFlowEventType =
  | "navigation"
  | "api_call"
  | "form_submit"
  | "click_action"
  | "overlay"
  | "guard"
  | "loading_state"
  | "error_state"
  | "empty_state";

export type UiHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export type UiFlowEvent = {
  type: UiFlowEventType;
  line: number;
  target?: string;
  text?: string;
  method?: UiHttpMethod;
};

export type UiComponentUsage = {
  name: string;
  line: number;
  importedFrom?: string;
  importLine?: number;
};

export type UiInventoryItem = {
  type: string;
  text?: string;
  line: number;
};

export type UiFlowFile = {
  path: string;
  events: UiFlowEvent[];
  components?: UiComponentUsage[];
  inventory?: UiInventoryItem[];
};

export type UiGraphEvidence = {
  path: string;
  line?: number;
};

export type UiGraphNodeKind =
  | "route"
  | "source_file"
  | "navigation_target"
  | "api_endpoint"
  | "component"
  | "ui_element"
  | "interaction"
  | "state";

export type UiGraphNode = {
  id: string;
  kind: UiGraphNodeKind;
  label: string;
  evidence: UiGraphEvidence[];
};

export type UiGraphEdgeKind =
  | "contains"
  | "navigates_to"
  | "calls"
  | "renders"
  | "imports_from"
  | "shows_state";

export type UiGraphEdge = {
  id: string;
  kind: UiGraphEdgeKind;
  source: string;
  target: string;
  evidence: UiGraphEvidence[];
};

export type UiGraph = {
  nodes: UiGraphNode[];
  edges: UiGraphEdge[];
  evidence: UiGraphEvidence[];
};

function clean(
  value?: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const result =
    value
      .replace(
        /\s+/g,
        " ",
      )
      .trim()
      .slice(
        0,
        300,
      );

  return (
    result
    || undefined
  );
}

function uiHttpMethod(
  value:
    string
    | undefined,
): UiHttpMethod | undefined {
  const method =
    value?.toUpperCase();

  if (
    method === "GET"
    || method === "POST"
    || method === "PUT"
    || method === "PATCH"
    || method === "DELETE"
  ) {
    return method;
  }

  return undefined;
}

export function extractUiFlowEvents(
  content: string,
): UiFlowEvent[] {
  const lines =
    content.split(
      /\r?\n/,
    );

  const events:
    UiFlowEvent[] = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    const lineNo =
      i + 1;

    const href =
      line.match(
        /\bhref\s*=\s*["'`]([^"'`]+)["'`]/,
      )
      ?.[1];

    if (href) {
      events.push({
        type:
          "navigation",
        line:
          lineNo,
        target:
          href,
      });
    }

    const routerPush =
      line.match(
        /\b(?:router\.(?:push|replace)|navigate)\s*\(\s*["'`]([^"'`]+)["'`]/,
      )
      ?.[1];

    if (routerPush) {
      events.push({
        type:
          "navigation",
        line:
          lineNo,
        target:
          routerPush,
      });
    }

    const axiosCall =
      line.match(
        /\baxios\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/i,
      );

    if (axiosCall) {
      events.push({
        type:
          "api_call",
        line:
          lineNo,
        target:
          axiosCall[2],
        method:
          uiHttpMethod(
            axiosCall[1],
          ),
      });
    }

    const fetchCall =
      line.match(
        /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/,
      );

    if (fetchCall) {
      const explicitMethod =
        line.match(
          /\bmethod\s*:\s*["'`](get|post|put|patch|delete)["'`]/i,
        )?.[1];

      events.push({
        type:
          "api_call",
        line:
          lineNo,
        target:
          fetchCall[1],
        ...(
          explicitMethod
            ? {
                method:
                  uiHttpMethod(
                    explicitMethod,
                  ),
              }
            : {}
        ),
      });
    }

    if (
      /\bonSubmit\s*=|handleSubmit\s*\(/.test(
        line,
      )
    ) {
      events.push({
        type:
          "form_submit",
        line:
          lineNo,
      });
    }

    if (
      /\bonClick\s*=/.test(
        line,
      )
    ) {
      events.push({
        type:
          "click_action",
        line:
          lineNo,
        text:
          clean(
            line.match(
              />([^<>]{1,120})</,
            )
            ?.[1],
          ),
      });
    }

    if (
      /\b(Dialog|Modal|Drawer|Sheet|Popover)\b/.test(
        line,
      )
    ) {
      events.push({
        type:
          "overlay",
        line:
          lineNo,
      });
    }

    if (
      /\b(disabled|isDisabled|canSubmit|canProceed|hasPermission|isAllowed)\b/.test(
        line,
      )
    ) {
      events.push({
        type:
          "guard",
        line:
          lineNo,
        text:
          clean(
            line,
          ),
      });
    }

    if (
      /\b(isLoading|loading|Loading|Spinner|Skeleton)\b/.test(
        line,
      )
    ) {
      events.push({
        type:
          "loading_state",
        line:
          lineNo,
      });
    }

    if (
      /\b(isError|errorMessage|toast\.error|setError|Error)\b/.test(
        line,
      )
    ) {
      events.push({
        type:
          "error_state",
        line:
          lineNo,
      });
    }

    if (
      /\b(empty|Empty|noData|NoData|length\s*===\s*0)\b/.test(
        line,
      )
    ) {
      events.push({
        type:
          "empty_state",
        line:
          lineNo,
      });
    }
  }

  return events;
}

export function extractUiComponentUsages(
  content: string,
): UiComponentUsage[] {
  const lines =
    content.split(
      /\r?\n/,
    );

  const usages:
    UiComponentUsage[] = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    const matches =
      line.matchAll(
        /<([A-Z][A-Za-z0-9_$]*(?:\.[A-Z][A-Za-z0-9_$]*)*)\b/g,
      );

    for (
      const match
      of matches
    ) {
      usages.push({
        name:
          match[1],
        line:
          i + 1,
      });
    }
  }

  return usages;
}

export function extractUiInventoryItems(
  content: string,
): UiInventoryItem[] {
  const lines =
    content.split(
      /\r?\n/,
    );

  const items:
    UiInventoryItem[] = [];

  const patterns:
    Array<{
      type: string;
      regex: RegExp;
    }> = [
      {
        type:
          "button",
        regex:
          /<(?:button|Button)\b[^>]*>(.*?)<\/(?:button|Button)>/i,
      },
      {
        type:
          "heading",
        regex:
          /<h[1-6]\b[^>]*>(.*?)<\/h[1-6]>/i,
      },
      {
        type:
          "label",
        regex:
          /<label\b[^>]*>(.*?)<\/label>/i,
      },
      {
        type:
          "link",
        regex:
          /<(?:a|Link)\b[^>]*>(.*?)<\/(?:a|Link)>/i,
      },
      {
        type:
          "placeholder",
        regex:
          /placeholder\s*=\s*["'`]([^"'`]+)["'`]/i,
      },
      {
        type:
          "aria-label",
        regex:
          /aria-label\s*=\s*["'`]([^"'`]+)["'`]/i,
      },
    ];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    for (
      const pattern
      of patterns
    ) {
      const match =
        line.match(
          pattern.regex,
        );

      if (!match) {
        continue;
      }

      const value =
        (
          match[1]
          ?? ""
        )
          .replace(
            /\s+/g,
            " ",
          )
          .replace(
            /[{}]/g,
            "",
          )
          .trim()
          .slice(
            0,
            300,
          );

      items.push({
        type:
          pattern.type,
        text:
          value
          || undefined,
        line:
          i + 1,
      });
    }

    if (
      /\b(isLoading|loading|Loading|Skeleton|Spinner)\b/.test(
        line,
      )
    ) {
      items.push({
        type:
          "loading_state",
        line:
          i + 1,
      });
    }

    if (
      /\b(error|Error|isError|errorMessage|toast\.error)\b/.test(
        line,
      )
    ) {
      items.push({
        type:
          "error_state",
        line:
          i + 1,
      });
    }

    if (
      /\b(empty|Empty|noData|NoData|length\s*===\s*0)\b/.test(
        line,
      )
    ) {
      items.push({
        type:
          "empty_state",
        line:
          i + 1,
      });
    }

    if (
      /<(?:input|Input|select|Select|textarea|Textarea)\b/i.test(
        line,
      )
    ) {
      items.push({
        type:
          "form_control",
        line:
          i + 1,
      });
    }

    if (
      /\bonClick\s*=/.test(
        line,
      )
    ) {
      items.push({
        type:
          "click_action",
        line:
          i + 1,
      });
    }
  }

  return items;
}

type UiImportBinding = {
  localName: string;
  specifier: string;
  line: number;
  namespace: boolean;
};

function extractUiImportBindings(
  content: string,
): UiImportBinding[] {
  const lines =
    content.split(
      /\r?\n/,
    );

  const bindings:
    UiImportBinding[] = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    const source =
      line.match(
        /\bfrom\s*["'`]([^"'`]+)["'`]/,
      )
      ?.[1];

    if (
      !source
      || !source.startsWith(
        ".",
      )
    ) {
      continue;
    }

    const namespace =
      line.match(
        /^\s*import\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\b/,
      );

    if (namespace) {
      bindings.push({
        localName:
          namespace[1],
        specifier:
          source,
        line:
          i + 1,
        namespace:
          true,
      });

      continue;
    }

    const defaultImport =
      line.match(
        /^\s*import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|from\b)/,
      );

    if (defaultImport) {
      bindings.push({
        localName:
          defaultImport[1],
        specifier:
          source,
        line:
          i + 1,
        namespace:
          false,
      });
    }

    const namedBlock =
      line.match(
        /\{([^}]+)\}/,
      )
      ?.[1];

    if (!namedBlock) {
      continue;
    }

    for (
      const rawPart
      of namedBlock.split(
        ",",
      )
    ) {
      const part =
        rawPart.trim();

      if (!part) {
        continue;
      }

      const aliasMatch =
        part.match(
          /^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/,
        );

      const directMatch =
        part.match(
          /^([A-Za-z_$][A-Za-z0-9_$]*)$/,
        );

      const localName =
        aliasMatch
          ? aliasMatch[2]
          : directMatch
            ? directMatch[1]
            : undefined;

      if (!localName) {
        continue;
      }

      bindings.push({
        localName,
        specifier:
          source,
        line:
          i + 1,
        namespace:
          false,
      });
    }
  }

  return bindings;
}

function normalizeRepoPath(
  value: string,
): string {
  const parts:
    string[] = [];

  for (
    const part
    of value.split(
      "/",
    )
  ) {
    if (
      !part
      || part === "."
    ) {
      continue;
    }

    if (
      part === ".."
    ) {
      parts.pop();
      continue;
    }

    parts.push(
      part,
    );
  }

  return parts.join(
    "/",
  );
}

function dirname(
  value: string,
): string {
  const index =
    value.lastIndexOf(
      "/",
    );

  return index < 0
    ? ""
    : value.slice(
        0,
        index,
      );
}

function resolveRelativeModule(
  importerPath: string,
  specifier: string,
  repositoryPaths:
    ReadonlySet<string>,
): string | undefined {
  if (
    !specifier.startsWith(
      ".",
    )
  ) {
    return undefined;
  }

  const base =
    normalizeRepoPath(
      [
        dirname(
          importerPath,
        ),
        specifier,
      ]
        .filter(
          Boolean,
        )
        .join(
          "/",
        ),
    );

  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.jsx`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ];

  return candidates.find(
    (candidate) =>
      repositoryPaths.has(
        candidate,
      ),
  );
}

export function resolveUiComponentUsages(
  path: string,
  content: string,
  repositoryPaths:
    readonly string[],
): UiComponentUsage[] {
  const usages =
    extractUiComponentUsages(
      content,
    );

  const bindings =
    extractUiImportBindings(
      content,
    );

  const snapshotPaths =
    new Set(
      repositoryPaths,
    );

  const bindingsByName =
    new Map<
      string,
      UiImportBinding
    >();

  for (
    const binding
    of bindings
  ) {
    bindingsByName.set(
      binding.localName,
      binding,
    );
  }

  return usages.map(
    (usage) => {
      const rootName =
        usage.name.split(
          ".",
          1,
        )[0];

      const binding =
        bindingsByName.get(
          rootName,
        );

      if (!binding) {
        return usage;
      }

      if (
        binding.namespace
        && !usage.name.startsWith(
          `${binding.localName}.`,
        )
      ) {
        return usage;
      }

      const importedFrom =
        resolveRelativeModule(
          path,
          binding.specifier,
          snapshotPaths,
        );

      if (!importedFrom) {
        return usage;
      }

      return {
        ...usage,
        importedFrom,
        importLine:
          binding.line,
      };
    },
  );
}

function evidenceKey(
  evidence:
    UiGraphEvidence,
): string {
  return [
    evidence.path,
    evidence.line
      ?? "",
  ].join(
    ":",
  );
}

function mergeEvidence(
  ...groups:
    Array<
      readonly UiGraphEvidence[]
      | undefined
    >
): UiGraphEvidence[] {
  const merged =
    new Map<
      string,
      UiGraphEvidence
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
          path:
            evidence.path,
          ...(
            evidence.line
              === undefined
              ? {}
              : {
                  line:
                    evidence.line,
                }
          ),
        },
      );
    }
  }

  return [
    ...merged.values(),
  ];
}

function encoded(
  value: string,
): string {
  return encodeURIComponent(
    value,
  );
}

function routeNodeId(
  route: string,
): string {
  return (
    "route:"
    + encoded(
      route,
    )
  );
}

function fileNodeId(
  path: string,
): string {
  return (
    "file:"
    + encoded(
      path,
    )
  );
}

function inventoryNodeId(
  path: string,
  item: UiInventoryItem,
): string {
  return [
    "ui",
    encoded(
      path,
    ),
    item.line,
    encoded(
      item.type,
    ),
    encoded(
      item.text
      ?? "",
    ),
  ].join(
    ":",
  );
}

function componentNodeId(
  path: string,
  name: string,
): string {
  return [
    "component",
    encoded(
      path,
    ),
    encoded(
      name,
    ),
  ].join(
    ":",
  );
}

function targetNodeId(
  kind:
    | "navigation"
    | "api",
  target: string,
): string {
  return [
    kind,
    encoded(
      target,
    ),
  ].join(
    ":",
  );
}

function eventNodeId(
  path: string,
  event: UiFlowEvent,
): string {
  return [
    "event",
    encoded(
      path,
    ),
    event.line,
    event.type,
  ].join(
    ":",
  );
}

function edgeId(
  kind: UiGraphEdgeKind,
  source: string,
  target: string,
): string {
  return [
    "edge",
    kind,
    encoded(
      source,
    ),
    encoded(
      target,
    ),
  ].join(
    ":",
  );
}

function interactionLabel(
  event: UiFlowEvent,
): string {
  if (event.text) {
    return (
      `${event.type}: `
      + event.text
    );
  }

  return event.type;
}

export function buildUiGraph(
  route: string,
  files:
    readonly UiFlowFile[],
): UiGraph {
  const nodes =
    new Map<
      string,
      UiGraphNode
    >();

  const edges =
    new Map<
      string,
      UiGraphEdge
    >();

  function addNode(
    node: UiGraphNode,
  ) {
    const existing =
      nodes.get(
        node.id,
      );

    if (existing) {
      existing.evidence =
        mergeEvidence(
          existing.evidence,
          node.evidence,
        );

      return;
    }

    nodes.set(
      node.id,
      {
        ...node,
        evidence:
          mergeEvidence(
            node.evidence,
          ),
      },
    );
  }

  function addEdge(
    edge: UiGraphEdge,
  ) {
    const existing =
      edges.get(
        edge.id,
      );

    if (existing) {
      existing.evidence =
        mergeEvidence(
          existing.evidence,
          edge.evidence,
        );

      return;
    }

    edges.set(
      edge.id,
      {
        ...edge,
        evidence:
          mergeEvidence(
            edge.evidence,
          ),
      },
    );
  }

  const routeId =
    routeNodeId(
      route,
    );

  addNode({
    id:
      routeId,
    kind:
      "route",
    label:
      route,
    evidence:
      [],
  });

  for (
    const file
    of files
  ) {
    const fileId =
      fileNodeId(
        file.path,
      );

    const fileEvidence:
      UiGraphEvidence[] = [
        {
          path:
            file.path,
        },
      ];

    addNode({
      id:
        fileId,
      kind:
        "source_file",
      label:
        file.path,
      evidence:
        fileEvidence,
    });

    addEdge({
      id:
        edgeId(
          "contains",
          routeId,
          fileId,
        ),
      kind:
        "contains",
      source:
        routeId,
      target:
        fileId,
      evidence:
        fileEvidence,
    });

    for (
      const component
      of file.components
        ?? []
    ) {
      const componentId =
        componentNodeId(
          file.path,
          component.name,
        );

      const componentEvidence:
        UiGraphEvidence[] = [
          {
            path:
              file.path,
            line:
              component.line,
          },
        ];

      addNode({
        id:
          componentId,
        kind:
          "component",
        label:
          component.name,
        evidence:
          componentEvidence,
      });

      addEdge({
        id:
          edgeId(
            "renders",
            fileId,
            componentId,
          ),
        kind:
          "renders",
        source:
          fileId,
        target:
          componentId,
        evidence:
          componentEvidence,
      });

      if (
        component.importedFrom
      ) {
        const importedFileId =
          fileNodeId(
            component.importedFrom,
          );

        const importedFileEvidence:
          UiGraphEvidence[] = [
            {
              path:
                component.importedFrom,
            },
          ];

        addNode({
          id:
            importedFileId,
          kind:
            "source_file",
          label:
            component.importedFrom,
          evidence:
            importedFileEvidence,
        });

        const importEvidence:
          UiGraphEvidence[] = [
            {
              path:
                file.path,
              line:
                component.importLine
                ?? component.line,
            },
            {
              path:
                component.importedFrom,
            },
          ];

        addEdge({
          id:
            edgeId(
              "imports_from",
              componentId,
              importedFileId,
            ),
          kind:
            "imports_from",
          source:
            componentId,
          target:
            importedFileId,
          evidence:
            importEvidence,
        });
      }
    }

    for (
      const item
      of file.inventory
        ?? []
    ) {
      if (
        item.type
          === "loading_state"
        || item.type
          === "error_state"
        || item.type
          === "empty_state"
        || item.type
          === "click_action"
      ) {
        continue;
      }

      const itemId =
        inventoryNodeId(
          file.path,
          item,
        );

      const itemEvidence:
        UiGraphEvidence[] = [
          {
            path:
              file.path,
            line:
              item.line,
          },
        ];

      addNode({
        id:
          itemId,
        kind:
          "ui_element",
        label:
          item.text
            ? `${item.type}: ${item.text}`
            : item.type,
        evidence:
          itemEvidence,
      });

      addEdge({
        id:
          edgeId(
            "contains",
            fileId,
            itemId,
          ),
        kind:
          "contains",
        source:
          fileId,
        target:
          itemId,
        evidence:
          itemEvidence,
      });
    }

    for (
      const event
      of file.events
    ) {
      const eventEvidence:
        UiGraphEvidence[] = [
          {
            path:
              file.path,
            line:
              event.line,
          },
        ];

      if (
        event.type
          === "navigation"
        && event.target
      ) {
        const targetId =
          targetNodeId(
            "navigation",
            event.target,
          );

        addNode({
          id:
            targetId,
          kind:
            "navigation_target",
          label:
            event.target,
          evidence:
            eventEvidence,
        });

        addEdge({
          id:
            edgeId(
              "navigates_to",
              fileId,
              targetId,
            ),
          kind:
            "navigates_to",
          source:
            fileId,
          target:
            targetId,
          evidence:
            eventEvidence,
        });

        continue;
      }

      if (
        event.type
          === "api_call"
        && event.target
      ) {
        const targetId =
          targetNodeId(
            "api",
            event.target,
          );

        addNode({
          id:
            targetId,
          kind:
            "api_endpoint",
          label:
            event.target,
          evidence:
            eventEvidence,
        });

        addEdge({
          id:
            edgeId(
              "calls",
              fileId,
              targetId,
            ),
          kind:
            "calls",
          source:
            fileId,
          target:
            targetId,
          evidence:
            eventEvidence,
        });

        continue;
      }

      if (
        event.type
          === "loading_state"
        || event.type
          === "error_state"
        || event.type
          === "empty_state"
      ) {
        const stateId =
          eventNodeId(
            file.path,
            event,
          );

        addNode({
          id:
            stateId,
          kind:
            "state",
          label:
            event.type,
          evidence:
            eventEvidence,
        });

        addEdge({
          id:
            edgeId(
              "shows_state",
              fileId,
              stateId,
            ),
          kind:
            "shows_state",
          source:
            fileId,
          target:
            stateId,
          evidence:
            eventEvidence,
        });

        continue;
      }

      const interactionId =
        eventNodeId(
          file.path,
          event,
        );

      addNode({
        id:
          interactionId,
        kind:
          "interaction",
        label:
          interactionLabel(
            event,
          ),
        evidence:
          eventEvidence,
      });

      addEdge({
        id:
          edgeId(
            "contains",
            fileId,
            interactionId,
          ),
        kind:
          "contains",
        source:
          fileId,
        target:
          interactionId,
        evidence:
          eventEvidence,
      });
    }
  }

  const nodeValues =
    [
      ...nodes.values(),
    ];

  const edgeValues =
    [
      ...edges.values(),
    ];

  return {
    nodes:
      nodeValues,
    edges:
      edgeValues,
    evidence:
      mergeEvidence(
        ...nodeValues.map(
          (node) =>
            node.evidence,
        ),
        ...edgeValues.map(
          (edge) =>
            edge.evidence,
        ),
      ),
  };
}

function mermaidLabel(
  value: string,
): string {
  return value
    .replace(
      /\\/g,
      "\\\\",
    )
    .replace(
      /"/g,
      '\\"',
    )
    .replace(
      /\r?\n/g,
      " ",
    );
}

function mermaidEdgeLabel(
  kind: UiGraphEdgeKind,
): string {
  switch (kind) {
    case "contains":
      return "contains";

    case "navigates_to":
      return "navigates to";

    case "calls":
      return "calls";

    case "renders":
      return "renders";

    case "imports_from":
      return "imports from";

    case "shows_state":
      return "shows state";
  }
}

export function renderUiGraphMermaid(
  graph: UiGraph,
): string {
  const lines:
    string[] = [
      "flowchart LR",
    ];

  const mermaidIds =
    new Map<
      string,
      string
    >();

  graph.nodes.forEach(
    (
      node,
      index,
    ) => {
      const id =
        `n${index}`;

      mermaidIds.set(
        node.id,
        id,
      );

      lines.push(
        `  ${id}["${mermaidLabel(
          `${node.kind}: ${node.label}`,
        )}"]`,
      );
    },
  );

  for (
    const edge
    of graph.edges
  ) {
    const source =
      mermaidIds.get(
        edge.source,
      );

    const target =
      mermaidIds.get(
        edge.target,
      );

    if (
      !source
      || !target
    ) {
      continue;
    }

    lines.push(
      `  ${source} -->|${mermaidEdgeLabel(
        edge.kind,
      )}| ${target}`,
    );
  }

  return lines.join(
    "\n",
  );
}
