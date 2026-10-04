import "dotenv/config";
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

function requiredNumber(name: string): number {
  const raw = required(name);
  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer`,
    );
  }

  return value;
}

export const githubConfig = {
  get appId() {
    return required("GITHUB_APP_ID");
  },

  get installationId() {
    return requiredNumber("GITHUB_INSTALLATION_ID");
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
    return required("GITHUB_PRIVATE_KEY_PATH");
  },
};

let octokit: Octokit | null = null;

export function getOctokit(): Octokit {
  if (octokit) {
    return octokit;
  }

  const privateKey = fs.readFileSync(
    githubConfig.privateKeyPath,
    "utf8",
  );

  octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: githubConfig.appId,
      privateKey,
      installationId: githubConfig.installationId,
    },
  });

  return octokit;
}
