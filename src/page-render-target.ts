import {
  pageRenderConfigFromEnv,
} from "./page-render-policy.js";

import {
  normalizePageRenderBrowserExecutable,
  pageRenderBrowserExecutableFromEnv,
  renderPageSnapshot,
  type PageRenderSnapshot,
} from "./page-renderer.js";

export type PageRenderTarget =
  Readonly<{
    repositoryKey: string;
    origin: string;
    browserExecutablePath: string;
  }>;

export interface PageRenderTargetAccess {
  resolve(
    repositoryKey: string,
  ): Promise<PageRenderTarget | null>;
}

export type PageRenderTargetErrorCode =
  | "render_target_repository_key_invalid"
  | "render_target_configuration_incomplete"
  | "render_target_not_found";

export class PageRenderTargetError
  extends Error {
  readonly code:
    PageRenderTargetErrorCode;

  constructor(
    code:
      PageRenderTargetErrorCode,
    message: string,
  ) {
    super(
      message,
    );

    this.name =
      "PageRenderTargetError";

    this.code =
      code;
  }
}

function normalizedRepositoryKey(
  value: string,
): string {
  const key =
    value.trim();

  if (!key) {
    throw new PageRenderTargetError(
      "render_target_repository_key_invalid",
      "Page render target repository key must not be empty",
    );
  }

  return key;
}

export function createSinglePageRenderTargetAccess(
  target:
    PageRenderTarget,
): PageRenderTargetAccess {
  const repositoryKey =
    normalizedRepositoryKey(
      target.repositoryKey,
    );

  const browserExecutablePath =
    normalizePageRenderBrowserExecutable(
      target.browserExecutablePath,
    );

  if (!browserExecutablePath) {
    throw new PageRenderTargetError(
      "render_target_configuration_incomplete",
      "Page render target browser executable is missing",
    );
  }

  const normalizedTarget:
    PageRenderTarget = {
      repositoryKey,
      origin:
        target.origin,
      browserExecutablePath,
    };

  return {
    async resolve(
      requestedRepositoryKey,
    ) {
      const requestedKey =
        normalizedRepositoryKey(
          requestedRepositoryKey,
        );

      if (
        requestedKey
          !== repositoryKey
      ) {
        return null;
      }

      return normalizedTarget;
    },
  };
}

export function pageRenderTargetAccessFromEnv(
  repositoryKey: string,
  env:
    NodeJS.ProcessEnv =
      process.env,
): PageRenderTargetAccess | null {
  const config =
    pageRenderConfigFromEnv(
      env,
    );

  const browserExecutablePath =
    pageRenderBrowserExecutableFromEnv(
      env,
    );

  if (
    !config.enabled
    && !browserExecutablePath
  ) {
    return null;
  }

  if (
    !config.enabled
    || !browserExecutablePath
  ) {
    throw new PageRenderTargetError(
      "render_target_configuration_incomplete",
      "Page rendering requires both REPO_CONTEXT_RENDER_ORIGIN and REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE",
    );
  }

  return createSinglePageRenderTargetAccess({
    repositoryKey:
      normalizedRepositoryKey(
        repositoryKey,
      ),
    origin:
      config.origin,
    browserExecutablePath,
  });
}

export async function renderPageForRepository(
  access:
    PageRenderTargetAccess,
  repositoryKey: string,
  route: string,
): Promise<PageRenderSnapshot> {
  const target =
    await access.resolve(
      repositoryKey,
    );

  if (!target) {
    throw new PageRenderTargetError(
      "render_target_not_found",
      "No page render target is configured for this repository",
    );
  }

  return renderPageSnapshot({
    origin:
      target.origin,
    route,
    browserExecutablePath:
      target.browserExecutablePath,
  });
}
