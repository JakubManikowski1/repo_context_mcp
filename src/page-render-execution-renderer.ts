import type {
  PageRenderExecutionProfile,
} from "./page-render-execution-profile.js";

import {
  withPageRenderExecutionSession,
} from "./page-render-execution-session.js";

import {
  renderPageSnapshot,
  type PageRenderSnapshot,
  type RenderPageSnapshotOptions,
} from "./page-renderer.js";

import type {
  PageRenderToolRenderer,
} from "./page-render-tool.js";

export type PageRenderExecutionBinding =
  Readonly<{
    repositoryKey: string;
    profile:
      PageRenderExecutionProfile;
  }>;

export type PageRenderExecutionRendererErrorCode =
  | "render_execution_binding_invalid"
  | "render_execution_binding_duplicate"
  | "render_execution_profile_not_found";

export class PageRenderExecutionRendererError
  extends Error {
  readonly code:
    PageRenderExecutionRendererErrorCode;

  constructor(
    code:
      PageRenderExecutionRendererErrorCode,
    message: string,
  ) {
    super(
      message,
    );

    this.name =
      "PageRenderExecutionRendererError";

    this.code =
      code;
  }
}

export type RenderExecutionSnapshot =
  (
    options:
      RenderPageSnapshotOptions,
  ) => Promise<PageRenderSnapshot>;

function normalizedRepositoryKey(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !normalized
    || normalized.includes(
      "\u0000",
    )
  ) {
    throw new PageRenderExecutionRendererError(
      "render_execution_binding_invalid",
      "Page render execution binding repository key is invalid",
    );
  }

  return normalized;
}

export function createPageRenderExecutionToolRenderer(
  bindings:
    readonly PageRenderExecutionBinding[],
  browserExecutablePath: string,
  renderSnapshot:
    RenderExecutionSnapshot =
      renderPageSnapshot,
):
  PageRenderToolRenderer {
  const profilesByRepositoryKey =
    new Map<
      string,
      PageRenderExecutionProfile
    >();

  for (
    const binding
    of bindings
  ) {
    const repositoryKey =
      normalizedRepositoryKey(
        binding.repositoryKey,
      );

    if (
      profilesByRepositoryKey.has(
        repositoryKey,
      )
    ) {
      throw new PageRenderExecutionRendererError(
        "render_execution_binding_duplicate",
        `Duplicate page render execution binding for repository key ${repositoryKey}`,
      );
    }

    profilesByRepositoryKey.set(
      repositoryKey,
      binding.profile,
    );
  }

  return {
    async render(
      repositoryKey,
      route,
    ) {
      const normalizedKey =
        normalizedRepositoryKey(
          repositoryKey,
        );

      const profile =
        profilesByRepositoryKey.get(
          normalizedKey,
        );

      if (
        !profile
      ) {
        throw new PageRenderExecutionRendererError(
          "render_execution_profile_not_found",
          "No trusted page render execution profile is configured for this repository",
        );
      }

      return withPageRenderExecutionSession(
        {
          profile,
          repositoryKey:
            normalizedKey,
          browserExecutablePath,
        },
        async (
          target,
        ) =>
          renderSnapshot({
            origin:
              target.origin,
            route,
            browserExecutablePath:
              target.browserExecutablePath,
          }),
      );
    },
  };
}
