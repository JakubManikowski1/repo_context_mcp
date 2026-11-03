import type {
  BackendResolvedRoute,
  BackendSourceFile,
} from "./backend-graph.js";

import type {
  UiFlowFile,
  UiHttpMethod,
} from "./ui-graph.js";

export type UiApiCallReference = {
  sourcePath: string;
  line: number;
  target: string;
  method?: UiHttpMethod;
};

export type UiBackendRouteLink = {
  ui: UiApiCallReference;
  backend: BackendResolvedRoute;
};

function normalizePath(
  value: string,
): string | undefined {
  const trimmed =
    value.trim();

  if (
    !trimmed.startsWith(
      "/",
    )
  ) {
    return undefined;
  }

  const withoutQuery =
    trimmed
      .split(
        "?",
        1,
      )[0]
      .split(
        "#",
        1,
      )[0];

  if (
    !withoutQuery
  ) {
    return "/";
  }

  const collapsed =
    withoutQuery.replace(
      /\/{2,}/g,
      "/",
    );

  if (
    collapsed.length > 1
    && collapsed.endsWith(
      "/",
    )
  ) {
    return collapsed.slice(
      0,
      -1,
    );
  }

  return collapsed;
}

function pathSegments(
  value: string,
): string[] {
  if (
    value === "/"
  ) {
    return [];
  }

  return value
    .split(
      "/",
    )
    .filter(
      Boolean,
    );
}

function routePathMatches(
  uiPath: string,
  backendPath: string,
): boolean {
  const uiSegments =
    pathSegments(
      uiPath,
    );

  const backendSegments =
    pathSegments(
      backendPath,
    );

  if (
    uiSegments.length
    !== backendSegments.length
  ) {
    return false;
  }

  for (
    let i = 0;
    i < uiSegments.length;
    i++
  ) {
    const uiSegment =
      uiSegments[i];

    const backendSegment =
      backendSegments[i];

    if (
      backendSegment.startsWith(
        ":",
      )
    ) {
      if (!uiSegment) {
        return false;
      }

      continue;
    }

    if (
      uiSegment !== backendSegment
    ) {
      return false;
    }
  }

  return true;
}

export function collectUiApiCalls(
  files:
    readonly UiFlowFile[],
): UiApiCallReference[] {
  const calls:
    UiApiCallReference[] = [];

  for (
    const file
    of files
  ) {
    for (
      const event
      of file.events
    ) {
      if (
        event.type
          !== "api_call"
        || !event.target
      ) {
        continue;
      }

      calls.push({
        sourcePath:
          file.path,
        line:
          event.line,
        target:
          event.target,
        ...(
          event.method
            ? {
                method:
                  event.method,
              }
            : {}
        ),
      });
    }
  }

  return calls;
}

export function matchUiApiCallsToBackend(
  files:
    readonly UiFlowFile[],
  backendRoutes:
    readonly BackendResolvedRoute[],
): UiBackendRouteLink[] {
  const links:
    UiBackendRouteLink[] = [];

  for (
    const ui
    of collectUiApiCalls(
      files,
    )
  ) {
    const uiPath =
      normalizePath(
        ui.target,
      );

    if (!uiPath) {
      continue;
    }

    const pathCandidates =
      backendRoutes.filter(
        (route) => {
          const backendPath =
            normalizePath(
              route.fullPath,
            );

          return (
            backendPath
            !== undefined
            && routePathMatches(
              uiPath,
              backendPath,
            )
          );
        },
      );

    if (
      pathCandidates.length === 0
    ) {
      continue;
    }

    let matches:
      BackendResolvedRoute[];

    if (ui.method) {
      matches =
        pathCandidates.filter(
          (route) =>
            route.method
              === ui.method,
        );
    } else {
      matches =
        pathCandidates;
    }

    if (
      matches.length !== 1
    ) {
      continue;
    }

    links.push({
      ui,
      backend:
        matches[0],
    });
  }

  return links;
}


export type BackendDbCollectionEvidence = {
  path: string;
  line: number;
};

export type BackendDbCollectionLink = {
  route: BackendResolvedRoute;
  handler: string;
  controllerPath: string;
  servicePath: string;
  serviceFunction: string;
  collection: string;
  evidence: BackendDbCollectionEvidence[];
};

type ProcessImportBinding = {
  localName: string;
  importedName?: string;
  specifier: string;
  line: number;
  memberContainer: boolean;
};

type FunctionSpan = {
  body: string;
  bodyStartIndex: number;
};

function processLineNumberAt(
  content: string,
  index: number,
): number {
  return content
    .slice(
      0,
      index,
    )
    .split(
      /\r?\n/,
    )
    .length;
}

function escapeRegExp(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function findMatchingBrace(
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
    const char = content[i];
    const next = content[i + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (
        char === "*"
        && next === "/"
      ) {
        blockComment = false;
        i++;
      }

      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (
      char === "/"
      && next === "/"
    ) {
      lineComment = true;
      i++;
      continue;
    }

    if (
      char === "/"
      && next === "*"
    ) {
      blockComment = true;
      i++;
      continue;
    }

    if (
      char === "'"
      || char === '"'
      || char === "`"
    ) {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth++;
      continue;
    }

    if (char === "}") {
      depth--;

      if (depth === 0) {
        return i;
      }
    }
  }

  return undefined;
}

function findNamedFunction(
  content: string,
  name: string,
): FunctionSpan | undefined {
  const escapedName =
    escapeRegExp(
      name,
    );

  const patterns = [
    new RegExp(
      `\\b(?:export\\s+)?const\\s+${escapedName}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][A-Za-z0-9_$]*)\\s*=>\\s*\\{`,
      "m",
    ),
    new RegExp(
      `\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\s*\\([^)]*\\)\\s*\\{`,
      "m",
    ),
  ];

  for (const pattern of patterns) {
    const match =
      pattern.exec(
        content,
      );

    if (!match) {
      continue;
    }

    const relativeOpen =
      match[0]
        .lastIndexOf(
          "{",
        );

    if (relativeOpen < 0) {
      continue;
    }

    const openIndex =
      match.index
      + relativeOpen;

    const closeIndex =
      findMatchingBrace(
        content,
        openIndex,
      );

    if (closeIndex === undefined) {
      continue;
    }

    return {
      body:
        content.slice(
          openIndex + 1,
          closeIndex,
        ),
      bodyStartIndex:
        openIndex + 1,
    };
  }

  return undefined;
}

function processImports(
  content: string,
): ProcessImportBinding[] {
  const bindings:
    ProcessImportBinding[] = [];

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
    bindings.push({
      localName:
        namespaceMatch[1],
      specifier:
        namespaceMatch[2],
      line:
        processLineNumberAt(
          content,
          namespaceMatch.index,
        ),
      memberContainer:
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
    bindings.push({
      localName:
        defaultMatch[1],
      specifier:
        defaultMatch[2],
      line:
        processLineNumberAt(
          content,
          defaultMatch.index,
        ),
      memberContainer:
        true,
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

      const importedName =
        alias
          ? alias[1]
          : direct
            ? direct[1]
            : undefined;

      const localName =
        alias
          ? alias[2]
          : direct
            ? direct[1]
            : undefined;

      if (
        !importedName
        || !localName
      ) {
        continue;
      }

      bindings.push({
        localName,
        importedName,
        specifier:
          namedMatch[2],
        line:
          processLineNumberAt(
            content,
            namedMatch.index,
          ),
        memberContainer:
          false,
      });
    }
  }

  return bindings;
}

function processDirname(
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

function normalizeProcessRepoPath(
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

    if (part === "..") {
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

function resolveProcessModule(
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
    normalizeProcessRepoPath(
      [
        processDirname(
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

  if (base.endsWith(".js")) {
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

type ImportedFunctionCall = {
  servicePath: string;
  serviceFunction: string;
  line: number;
};

type ReExportedFunction = {
  servicePath: string;
  serviceFunction: string;
  line: number;
};

function reExportedFunction(
  content: string,
  sourcePath: string,
  exportedName: string,
  repositoryPaths:
    ReadonlySet<string>,
): ReExportedFunction | undefined {
  const pattern =
    /\bexport\s*\{([\s\S]*?)\}\s*from\s*["'`]([^"'`]+)["'`]/g;

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
    const targetPath =
      resolveProcessModule(
        sourcePath,
        match[2],
        repositoryPaths,
      );

    if (!targetPath) {
      continue;
    }

    for (
      const rawPart
      of match[1]
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

      const serviceFunction =
        alias
          ? alias[1]
          : direct
            ? direct[1]
            : undefined;

      const visibleName =
        alias
          ? alias[2]
          : direct
            ? direct[1]
            : undefined;

      if (
        !serviceFunction
        || visibleName
          !== exportedName
      ) {
        continue;
      }

      return {
        servicePath:
          targetPath,
        serviceFunction,
        line:
          processLineNumberAt(
            content,
            match.index,
          ),
      };
    }
  }

  return undefined;
}

function importedCallsFromFunction(
  content: string,
  sourcePath: string,
  functionName: string,
  repositoryPaths:
    ReadonlySet<string>,
): ImportedFunctionCall[] {
  const span =
    findNamedFunction(
      content,
      functionName,
    );

  if (!span) {
    return [];
  }

  const calls:
    ImportedFunctionCall[] = [];

  for (
    const binding
    of processImports(
      content,
    )
  ) {
    const servicePath =
      resolveProcessModule(
        sourcePath,
        binding.specifier,
        repositoryPaths,
      );

    if (!servicePath) {
      continue;
    }

    if (
      binding.memberContainer
    ) {
      const pattern =
        new RegExp(
          `\\b${escapeRegExp(
            binding.localName,
          )}\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(`,
          "g",
        );

      let match:
        RegExpExecArray | null;

      while (
        (
          match =
            pattern.exec(
              span.body,
            )
        )
        !== null
      ) {
        calls.push({
          servicePath,
          serviceFunction:
            match[1],
          line:
            processLineNumberAt(
              content,
              span.bodyStartIndex
              + match.index,
            ),
        });
      }

      continue;
    }

    const pattern =
      new RegExp(
        `\\b${escapeRegExp(
          binding.localName,
        )}\\s*\\(`,
        "g",
      );

    let match:
      RegExpExecArray | null;

    while (
      (
        match =
          pattern.exec(
            span.body,
          )
      )
      !== null
    ) {
      calls.push({
        servicePath,
        serviceFunction:
          binding.importedName
          ?? binding.localName,
        line:
          processLineNumberAt(
            content,
            span.bodyStartIndex
            + match.index,
          ),
      });
    }
  }

  return calls;
}

type FunctionCollectionAccess = {
  collection: string;
  line: number;
};

function directPocketBaseCollections(
  content: string,
  functionName: string,
): FunctionCollectionAccess[] {
  const span =
    findNamedFunction(
      content,
      functionName,
    );

  if (!span) {
    return [];
  }

  const accesses:
    FunctionCollectionAccess[] = [];

  const pattern =
    /\b(?:pb|userAuthPb)\.collection\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        pattern.exec(
          span.body,
        )
    )
    !== null
  ) {
    accesses.push({
      collection:
        match[1],
      line:
        processLineNumberAt(
          content,
          span.bodyStartIndex
          + match.index,
        ),
    });
  }

  return accesses;
}

function addDbEvidence(
  target:
    BackendDbCollectionEvidence[],
  evidence:
    BackendDbCollectionEvidence,
) {
  if (
    target.some(
      (existing) =>
        existing.path
          === evidence.path
        && existing.line
          === evidence.line,
    )
  ) {
    return;
  }

  target.push(
    evidence,
  );
}

export function linkBackendRoutesToDirectDbCollections(
  routes:
    readonly BackendResolvedRoute[],
  files:
    readonly BackendSourceFile[],
  repositoryPaths:
    readonly string[] = files.map(
      (file) =>
        file.path,
    ),
): BackendDbCollectionLink[] {
  const filesByPath =
    new Map(
      files.map(
        (file) => [
          file.path,
          file.content,
        ],
      ),
    );

  const snapshotPaths =
    new Set(
      repositoryPaths,
    );

  const links =
    new Map<
      string,
      BackendDbCollectionLink
    >();

  for (
    const route
    of routes
  ) {
    if (
      !route.handler
      || !route.handlerImportedFrom
    ) {
      continue;
    }

    const controllerPath =
      route.handlerImportedFrom;

    const controllerContent =
      filesByPath.get(
        controllerPath,
      );

    if (!controllerContent) {
      continue;
    }

    const handlerName =
      route.handler
        .split(
          ".",
        )
        .at(
          -1,
        );

    if (!handlerName) {
      continue;
    }

    const calls =
      importedCallsFromFunction(
        controllerContent,
        controllerPath,
        handlerName,
        snapshotPaths,
      );

    for (const call of calls) {
      let servicePath =
        call.servicePath;

      let serviceFunction =
        call.serviceFunction;

      let serviceContent =
        filesByPath.get(
          servicePath,
        );

      if (!serviceContent) {
        continue;
      }

      let collections =
        directPocketBaseCollections(
          serviceContent,
          serviceFunction,
        );

      let reExportEvidence:
        BackendDbCollectionEvidence
        | undefined;

      if (
        collections.length === 0
      ) {
        const reExport =
          reExportedFunction(
            serviceContent,
            servicePath,
            serviceFunction,
            snapshotPaths,
          );

        if (reExport) {
          const resolvedContent =
            filesByPath.get(
              reExport.servicePath,
            );

          if (resolvedContent) {
            const resolvedCollections =
              directPocketBaseCollections(
                resolvedContent,
                reExport.serviceFunction,
              );

            if (
              resolvedCollections.length
                > 0
            ) {
              reExportEvidence = {
                path:
                  servicePath,
                line:
                  reExport.line,
              };

              servicePath =
                reExport.servicePath;

              serviceFunction =
                reExport.serviceFunction;

              serviceContent =
                resolvedContent;

              collections =
                resolvedCollections;
            }
          }
        }
      }

      for (
        const access
        of collections
      ) {
        const key = [
          route.method,
          route.fullPath,
          route.sourcePath,
          route.line,
          controllerPath,
          servicePath,
          serviceFunction,
          access.collection,
        ].join(
          "|",
        );

        let link =
          links.get(
            key,
          );

        if (!link) {
          link = {
            route,
            handler:
              route.handler,
            controllerPath,
            servicePath,
            serviceFunction,
            collection:
              access.collection,
            evidence: [],
          };

          links.set(
            key,
            link,
          );
        }

        addDbEvidence(
          link.evidence,
          {
            path:
              route.sourcePath,
            line:
              route.line,
          },
        );

        addDbEvidence(
          link.evidence,
          {
            path:
              controllerPath,
            line:
              call.line,
          },
        );

        if (
          reExportEvidence
        ) {
          addDbEvidence(
            link.evidence,
            reExportEvidence,
          );
        }

        addDbEvidence(
          link.evidence,
          {
            path:
              servicePath,
            line:
              access.line,
          },
        );
      }
    }
  }

  return [
    ...links.values(),
  ];
}


export type ProcessGraphNodeKind =
  | "ui_source"
  | "api_route"
  | "handler"
  | "service_function"
  | "db_collection";

export type ProcessGraphEdgeKind =
  | "calls_api"
  | "handled_by"
  | "calls_service"
  | "accesses_collection";

export type ProcessGraphNode = {
  id: string;
  kind: ProcessGraphNodeKind;
  label: string;
  path?: string;
  line?: number;
};

export type ProcessGraphEdge = {
  from: string;
  to: string;
  kind: ProcessGraphEdgeKind;
  evidence: BackendDbCollectionEvidence[];
};

export type ProcessGraph = {
  nodes: ProcessGraphNode[];
  edges: ProcessGraphEdge[];
};

function processRouteNodeId(
  route: BackendResolvedRoute,
): string {
  return [
    "route",
    route.method,
    route.fullPath,
    route.sourcePath,
    route.line,
  ].join(
    ":",
  );
}

function processHandlerNodeId(
  path: string,
  handler: string,
): string {
  return [
    "handler",
    path,
    handler,
  ].join(
    ":",
  );
}

function processServiceNodeId(
  path: string,
  serviceFunction: string,
): string {
  return [
    "service",
    path,
    serviceFunction,
  ].join(
    ":",
  );
}

function processCollectionNodeId(
  collection: string,
): string {
  return [
    "db",
    collection,
  ].join(
    ":",
  );
}

function processUiNodeId(
  ui: UiApiCallReference,
): string {
  return [
    "ui",
    ui.sourcePath,
    ui.line,
  ].join(
    ":",
  );
}

function processPushEvidence(
  target:
    BackendDbCollectionEvidence[],
  evidence:
    readonly BackendDbCollectionEvidence[],
) {
  for (
    const item
    of evidence
  ) {
    if (
      target.some(
        (existing) =>
          existing.path
            === item.path
          && existing.line
            === item.line,
      )
    ) {
      continue;
    }

    target.push({
      path:
        item.path,
      line:
        item.line,
    });
  }
}

export function buildProcessGraph(
  uiLinks:
    readonly UiBackendRouteLink[],
  dbLinks:
    readonly BackendDbCollectionLink[],
): ProcessGraph {
  const nodes =
    new Map<
      string,
      ProcessGraphNode
    >();

  const edges =
    new Map<
      string,
      ProcessGraphEdge
    >();

  const addNode = (
    node: ProcessGraphNode,
  ) => {
    if (
      !nodes.has(
        node.id,
      )
    ) {
      nodes.set(
        node.id,
        node,
      );
    }
  };

  const addEdge = (
    from: string,
    to: string,
    kind: ProcessGraphEdgeKind,
    evidence:
      readonly BackendDbCollectionEvidence[],
  ) => {
    const key =
      [
        from,
        kind,
        to,
      ].join(
        "|",
      );

    let edge =
      edges.get(
        key,
      );

    if (!edge) {
      edge = {
        from,
        to,
        kind,
        evidence: [],
      };

      edges.set(
        key,
        edge,
      );
    }

    processPushEvidence(
      edge.evidence,
      evidence,
    );
  };

  const addRouteAndHandler = (
    route: BackendResolvedRoute,
  ) => {
    const routeId =
      processRouteNodeId(
        route,
      );

    addNode({
      id:
        routeId,
      kind:
        "api_route",
      label:
        `${route.method} ${route.fullPath}`,
      path:
        route.sourcePath,
      line:
        route.line,
    });

    if (
      !route.handler
      || !route.handlerImportedFrom
    ) {
      return {
        routeId,
        handlerId:
          undefined,
      };
    }

    const handlerId =
      processHandlerNodeId(
        route.handlerImportedFrom,
        route.handler,
      );

    addNode({
      id:
        handlerId,
      kind:
        "handler",
      label:
        route.handler,
      path:
        route.handlerImportedFrom,
      line:
        route.handlerImportLine,
    });

    const evidence:
      BackendDbCollectionEvidence[] = [
        {
          path:
            route.sourcePath,
          line:
            route.line,
        },
      ];

    if (
      route.handlerImportLine
        !== undefined
    ) {
      evidence.push({
        path:
          route.handlerImportedFrom,
        line:
          route.handlerImportLine,
      });
    }

    addEdge(
      routeId,
      handlerId,
      "handled_by",
      evidence,
    );

    return {
      routeId,
      handlerId,
    };
  };

  for (
    const link
    of uiLinks
  ) {
    const uiId =
      processUiNodeId(
        link.ui,
      );

    addNode({
      id:
        uiId,
      kind:
        "ui_source",
      label:
        `${link.ui.sourcePath}:${link.ui.line}`,
      path:
        link.ui.sourcePath,
      line:
        link.ui.line,
    });

    const {
      routeId,
    } =
      addRouteAndHandler(
        link.backend,
      );

    addEdge(
      uiId,
      routeId,
      "calls_api",
      [
        {
          path:
            link.ui.sourcePath,
          line:
            link.ui.line,
        },
        {
          path:
            link.backend.sourcePath,
          line:
            link.backend.line,
        },
      ],
    );
  }

  for (
    const link
    of dbLinks
  ) {
    const {
      handlerId,
    } =
      addRouteAndHandler(
        link.route,
      );

    if (!handlerId) {
      continue;
    }

    const serviceId =
      processServiceNodeId(
        link.servicePath,
        link.serviceFunction,
      );

    const collectionId =
      processCollectionNodeId(
        link.collection,
      );

    addNode({
      id:
        serviceId,
      kind:
        "service_function",
      label:
        link.serviceFunction,
      path:
        link.servicePath,
    });

    addNode({
      id:
        collectionId,
      kind:
        "db_collection",
      label:
        link.collection,
    });

    const handlerEvidence =
      link.evidence.filter(
        (item) =>
          item.path
            === link.controllerPath
          || (
            item.path
              !== link.route.sourcePath
            && item.path
              !== link.servicePath
          ),
      );

    const collectionEvidence =
      link.evidence.filter(
        (item) =>
          item.path
            === link.servicePath,
      );

    addEdge(
      handlerId,
      serviceId,
      "calls_service",
      handlerEvidence,
    );

    addEdge(
      serviceId,
      collectionId,
      "accesses_collection",
      collectionEvidence,
    );
  }

  return {
    nodes:
      [
        ...nodes.values(),
      ],
    edges:
      [
        ...edges.values(),
      ],
  };
}

function processMermaidLabel(
  value: string,
): string {
  return value
    .replace(
      /\\/g,
      "\\\\",
    )
    .replace(
      /"/g,
      '\"',
    )
    .replace(
      /\r?\n/g,
      " ",
    );
}

function processEdgeLabel(
  kind: ProcessGraphEdgeKind,
): string {
  switch (kind) {
    case "calls_api":
      return "calls API";

    case "handled_by":
      return "handled by";

    case "calls_service":
      return "calls";

    case "accesses_collection":
      return "accesses";
  }
}

function processNodeLabel(
  node: ProcessGraphNode,
): string {
  switch (node.kind) {
    case "ui_source":
      return `UI: ${node.label}`;

    case "api_route":
      return `API: ${node.label}`;

    case "handler":
      return `Handler: ${node.label}`;

    case "service_function":
      return `Service: ${node.label}`;

    case "db_collection":
      return `DB: ${node.label}`;
  }
}

export function renderProcessGraphMermaid(
  graph: ProcessGraph,
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
        `n${index + 1}`;

      mermaidIds.set(
        node.id,
        id,
      );

      lines.push(
        `  ${id}["${processMermaidLabel(
          processNodeLabel(
            node,
          ),
        )}"]`,
      );
    },
  );

  for (
    const edge
    of graph.edges
  ) {
    const from =
      mermaidIds.get(
        edge.from,
      );

    const to =
      mermaidIds.get(
        edge.to,
      );

    if (
      !from
      || !to
    ) {
      continue;
    }

    lines.push(
      `  ${from} -->|${processEdgeLabel(
        edge.kind,
      )}| ${to}`,
    );
  }

  return lines.join(
    "\n",
  );
}
