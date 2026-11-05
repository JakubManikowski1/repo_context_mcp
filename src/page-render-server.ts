import type {
  RepositoryContext,
} from "./repository-context.js";

import {
  pageRenderTargetAccessFromEnv,
  type PageRenderTargetAccess,
} from "./page-render-target.js";

import {
  pageRenderBrowserExecutableFromEnv,
} from "./page-renderer.js";

import {
  loadPageRenderExecutionProfiles,
} from "./page-render-execution-profile.js";

import {
  createPageRenderExecutionToolRenderer,
} from "./page-render-execution-renderer.js";

import type {
  PageRenderExecutionBinding,
} from "./page-render-execution-renderer.js";

import {
  staticRepositoryKey,
  type StaticRepositoryDefinition,
} from "./static-repository-registry.js";

import type {
  PageRenderToolRenderer,
} from "./page-render-tool.js";

export type PageRenderServerMode =
  | "legacy"
  | "oauth";

export type PageRenderServerBinding =
  | Readonly<{
      enabled: false;
    }>
  | Readonly<{
      enabled: true;
      kind: "legacy";
    }>
  | Readonly<{
      enabled: true;
      kind: "connection";
      repositoryId: string;
    }>;

export type PageRenderServerConfigErrorCode =
  | "render_server_configuration_incomplete"
  | "render_server_repository_id_required"
  | "render_server_repository_id_forbidden"
  | "render_server_legacy_repository_missing"
  | "render_server_target_unavailable"
  | "render_server_execution_registry_required"
  | "render_server_execution_browser_required"
  | "render_server_execution_configuration_conflict"
  | "render_server_execution_repository_unknown";

export class PageRenderServerConfigError
  extends Error {
  readonly code:
    PageRenderServerConfigErrorCode;

  constructor(
    code:
      PageRenderServerConfigErrorCode,
    message: string,
  ) {
    super(
      message,
    );

    this.name =
      "PageRenderServerConfigError";

    this.code =
      code;
  }
}

function optionalEnv(
  env:
    NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value =
    env[name]?.trim();

  return value
    ? value
    : undefined;
}

export type StaticPageRenderExecutionConfig =
  Readonly<{
    bindings:
      readonly PageRenderExecutionBinding[];

    browserExecutablePath:
      string;
  }>;

export function staticPageRenderExecutionConfigFromEnv(
  definitions:
    readonly StaticRepositoryDefinition[]
    | null,
  env:
    NodeJS.ProcessEnv =
      process.env,
):
  StaticPageRenderExecutionConfig | null {
  const profilesFile =
    optionalEnv(
      env,
      "REPO_CONTEXT_RENDER_PROFILES_FILE",
    );

  if (
    !profilesFile
  ) {
    return null;
  }

  if (
    !definitions
  ) {
    throw new PageRenderServerConfigError(
      "render_server_execution_registry_required",
      "Page render execution profiles require a static repository registry",
    );
  }

  if (
    optionalEnv(
      env,
      "REPO_CONTEXT_RENDER_ORIGIN",
    )
    || optionalEnv(
      env,
      "REPO_CONTEXT_RENDER_REPOSITORY_ID",
    )
  ) {
    throw new PageRenderServerConfigError(
      "render_server_execution_configuration_conflict",
      "Page render execution profiles cannot be combined with legacy render origin or repository-id configuration",
    );
  }

  const browserExecutablePath =
    pageRenderBrowserExecutableFromEnv(
      env,
    );

  if (
    !browserExecutablePath
  ) {
    throw new PageRenderServerConfigError(
      "render_server_execution_browser_required",
      "Page render execution profiles require REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE",
    );
  }

  const definitionsById =
    new Map(
      definitions.map(
        (
          definition,
        ) => [
          definition.id,
          definition,
        ] as const,
      ),
    );

  const profiles =
    loadPageRenderExecutionProfiles(
      profilesFile,
    );

  const bindings:
    PageRenderExecutionBinding[] =
      profiles.map(
        (
          profile,
        ) => {
          const definition =
            definitionsById.get(
              profile.repositoryId,
            );

          if (
            !definition
          ) {
            throw new PageRenderServerConfigError(
              "render_server_execution_repository_unknown",
              `Page render execution profile references unknown repository ${profile.repositoryId}`,
            );
          }

          return {
            repositoryKey:
              staticRepositoryKey(
                definition,
              ),
            profile,
          };
        },
      );

  return {
    bindings,
    browserExecutablePath,
  };
}

export function staticPageRenderExecutionToolRendererFromEnv(
  definitions:
    readonly StaticRepositoryDefinition[]
    | null,
  env:
    NodeJS.ProcessEnv =
      process.env,
):
  PageRenderToolRenderer | null {
  const config =
    staticPageRenderExecutionConfigFromEnv(
      definitions,
      env,
    );

  if (!config) {
    return null;
  }

  return createPageRenderExecutionToolRenderer(
    config.bindings,
    config.browserExecutablePath,
  );
}

export function pageRenderServerBindingFromEnv(
  mode:
    PageRenderServerMode,
  env:
    NodeJS.ProcessEnv =
      process.env,
): PageRenderServerBinding {
  const origin =
    optionalEnv(
      env,
      "REPO_CONTEXT_RENDER_ORIGIN",
    );

  const browserExecutable =
    optionalEnv(
      env,
      "REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE",
    );

  const repositoryId =
    optionalEnv(
      env,
      "REPO_CONTEXT_RENDER_REPOSITORY_ID",
    );

  if (
    !origin
    && !browserExecutable
    && !repositoryId
  ) {
    return {
      enabled:
        false,
    };
  }

  if (
    !origin
    || !browserExecutable
  ) {
    throw new PageRenderServerConfigError(
      "render_server_configuration_incomplete",
      "Page rendering requires both REPO_CONTEXT_RENDER_ORIGIN and REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE",
    );
  }

  if (
    mode === "legacy"
  ) {
    if (repositoryId) {
      throw new PageRenderServerConfigError(
        "render_server_repository_id_forbidden",
        "REPO_CONTEXT_RENDER_REPOSITORY_ID must not be set in legacy mode",
      );
    }

    return {
      enabled:
        true,
      kind:
        "legacy",
    };
  }

  if (!repositoryId) {
    throw new PageRenderServerConfigError(
      "render_server_repository_id_required",
      "OAuth page rendering requires REPO_CONTEXT_RENDER_REPOSITORY_ID",
    );
  }

  return {
    enabled:
      true,
    kind:
      "connection",
    repositoryId,
  };
}

export function pageRenderTargetAccessForRequest(
  binding:
    PageRenderServerBinding,
  legacyRepository:
    RepositoryContext | null,
  env:
    NodeJS.ProcessEnv =
      process.env,
): PageRenderTargetAccess | null {
  if (!binding.enabled) {
    return null;
  }

  let repositoryKey:
    string;

  if (
    binding.kind
      === "legacy"
  ) {
    if (!legacyRepository) {
      throw new PageRenderServerConfigError(
        "render_server_legacy_repository_missing",
        "Legacy page rendering requires the legacy repository context",
      );
    }

    repositoryKey =
      legacyRepository.key;
  } else {
    repositoryKey =
      `connection:${binding.repositoryId}`;
  }

  const access =
    pageRenderTargetAccessFromEnv(
      repositoryKey,
      env,
    );

  if (!access) {
    throw new PageRenderServerConfigError(
      "render_server_target_unavailable",
      "Page render target configuration is unavailable",
    );
  }

  return access;
}
