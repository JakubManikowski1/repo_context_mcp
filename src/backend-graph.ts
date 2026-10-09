export type BackendHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export type BackendRoute = {
  method: BackendHttpMethod;
  path: string;
  line: number;
  handler?: string;
  handlerImportedFrom?: string;
  handlerImportLine?: number;
};

export type BackendRouterMount = {
  path: string;
  line: number;
  router: string;
  routerImportedFrom: string;
  routerImportLine?: number;
};

export type BackendSourceFile = {
  path: string;
  content: string;
};

export type BackendMountStep = {
  sourcePath: string;
  path: string;
  line: number;
  router: string;
  targetPath: string;
};

export type BackendResolvedRoute =
  BackendRoute & {
    sourcePath: string;
    fullPath: string;
    mountChain: BackendMountStep[];
  };

export type BackendGraphEvidence = {
  path: string;
  line?: number;
};

export type BackendGraphNodeKind =
  | "source_file"
  | "api_route"
  | "handler";

export type BackendGraphNode = {
  id: string;
  kind: BackendGraphNodeKind;
  label: string;
  evidence: BackendGraphEvidence[];
};

export type BackendGraphEdgeKind =
  | "declares"
  | "handled_by"
  | "imports_from";

export type BackendGraphEdge = {
  id: string;
  kind: BackendGraphEdgeKind;
  source: string;
  target: string;
  evidence: BackendGraphEvidence[];
};

export type BackendGraph = {
  nodes: BackendGraphNode[];
  edges: BackendGraphEdge[];
  evidence: BackendGraphEvidence[];
};

type ImportBinding = {
  localName: string;
  specifier: string;
  line: number;
  namespace: boolean;
};

function lineNumberAt(
  content: string,
  index: number,
): number {
  return (
    content
      .slice(
        0,
        index,
      )
      .split(
        /\r?\n/,
      )
      .length
  );
}

function findMatchingParen(
  content: string,
  openIndex: number,
): number | undefined {
  let depth = 0;

  let quote:
    | "'"
    | '"'
    | "`"
    | undefined;

  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = openIndex;
    i < content.length;
    i++
  ) {
    const char =
      content[i];

    const next =
      content[i + 1];

    if (lineComment) {
      if (
        char === "\n"
      ) {
        lineComment =
          false;
      }

      continue;
    }

    if (blockComment) {
      if (
        char === "*"
        && next === "/"
      ) {
        blockComment =
          false;
        i++;
      }

      continue;
    }

    if (quote) {
      if (escaped) {
        escaped =
          false;
        continue;
      }

      if (
        char === "\\"
      ) {
        escaped =
          true;
        continue;
      }

      if (
        char === quote
      ) {
        quote =
          undefined;
      }

      continue;
    }

    if (
      char === "/"
      && next === "/"
    ) {
      lineComment =
        true;
      i++;
      continue;
    }

    if (
      char === "/"
      && next === "*"
    ) {
      blockComment =
        true;
      i++;
      continue;
    }

    if (
      char === "'"
      || char === '"'
      || char === "`"
    ) {
      quote =
        char;
      continue;
    }

    if (
      char === "("
    ) {
      depth++;
      continue;
    }

    if (
      char === ")"
    ) {
      depth--;

      if (
        depth === 0
      ) {
        return i;
      }
    }
  }

  return undefined;
}

function splitTopLevelArgs(
  value: string,
): string[] {
  const result:
    string[] = [];

  let start = 0;

  let paren = 0;
  let bracket = 0;
  let brace = 0;

  let quote:
    | "'"
    | '"'
    | "`"
    | undefined;

  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = 0;
    i < value.length;
    i++
  ) {
    const char =
      value[i];

    const next =
      value[i + 1];

    if (lineComment) {
      if (
        char === "\n"
      ) {
        lineComment =
          false;
      }

      continue;
    }

    if (blockComment) {
      if (
        char === "*"
        && next === "/"
      ) {
        blockComment =
          false;
        i++;
      }

      continue;
    }

    if (quote) {
      if (escaped) {
        escaped =
          false;
        continue;
      }

      if (
        char === "\\"
      ) {
        escaped =
          true;
        continue;
      }

      if (
        char === quote
      ) {
        quote =
          undefined;
      }

      continue;
    }

    if (
      char === "/"
      && next === "/"
    ) {
      lineComment =
        true;
      i++;
      continue;
    }

    if (
      char === "/"
      && next === "*"
    ) {
      blockComment =
        true;
      i++;
      continue;
    }

    if (
      char === "'"
      || char === '"'
      || char === "`"
    ) {
      quote =
        char;
      continue;
    }

    if (char === "(") {
      paren++;
      continue;
    }

    if (char === ")") {
      paren--;
      continue;
    }

    if (char === "[") {
      bracket++;
      continue;
    }

    if (char === "]") {
      bracket--;
      continue;
    }

    if (char === "{") {
      brace++;
      continue;
    }

    if (char === "}") {
      brace--;
      continue;
    }

    if (
      char === ","
      && paren === 0
      && bracket === 0
      && brace === 0
    ) {
      result.push(
        value
          .slice(
            start,
            i,
          )
          .trim(),
      );

      start =
        i + 1;
    }
  }

  const last =
    value
      .slice(
        start,
      )
      .trim();

  if (last) {
    result.push(
      last,
    );
  }

  return result;
}

function stringLiteralValue(
  value: string,
): string | undefined {
  const match =
    value
      .trim()
      .match(
        /^(["'`])([\s\S]*)\1$/,
      );

  return match?.[2];
}

function extractImports(
  content: string,
): ImportBinding[] {
  const bindings:
    ImportBinding[] = [];

  const namespacePattern =
    /\bimport\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'`]([^"'`]+)["'`]/g;

  let namespaceMatch:
    RegExpExecArray | null;

  while (
    (
      namespaceMatch =
        namespacePattern.exec(
          content,
        )
    )
    !== null
  ) {
    if (
      !namespaceMatch[2]
        .startsWith(
          ".",
        )
    ) {
      continue;
    }

    bindings.push({
      localName:
        namespaceMatch[1],
      specifier:
        namespaceMatch[2],
      line:
        lineNumberAt(
          content,
          namespaceMatch.index,
        ),
      namespace:
        true,
    });
  }

  const defaultPattern =
    /\bimport\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'`]([^"'`]+)["'`]/g;

  let defaultMatch:
    RegExpExecArray | null;

  while (
    (
      defaultMatch =
        defaultPattern.exec(
          content,
        )
    )
    !== null
  ) {
    if (
      !defaultMatch[2]
        .startsWith(
          ".",
        )
    ) {
      continue;
    }

    bindings.push({
      localName:
        defaultMatch[1],
      specifier:
        defaultMatch[2],
      line:
        lineNumberAt(
          content,
          defaultMatch.index,
        ),
      namespace:
        false,
    });
  }

  const namedPattern =
    /\bimport\s*\{([\s\S]*?)\}\s*from\s*["'`]([^"'`]+)["'`]/g;

  let namedMatch:
    RegExpExecArray | null;

  while (
    (
      namedMatch =
        namedPattern.exec(
          content,
        )
    )
    !== null
  ) {
    const specifier =
      namedMatch[2];

    if (
      !specifier.startsWith(
        ".",
      )
    ) {
      continue;
    }

    for (
      const rawPart
      of namedMatch[1]
        .split(
          ",",
        )
    ) {
      const part =
        rawPart.trim();

      if (!part) {
        continue;
      }

      const alias =
        part.match(
          /^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/,
        );

      const direct =
        part.match(
          /^([A-Za-z_$][A-Za-z0-9_$]*)$/,
        );

      const localName =
        alias
          ? alias[2]
          : direct
            ? direct[1]
            : undefined;

      if (!localName) {
        continue;
      }

      bindings.push({
        localName,
        specifier,
        line:
          lineNumberAt(
            content,
            namedMatch.index,
          ),
        namespace:
          false,
      });
    }
  }

  return bindings;
}

function dirname(
  value: string,
): string {
  const index =
    value.lastIndexOf(
      "/",
    );

  return (
    index < 0
      ? ""
      : value.slice(
          0,
          index,
        )
  );
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

  const candidates:
    string[] = [
      base,
    ];

  if (
    base.endsWith(
      ".js",
    )
  ) {
    const stem =
      base.slice(
        0,
        -3,
      );

    candidates.push(
      `${stem}.ts`,
      `${stem}.tsx`,
    );
  } else if (
    base.endsWith(
      ".jsx",
    )
  ) {
    const stem =
      base.slice(
        0,
        -4,
      );

    candidates.push(
      `${stem}.tsx`,
      `${stem}.ts`,
    );
  } else if (
    !/\.[A-Za-z0-9]+$/.test(
      base,
    )
  ) {
    candidates.push(
      `${base}.js`,
      `${base}.jsx`,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.js`,
      `${base}/index.jsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    );
  }

  return candidates.find(
    (candidate) =>
      repositoryPaths.has(
        candidate,
      ),
  );
}

function handlerReference(
  value: string,
): string | undefined {
  const trimmed =
    value.trim();

  return (
    /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(
      trimmed,
    )
      ? trimmed
      : undefined
  );
}

function routerReference(
  value: string,
): string | undefined {
  const trimmed =
    value.trim();

  const match =
    trimmed.match(
      /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)(?:\(\s*\))?$/,
    );

  return match?.[1];
}

export function extractExpressRouterMounts(
  content: string,
  path: string,
  repositoryPaths:
    readonly string[],
): BackendRouterMount[] {
  const snapshotPaths =
    new Set(
      repositoryPaths,
    );

  const bindings =
    new Map<
      string,
      ImportBinding
    >();

  for (
    const binding
    of extractImports(
      content,
    )
  ) {
    bindings.set(
      binding.localName,
      binding,
    );
  }

  const mounts:
    BackendRouterMount[] = [];

  const pattern =
    /\b(?:router|app)\.use\s*\(/g;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        pattern.exec(
          content,
        )
    )
    !== null
  ) {
    const openIndex =
      pattern.lastIndex - 1;

    const closeIndex =
      findMatchingParen(
        content,
        openIndex,
      );

    if (
      closeIndex === undefined
    ) {
      continue;
    }

    pattern.lastIndex =
      closeIndex + 1;

    const args =
      splitTopLevelArgs(
        content.slice(
          openIndex + 1,
          closeIndex,
        ),
      );

    if (
      args.length === 0
    ) {
      continue;
    }

    const explicitPath =
      stringLiteralValue(
        args[0],
      );

    const mountPath =
      explicitPath
        ?? "/";

    const candidateArgs =
      explicitPath
        ? args.slice(
            1,
          )
        : args;

    let router:
      string | undefined;

    let binding:
      ImportBinding | undefined;

    for (
      let i =
        candidateArgs.length - 1;
      i >= 0;
      i--
    ) {
      const candidate =
        routerReference(
          candidateArgs[i],
        );

      if (!candidate) {
        continue;
      }

      const root =
        candidate.split(
          ".",
        )[0];

      const candidateBinding =
        bindings.get(
          root,
        );

      if (!candidateBinding) {
        continue;
      }

      if (
        candidateBinding.namespace
        && !candidate.includes(
          ".",
        )
      ) {
        continue;
      }

      router =
        candidate;

      binding =
        candidateBinding;

      break;
    }

    if (
      !router
      || !binding
    ) {
      continue;
    }

    const importedFrom =
      resolveRelativeModule(
        path,
        binding.specifier,
        snapshotPaths,
      );

    if (!importedFrom) {
      continue;
    }

    mounts.push({
      path:
        mountPath,
      line:
        lineNumberAt(
          content,
          match.index,
        ),
      router,
      routerImportedFrom:
        importedFrom,
      routerImportLine:
        binding.line,
    });
  }

  return mounts;
}

function joinRoutePaths(
  prefix: string,
  suffix: string,
): string {
  const joined =
    [
      prefix,
      suffix,
    ]
      .join(
        "/",
      )
      .replace(
        /\/{2,}/g,
        "/",
      );

  const withLeadingSlash =
    joined.startsWith(
      "/",
    )
      ? joined
      : `/${joined}`;

  if (
    withLeadingSlash.length > 1
    && withLeadingSlash.endsWith(
      "/",
    )
  ) {
    return withLeadingSlash.slice(
      0,
      -1,
    );
  }

  return (
    withLeadingSlash
    || "/"
  );
}

export function resolveExpressRouteTree(
  files:
    readonly BackendSourceFile[],
  repositoryPaths:
    readonly string[],
  entryPaths:
    readonly string[],
): BackendResolvedRoute[] {
  const parsed =
    new Map<
      string,
      {
        routes: BackendRoute[];
        mounts: BackendRouterMount[];
      }
    >();

  for (
    const file
    of files
  ) {
    parsed.set(
      file.path,
      {
        routes:
          extractExpressRoutes(
            file.content,
            file.path,
            repositoryPaths,
          ),
        mounts:
          extractExpressRouterMounts(
            file.content,
            file.path,
            repositoryPaths,
          ),
      },
    );
  }

  const resolved:
    BackendResolvedRoute[] = [];

  function visit(
    sourcePath: string,
    prefix: string,
    mountChain:
      BackendMountStep[],
    ancestry:
      ReadonlySet<string>,
  ) {
    const current =
      parsed.get(
        sourcePath,
      );

    if (!current) {
      return;
    }

    for (
      const route
      of current.routes
    ) {
      resolved.push({
        ...route,
        sourcePath,
        fullPath:
          joinRoutePaths(
            prefix,
            route.path,
          ),
        mountChain:
          mountChain.map(
            (step) => ({
              ...step,
            }),
          ),
      });
    }

    for (
      const mount
      of current.mounts
    ) {
      const targetPath =
        mount.routerImportedFrom;

      if (
        !parsed.has(
          targetPath,
        )
      ) {
        continue;
      }

      if (
        ancestry.has(
          targetPath,
        )
      ) {
        continue;
      }

      const nextPrefix =
        joinRoutePaths(
          prefix,
          mount.path,
        );

      const nextChain = [
        ...mountChain,
        {
          sourcePath,
          path:
            mount.path,
          line:
            mount.line,
          router:
            mount.router,
          targetPath,
        },
      ];

      const nextAncestry =
        new Set(
          ancestry,
        );

      nextAncestry.add(
        targetPath,
      );

      visit(
        targetPath,
        nextPrefix,
        nextChain,
        nextAncestry,
      );
    }
  }

  for (
    const entryPath
    of entryPaths
  ) {
    if (
      !parsed.has(
        entryPath,
      )
    ) {
      continue;
    }

    visit(
      entryPath,
      "/",
      [],
      new Set([
        entryPath,
      ]),
    );
  }

  const unique =
    new Map<
      string,
      BackendResolvedRoute
    >();

  for (
    const route
    of resolved
  ) {
    const key = [
      route.method,
      route.fullPath,
      route.sourcePath,
      route.line,
    ].join(
      ":",
    );

    if (
      !unique.has(
        key,
      )
    ) {
      unique.set(
        key,
        route,
      );
    }
  }

  return [
    ...unique.values(),
  ];
}

export function extractExpressRoutes(
  content: string,
  path: string,
  repositoryPaths:
    readonly string[],
): BackendRoute[] {
  const snapshotPaths =
    new Set(
      repositoryPaths,
    );

  const bindings =
    new Map<
      string,
      ImportBinding
    >();

  for (
    const binding
    of extractImports(
      content,
    )
  ) {
    bindings.set(
      binding.localName,
      binding,
    );
  }

  const routes:
    BackendRoute[] = [];

  const pattern =
    /\b(?:router|app)\.(get|post|put|patch|delete)\s*\(/gi;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        pattern.exec(
          content,
        )
    )
    !== null
  ) {
    const openIndex =
      pattern.lastIndex - 1;

    const closeIndex =
      findMatchingParen(
        content,
        openIndex,
      );

    if (
      closeIndex === undefined
    ) {
      continue;
    }

    pattern.lastIndex =
      closeIndex + 1;

    const args =
      splitTopLevelArgs(
        content.slice(
          openIndex + 1,
          closeIndex,
        ),
      );

    if (
      args.length < 2
    ) {
      continue;
    }

    const routePath =
      stringLiteralValue(
        args[0],
      );

    if (!routePath) {
      continue;
    }

    const handler =
      handlerReference(
        args[
          args.length - 1
        ],
      );

    const method =
      match[1]
        .toUpperCase();

    if (
      method !== "GET"
      && method !== "POST"
      && method !== "PUT"
      && method !== "PATCH"
      && method !== "DELETE"
    ) {
      continue;
    }

    const route:
      BackendRoute = {
        method,
        path:
          routePath,
        line:
          lineNumberAt(
            content,
            match.index,
          ),
        ...(handler
          ? {
              handler,
            }
          : {}),
      };

    if (handler) {
      const root =
        handler.split(
          ".",
        )[0];

      const binding =
        bindings.get(
          root,
        );

      if (
        binding
        && (
          !binding.namespace
          || handler.includes(
            ".",
          )
        )
      ) {
        const importedFrom =
          resolveRelativeModule(
            path,
            binding.specifier,
            snapshotPaths,
          );

        if (importedFrom) {
          route.handlerImportedFrom =
            importedFrom;

          route.handlerImportLine =
            binding.line;
        }
      }
    }

    routes.push(
      route,
    );
  }

  return routes;
}

function evidenceKey(
  evidence:
    BackendGraphEvidence,
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
      readonly BackendGraphEvidence[]
      | undefined
    >
): BackendGraphEvidence[] {
  const merged =
    new Map<
      string,
      BackendGraphEvidence
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
          ...(evidence.line
            === undefined
            ? {}
            : {
                line:
                  evidence.line,
              }),
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

function routeNodeId(
  sourcePath: string,
  route: BackendRoute,
): string {
  return [
    "route",
    encoded(
      sourcePath,
    ),
    route.line,
    route.method,
    encoded(
      route.path,
    ),
  ].join(
    ":",
  );
}

function handlerNodeId(
  sourcePath: string,
  handler: string,
): string {
  return [
    "handler",
    encoded(
      sourcePath,
    ),
    encoded(
      handler,
    ),
  ].join(
    ":",
  );
}

function edgeId(
  kind:
    BackendGraphEdgeKind,
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

export function buildBackendGraph(
  sourcePath: string,
  routes:
    readonly BackendRoute[],
): BackendGraph {
  const nodes =
    new Map<
      string,
      BackendGraphNode
    >();

  const edges =
    new Map<
      string,
      BackendGraphEdge
    >();

  function addNode(
    node:
      BackendGraphNode,
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
    edge:
      BackendGraphEdge,
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

  const routeFileId =
    fileNodeId(
      sourcePath,
    );

  addNode({
    id:
      routeFileId,
    kind:
      "source_file",
    label:
      sourcePath,
    evidence: [
      {
        path:
          sourcePath,
      },
    ],
  });

  for (
    const route
    of routes
  ) {
    const routeId =
      routeNodeId(
        sourcePath,
        route,
      );

    const routeEvidence = [
      {
        path:
          sourcePath,
        line:
          route.line,
      },
    ];

    addNode({
      id:
        routeId,
      kind:
        "api_route",
      label:
        `${route.method} ${route.path}`,
      evidence:
        routeEvidence,
    });

    addEdge({
      id:
        edgeId(
          "declares",
          routeFileId,
          routeId,
        ),
      kind:
        "declares",
      source:
        routeFileId,
      target:
        routeId,
      evidence:
        routeEvidence,
    });

    if (!route.handler) {
      continue;
    }

    const handlerId =
      handlerNodeId(
        sourcePath,
        route.handler,
      );

    addNode({
      id:
        handlerId,
      kind:
        "handler",
      label:
        route.handler,
      evidence:
        routeEvidence,
    });

    addEdge({
      id:
        edgeId(
          "handled_by",
          routeId,
          handlerId,
        ),
      kind:
        "handled_by",
      source:
        routeId,
      target:
        handlerId,
      evidence:
        routeEvidence,
    });

    if (
      !route.handlerImportedFrom
    ) {
      continue;
    }

    const importedFileId =
      fileNodeId(
        route.handlerImportedFrom,
      );

    addNode({
      id:
        importedFileId,
      kind:
        "source_file",
      label:
        route.handlerImportedFrom,
      evidence: [
        {
          path:
            route.handlerImportedFrom,
        },
      ],
    });

    const importEvidence:
      BackendGraphEvidence[] = [
        {
          path:
            sourcePath,
          line:
            route.handlerImportLine
            ?? route.line,
        },
        {
          path:
            route.handlerImportedFrom,
        },
      ];

    addEdge({
      id:
        edgeId(
          "imports_from",
          handlerId,
          importedFileId,
        ),
      kind:
        "imports_from",
      source:
        handlerId,
      target:
        importedFileId,
      evidence:
        importEvidence,
    });
  }

  const nodeValues = [
    ...nodes.values(),
  ];

  const edgeValues = [
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
  kind:
    BackendGraphEdgeKind,
): string {
  switch (kind) {
    case "declares":
      return "declares";

    case "handled_by":
      return "handled by";

    case "imports_from":
      return "imports from";
  }
}

export function renderBackendGraphMermaid(
  graph:
    BackendGraph,
): string {
  const lines:
    string[] = [
      "flowchart LR",
    ];

  const ids =
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

      ids.set(
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
      ids.get(
        edge.source,
      );

    const target =
      ids.get(
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
