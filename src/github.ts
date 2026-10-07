import fs from "node:fs";

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function positiveSafeInteger(
  value: string | number,
  label: string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(
      `${label} must be a positive integer`,
    );
  }

  return parsed;
}

function requiredNumber(name: string): number {
  return positiveSafeInteger(
    required(name),
    `Environment variable ${name}`,
  );
}

export const githubAppConfig = {
  get appId() {
    return required("GITHUB_APP_ID");
  },

  get privateKeyPath() {
    return required("GITHUB_PRIVATE_KEY_PATH");
  },
};

export const githubConfig = {
  get appId() {
    return githubAppConfig.appId;
  },

  get installationId() {
    return requiredNumber(
      "GITHUB_INSTALLATION_ID",
    );
  },

  get owner() {
    return required("GITHUB_OWNER");
  },

  get repo() {
    return required("GITHUB_REPO");
  },

  get branch() {
    return required("GITHUB_BRANCH");
  },

  get privateKeyPath() {
    return githubAppConfig.privateKeyPath;
  },
};

export function createOctokitForInstallation(
  installationId: string | number,
): Octokit {
  const normalizedInstallationId =
    positiveSafeInteger(
      installationId,
      "GitHub installation ID",
    );

  const privateKey = fs.readFileSync(
    githubAppConfig.privateKeyPath,
    "utf8",
  );

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: githubAppConfig.appId,
      privateKey,
      installationId:
        normalizedInstallationId,
    },
  });
}

let octokit: Octokit | null = null;

export function getOctokit(): Octokit {
  if (octokit) {
    return octokit;
  }

  octokit =
    createOctokitForInstallation(
      githubConfig.installationId,
    );

  return octokit;
}
