import {
  getLegacyRepositoryContext,
  type RepositoryContext,
} from "./repository-context.js";

import {
  RepositoryAccessError,
  type RepositoryAccessResolver,
} from "./connections/resolver.js";

import type {
  PrincipalIdentity,
} from "./connections/types.js";

export type RepositoryListItem = Readonly<{
  repositoryId: string | null;
  provider: "github";
  owner: string;
  name: string;
  branch: string;
}>;

export interface RepositoryToolAccess {
  list(): Promise<readonly RepositoryListItem[]>;

  resolve(
    repositoryId?: string,
  ): Promise<RepositoryContext>;
}

export function createLegacyRepositoryAccess(
  repository:
    RepositoryContext =
      getLegacyRepositoryContext(),
): RepositoryToolAccess {
  return {
    async list() {
      return [
        {
          repositoryId: null,
          provider: repository.provider,
          owner: repository.owner,
          name: repository.repo,
          branch: repository.branch,
        },
      ];
    },

    async resolve(repositoryId) {
      if (repositoryId?.trim()) {
        throw new RepositoryAccessError(
          "repository_not_found",
          "Repository connection not found",
        );
      }

      return repository;
    },
  };
}

export function createConnectionRepositoryAccess(
  resolver: RepositoryAccessResolver,
  principal: PrincipalIdentity,
): RepositoryToolAccess {
  const boundPrincipal: PrincipalIdentity = {
    issuer: principal.issuer,
    subject: principal.subject,
  };

  return {
    async list() {
      const repositories =
        await resolver.list(
          boundPrincipal,
        );

      return repositories.map(
        (repository) => ({
          repositoryId: repository.id,
          provider: repository.provider,
          owner: repository.owner,
          name: repository.repo,
          branch: repository.branch,
        }),
      );
    },

    async resolve(repositoryId) {
      return resolver.resolveSelected(
        boundPrincipal,
        repositoryId,
      );
    },
  };
}
