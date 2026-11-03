export type PageRenderPolicyErrorCode =
  | "render_origin_invalid"
  | "render_origin_protocol_invalid"
  | "render_origin_credentials_forbidden"
  | "render_origin_must_be_origin"
  | "render_disabled"
  | "render_route_invalid"
  | "render_route_cross_origin";

export class PageRenderPolicyError extends Error {
  readonly code:
    PageRenderPolicyErrorCode;

  constructor(
    code: PageRenderPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name =
      "PageRenderPolicyError";
    this.code =
      code;
  }
}

export type PageRenderConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      origin: string;
    };

function parseUrl(
  value: string,
): URL {
  try {
    return new URL(
      value,
    );
  } catch {
    throw new PageRenderPolicyError(
      "render_origin_invalid",
      "Page render origin must be a valid absolute URL",
    );
  }
}

export function normalizePageRenderOrigin(
  value:
    string
    | undefined,
): string | undefined {
  const trimmed =
    value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const url =
    parseUrl(
      trimmed,
    );

  if (
    url.protocol !== "http:"
    && url.protocol !== "https:"
  ) {
    throw new PageRenderPolicyError(
      "render_origin_protocol_invalid",
      "Page render origin must use http or https",
    );
  }

  if (
    url.username
    || url.password
  ) {
    throw new PageRenderPolicyError(
      "render_origin_credentials_forbidden",
      "Page render origin must not contain credentials",
    );
  }

  if (
    url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new PageRenderPolicyError(
      "render_origin_must_be_origin",
      "Page render origin must contain only scheme, host and optional port",
    );
  }

  return url.origin;
}

export function pageRenderConfigFromEnv(
  env:
    NodeJS.ProcessEnv =
      process.env,
): PageRenderConfig {
  const origin =
    normalizePageRenderOrigin(
      env.REPO_CONTEXT_RENDER_ORIGIN,
    );

  if (!origin) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    origin,
  };
}

export function resolvePageRenderUrl(
  origin: string,
  route: string,
): string {
  const normalizedOrigin =
    normalizePageRenderOrigin(
      origin,
    );

  if (!normalizedOrigin) {
    throw new PageRenderPolicyError(
      "render_disabled",
      "Page rendering is not configured",
    );
  }

  const trimmed =
    route.trim();

  if (
    !trimmed
    || !trimmed.startsWith(
      "/",
    )
    || trimmed.startsWith(
      "//",
    )
    || trimmed.includes(
      "\\",
    )
    || /[\u0000-\u001f\u007f]/.test(
      trimmed,
    )
  ) {
    throw new PageRenderPolicyError(
      "render_route_invalid",
      "Page render route must be an application-local absolute path",
    );
  }

  const target =
    new URL(
      trimmed,
      `${normalizedOrigin}/`,
    );

  if (
    target.origin
      !== normalizedOrigin
  ) {
    throw new PageRenderPolicyError(
      "render_route_cross_origin",
      "Page render route resolved outside the configured origin",
    );
  }

  return target.href;
}
