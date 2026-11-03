import type {
  RepositoryContext,
} from "./repository-context.js";

import type {
  StaticRepositoryRegistration,
} from "./static-repository-registry.js";

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
  repository: RepositoryContext,
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

export function createStaticRepositoryAccess(
  registrations:
    readonly StaticRepositoryRegistration[],
): RepositoryToolAccess {
  if (registrations.length === 0) {
    throw new Error(
      "Static repository access requires at least one repository",
    );
  }

  const byId =
    new Map(
      registrations.map(
        (registration) => [
          registration.id,
          registration.repository,
        ],
      ),
    );

  return {
    async list() {
      return registrations.map(
        (registration) => ({
          repositoryId:
            registration.id,

          provider:
            registration.repository.provider,

          owner:
            registration.repository.owner,

          name:
            registration.repository.repo,

          branch:
            registration.repository.branch,
        }),
      );
    },

    async resolve(repositoryId) {
      const normalizedRepositoryId =
        repositoryId?.trim();

      if (normalizedRepositoryId) {
        const repository =
          byId.get(
            normalizedRepositoryId,
          );

        if (!repository) {
          throw new RepositoryAccessError(
            "repository_not_found",
            "Repository connection not found",
          );
        }

        return repository;
      }

      if (registrations.length > 1) {
        throw new RepositoryAccessError(
          "repository_required",
          "repository_id is required when more than one repository is configured",
        );
      }

      return registrations[0].repository;
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
