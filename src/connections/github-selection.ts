import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import type {
  GitHubConnectRepository,
} from "./github-connect.js";

import type {
  PrincipalIdentity,
} from "./types.js";

const SELECTION_PREFIX =
  "grs1";

const SELECTION_AAD =
  Buffer.from(
    "repo_context_mcp:github-repository-selection:v1",
    "utf8",
  );

const DEFAULT_TTL_MS =
  10 * 60 * 1000;

const MAX_REPOSITORIES =
  10_000;

type SelectionPayload =
  Readonly<{
    version: 1;
    issuer: string;
    subject: string;
    browserNonce: string;
    installationId: string;
    repositoryIds: readonly string[];
    expiresAt: number;
  }>;

export type GitHubRepositorySelectionErrorCode =
  | "github_repository_selection_invalid"
  | "github_repository_selection_expired"
  | "github_repository_selection_browser_mismatch"
  | "github_repository_selection_empty"
  | "github_repository_selection_too_large"
  | "github_repository_unavailable";

export class GitHubRepositorySelectionError
  extends Error {
  readonly code:
    GitHubRepositorySelectionErrorCode;

  constructor(
    code:
      GitHubRepositorySelectionErrorCode,
    message: string,
  ) {
    super(message);

    this.name =
      "GitHubRepositorySelectionError";

    this.code = code;
  }
}

export type GitHubRepositorySelectionOptions =
  Readonly<{
    stateKey: Uint8Array;
    now?: () => Date;
    ttlMs?: number;
  }>;

export type GitHubRepositorySelectionStart =
  Readonly<{
    repositories:
      readonly GitHubConnectRepository[];

    selectionToken: string;
    expiresAt: string;
  }>;

export type GitHubRepositorySelectionResult =
  Readonly<{
    principal:
      PrincipalIdentity;

    installationId: string;
    repositoryId: string;
  }>;

function base64url(
  value: Uint8Array,
): string {
  return Buffer
    .from(value)
    .toString("base64url");
}

function validIdentityPart(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.includes("\0")
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_invalid",
      "GitHub repository selection identity is invalid",
    );
  }

  return normalized;
}

function validBrowserNonce(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !/^[A-Za-z0-9_-]{32,}$/.test(
      normalized,
    )
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_browser_mismatch",
      "GitHub repository selection does not belong to this browser",
    );
  }

  return normalized;
}

function validNumericId(
  value: string,
  errorCode:
    GitHubRepositorySelectionErrorCode,
): string {
  const normalized =
    value.trim();

  if (
    !/^[1-9][0-9]*$/.test(
      normalized,
    )
  ) {
    throw new GitHubRepositorySelectionError(
      errorCode,
      "GitHub repository selection contains an invalid identifier",
    );
  }

  return normalized;
}

function parsePayload(
  value: unknown,
): SelectionPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_invalid",
      "GitHub repository selection is invalid",
    );
  }

  const record =
    value as
      Record<string, unknown>;

  if (
    record.version !== 1 ||
    typeof record.issuer !== "string" ||
    typeof record.subject !== "string" ||
    typeof record.browserNonce !== "string" ||
    typeof record.installationId !== "string" ||
    !Array.isArray(
      record.repositoryIds,
    ) ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(
      record.expiresAt,
    )
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_invalid",
      "GitHub repository selection is invalid",
    );
  }

  if (
    record.repositoryIds.length === 0 ||
    record.repositoryIds.length >
      MAX_REPOSITORIES
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_invalid",
      "GitHub repository selection is invalid",
    );
  }

  const repositoryIds =
    record.repositoryIds.map(
      (repositoryId) => {
        if (
          typeof repositoryId !==
          "string"
        ) {
          throw new GitHubRepositorySelectionError(
            "github_repository_selection_invalid",
            "GitHub repository selection is invalid",
          );
        }

        return validNumericId(
          repositoryId,
          "github_repository_selection_invalid",
        );
      },
    );

  if (
    new Set(
      repositoryIds,
    ).size !==
    repositoryIds.length
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_invalid",
      "GitHub repository selection contains duplicate repositories",
    );
  }

  return {
    version: 1,

    issuer:
      validIdentityPart(
        record.issuer,
      ),

    subject:
      validIdentityPart(
        record.subject,
      ),

    browserNonce:
      validBrowserNonce(
        record.browserNonce,
      ),

    installationId:
      validNumericId(
        record.installationId,
        "github_repository_selection_invalid",
      ),

    repositoryIds,

    expiresAt:
      record.expiresAt,
  };
}

export class GitHubRepositorySelection {
  private readonly stateKey:
    Buffer;

  private readonly now:
    () => Date;

  private readonly ttlMs:
    number;

  constructor(
    options:
      GitHubRepositorySelectionOptions,
  ) {
    this.stateKey =
      Buffer.from(
        options.stateKey,
      );

    if (
      this.stateKey.length !== 32
    ) {
      throw new TypeError(
        "GitHub repository selection key must be exactly 32 bytes",
      );
    }

    this.now =
      options.now ??
      (() => new Date());

    this.ttlMs =
      options.ttlMs ??
      DEFAULT_TTL_MS;

    if (
      !Number.isSafeInteger(
        this.ttlMs,
      ) ||
      this.ttlMs <= 0
    ) {
      throw new TypeError(
        "GitHub repository selection TTL must be a positive integer",
      );
    }
  }

  private encrypt(
    payload:
      SelectionPayload,
  ): string {
    const iv =
      randomBytes(12);

    const cipher =
      createCipheriv(
        "aes-256-gcm",
        this.stateKey,
        iv,
      );

    cipher.setAAD(
      SELECTION_AAD,
    );

    const ciphertext =
      Buffer.concat([
        cipher.update(
          Buffer.from(
            JSON.stringify(
              payload,
            ),
            "utf8",
          ),
        ),

        cipher.final(),
      ]);

    const tag =
      cipher.getAuthTag();

    return [
      SELECTION_PREFIX,
      base64url(iv),
      base64url(ciphertext),
      base64url(tag),
    ].join(".");
  }

  private decrypt(
    token: string,
  ): SelectionPayload {
    try {
      const parts =
        token.split(".");

      if (
        parts.length !== 4 ||
        parts[0] !==
          SELECTION_PREFIX
      ) {
        throw new Error();
      }

      const iv =
        Buffer.from(
          parts[1] ?? "",
          "base64url",
        );

      const ciphertext =
        Buffer.from(
          parts[2] ?? "",
          "base64url",
        );

      const tag =
        Buffer.from(
          parts[3] ?? "",
          "base64url",
        );

      if (
        iv.length !== 12 ||
        ciphertext.length === 0 ||
        tag.length !== 16
      ) {
        throw new Error();
      }

      const decipher =
        createDecipheriv(
          "aes-256-gcm",
          this.stateKey,
          iv,
        );

      decipher.setAAD(
        SELECTION_AAD,
      );

      decipher.setAuthTag(
        tag,
      );

      const plaintext =
        Buffer.concat([
          decipher.update(
            ciphertext,
          ),

          decipher.final(),
        ]);

      return parsePayload(
        JSON.parse(
          plaintext.toString(
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if (
        error instanceof
          GitHubRepositorySelectionError
      ) {
        throw error;
      }

      throw new GitHubRepositorySelectionError(
        "github_repository_selection_invalid",
        "GitHub repository selection is invalid",
      );
    }
  }

  create(
    principal:
      PrincipalIdentity,

    browserNonce: string,

    rawInstallationId: string,

    repositories:
      readonly GitHubConnectRepository[],
  ): GitHubRepositorySelectionStart {
    if (
      repositories.length === 0
    ) {
      throw new GitHubRepositorySelectionError(
        "github_repository_selection_empty",
        "No GitHub repositories are available for selection",
      );
    }

    if (
      repositories.length >
      MAX_REPOSITORIES
    ) {
      throw new GitHubRepositorySelectionError(
        "github_repository_selection_too_large",
        "Too many GitHub repositories are available for selection",
      );
    }

    const repositoryIds =
      repositories.map(
        (repository) =>
          validNumericId(
            repository.repositoryId,
            "github_repository_selection_invalid",
          ),
      );

    if (
      new Set(
        repositoryIds,
      ).size !==
      repositoryIds.length
    ) {
      throw new GitHubRepositorySelectionError(
        "github_repository_selection_invalid",
        "GitHub repository selection contains duplicate repositories",
      );
    }

    const expiresAt =
      this.now().getTime() +
      this.ttlMs;

    const payload:
      SelectionPayload = {
        version: 1,

        issuer:
          validIdentityPart(
            principal.issuer,
          ),

        subject:
          validIdentityPart(
            principal.subject,
          ),

        browserNonce:
          validBrowserNonce(
            browserNonce,
          ),

        installationId:
          validNumericId(
            rawInstallationId,
            "github_repository_selection_invalid",
          ),

        repositoryIds,
        expiresAt,
      };

    return {
      repositories:
        repositories.map(
          (repository) => ({
            ...repository,
          }),
        ),

      selectionToken:
        this.encrypt(
          payload,
        ),

      expiresAt:
        new Date(
          expiresAt,
        ).toISOString(),
    };
  }

  complete(
    selectionToken: string,
    browserNonce: string,
    rawRepositoryId: string,
  ): GitHubRepositorySelectionResult {
    const payload =
      this.decrypt(
        selectionToken,
      );

    const nonce =
      validBrowserNonce(
        browserNonce,
      );

    if (
      payload.browserNonce !==
      nonce
    ) {
      throw new GitHubRepositorySelectionError(
        "github_repository_selection_browser_mismatch",
        "GitHub repository selection does not belong to this browser",
      );
    }

    if (
      payload.expiresAt <
      this.now().getTime()
    ) {
      throw new GitHubRepositorySelectionError(
        "github_repository_selection_expired",
        "GitHub repository selection has expired",
      );
    }

    const repositoryId =
      validNumericId(
        rawRepositoryId,
        "github_repository_unavailable",
      );

    if (
      !payload.repositoryIds.includes(
        repositoryId,
      )
    ) {
      throw new GitHubRepositorySelectionError(
        "github_repository_unavailable",
        "GitHub repository is unavailable to the authorized user",
      );
    }

    return {
      principal: {
        issuer:
          payload.issuer,

        subject:
          payload.subject,
      },

      installationId:
        payload.installationId,

      repositoryId,
    };
  }
}
