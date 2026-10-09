import type {
  BackendResolvedRoute,
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
