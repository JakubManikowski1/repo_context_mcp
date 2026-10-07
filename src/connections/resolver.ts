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
  RepositoryConnectionPayload,
  StoredRepositoryConnection,
} from "./types.js";

export type RepositoryAccessErrorCode =
  | "repository_not_found"
  | "repository_required"
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

export type AccessibleRepository =
  Readonly<{
    id: string;
    provider: "github";
    owner: string;
    repo: string;
    branch: string;
  }>;

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

  private deriveLookup(
    principal: PrincipalIdentity,
  ): string {
    return deriveUserLookup(
      principal,
      this.lookupKey,
    );
  }

  private decryptConnection(
    connection: StoredRepositoryConnection,
  ): RepositoryConnectionPayload {
    try {
      return decryptRepositoryConnection(
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
  }

  private contextFromConnection(
    connection: StoredRepositoryConnection,
    payload: RepositoryConnectionPayload,
  ): RepositoryContext {
    return {
      source: "connection",
      provider: "github",

      // Connection-scoped so caches and repo_code
      // budgets cannot cross user connection boundaries.
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

  async list(
    principal: PrincipalIdentity,
  ): Promise<readonly AccessibleRepository[]> {
    const userLookup =
      this.deriveLookup(principal);

    const connections =
      await this.store.listActiveByUserLookup(
        userLookup,
      );

    return connections.map(
      (connection) => {
        const payload =
          this.decryptConnection(
            connection,
          );

        return {
          id: connection.id,
          provider: payload.provider,
          owner: payload.owner,
          repo: payload.name,
          branch: payload.branch,
        };
      },
    );
  }

  async resolveSelected(
    principal: PrincipalIdentity,
    connectionId?: string,
  ): Promise<RepositoryContext> {
    const normalizedConnectionId =
      connectionId?.trim();

    if (normalizedConnectionId) {
      return this.resolve(
        principal,
        normalizedConnectionId,
      );
    }

    const userLookup =
      this.deriveLookup(principal);

    const connections =
      await this.store.listActiveByUserLookup(
        userLookup,
      );

    if (connections.length === 0) {
      throw new RepositoryAccessError(
        "repository_not_found",
        "No active repository connection found",
      );
    }

    if (connections.length > 1) {
      throw new RepositoryAccessError(
        "repository_required",
        "repository_id is required when more than one repository is connected",
      );
    }

    return this.resolve(
      principal,
      connections[0].id,
    );
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

    const userLookup =
      this.deriveLookup(principal);

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

    const payload =
      this.decryptConnection(
        connection,
      );

    return this.contextFromConnection(
      connection,
      payload,
    );
  }
}
