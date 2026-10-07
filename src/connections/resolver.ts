import {
  createOctokitForInstallation,
} from "../github.js";

import type {
  RepositoryContext,
} from "../repository-context.js";

import {
  decryptRepositoryConnection,
  deriveUserLookup,
} from "./crypto.js";

import type {
  RepositoryConnectionStore,
} from "./store.js";

import type {
  PrincipalIdentity,
} from "./types.js";

export type RepositoryAccessErrorCode =
  | "repository_not_found"
  | "repository_connection_invalid";

export class RepositoryAccessError
  extends Error
{
  readonly code: RepositoryAccessErrorCode;

  constructor(
    code: RepositoryAccessErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryAccessError";
    this.code = code;
  }
}

type GitHubClientFactory = (
  installationId: string | number,
) => RepositoryContext["octokit"];

export type RepositoryAccessResolverOptions =
  Readonly<{
    store: RepositoryConnectionStore;
    lookupKey: Buffer;
    encryptionKey: Buffer;
    createGitHubClient?: GitHubClientFactory;
  }>;

export class RepositoryAccessResolver {
  private readonly store:
    RepositoryConnectionStore;

  private readonly lookupKey: Buffer;
  private readonly encryptionKey: Buffer;

  private readonly createGitHubClient:
    GitHubClientFactory;

  constructor(
    options: RepositoryAccessResolverOptions,
  ) {
    this.store = options.store;

    this.lookupKey =
      Buffer.from(options.lookupKey);

    this.encryptionKey =
      Buffer.from(options.encryptionKey);

    if (
      this.lookupKey.equals(
        this.encryptionKey,
      )
    ) {
      throw new Error(
        "lookupKey and encryptionKey must be distinct",
      );
    }

    this.createGitHubClient =
      options.createGitHubClient ??
      createOctokitForInstallation;
  }

  async resolve(
    principal: PrincipalIdentity,
    connectionId: string,
  ): Promise<RepositoryContext> {
    const normalizedConnectionId =
      connectionId.trim();

    if (!normalizedConnectionId) {
      throw new RepositoryAccessError(
        "repository_not_found",
        "Repository connection not found",
      );
    }

    const userLookup = deriveUserLookup(
      principal,
      this.lookupKey,
    );

    const connection =
      await this.store.findActiveByIdForUser(
        userLookup,
        normalizedConnectionId,
      );

    if (!connection) {
      throw new RepositoryAccessError(
        "repository_not_found",
        "Repository connection not found",
      );
    }

    let payload;

    try {
      payload =
        decryptRepositoryConnection(
          connection.encryptedPayload,
          this.encryptionKey,
          connection.id,
          connection.userLookup,
        );
    } catch (error) {
      throw new RepositoryAccessError(
        "repository_connection_invalid",
        "Repository connection could not be decrypted",
        {
          cause: error,
        },
      );
    }

    return {
      source: "connection",
      provider: "github",

      // Deliberately connection-scoped rather than
      // repository-scoped. This prevents in-memory
      // caches and repo_code budgets from being shared
      // across different user connections.
      key: `connection:${connection.id}`,

      owner: payload.owner,
      repo: payload.name,
      branch: payload.branch,

      octokit:
        this.createGitHubClient(
          payload.installationId,
        ),
    };
  }
}
