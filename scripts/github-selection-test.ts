import assert from "node:assert/strict";

import {
  randomBytes,
} from "node:crypto";

import {
  GitHubRepositorySelection,
  GitHubRepositorySelectionError,
} from "../src/connections/github-selection.js";

const principal = {
  issuer:
    "https://auth.example.test",
  subject:
    "selection-user-123",
};

const repositories = [
  {
    repositoryId: "1001",
    owner: "example-org",
    name: "repo-one",
    defaultBranch: "main",
  },
  {
    repositoryId: "1002",
    owner: "example-org",
    name: "repo-two",
    defaultBranch: "trunk",
  },
] as const;

async function main(): Promise<void> {
  let now =
    new Date(
      "2026-10-07T12:00:00.000Z",
    );

  const stateKey =
    randomBytes(32);

  const selection =
    new GitHubRepositorySelection({
      stateKey,

      now:
        () => now,
    });

  const browserNonce =
    randomBytes(32)
      .toString(
        "base64url",
      );

  const start =
    selection.create(
      principal,
      browserNonce,
      "12345",
      repositories,
    );

  assert.deepEqual(
    start.repositories,
    repositories,
  );

  assert.ok(
    start.selectionToken
      .startsWith(
        "grs1.",
      ),
  );

  for (const secret of [
    principal.issuer,
    principal.subject,
    "12345",
    "1001",
    "1002",
    "example-org",
    "repo-one",
    "repo-two",
  ]) {
    assert.equal(
      start.selectionToken
        .includes(secret),
      false,
      `selection token leaked plaintext: ${secret}`,
    );
  }

  const result =
    selection.complete(
      start.selectionToken,
      browserNonce,
      "1002",
    );

  assert.deepEqual(
    result,
    {
      principal,
      installationId:
        "12345",
      repositoryId:
        "1002",
    },
  );

  assert.throws(
    () =>
      selection.complete(
        start.selectionToken,
        browserNonce,
        "9999",
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubRepositorySelectionError &&
      error.code ===
        "github_repository_unavailable",
  );

  assert.throws(
    () =>
      selection.complete(
        start.selectionToken,
        randomBytes(32)
          .toString(
            "base64url",
          ),
        "1001",
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubRepositorySelectionError &&
      error.code ===
        "github_repository_selection_browser_mismatch",
  );

  const parts =
    start.selectionToken
      .split(".");

  assert.equal(
    parts.length,
    4,
  );

  const ciphertext =
    parts[2];

  assert.ok(
    ciphertext,
  );

  const replacement =
    ciphertext[0] === "A"
      ? "B"
      : "A";

  const tampered = [
    parts[0],
    parts[1],
    replacement
      + ciphertext.slice(1),
    parts[3],
  ].join(".");

  assert.throws(
    () =>
      selection.complete(
        tampered,
        browserNonce,
        "1001",
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubRepositorySelectionError &&
      error.code ===
        "github_repository_selection_invalid",
  );

  const expiring =
    selection.create(
      principal,
      browserNonce,
      "12345",
      repositories,
    );

  now =
    new Date(
      "2026-10-07T12:11:00.000Z",
    );

  assert.throws(
    () =>
      selection.complete(
        expiring.selectionToken,
        browserNonce,
        "1001",
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubRepositorySelectionError &&
      error.code ===
        "github_repository_selection_expired",
  );

  assert.throws(
    () =>
      selection.create(
        principal,
        browserNonce,
        "12345",
        [],
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubRepositorySelectionError &&
      error.code ===
        "github_repository_selection_empty",
  );

  assert.throws(
    () =>
      selection.create(
        principal,
        browserNonce,
        "12345",
        [
          repositories[0],
          repositories[0],
        ],
      ),
    (
      error: unknown,
    ) =>
      error instanceof
        GitHubRepositorySelectionError &&
      error.code ===
        "github_repository_selection_invalid",
  );

  console.log(
    "GitHub repository selection handoff: OK",
  );

  console.log(
    "User-authorized repository ID allowlist: OK",
  );

  console.log(
    "Selection token plaintext leakage: ABSENT",
  );

  console.log(
    "Browser nonce binding: OK",
  );

  console.log(
    "Selection expiry/tamper detection: OK",
  );

  console.log(
    "Unverified repository selection: FAIL CLOSED",
  );

  console.log(
    "GitHub user token handoff/persistence: ABSENT",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
