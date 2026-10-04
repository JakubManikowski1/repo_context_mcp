import "dotenv/config";
import fs from "node:fs";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export const githubConfig = {
  appId: required("GITHUB_APP_ID"),
  installationId: Number(required("GITHUB_INSTALLATION_ID")),
  owner: required("GITHUB_OWNER"),
  repo: required("GITHUB_REPO"),
  branch: required("GITHUB_BRANCH"),
  privateKeyPath: required("GITHUB_PRIVATE_KEY_PATH"),
};

const privateKey = fs.readFileSync(
  githubConfig.privateKeyPath,
  "utf8",
);

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: githubConfig.appId,
    privateKey,
    installationId: githubConfig.installationId,
  },
});

export function getOctokit(): Octokit {
  return octokit;
}
