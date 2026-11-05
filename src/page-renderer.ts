import {
  isAbsolute,
} from "node:path";

import {
  chromium,
  type Browser,
  type Page,
} from "playwright-core";

import {
  normalizePageRenderOrigin,
  resolvePageRenderUrl,
} from "./page-render-policy.js";

const VIEWPORT_WIDTH =
  1280;

const VIEWPORT_HEIGHT =
  720;

const NAVIGATION_TIMEOUT_MS =
  10_000;

const SETTLE_MS =
  300;

const MAX_TEXT_CHARS =
  20_000;

const MAX_ELEMENTS =
  120;

const MAX_SCREENSHOT_BYTES =
  1_500_000;

const MAX_BLOCKED_ORIGINS =
  20;

export type PageRenderBrowserErrorCode =
  | "render_browser_executable_invalid"
  | "render_browser_executable_not_absolute"
  | "render_browser_launch_failed"
  | "render_browser_session_closed"
  | "render_navigation_failed"
  | "render_navigation_cross_origin";

export class PageRenderBrowserError
  extends Error {
  readonly code:
    PageRenderBrowserErrorCode;

  constructor(
    code:
      PageRenderBrowserErrorCode,
    message: string,
  ) {
    super(
      message,
    );

    this.name =
      "PageRenderBrowserError";

    this.code =
      code;
  }
}

export type PageRenderElement =
  Readonly<{
    tag: string;
    role?: string;
    text?: string;
    type?: string;
    name?: string;
    placeholder?: string;
    ariaLabel?: string;
  }>;

export type PageRenderScreenshot =
  Readonly<{
    mimeType:
      "image/jpeg";
    data: string;
  }>;

export type PageRenderSnapshot =
  Readonly<{
    requestedUrl: string;
    finalUrl: string;
    status:
      number | null;
    title: string;
    viewport:
      Readonly<{
        width: number;
        height: number;
      }>;
    text: string;
    textTruncated: boolean;
    elements:
      readonly PageRenderElement[];
    elementsTruncated: boolean;
    screenshot?:
      PageRenderScreenshot;
    warnings:
      readonly string[];
  }>;

export type RenderPageSnapshotOptions =
  Readonly<{
    origin: string;
    route: string;
    browserExecutablePath: string;
  }>;

export type StartPageRenderBrowserSessionOptions =
  Readonly<{
    origin: string;
    browserExecutablePath: string;
  }>;

export interface PageRenderBrowserSession {
  readonly origin: string;

  render(
    route: string,
  ): Promise<PageRenderSnapshot>;

  close(): Promise<void>;
}

type PageRenderBrowserNetworkState = {
  blockedNavigationUrl?:
    string;
};

type PageRenderBrowserState =
  Readonly<{
    browser: Browser;
    page: Page;
    blockedResourceOrigins:
      Set<string>;
    blockedWebSocketOrigins:
      Set<string>;
    networkState:
      PageRenderBrowserNetworkState;
  }>;

type PageRenderBrowserLauncher =
  typeof chromium.launch;

export function normalizePageRenderBrowserExecutable(
  value:
    string | undefined,
): string | undefined {
  const trimmed =
    value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (
    trimmed.includes(
      "\u0000",
    )
  ) {
    throw new PageRenderBrowserError(
      "render_browser_executable_invalid",
      "Page render browser executable path is invalid",
    );
  }

  if (
    !isAbsolute(
      trimmed,
    )
  ) {
    throw new PageRenderBrowserError(
      "render_browser_executable_not_absolute",
      "Page render browser executable must be an absolute path",
    );
  }

  return trimmed;
}

export function pageRenderBrowserExecutableFromEnv(
  env:
    NodeJS.ProcessEnv =
      process.env,
): string | undefined {
  return normalizePageRenderBrowserExecutable(
    env.REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE,
  );
}

export function pageRenderNetworkUrlAllowed(
  origin: string,
  value: string,
): boolean {
  const normalizedOrigin =
    normalizePageRenderOrigin(
      origin,
    );

  if (!normalizedOrigin) {
    return false;
  }

  let url:
    URL;

  try {
    url =
      new URL(
        value,
      );
  } catch {
    return false;
  }

  if (
    url.protocol === "data:"
    || url.protocol === "about:"
  ) {
    return true;
  }

  if (
    url.protocol === "blob:"
  ) {
    return (
      url.origin
        === normalizedOrigin
    );
  }

  if (
    url.protocol === "http:"
    || url.protocol === "https:"
  ) {
    return (
      url.origin
        === normalizedOrigin
    );
  }

  if (
    url.protocol === "ws:"
    || url.protocol === "wss:"
  ) {
    const httpUrl =
      new URL(
        url.href,
      );

    httpUrl.protocol =
      url.protocol === "ws:"
        ? "http:"
        : "https:";

    return (
      httpUrl.origin
        === normalizedOrigin
    );
  }

  return false;
}

function pageRenderNetworkOrigin(
  value: string,
): string {
  try {
    const url =
      new URL(
        value,
      );

    if (
      url.protocol === "ws:"
      || url.protocol === "wss:"
    ) {
      const httpUrl =
        new URL(
          url.href,
        );

      httpUrl.protocol =
        url.protocol === "ws:"
          ? "http:"
          : "https:";

      return httpUrl.origin;
    }

    if (
      url.origin
      && url.origin !== "null"
    ) {
      return url.origin;
    }

    return url.protocol;
  } catch {
    return "invalid-url";
  }
}

function addBlockedOrigin(
  target:
    Set<string>,
  value: string,
) {
  if (
    target.size
      >= MAX_BLOCKED_ORIGINS
  ) {
    return;
  }

  target.add(
    pageRenderNetworkOrigin(
      value,
    ),
  );
}

async function startPageRenderBrowserState(
  origin: string,
  browserExecutablePath: string,
  launchBrowser:
    PageRenderBrowserLauncher =
      chromium.launch.bind(
        chromium,
      ),
): Promise<PageRenderBrowserState> {
  const executablePath =
    normalizePageRenderBrowserExecutable(
      browserExecutablePath,
    );

  if (!executablePath) {
    throw new PageRenderBrowserError(
      "render_browser_executable_invalid",
      "Page render browser executable is not configured",
    );
  }

  let browser;

  try {
    browser =
      await launchBrowser({
        executablePath,
        headless:
          true,
      });
  } catch {
    throw new PageRenderBrowserError(
      "render_browser_launch_failed",
      "Could not launch the configured page render browser",
    );
  }

  try {
    const context =
      await browser.newContext({
        viewport: {
          width:
            VIEWPORT_WIDTH,
          height:
            VIEWPORT_HEIGHT,
        },
        acceptDownloads:
          false,
        serviceWorkers:
          "block",
      });

    const blockedResourceOrigins =
      new Set<string>();

    const blockedWebSocketOrigins =
      new Set<string>();

    const networkState:
      PageRenderBrowserNetworkState = {};

    await context.routeWebSocket(
      "**/*",
      async (
        webSocket,
      ) => {
        const url =
          webSocket.url();

        if (
          !pageRenderNetworkUrlAllowed(
            origin,
            url,
          )
        ) {
          addBlockedOrigin(
            blockedWebSocketOrigins,
            url,
          );

          await webSocket.close({
            code:
              1008,
            reason:
              "Blocked by page render network policy",
          });

          return;
        }

        webSocket.connectToServer();
      },
    );

    const page =
      await context.newPage();

    await context.route(
      "**/*",
      async (
        routeHandle,
      ) => {
        const request =
          routeHandle.request();

        if (
          !pageRenderNetworkUrlAllowed(
            origin,
            request.url(),
          )
        ) {
          addBlockedOrigin(
            blockedResourceOrigins,
            request.url(),
          );

          if (
            request.isNavigationRequest()
            && request.frame()
              === page.mainFrame()
          ) {
            networkState.blockedNavigationUrl =
              request.url();
          }

          await routeHandle.abort(
            "blockedbyclient",
          );

          return;
        }

        await routeHandle.continue();
      },
    );

    return {
      browser,
      page,
      blockedResourceOrigins,
      blockedWebSocketOrigins,
      networkState,
    };
  } catch (error) {
    await browser.close();

    throw error;
  }
}

export async function startPageRenderBrowserSession(
  options:
    StartPageRenderBrowserSessionOptions,
  launchBrowser:
    PageRenderBrowserLauncher =
      chromium.launch.bind(
        chromium,
      ),
): Promise<PageRenderBrowserSession> {
  const origin =
    normalizePageRenderOrigin(
      options.origin,
    );

  if (!origin) {
    throw new PageRenderBrowserError(
      "render_navigation_failed",
      "Page render origin is not configured",
    );
  }

  const state =
    await startPageRenderBrowserState(
      origin,
      options.browserExecutablePath,
      launchBrowser,
    );

  let closed =
    false;

  return {
    origin,

    async render(
      route: string,
    ) {
      if (closed) {
        throw new PageRenderBrowserError(
          "render_browser_session_closed",
          "Page render browser session is closed",
        );
      }

      return renderPageSnapshot(
        {
          origin,
          route,
          browserExecutablePath:
            options.browserExecutablePath,
        },
        state,
      );
    },

    async close() {
      if (closed) {
        return;
      }

      closed =
        true;

      await state.browser.close();
    },
  };
}

export async function renderPageSnapshot(
  options:
    RenderPageSnapshotOptions,
  browserState?:
    PageRenderBrowserState,
): Promise<PageRenderSnapshot> {
  const origin =
    normalizePageRenderOrigin(
      options.origin,
    );

  if (!origin) {
    throw new PageRenderBrowserError(
      "render_navigation_failed",
      "Page render origin is not configured",
    );
  }

  const requestedUrl =
    resolvePageRenderUrl(
      origin,
      options.route,
    );

  const ownsBrowserState =
    browserState ===
      undefined;

  const state =
    browserState
    ?? await startPageRenderBrowserState(
      origin,
      options.browserExecutablePath,
    );

  const {
    browser,
    page,
    blockedResourceOrigins,
    blockedWebSocketOrigins,
    networkState,
  } = state;

  blockedResourceOrigins.clear();
  blockedWebSocketOrigins.clear();

  networkState.blockedNavigationUrl =
    undefined;

  try {
    let status:
      number | null =
        null;

    try {
      const response =
        await page.goto(
          requestedUrl,
          {
            waitUntil:
              "domcontentloaded",
            timeout:
              NAVIGATION_TIMEOUT_MS,
          },
        );

      status =
        response?.status()
        ?? null;
    } catch {
      if (
        networkState.blockedNavigationUrl
      ) {
        throw new PageRenderBrowserError(
          "render_navigation_cross_origin",
          "Page attempted a top-level navigation outside the configured render origin",
        );
      }

      throw new PageRenderBrowserError(
        "render_navigation_failed",
        "Page render navigation failed",
      );
    }

    const finalUrl =
      page.url();

    let finalOrigin:
      string;

    try {
      finalOrigin =
        new URL(
          finalUrl,
        ).origin;
    } catch {
      throw new PageRenderBrowserError(
        "render_navigation_failed",
        "Rendered page returned an invalid final URL",
      );
    }

    if (
      finalOrigin
        !== origin
    ) {
      throw new PageRenderBrowserError(
        "render_navigation_cross_origin",
        "Rendered page left the configured render origin",
      );
    }

    await page.waitForTimeout(
      SETTLE_MS,
    );

    const rendered =
      await page.evaluate(
        ({
          maxTextChars,
          maxElements,
        }) => {
          const rawText =
            document.body
              ?.innerText
            ?? "";

          const visibleElements =
            Array.from(
              document.querySelectorAll(
                [
                  "a",
                  "button",
                  "input",
                  "select",
                  "textarea",
                  "[role]",
                ].join(
                  ",",
                ),
              ),
            ).filter(
              (
                element,
              ) => {
                const rect =
                  element
                    .getBoundingClientRect();

                const style =
                  window
                    .getComputedStyle(
                      element,
                    );

                return (
                  rect.width > 0
                  && rect.height > 0
                  && style.display
                    !== "none"
                  && style.visibility
                    !== "hidden"
                );
              },
            );

          const elements =
            visibleElements
              .slice(
                0,
                maxElements,
              )
              .map(
                (
                  element,
                ) => {
                  const htmlElement =
                    element
                      instanceof HTMLElement
                      ? element
                      : undefined;

                  const text =
                    (
                      htmlElement
                        ?.innerText
                      ?? ""
                    )
                      .trim()
                      .slice(
                        0,
                        300,
                      );

                  const role =
                    element
                      .getAttribute(
                        "role",
                      )
                      ?.trim();

                  const type =
                    element
                      .getAttribute(
                        "type",
                      )
                      ?.trim();

                  const name =
                    element
                      .getAttribute(
                        "name",
                      )
                      ?.trim();

                  const placeholder =
                    element
                      .getAttribute(
                        "placeholder",
                      )
                      ?.trim();

                  const ariaLabel =
                    element
                      .getAttribute(
                        "aria-label",
                      )
                      ?.trim();

                  return {
                    tag:
                      element
                        .tagName
                        .toLowerCase(),
                    ...(
                      role
                        ? {
                            role,
                          }
                        : {}
                    ),
                    ...(
                      text
                        ? {
                            text,
                          }
                        : {}
                    ),
                    ...(
                      type
                        ? {
                            type,
                          }
                        : {}
                    ),
                    ...(
                      name
                        ? {
                            name,
                          }
                        : {}
                    ),
                    ...(
                      placeholder
                        ? {
                            placeholder,
                          }
                        : {}
                    ),
                    ...(
                      ariaLabel
                        ? {
                            ariaLabel,
                          }
                        : {}
                    ),
                  };
                },
              );

          return {
            title:
              document.title,
            text:
              rawText.slice(
                0,
                maxTextChars,
              ),
            textTruncated:
              rawText.length
                > maxTextChars,
            elements,
            elementsTruncated:
              visibleElements.length
                > maxElements,
            viewport: {
              width:
                window.innerWidth,
              height:
                window.innerHeight,
            },
          };
        },
        {
          maxTextChars:
            MAX_TEXT_CHARS,
          maxElements:
            MAX_ELEMENTS,
        },
      );

    const screenshotBuffer =
      await page.screenshot({
        type:
          "jpeg",
        quality:
          60,
        fullPage:
          false,
        animations:
          "disabled",
      });

    const warnings:
      string[] = [];

    const screenshot =
      screenshotBuffer.byteLength
        <= MAX_SCREENSHOT_BYTES
        ? {
            mimeType:
              "image/jpeg" as const,
            data:
              screenshotBuffer
                .toString(
                  "base64",
                ),
          }
        : undefined;

    if (!screenshot) {
      warnings.push(
        "Rendered screenshot exceeded the configured size limit and was omitted",
      );
    }

    if (
      blockedResourceOrigins.size
        > 0
    ) {
      warnings.push(
        `Blocked cross-origin resource requests: ${[
          ...blockedResourceOrigins,
        ].sort().join(", ")}`,
      );
    }

    if (
      blockedWebSocketOrigins.size
        > 0
    ) {
      warnings.push(
        `Blocked cross-origin WebSockets: ${[
          ...blockedWebSocketOrigins,
        ].sort().join(", ")}`,
      );
    }

    return {
      requestedUrl,
      finalUrl,
      status,
      title:
        rendered.title,
      viewport:
        rendered.viewport,
      text:
        rendered.text,
      textTruncated:
        rendered.textTruncated,
      elements:
        rendered.elements,
      elementsTruncated:
        rendered.elementsTruncated,
      ...(
        screenshot
          ? {
              screenshot,
            }
          : {}
      ),
      warnings,
    };
  } finally {
    networkState.blockedNavigationUrl =
      undefined;

    if (ownsBrowserState) {
      await browser.close();
    }
  }
}
