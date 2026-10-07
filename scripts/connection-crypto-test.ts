import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  decryptRepositoryConnection,
  deriveUserLookup,
  encryptRepositoryConnection,
} from "../src/connections/crypto.js";

import type {
  PrincipalIdentity,
  RepositoryConnectionPayload,
} from "../src/connections/types.js";

const lookupKey = randomBytes(32);
const encryptionKey = randomBytes(32);

const principal: PrincipalIdentity = {
  issuer: "https://auth.example.test",
  subject: "user_123",
};

const payload: RepositoryConnectionPayload = {
  version: 1,
  provider: "github",
  installationId: "123456",
  repositoryId: "987654",
  owner: "private-owner",
  name: "private-repository",
  branch: "main",
};

const connectionId = "conn_test_001";

const userLookup = deriveUserLookup(
  principal,
  lookupKey,
);

assert.match(
  userLookup,
  /^ul1_[A-Za-z0-9_-]+$/,
);

assert.equal(
  deriveUserLookup(
    principal,
    lookupKey,
  ),
  userLookup,
  "same principal must produce same lookup",
);

assert.notEqual(
  deriveUserLookup(
    {
      ...principal,
      subject: "user_456",
    },
    lookupKey,
  ),
  userLookup,
  "different subject must produce different lookup",
);

assert.notEqual(
  deriveUserLookup(
    {
      ...principal,
      issuer: "https://other.example.test",
    },
    lookupKey,
  ),
  userLookup,
  "different issuer must produce different lookup",
);

const encryptedA =
  encryptRepositoryConnection(
    payload,
    encryptionKey,
    connectionId,
    userLookup,
  );

const encryptedB =
  encryptRepositoryConnection(
    payload,
    encryptionKey,
    connectionId,
    userLookup,
  );

assert.match(
  encryptedA,
  /^rc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
);

assert.notEqual(
  encryptedA,
  encryptedB,
  "random IV must produce different ciphertext",
);

assert.deepEqual(
  decryptRepositoryConnection(
    encryptedA,
    encryptionKey,
    connectionId,
    userLookup,
  ),
  payload,
);

for (const sensitiveValue of [
  principal.issuer,
  principal.subject,
  payload.installationId,
  payload.repositoryId,
  payload.owner,
  payload.name,
]) {
  assert.equal(
    encryptedA.includes(sensitiveValue),
    false,
    `ciphertext leaked plaintext value: ${sensitiveValue}`,
  );
}

assert.throws(
  () =>
    decryptRepositoryConnection(
      encryptedA,
      encryptionKey,
      "conn_other",
      userLookup,
    ),
  "connection ID substitution must fail authentication",
);

assert.throws(
  () =>
    decryptRepositoryConnection(
      encryptedA,
      encryptionKey,
      connectionId,
      deriveUserLookup(
        {
          ...principal,
          subject: "user_other",
        },
        lookupKey,
      ),
    ),
  "user lookup substitution must fail authentication",
);

assert.throws(
  () =>
    decryptRepositoryConnection(
      encryptedA,
      randomBytes(32),
      connectionId,
      userLookup,
    ),
  "wrong encryption key must fail",
);

const tamperedParts = encryptedA.split(".");
const ciphertext = Buffer.from(
  tamperedParts[2],
  "base64url",
);

ciphertext[0] ^= 1;

tamperedParts[2] =
  ciphertext.toString("base64url");

assert.throws(
  () =>
    decryptRepositoryConnection(
      tamperedParts.join("."),
      encryptionKey,
      connectionId,
      userLookup,
    ),
  "ciphertext tampering must fail authentication",
);

assert.throws(
  () =>
    decryptRepositoryConnection(
      "rc0.invalid.invalid.invalid",
      encryptionKey,
      connectionId,
      userLookup,
    ),
  "unsupported crypto format must fail",
);

assert.throws(
  () =>
    deriveUserLookup(
      principal,
      randomBytes(31),
    ),
  "lookup key must be exactly 32 bytes",
);

assert.throws(
  () =>
    encryptRepositoryConnection(
      payload,
      randomBytes(31),
      connectionId,
      userLookup,
    ),
  "encryption key must be exactly 32 bytes",
);

console.log("Connection crypto: OK");
console.log("HMAC user lookup: OK");
console.log("AES-256-GCM round trip: OK");
console.log("Randomized ciphertext: OK");
console.log("Row/user binding via AAD: OK");
console.log("Tamper detection: OK");
console.log("Plaintext leakage check: OK");
