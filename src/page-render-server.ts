import type {
  RepositoryContext,
} from "./repository-context.js";

import {
  pageRenderTargetAccessFromEnv,
  type PageRenderTargetAccess,
} from "./page-render-target.js";

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
  | "render_server_target_unavailable";

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
