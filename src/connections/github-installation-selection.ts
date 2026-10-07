import {
  randomUUID,
} from "node:crypto";

import {
  createOctokitForInstallation,
} from "../github.js";

import {
  deriveUserLookup,
  encryptRepositoryConnection,
} from "./crypto.js";

import {
  GitHubConnectError,
  type ConnectedRepository,
  type GitHubConnectRepository,
} from "./github-connect.js";

import type {
  RepositoryConnectionStore,
} from "./store.js";

import type {
  PrincipalIdentity,
  RepositoryConnectionPayload,
} from "./types.js";

type GitHubInstallationClient =
  ReturnType<
    typeof createOctokitForInstallation
  >;

export type GitHubInstallationSelectionOptions =
  Readonly<{
    store:
      RepositoryConnectionStore;

    lookupKey:
      Uint8Array;

    encryptionKey:
      Uint8Array;

    createGitHubClient?:
      (
        installationId:
          string | number,
      ) =>
        GitHubInstallationClient;

    createConnectionId?:
      () => string;

    now?:
      () => Date;
  }>;

function numericId(
  value: string,
  label: string,
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
      `${label} is invalid`,
    );
  }

  return normalized;
}

function parseRepository(
  value: unknown,
): GitHubConnectRepository | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const repository =
    value as
      Record<string, unknown>;

  const owner =
    repository.owner;

  if (
    typeof owner !== "object" ||
    owner === null ||
    Array.isArray(owner)
  ) {
    return null;
  }

  const ownerRecord =
    owner as
      Record<string, unknown>;

  if (
    (
      typeof repository.id !==
        "number" &&
      typeof repository.id !==
        "string"
    ) ||
    typeof repository.name !==
      "string" ||
    !repository.name ||
    typeof repository.default_branch !==
      "string" ||
    !repository.default_branch ||
    typeof ownerRecord.login !==
      "string" ||
    !ownerRecord.login
  ) {
    return null;
  }

  const repositoryId =
    String(repository.id);

  if (
    !/^[1-9][0-9]*$/.test(
      repositoryId,
    )
  ) {
    return null;
  }

  return {
    repositoryId,
    owner:
      ownerRecord.login,
    name:
      repository.name,
    defaultBranch:
      repository.default_branch,
  };
}

export class GitHubInstallationSelection {
  private readonly store:
    RepositoryConnectionStore;

  private readonly lookupKey:
    Buffer;

  private readonly encryptionKey:
    Buffer;

  private readonly createGitHubClient:
    (
      installationId:
        string | number,
    ) =>
      GitHubInstallationClient;

  private readonly createConnectionId:
    () => string;

  private readonly now:
    () => Date;

  constructor(
    options:
      GitHubInstallationSelectionOptions,
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

    this.createGitHubClient =
      options.createGitHubClient ??
      createOctokitForInstallation;

    this.createConnectionId =
      options.createConnectionId ??
      randomUUID;

    this.now =
      options.now ??
      (() => new Date());
  }

  private async findRepository(
    installationId: string,
    repositoryId: string,
  ): Promise<
    GitHubConnectRepository
  > {
    const client =
      this.createGitHubClient(
        installationId,
      );

    for (
      let page = 1;
      page <= 100;
      page += 1
    ) {
      let response:
        Awaited<
          ReturnType<
            GitHubInstallationClient["request"]
          >
        >;

      try {
        response =
          await client.request(
            "GET /installation/repositories",
            {
              per_page: 100,
              page,

              headers: {
                "X-GitHub-Api-Version":
                  "2026-03-10",
              },
            },
          );
      } catch (
        error: unknown
      ) {
        const status =
          (
            error as
              {
                status?: unknown;
              }
          )?.status;

        if (
          status === 401 ||
          status === 403 ||
          status === 404
        ) {
          throw new GitHubConnectError(
            "github_installation_unavailable",
            "GitHub installation is unavailable",
          );
        }

        throw new GitHubConnectError(
          "github_provider_error",
          "GitHub installation repository verification failed",
        );
      }

      const data =
        response.data as
          {
            total_count?: unknown;
            repositories?: unknown;
          };

      if (
        !Array.isArray(
          data.repositories,
        )
      ) {
        throw new GitHubConnectError(
          "github_provider_error",
          "GitHub returned an invalid installation repository response",
        );
      }

      for (
        const candidate
        of data.repositories
      ) {
        const repository =
          parseRepository(
            candidate,
          );

        if (!repository) {
          throw new GitHubConnectError(
            "github_provider_error",
            "GitHub returned an invalid installation repository",
          );
        }

        if (
          repository.repositoryId ===
          repositoryId
        ) {
          return repository;
        }
      }

      const totalCount =
        data.total_count;

      if (
        typeof totalCount ===
          "number" &&
        Number.isFinite(
          totalCount,
        ) &&
        page * 100 >=
          totalCount
      ) {
        break;
      }

      if (
        data.repositories.length === 0
      ) {
        break;
      }
    }

    throw new GitHubConnectError(
      "github_repository_unavailable",
      "GitHub repository is unavailable to this installation",
    );
  }

  async connect(
    principal:
      PrincipalIdentity,

    rawInstallationId:
      string,

    rawRepositoryId:
      string,
  ): Promise<
    ConnectedRepository
  > {
    const installationId =
      numericId(
        rawInstallationId,
        "GitHub installation ID",
      );

    const repositoryId =
      numericId(
        rawRepositoryId,
        "GitHub repository ID",
      );

    const repository =
      await this.findRepository(
        installationId,
        repositoryId,
      );

    const connectionId =
      this.createConnectionId()
        .trim();

    if (!connectionId) {
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

        installationId,

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
      id:
        connectionId,

      userLookup,

      encryptedPayload:
        encryptRepositoryConnection(
          payload,
          this.encryptionKey,
          connectionId,
          userLookup,
        ),

      createdAt:
        this.now()
          .toISOString(),
    });

    return {
      connectionId,
      provider:
        "github",

      installationId,

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
