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

export type UiFlowEvent = {
  type: UiFlowEventType;
  line: number;
  target?: string;
  text?: string;
};

export type UiFlowFile = {
  path: string;
  events: UiFlowEvent[];
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

    const apiCall =
      line.match(
        /\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*["'`]([^"'`]+)["'`]/,
      )
      ?.[1];

    if (apiCall) {
      events.push({
        type:
          "api_call",
        line:
          lineNo,
        target:
          apiCall,
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
