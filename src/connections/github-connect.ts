import {
  randomUUID,
} from "node:crypto";

import {
  deriveUserLookup,
  encryptRepositoryConnection,
} from "./crypto.js";

import type {
  RepositoryConnectionStore,
} from "./store.js";

import type {
  PrincipalIdentity,
  RepositoryConnectionPayload,
} from "./types.js";

const GITHUB_API_VERSION =
  "2026-03-10";

export type GitHubConnectRepository =
  Readonly<{
    repositoryId: string;
    owner: string;
    name: string;
    defaultBranch: string;
  }>;

export type ConnectedRepository =
  Readonly<{
    connectionId: string;
    provider: "github";
    installationId: string;
    repositoryId: string;
    owner: string;
    name: string;
    branch: string;
  }>;

export type GitHubConnectErrorCode =
  | "github_user_token_required"
  | "github_user_token_invalid"
  | "github_installation_invalid"
  | "github_installation_unavailable"
  | "github_repository_unavailable"
  | "github_provider_error";

export class GitHubConnectError extends Error {
  readonly code: GitHubConnectErrorCode;

  constructor(
    code: GitHubConnectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitHubConnectError";
    this.code = code;
  }
}

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GitHubRepositoryConnectorOptions =
  Readonly<{
    store: RepositoryConnectionStore;
    lookupKey: Uint8Array;
    encryptionKey: Uint8Array;
    fetch?: FetchLike;
    createConnectionId?: () => string;
    now?: () => Date;
  }>;

function installationId(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !/^[1-9][0-9]*$/.test(
      normalized,
    )
  ) {
    throw new GitHubConnectError(
      "github_installation_invalid",
      "GitHub installation ID is invalid",
    );
  }

  return normalized;
}

function repositoryId(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !/^[1-9][0-9]*$/.test(
      normalized,
    )
  ) {
    throw new GitHubConnectError(
      "github_repository_unavailable",
      "GitHub repository is unavailable",
    );
  }

  return normalized;
}

function userToken(
  value: string,
): string {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new GitHubConnectError(
      "github_user_token_required",
      "GitHub user authorization is required",
    );
  }

  return normalized;
}

function record(
  value: unknown,
): Record<string, unknown> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as
    Record<string, unknown>;
}

function parseRepository(
  value: unknown,
): GitHubConnectRepository | null {
  const repository =
    record(value);

  if (!repository) {
    return null;
  }

  const owner =
    record(
      repository.owner,
    );

  if (
    (
      typeof repository.id !==
        "number" &&
      typeof repository.id !==
        "string"
    ) ||
    !owner ||
    typeof owner.login !== "string" ||
    !owner.login ||
    typeof repository.name !== "string" ||
    !repository.name ||
    typeof repository.default_branch !==
      "string" ||
    !repository.default_branch
  ) {
    return null;
  }

  const id =
    String(repository.id);

  if (
    !/^[1-9][0-9]*$/.test(id)
  ) {
    return null;
  }

  return {
    repositoryId: id,
    owner: owner.login,
    name: repository.name,
    defaultBranch:
      repository.default_branch,
  };
}

export class GitHubRepositoryConnector {
  private readonly store:
    RepositoryConnectionStore;

  private readonly lookupKey:
    Buffer;

  private readonly encryptionKey:
    Buffer;

  private readonly fetch:
    FetchLike;

  private readonly createConnectionId:
    () => string;

  private readonly now:
    () => Date;

  constructor(
    options:
      GitHubRepositoryConnectorOptions,
  ) {
    this.store =
      options.store;

    this.lookupKey =
      Buffer.from(
        options.lookupKey,
      );

    this.encryptionKey =
      Buffer.from(
        options.encryptionKey,
      );

    if (
      this.lookupKey.length !== 32 ||
      this.encryptionKey.length !== 32
    ) {
      throw new TypeError(
        "Repository connection keys must be exactly 32 bytes",
      );
    }

    if (
      this.lookupKey.equals(
        this.encryptionKey,
      )
    ) {
      throw new TypeError(
        "Repository connection lookup and encryption keys must be different",
      );
    }

    this.fetch =
      options.fetch ??
      globalThis.fetch;

    this.createConnectionId =
      options.createConnectionId ??
      randomUUID;

    this.now =
      options.now ??
      (() => new Date());
  }

  async listRepositories(
    githubUserAccessToken: string,
    rawInstallationId: string,
  ): Promise<
    readonly GitHubConnectRepository[]
  > {
    const token =
      userToken(
        githubUserAccessToken,
      );

    const installation =
      installationId(
        rawInstallationId,
      );

    const repositories:
      GitHubConnectRepository[] = [];

    for (
      let page = 1;
      page <= 100;
      page += 1
    ) {
      const url =
        new URL(
          `https://api.github.com/user/installations/${installation}/repositories`,
        );

      url.searchParams.set(
        "per_page",
        "100",
      );

      url.searchParams.set(
        "page",
        String(page),
      );

      let response: Response;

      try {
        response =
          await this.fetch(
            url,
            {
              headers: {
                Accept:
                  "application/vnd.github+json",

                Authorization:
                  `Bearer ${token}`,

                "X-GitHub-Api-Version":
                  GITHUB_API_VERSION,
              },
            },
          );
      } catch {
        throw new GitHubConnectError(
          "github_provider_error",
          "GitHub repository verification failed",
        );
      }

      if (response.status === 401) {
        throw new GitHubConnectError(
          "github_user_token_invalid",
          "GitHub user authorization is invalid or expired",
        );
      }

      if (
        response.status === 403 ||
        response.status === 404
      ) {
        throw new GitHubConnectError(
          "github_installation_unavailable",
          "GitHub installation is unavailable to the authorized user",
        );
      }

      if (!response.ok) {
        throw new GitHubConnectError(
          "github_provider_error",
          "GitHub repository verification failed",
        );
      }

      let body: unknown;

      try {
        body =
          await response.json();
      } catch {
        throw new GitHubConnectError(
          "github_provider_error",
          "GitHub returned an invalid repository response",
        );
      }

      const responseRecord =
        record(body);

      if (
        !responseRecord ||
        !Array.isArray(
          responseRecord.repositories,
        )
      ) {
        throw new GitHubConnectError(
          "github_provider_error",
          "GitHub returned an invalid repository response",
        );
      }

      for (
        const candidate
        of responseRecord.repositories
      ) {
        const parsed =
          parseRepository(
            candidate,
          );

        if (!parsed) {
          throw new GitHubConnectError(
            "github_provider_error",
            "GitHub returned an invalid repository",
          );
        }

        repositories.push(
          parsed,
        );
      }

      const totalCount =
        responseRecord.total_count;

      if (
        typeof totalCount === "number" &&
        Number.isFinite(totalCount) &&
        repositories.length >=
          totalCount
      ) {
        return repositories;
      }

      if (
        responseRecord.repositories
          .length === 0
      ) {
        return repositories;
      }
    }

    throw new GitHubConnectError(
      "github_provider_error",
      "GitHub repository list exceeded the supported pagination limit",
    );
  }

  async connectRepository(
    principal: PrincipalIdentity,
    githubUserAccessToken: string,
    rawInstallationId: string,
    rawRepositoryId: string,
  ): Promise<ConnectedRepository> {
    const installation =
      installationId(
        rawInstallationId,
      );

    const selectedRepositoryId =
      repositoryId(
        rawRepositoryId,
      );

    const repositories =
      await this.listRepositories(
        githubUserAccessToken,
        installation,
      );

    const repository =
      repositories.find(
        (candidate) =>
          candidate.repositoryId ===
          selectedRepositoryId,
      );

    if (!repository) {
      throw new GitHubConnectError(
        "github_repository_unavailable",
        "GitHub repository is unavailable to the authorized user",
      );
    }

    const connectionId =
      this.createConnectionId();

    if (
      !connectionId ||
      !connectionId.trim()
    ) {
      throw new TypeError(
        "Connection ID generator returned an invalid ID",
      );
    }

    const userLookup =
      deriveUserLookup(
        principal,
        this.lookupKey,
      );

    const payload:
      RepositoryConnectionPayload = {
        version: 1,
        provider: "github",
        installationId:
          installation,
        repositoryId:
          repository.repositoryId,
        owner:
          repository.owner,
        name:
          repository.name,
        branch:
          repository.defaultBranch,
      };

    await this.store.create({
      id: connectionId,
      userLookup,

      encryptedPayload:
        encryptRepositoryConnection(
          payload,
          this.encryptionKey,
          connectionId,
          userLookup,
        ),

      createdAt:
        this.now().toISOString(),
    });

    return {
      connectionId,
      provider: "github",
      installationId:
        installation,
      repositoryId:
        repository.repositoryId,
      owner:
        repository.owner,
      name:
        repository.name,
      branch:
        repository.defaultBranch,
    };
  }
}
