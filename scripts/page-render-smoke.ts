import {
  pageRenderConfigFromEnv,
} from "../src/page-render-policy.js";

import {
  pageRenderBrowserExecutableFromEnv,
  renderPageSnapshot,
} from "../src/page-renderer.js";

const route =
  process.argv[2]
  ?? "/";

const config =
  pageRenderConfigFromEnv();

if (!config.enabled) {
  throw new Error(
    "REPO_CONTEXT_RENDER_ORIGIN is not configured",
  );
}

const browserExecutablePath =
  pageRenderBrowserExecutableFromEnv();

if (!browserExecutablePath) {
  throw new Error(
    "REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE is not configured",
  );
}

const snapshot =
  await renderPageSnapshot({
    origin:
      config.origin,
    route,
    browserExecutablePath,
  });

const {
  screenshot,
  ...metadata
} = snapshot;

console.log(
  JSON.stringify(
    {
      ...metadata,
      screenshot:
        screenshot
          ? {
              mimeType:
                screenshot.mimeType,
              bytes:
                Buffer.from(
                  screenshot.data,
                  "base64",
                ).byteLength,
            }
          : null,
    },
    null,
    2,
  ),
);
