import {
  readFileSync,
} from "node:fs";

import * as path from "node:path";

export type PageRenderExecutionProfile =
  Readonly<{
    repositoryId: string;
    strategy:
      "local-workspace";
    workspace: string;
    cwd: string;
    command: string;
    args:
      readonly string[];
  }>;

export interface PageRenderExecutionProfileAccess {
  list():
    readonly PageRenderExecutionProfile[];

  resolve(
    repositoryId: string,
  ):
    PageRenderExecutionProfile | null;
}

export type PageRenderExecutionProfileErrorCode =
  | "render_execution_profile_invalid"
  | "render_execution_profile_duplicate"
  | "render_execution_profile_file_invalid";

export class PageRenderExecutionProfileError
  extends Error {
  readonly code:
    PageRenderExecutionProfileErrorCode;

  constructor(
    code:
      PageRenderExecutionProfileErrorCode,
    message: string,
  ) {
    super(
      message,
    );

    this.name =
      "PageRenderExecutionProfileError";

    this.code =
      code;
  }
}

function invalid(
  message: string,
): never {
  throw new PageRenderExecutionProfileError(
    "render_execution_profile_invalid",
    message,
  );
}

function requiredObject(
  value: unknown,
  label: string,
):
  Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(
      value,
    )
  ) {
    return invalid(
      `${label} must be an object`,
    );
  }

  return value as
    Record<string, unknown>;
}

function requiredString(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string"
  ) {
    return invalid(
      `${label} must be a string`,
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized
    || normalized.includes(
      "\u0000",
    )
  ) {
    return invalid(
      `${label} must be a non-empty safe string`,
    );
  }

  return normalized;
}

function repositoryId(
  value: unknown,
  label: string,
): string {
  const normalized =
    requiredString(
      value,
      label,
    );

  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(
      normalized,
    )
  ) {
    return invalid(
      `${label} contains unsupported characters`,
    );
  }

  return normalized;
}

function workspacePath(
  value: unknown,
  label: string,
): string {
  const normalized =
    requiredString(
      value,
      label,
    );

  if (
    !path.isAbsolute(
      normalized,
    )
  ) {
    return invalid(
      `${label} must be an absolute path`,
    );
  }

  return path.resolve(
    normalized,
  );
}

function workspaceCwd(
  value: unknown,
  label: string,
): string {
  const normalized =
    requiredString(
      value,
      label,
    );

  if (
    path.isAbsolute(
      normalized,
    )
  ) {
    return invalid(
      `${label} must be relative to workspace`,
    );
  }

  const segments =
    normalized.split(
      /[\\/]+/,
    );

  if (
    segments.includes(
      "..",
    )
  ) {
    return invalid(
      `${label} must not traverse outside workspace`,
    );
  }

  return path.normalize(
    normalized,
  );
}

function commandArgs(
  value: unknown,
  label: string,
):
  readonly string[] {
  if (
    !Array.isArray(
      value,
    )
  ) {
    return invalid(
      `${label} must be an array`,
    );
  }

  return value.map(
    (
      item,
      index,
    ) => {
      if (
        typeof item !== "string"
        || item.includes(
          "\u0000",
        )
      ) {
        return invalid(
          `${label}[${index}] must be a safe string`,
        );
      }

      return item;
    },
  );
}

function tokenOccurrences(
  args:
    readonly string[],
  token: string,
): number {
  return args.reduce(
    (
      total,
      arg,
    ) =>
      total
      + (
        arg.split(
          token,
        ).length
        - 1
      ),
    0,
  );
}

function parseProfile(
  value: unknown,
  index: number,
):
  PageRenderExecutionProfile {
  const label =
    `profiles[${index}]`;

  const item =
    requiredObject(
      value,
      label,
    );

  const strategy =
    requiredString(
      item.strategy,
      `${label}.strategy`,
    );

  if (
    strategy
    !== "local-workspace"
  ) {
    return invalid(
      `${label}.strategy must be local-workspace`,
    );
  }

  const args =
    commandArgs(
      item.args,
      `${label}.args`,
    );

  if (
    tokenOccurrences(
      args,
      "{host}",
    ) !== 1
  ) {
    return invalid(
      `${label}.args must contain exactly one {host} token`,
    );
  }

  if (
    tokenOccurrences(
      args,
      "{port}",
    ) !== 1
  ) {
    return invalid(
      `${label}.args must contain exactly one {port} token`,
    );
  }

  return {
    repositoryId:
      repositoryId(
        item.repositoryId,
        `${label}.repositoryId`,
      ),

    strategy:
      "local-workspace",

    workspace:
      workspacePath(
        item.workspace,
        `${label}.workspace`,
      ),

    cwd:
      workspaceCwd(
        item.cwd,
        `${label}.cwd`,
      ),

    command:
      requiredString(
        item.command,
        `${label}.command`,
      ),

    args,
  };
}

export function parsePageRenderExecutionProfiles(
  value: unknown,
):
  readonly PageRenderExecutionProfile[] {
  const root =
    requiredObject(
      value,
      "render profile document",
    );

  if (
    root.version !== 1
  ) {
    return invalid(
      "render profile document version must be 1",
    );
  }

  if (
    !Array.isArray(
      root.profiles,
    )
  ) {
    return invalid(
      "render profile document profiles must be an array",
    );
  }

  const profiles =
    root.profiles.map(
      (
        item,
        index,
      ) =>
        parseProfile(
          item,
          index,
        ),
    );

  const seen =
    new Set<string>();

  for (
    const profile
    of profiles
  ) {
    if (
      seen.has(
        profile.repositoryId,
      )
    ) {
      throw new PageRenderExecutionProfileError(
        "render_execution_profile_duplicate",
        `Duplicate render execution profile for repository ${profile.repositoryId}`,
      );
    }

    seen.add(
      profile.repositoryId,
    );
  }

  return profiles;
}

export function loadPageRenderExecutionProfiles(
  filePath: string,
):
  readonly PageRenderExecutionProfile[] {
  try {
    return parsePageRenderExecutionProfiles(
      JSON.parse(
        readFileSync(
          filePath,
          "utf8",
        ),
      ),
    );
  } catch (
    error
  ) {
    if (
      error
      instanceof PageRenderExecutionProfileError
    ) {
      throw error;
    }

    throw new PageRenderExecutionProfileError(
      "render_execution_profile_file_invalid",
      `Unable to load render execution profiles from ${filePath}`,
    );
  }
}

export function createPageRenderExecutionProfileAccess(
  profiles:
    readonly PageRenderExecutionProfile[],
):
  PageRenderExecutionProfileAccess {
  const byRepositoryId =
    new Map<
      string,
      PageRenderExecutionProfile
    >();

  for (
    const profile
    of profiles
  ) {
    if (
      byRepositoryId.has(
        profile.repositoryId,
      )
    ) {
      throw new PageRenderExecutionProfileError(
        "render_execution_profile_duplicate",
        `Duplicate render execution profile for repository ${profile.repositoryId}`,
      );
    }

    byRepositoryId.set(
      profile.repositoryId,
      profile,
    );
  }

  return {
    list() {
      return [
        ...byRepositoryId.values(),
      ];
    },

    resolve(
      repositoryId,
    ) {
      return (
        byRepositoryId.get(
          repositoryId,
        )
        ?? null
      );
    },
  };
}
