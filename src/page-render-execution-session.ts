import {
  spawn,
  type ChildProcess,
} from "node:child_process";

import {
  realpathSync,
  statSync,
} from "node:fs";

import {
  createServer,
} from "node:net";

import * as path from "node:path";

import {
  setTimeout as delay,
} from "node:timers/promises";

import type {
  PageRenderExecutionProfile,
} from "./page-render-execution-profile.js";

import type {
  PageRenderTarget,
} from "./page-render-target.js";

import {
  normalizePageRenderBrowserExecutable,
} from "./page-renderer.js";

const LOOPBACK_HOST =
  "127.0.0.1";

const DEFAULT_STARTUP_TIMEOUT_MS =
  15_000;

const DEFAULT_POLL_INTERVAL_MS =
  100;

const STOP_GRACE_MS =
  1_500;

const KILL_GRACE_MS =
  1_000;

export type PageRenderExecutionSessionErrorCode =
  | "render_execution_repository_key_invalid"
  | "render_execution_workspace_unavailable"
  | "render_execution_launch_failed"
  | "render_execution_process_exited"
  | "render_execution_startup_timeout";

export class PageRenderExecutionSessionError
  extends Error {
  readonly code:
    PageRenderExecutionSessionErrorCode;

  constructor(
    code:
      PageRenderExecutionSessionErrorCode,
    message: string,
  ) {
    super(
      message,
    );

    this.name =
      "PageRenderExecutionSessionError";

    this.code =
      code;
  }
}

export type PageRenderExecutionSession =
  Readonly<{
    target:
      PageRenderTarget;

    stop():
      Promise<void>;
  }>;

export type StartPageRenderExecutionSessionOptions =
  Readonly<{
    profile:
      PageRenderExecutionProfile;

    repositoryKey:
      string;

    browserExecutablePath:
      string;

    startupTimeoutMs?:
      number;

    pollIntervalMs?:
      number;
  }>;

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
    throw new PageRenderExecutionSessionError(
      "render_execution_repository_key_invalid",
      "Page render repository key is invalid",
    );
  }

  return normalized;
}

function positiveNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (
    value === undefined
  ) {
    return fallback;
  }

  if (
    !Number.isFinite(
      value,
    )
    || value <= 0
  ) {
    throw new PageRenderExecutionSessionError(
      "render_execution_launch_failed",
      "Page render execution timing configuration is invalid",
    );
  }

  return value;
}

function existingDirectory(
  value: string,
  label: string,
): string {
  try {
    const resolved =
      realpathSync(
        value,
      );

    if (
      !statSync(
        resolved,
      ).isDirectory()
    ) {
      throw new Error(
        "not_directory",
      );
    }

    return resolved;
  } catch {
    throw new PageRenderExecutionSessionError(
      "render_execution_workspace_unavailable",
      `${label} is unavailable`,
    );
  }
}

function executionCwd(
  profile:
    PageRenderExecutionProfile,
): string {
  if (
    !path.isAbsolute(
      profile.workspace,
    )
  ) {
    throw new PageRenderExecutionSessionError(
      "render_execution_workspace_unavailable",
      "Page render workspace must be absolute",
    );
  }

  if (
    path.isAbsolute(
      profile.cwd,
    )
  ) {
    throw new PageRenderExecutionSessionError(
      "render_execution_workspace_unavailable",
      "Page render cwd must be relative to workspace",
    );
  }

  const workspace =
    existingDirectory(
      profile.workspace,
      "Page render workspace",
    );

  const cwd =
    existingDirectory(
      path.resolve(
        workspace,
        profile.cwd,
      ),
      "Page render cwd",
    );

  const relative =
    path.relative(
      workspace,
      cwd,
    );

  if (
    relative === ".."
    || relative.startsWith(
      `..${path.sep}`,
    )
    || path.isAbsolute(
      relative,
    )
  ) {
    throw new PageRenderExecutionSessionError(
      "render_execution_workspace_unavailable",
      "Page render cwd resolves outside workspace",
    );
  }

  return cwd;
}

function tokenCount(
  values:
    readonly string[],
  token: string,
): number {
  return values.reduce(
    (
      total,
      value,
    ) =>
      total
      + (
        value.split(
          token,
        ).length
        - 1
      ),
    0,
  );
}

function executionArgs(
  profile:
    PageRenderExecutionProfile,
  port: number,
):
  readonly string[] {
  if (
    tokenCount(
      profile.args,
      "{host}",
    ) !== 1
    || tokenCount(
      profile.args,
      "{port}",
    ) !== 1
  ) {
    throw new PageRenderExecutionSessionError(
      "render_execution_launch_failed",
      "Page render execution profile placeholders are invalid",
    );
  }

  return profile.args.map(
    (
      value,
    ) =>
      value
        .replace(
          "{host}",
          LOOPBACK_HOST,
        )
        .replace(
          "{port}",
          String(
            port,
          ),
        ),
  );
}

async function allocateLoopbackPort():
  Promise<number> {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const server =
        createServer();

      server.unref();

      server.once(
        "error",
        (
          error,
        ) => {
          reject(
            error,
          );
        },
      );

      server.listen(
        {
          host:
            LOOPBACK_HOST,

          port:
            0,

          exclusive:
            true,
        },
        () => {
          const address =
            server.address();

          if (
            !address
            || typeof address
              === "string"
          ) {
            server.close();

            reject(
              new PageRenderExecutionSessionError(
                "render_execution_launch_failed",
                "Could not allocate page render loopback port",
              ),
            );

            return;
          }

          const port =
            address.port;

          server.close(
            (
              error,
            ) => {
              if (
                error
              ) {
                reject(
                  new PageRenderExecutionSessionError(
                    "render_execution_launch_failed",
                    "Could not release page render port reservation",
                  ),
                );

                return;
              }

              resolve(
                port,
              );
            },
          );
        },
      );
    },
  );
}

function childExited(
  child:
    ChildProcess,
): boolean {
  return (
    child.exitCode !== null
    || child.signalCode !== null
  );
}

function signalChildTree(
  child:
    ChildProcess,
  signal:
    NodeJS.Signals,
) {
  if (
    !child.pid
  ) {
    return;
  }

  if (
    process.platform
    !== "win32"
  ) {
    try {
      process.kill(
        -child.pid,
        signal,
      );

      return;
    } catch {
      // Fall back to direct child.
    }
  }

  try {
    child.kill(
      signal,
    );
  } catch {
    // Cleanup is best effort.
  }
}

async function waitForChildExit(
  child:
    ChildProcess,
  timeoutMs: number,
):
  Promise<boolean> {
  if (
    childExited(
      child,
    )
    || !child.pid
  ) {
    return true;
  }

  return new Promise(
    (
      resolve,
    ) => {
      let settled =
        false;

      let timer:
        NodeJS.Timeout | undefined;

      const finish =
        (
          value: boolean,
        ) => {
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

          if (
            timer
          ) {
            clearTimeout(
              timer,
            );
          }

          child.off(
            "exit",
            onExit,
          );

          child.off(
            "error",
            onError,
          );

          resolve(
            value,
          );
        };

      const onExit =
        () =>
          finish(
            true,
          );

      const onError =
        () =>
          finish(
            true,
          );

      child.once(
        "exit",
        onExit,
      );

      child.once(
        "error",
        onError,
      );

      if (
        childExited(
          child,
        )
      ) {
        finish(
          true,
        );

        return;
      }

      timer =
        setTimeout(
          () =>
            finish(
              false,
            ),
          timeoutMs,
        );
    },
  );
}

async function stopChildProcess(
  child:
    ChildProcess,
) {
  if (
    childExited(
      child,
    )
    || !child.pid
  ) {
    return;
  }

  signalChildTree(
    child,
    "SIGTERM",
  );

  if (
    await waitForChildExit(
      child,
      STOP_GRACE_MS,
    )
  ) {
    return;
  }

  signalChildTree(
    child,
    "SIGKILL",
  );

  await waitForChildExit(
    child,
    KILL_GRACE_MS,
  );
}

async function waitForHttpReady(
  child:
    ChildProcess,
  origin: string,
  startupTimeoutMs: number,
  pollIntervalMs: number,
  launchError:
    () => Error | null,
) {
  const deadline =
    Date.now()
    + startupTimeoutMs;

  while (
    Date.now()
    < deadline
  ) {
    if (
      launchError()
    ) {
      throw new PageRenderExecutionSessionError(
        "render_execution_launch_failed",
        "Could not launch page render application",
      );
    }

    if (
      childExited(
        child,
      )
    ) {
      throw new PageRenderExecutionSessionError(
        "render_execution_process_exited",
        "Page render application exited before becoming ready",
      );
    }

    const remaining =
      deadline
      - Date.now();

    try {
      const response =
        await fetch(
          `${origin}/`,
          {
            redirect:
              "manual",

            signal:
              AbortSignal.timeout(
                Math.max(
                  1,
                  Math.min(
                    500,
                    remaining,
                  ),
                ),
              ),
          },
        );

      await response.body
        ?.cancel();

      return;
    } catch {
      // Application is not ready yet.
    }

    await delay(
      Math.min(
        pollIntervalMs,
        Math.max(
          1,
          deadline
          - Date.now(),
        ),
      ),
    );
  }

  throw new PageRenderExecutionSessionError(
    "render_execution_startup_timeout",
    "Page render application did not become ready before startup timeout",
  );
}

export async function startPageRenderExecutionSession(
  options:
    StartPageRenderExecutionSessionOptions,
):
  Promise<PageRenderExecutionSession> {
  const repositoryKey =
    normalizedRepositoryKey(
      options.repositoryKey,
    );

  const browserExecutablePath =
    normalizePageRenderBrowserExecutable(
      options.browserExecutablePath,
    );

  if (
    !browserExecutablePath
  ) {
    throw new PageRenderExecutionSessionError(
      "render_execution_launch_failed",
      "Page render browser executable is not configured",
    );
  }

  const startupTimeoutMs =
    positiveNumber(
      options.startupTimeoutMs,
      DEFAULT_STARTUP_TIMEOUT_MS,
    );

  const pollIntervalMs =
    positiveNumber(
      options.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
    );

  const cwd =
    executionCwd(
      options.profile,
    );

  const port =
    await allocateLoopbackPort();

  const origin =
    `http://${LOOPBACK_HOST}:${port}`;

  const args =
    executionArgs(
      options.profile,
      port,
    );

  let child:
    ChildProcess;

  try {
    child =
      spawn(
        options.profile.command,
        args,
        {
          cwd,

          shell:
            false,

          detached:
            process.platform
            !== "win32",

          stdio:
            "ignore",

          env:
            process.env,
        },
      );
  } catch {
    throw new PageRenderExecutionSessionError(
      "render_execution_launch_failed",
      "Could not launch page render application",
    );
  }

  let childLaunchError:
    Error | null =
      null;

  child.once(
    "error",
    (
      error,
    ) => {
      childLaunchError =
        error;
    },
  );

  try {
    await waitForHttpReady(
      child,
      origin,
      startupTimeoutMs,
      pollIntervalMs,
      () =>
        childLaunchError,
    );
  } catch (
    error
  ) {
    await stopChildProcess(
      child,
    );

    throw error;
  }

  let stopped =
    false;

  return {
    target: {
      repositoryKey,
      origin,
      browserExecutablePath,
    },

    async stop() {
      if (
        stopped
      ) {
        return;
      }

      stopped =
        true;

      await stopChildProcess(
        child,
      );
    },
  };
}

export async function withPageRenderExecutionSession<
  Result,
>(
  options:
    StartPageRenderExecutionSessionOptions,
  fn:
    (
      target:
        PageRenderTarget,
    ) => Promise<Result>,
):
  Promise<Result> {
  const session =
    await startPageRenderExecutionSession(
      options,
    );

  try {
    return await fn(
      session.target,
    );
  } finally {
    await session.stop();
  }
}
