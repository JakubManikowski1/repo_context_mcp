import fs from "node:fs";

import {
  createOctokitForInstallation,
} from "./github.js";

import type {
  RepositoryContext,
} from "./repository-context.js";

export type StaticRepositoryDefinition =
  Readonly<{
    id: string;
    installationId: number;
    owner: string;
    repo: string;
    branch: string;
  }>;

export type StaticRepositoryRegistration =
  Readonly<{
    id: string;
    repository: RepositoryContext;
  }>;

type GitHubClientFactory = (
  installationId: string | number,
) => RepositoryContext["octokit"];

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
  );
}

function requiredString(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string"
    || !value.trim()
  ) {
    throw new Error(
      `${label} must be a non-empty string`,
    );
  }

  return value.trim();
}

function repositoryId(
  value: unknown,
  label: string,
): string {
  const id =
    requiredString(
      value,
      label,
    );

  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(
      id,
    )
  ) {
    throw new Error(
      `${label} must contain only letters, numbers, dot, underscore, or hyphen and be at most 64 characters`,
    );
  }

  return id;
}

function installationId(
  value: unknown,
  label: string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : (
          typeof value === "string"
            ? Number(value)
            : Number.NaN
        );

  if (
    !Number.isSafeInteger(parsed)
    || parsed <= 0
  ) {
    throw new Error(
      `${label} must be a positive integer`,
    );
  }

  return parsed;
}

export function parseStaticRepositoryRegistry(
  value: unknown,
): readonly StaticRepositoryDefinition[] {
  if (!isRecord(value)) {
    throw new Error(
      "Repository registry must be a JSON object",
    );
  }

  const repositories =
    value.repositories;

  if (
    !Array.isArray(repositories)
    || repositories.length === 0
  ) {
    throw new Error(
      "Repository registry must contain a non-empty repositories array",
    );
  }

  const seenIds =
    new Set<string>();

  return repositories.map(
    (
      item,
      index,
    ) => {
      if (!isRecord(item)) {
        throw new Error(
          `repositories[${index}] must be an object`,
        );
      }

      const id =
        repositoryId(
          item.id,
          `repositories[${index}].id`,
        );

      if (seenIds.has(id)) {
        throw new Error(
          `Duplicate repository id: ${id}`,
        );
      }

      seenIds.add(id);

      return {
        id,

        installationId:
          installationId(
            item.installationId,
            `repositories[${index}].installationId`,
          ),

        owner:
          requiredString(
            item.owner,
            `repositories[${index}].owner`,
          ),

        repo:
          requiredString(
            item.repo,
            `repositories[${index}].repo`,
          ),

        branch:
          requiredString(
            item.branch,
            `repositories[${index}].branch`,
          ),
      };
    },
  );
}

export function loadStaticRepositoryRegistry(
  filename: string,
): readonly StaticRepositoryDefinition[] {
  const normalizedFilename =
    filename.trim();

  if (!normalizedFilename) {
    throw new Error(
      "Repository registry filename is required",
    );
  }

  let raw: string;

  try {
    raw = fs.readFileSync(
      normalizedFilename,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `Could not read repository registry: ${normalizedFilename}`,
      {
        cause: error,
      },
    );
  }

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Repository registry is not valid JSON: ${normalizedFilename}`,
      {
        cause: error,
      },
    );
  }

  return parseStaticRepositoryRegistry(
    parsed,
  );
}

export function staticRepositoryKey(
  definition:
    StaticRepositoryDefinition,
): string {
  return [
    "static",
    definition.id,
    definition.installationId,
    `${definition.owner}/${definition.repo}`,
    definition.branch,
  ].join(":");
}

export function createStaticRepositoryRegistrations(
  definitions:
    readonly StaticRepositoryDefinition[],
  createGitHubClient:
    GitHubClientFactory =
      createOctokitForInstallation,
): readonly StaticRepositoryRegistration[] {
  return definitions.map(
    (definition) => ({
      id:
        definition.id,

      repository: {
        source:
          "static-registry",

        provider:
          "github",

        key:
          staticRepositoryKey(
            definition,
          ),

        owner:
          definition.owner,

        repo:
          definition.repo,

        branch:
          definition.branch,

        octokit:
          createGitHubClient(
            definition.installationId,
          ),
      },
    }),
  );
}
