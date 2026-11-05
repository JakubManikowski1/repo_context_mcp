import {
  randomBytes,
} from "node:crypto";

import type {
  PageRenderExecutionProfile,
} from "./page-render-execution-profile.js";

import {
  startPageRenderExecutionSession,
  type PageRenderExecutionSession,
  type StartPageRenderExecutionSessionOptions,
} from "./page-render-execution-session.js";

import type {
  PageRenderExecutionBinding,
} from "./page-render-execution-renderer.js";

import {
  startPageRenderBrowserSession,
  type PageRenderBrowserSession,
  type PageRenderSnapshot,
  type StartPageRenderBrowserSessionOptions,
} from "./page-renderer.js";

const DEFAULT_SESSION_TTL_MS =
  10 * 60 * 1000;

const SESSION_ID_BYTES =
  18;

const SESSION_ID_ATTEMPTS =
  8;

export type PageRenderBrowserSessionManagerErrorCode =
  | "browser_session_binding_invalid"
  | "browser_session_binding_duplicate"
  | "browser_session_profile_not_found"
  | "browser_session_id_invalid"
  | "browser_session_id_collision"
  | "browser_session_not_found"
  | "browser_session_expired"
  | "browser_session_ttl_invalid"
  | "browser_session_clock_invalid";

export class PageRenderBrowserSessionManagerError
  extends Error {
  readonly code:
    PageRenderBrowserSessionManagerErrorCode;

  constructor(
    code:
      PageRenderBrowserSessionManagerErrorCode,
    message: string,
  ) {
    super(
      message,
    );

    this.name =
      "PageRenderBrowserSessionManagerError";

    this.code =
      code;
  }
}

export type PageRenderBrowserSessionInfo =
  Readonly<{
    sessionId: string;
    repositoryKey: string;
    createdAt: string;
    lastAccessAt: string;
    snapshot:
      PageRenderSnapshot;
  }>;

export type StartManagedPageRenderExecutionSession =
  (
    options:
      StartPageRenderExecutionSessionOptions,
  ) => Promise<
    PageRenderExecutionSession
  >;

export type StartManagedPageRenderBrowserSession =
  (
    options:
      StartPageRenderBrowserSessionOptions,
  ) => Promise<
    PageRenderBrowserSession
  >;

export type PageRenderBrowserSessionManagerOptions =
  Readonly<{
    bindings:
      readonly PageRenderExecutionBinding[];

    browserExecutablePath:
      string;

    ttlMs?:
      number;

    now?:
      () => number;

    createSessionId?:
      () => string;

    startExecutionSession?:
      StartManagedPageRenderExecutionSession;

    startBrowserSession?:
      StartManagedPageRenderBrowserSession;
  }>;

export interface PageRenderBrowserSessionManager {
  open(
    repositoryKey: string,
    route: string,
  ): Promise<
    PageRenderBrowserSessionInfo
  >;

  state(
    sessionId: string,
  ): Promise<
    PageRenderBrowserSessionInfo
  >;

  render(
    sessionId: string,
    route: string,
  ): Promise<
    PageRenderBrowserSessionInfo
  >;

  click(
    sessionId: string,
    selector: string,
  ): Promise<PageRenderBrowserSessionInfo>;

  close(
    sessionId: string,
  ): Promise<boolean>;

  cleanupExpired():
    Promise<number>;

  closeAll():
    Promise<number>;
}

type ManagedSessionRecord = {
  sessionId: string;
  repositoryKey: string;
  profile:
    PageRenderExecutionProfile;
  createdAtMs: number;
  lastAccessAtMs: number;
  executionSession:
    PageRenderExecutionSession;
  browserSession:
    PageRenderBrowserSession;
  snapshot:
    PageRenderSnapshot;
};

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
    throw new PageRenderBrowserSessionManagerError(
      "browser_session_binding_invalid",
      "Browser session repository key is invalid",
    );
  }

  return normalized;
}

function normalizedSessionId(
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
    throw new PageRenderBrowserSessionManagerError(
      "browser_session_id_invalid",
      "Browser session id is invalid",
    );
  }

  return normalized;
}

function normalizedTtlMs(
  value: number | undefined,
): number {
  const ttlMs =
    value
    ?? DEFAULT_SESSION_TTL_MS;

  if (
    !Number.isFinite(
      ttlMs,
    )
    || ttlMs <= 0
  ) {
    throw new PageRenderBrowserSessionManagerError(
      "browser_session_ttl_invalid",
      "Browser session TTL must be a positive finite number",
    );
  }

  return ttlMs;
}

function defaultSessionId():
  string {
  return randomBytes(
    SESSION_ID_BYTES,
  ).toString(
    "base64url",
  );
}

function isoTimestamp(
  value: number,
): string {
  return new Date(
    value,
  ).toISOString();
}

export function createPageRenderBrowserSessionManager(
  options:
    PageRenderBrowserSessionManagerOptions,
):
  PageRenderBrowserSessionManager {
  const ttlMs =
    normalizedTtlMs(
      options.ttlMs,
    );

  const now =
    options.now
    ?? Date.now;

  const createSessionId =
    options.createSessionId
    ?? defaultSessionId;

  const startExecutionSession =
    options.startExecutionSession
    ?? startPageRenderExecutionSession;

  const startBrowserSession =
    options.startBrowserSession
    ?? startPageRenderBrowserSession;

  const profilesByRepositoryKey =
    new Map<
      string,
      PageRenderExecutionProfile
    >();

  for (
    const binding
    of options.bindings
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
      throw new PageRenderBrowserSessionManagerError(
        "browser_session_binding_duplicate",
        `Duplicate browser session binding for repository key ${repositoryKey}`,
      );
    }

    profilesByRepositoryKey.set(
      repositoryKey,
      binding.profile,
    );
  }

  const sessions =
    new Map<
      string,
      ManagedSessionRecord
    >();

  function currentTime():
    number {
    const value =
      now();

    if (
      !Number.isFinite(
        value,
      )
    ) {
      throw new PageRenderBrowserSessionManagerError(
        "browser_session_clock_invalid",
        "Browser session clock returned an invalid timestamp",
      );
    }

    return value;
  }

  function createUniqueSessionId():
    string {
    for (
      let attempt = 0;
      attempt < SESSION_ID_ATTEMPTS;
      attempt += 1
    ) {
      const candidate =
        normalizedSessionId(
          createSessionId(),
        );

      if (
        !sessions.has(
          candidate,
        )
      ) {
        return candidate;
      }
    }

    throw new PageRenderBrowserSessionManagerError(
      "browser_session_id_collision",
      "Could not allocate a unique browser session id",
    );
  }

  function infoFor(
    record:
      ManagedSessionRecord,
  ):
    PageRenderBrowserSessionInfo {
    return {
      sessionId:
        record.sessionId,
      repositoryKey:
        record.repositoryKey,
      createdAt:
        isoTimestamp(
          record.createdAtMs,
        ),
      lastAccessAt:
        isoTimestamp(
          record.lastAccessAtMs,
        ),
      snapshot:
        record.snapshot,
    };
  }

  function isExpired(
    record:
      ManagedSessionRecord,
    timestamp: number,
  ): boolean {
    return (
      timestamp
      - record.lastAccessAtMs
      >= ttlMs
    );
  }

  async function closeRecord(
    record:
      ManagedSessionRecord,
  ): Promise<void> {
    sessions.delete(
      record.sessionId,
    );

    const errors:
      unknown[] = [];

    try {
      await record
        .browserSession
        .close();
    } catch (
      error
    ) {
      errors.push(
        error,
      );
    }

    try {
      await record
        .executionSession
        .stop();
    } catch (
      error
    ) {
      errors.push(
        error,
      );
    }

    if (
      errors.length === 1
    ) {
      throw errors[0];
    }

    if (
      errors.length > 1
    ) {
      throw new AggregateError(
        errors,
        "Browser session cleanup failed",
      );
    }
  }

  async function liveRecord(
    sessionId: string,
  ): Promise<
    ManagedSessionRecord
  > {
    const normalizedId =
      normalizedSessionId(
        sessionId,
      );

    const record =
      sessions.get(
        normalizedId,
      );

    if (!record) {
      throw new PageRenderBrowserSessionManagerError(
        "browser_session_not_found",
        "Browser session was not found",
      );
    }

    const timestamp =
      currentTime();

    if (
      isExpired(
        record,
        timestamp,
      )
    ) {
      await closeRecord(
        record,
      );

      throw new PageRenderBrowserSessionManagerError(
        "browser_session_expired",
        "Browser session expired",
      );
    }

    record.lastAccessAtMs =
      timestamp;

    return record;
  }

  return {
    async open(
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

      if (!profile) {
        throw new PageRenderBrowserSessionManagerError(
          "browser_session_profile_not_found",
          "No trusted page render execution profile is configured for this repository",
        );
      }

      const sessionId =
        createUniqueSessionId();

      const createdAtMs =
        currentTime();

      const executionSession =
        await startExecutionSession({
          profile,
          repositoryKey:
            normalizedKey,
          browserExecutablePath:
            options.browserExecutablePath,
        });

      let browserSession:
        PageRenderBrowserSession;

      try {
        browserSession =
          await startBrowserSession({
            origin:
              executionSession
                .target
                .origin,
            browserExecutablePath:
              executionSession
                .target
                .browserExecutablePath,
          });
      } catch (
        error
      ) {
        await executionSession.stop();

        throw error;
      }

      let snapshot:
        PageRenderSnapshot;

      try {
        snapshot =
          await browserSession.render(
            route,
          );
      } catch (
        error
      ) {
        const cleanupErrors:
          unknown[] = [];

        try {
          await browserSession.close();
        } catch (
          cleanupError
        ) {
          cleanupErrors.push(
            cleanupError,
          );
        }

        try {
          await executionSession.stop();
        } catch (
          cleanupError
        ) {
          cleanupErrors.push(
            cleanupError,
          );
        }

        if (
          cleanupErrors.length > 0
        ) {
          throw new AggregateError(
            [
              error,
              ...cleanupErrors,
            ],
            "Browser session failed to open and cleanup was incomplete",
          );
        }

        throw error;
      }

      const record:
        ManagedSessionRecord = {
          sessionId,
          repositoryKey:
            normalizedKey,
          profile,
          createdAtMs,
          lastAccessAtMs:
            createdAtMs,
          executionSession,
          browserSession,
          snapshot,
        };

      sessions.set(
        sessionId,
        record,
      );

      return infoFor(
        record,
      );
    },

    async state(
      sessionId,
    ) {
      const record =
        await liveRecord(
          sessionId,
        );

      return infoFor(
        record,
      );
    },

    async render(
      sessionId,
      route,
    ) {
      const record =
        await liveRecord(
          sessionId,
        );

      const snapshot =
        await record
          .browserSession
          .render(
            route,
          );

      record.snapshot =
        snapshot;

      record.lastAccessAtMs =
        currentTime();

      return infoFor(
        record,
      );
    },

    async click(
      sessionId,
      selector,
    ) {
      const record = await liveRecord(
        sessionId,
      );

      const snapshot = await record
        .browserSession
        .click(selector);

      record.snapshot = snapshot;
      record.lastAccessAtMs = currentTime();

      return infoFor(record);
    },

    async close(
      sessionId,
    ) {
      const normalizedId =
        normalizedSessionId(
          sessionId,
        );

      const record =
        sessions.get(
          normalizedId,
        );

      if (!record) {
        return false;
      }

      await closeRecord(
        record,
      );

      return true;
    },

    async cleanupExpired() {
      const timestamp =
        currentTime();

      const expired = [
        ...sessions.values(),
      ].filter(
        (
          record,
        ) =>
          isExpired(
            record,
            timestamp,
          ),
      );

      const errors:
        unknown[] = [];

      for (
        const record
        of expired
      ) {
        try {
          await closeRecord(
            record,
          );
        } catch (
          error
        ) {
          errors.push(
            error,
          );
        }
      }

      if (
        errors.length > 0
      ) {
        throw new AggregateError(
          errors,
          "One or more expired browser sessions failed to close",
        );
      }

      return expired.length;
    },

    async closeAll() {
      const records = [
        ...sessions.values(),
      ];

      const errors:
        unknown[] = [];

      for (
        const record
        of records
      ) {
        try {
          await closeRecord(
            record,
          );
        } catch (
          error
        ) {
          errors.push(
            error,
          );
        }
      }

      if (
        errors.length > 0
      ) {
        throw new AggregateError(
          errors,
          "One or more browser sessions failed to close",
        );
      }

      return records.length;
    },
  };
}
