import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import type {
  PrincipalIdentity,
  RepositoryConnectionPayload,
} from "./types.js";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

const USER_LOOKUP_PREFIX = "ul1_";
const ENCRYPTED_PAYLOAD_PREFIX = "rc1";

const USER_LOOKUP_DOMAIN =
  "repo-context:user-lookup:v1";

const REPOSITORY_CONNECTION_DOMAIN =
  "repo-context:repository-connection:v1";

function requireKey(
  key: Buffer,
  label: string,
): void {
  if (
    !Buffer.isBuffer(key) ||
    key.length !== KEY_BYTES
  ) {
    throw new Error(
      `${label} must be exactly ${KEY_BYTES} bytes`,
    );
  }
}

function requireIdentityPart(
  value: string,
  label: string,
): void {
  if (!value || value.includes("\0")) {
    throw new Error(
      `${label} must be non-empty and must not contain NUL`,
    );
  }
}

function requireBindingPart(
  value: string,
  label: string,
): void {
  if (!value || value.includes("\0")) {
    throw new Error(
      `${label} must be non-empty and must not contain NUL`,
    );
  }
}

function assertRepositoryConnectionPayload(
  value: unknown,
): asserts value is RepositoryConnectionPayload {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new Error(
      "Invalid repository connection payload",
    );
  }

  const payload = value as Record<string, unknown>;

  if (
    payload.version !== 1 ||
    payload.provider !== "github"
  ) {
    throw new Error(
      "Unsupported repository connection payload",
    );
  }

  const requiredStrings = [
    "installationId",
    "repositoryId",
    "owner",
    "name",
    "branch",
  ] as const;

  for (const field of requiredStrings) {
    const fieldValue = payload[field];

    if (
      typeof fieldValue !== "string" ||
      !fieldValue ||
      fieldValue.includes("\0")
    ) {
      throw new Error(
        `Invalid repository connection field: ${field}`,
      );
    }
  }
}

function additionalAuthenticatedData(
  connectionId: string,
  userLookup: string,
): Buffer {
  requireBindingPart(
    connectionId,
    "connectionId",
  );

  requireBindingPart(
    userLookup,
    "userLookup",
  );

  return Buffer.from(
    [
      REPOSITORY_CONNECTION_DOMAIN,
      connectionId,
      userLookup,
    ].join("\0"),
    "utf8",
  );
}

function decodeBase64Url(
  value: string,
  label: string,
): Buffer {
  if (
    !value ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error(
      `Invalid ${label} encoding`,
    );
  }

  return Buffer.from(value, "base64url");
}

export function deriveUserLookup(
  principal: PrincipalIdentity,
  lookupKey: Buffer,
): string {
  requireKey(
    lookupKey,
    "lookupKey",
  );

  requireIdentityPart(
    principal.issuer,
    "principal.issuer",
  );

  requireIdentityPart(
    principal.subject,
    "principal.subject",
  );

  const digest = createHmac(
    "sha256",
    lookupKey,
  )
    .update(USER_LOOKUP_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(principal.issuer, "utf8")
    .update("\0", "utf8")
    .update(principal.subject, "utf8")
    .digest("base64url");

  return `${USER_LOOKUP_PREFIX}${digest}`;
}

export function encryptRepositoryConnection(
  payload: RepositoryConnectionPayload,
  encryptionKey: Buffer,
  connectionId: string,
  userLookup: string,
): string {
  requireKey(
    encryptionKey,
    "encryptionKey",
  );

  assertRepositoryConnectionPayload(payload);

  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(
    "aes-256-gcm",
    encryptionKey,
    iv,
    {
      authTagLength: AUTH_TAG_BYTES,
    },
  );

  cipher.setAAD(
    additionalAuthenticatedData(
      connectionId,
      userLookup,
    ),
  );

  const plaintext = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  );

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTED_PAYLOAD_PREFIX,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

export function decryptRepositoryConnection(
  encryptedPayload: string,
  encryptionKey: Buffer,
  connectionId: string,
  userLookup: string,
): RepositoryConnectionPayload {
  requireKey(
    encryptionKey,
    "encryptionKey",
  );

  const parts = encryptedPayload.split(".");

  if (
    parts.length !== 4 ||
    parts[0] !== ENCRYPTED_PAYLOAD_PREFIX
  ) {
    throw new Error(
      "Unsupported encrypted repository connection format",
    );
  }

  const iv = decodeBase64Url(
    parts[1],
    "IV",
  );

  const ciphertext = decodeBase64Url(
    parts[2],
    "ciphertext",
  );

  const authTag = decodeBase64Url(
    parts[3],
    "authentication tag",
  );

  if (iv.length !== IV_BYTES) {
    throw new Error(
      "Invalid repository connection IV length",
    );
  }

  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      "Invalid repository connection authentication tag length",
    );
  }

  if (ciphertext.length === 0) {
    throw new Error(
      "Repository connection ciphertext is empty",
    );
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    iv,
    {
      authTagLength: AUTH_TAG_BYTES,
    },
  );

  decipher.setAAD(
    additionalAuthenticatedData(
      connectionId,
      userLookup,
    ),
  );

  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  let parsed: unknown;

  try {
    parsed = JSON.parse(
      plaintext.toString("utf8"),
    );
  } catch {
    throw new Error(
      "Decrypted repository connection is not valid JSON",
    );
  }

  assertRepositoryConnectionPayload(parsed);

  return parsed;
}
