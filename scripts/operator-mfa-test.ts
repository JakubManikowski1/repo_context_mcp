import assert from "node:assert/strict";

import {
  decodeTotpSecret,
  generateTotpCode,
} from "../src/operator/totp.js";

import {
  OperatorMfaError,
  OperatorPrivilegedSessionService,
  PRIVILEGED_SESSION_TTL_MS,
} from "../src/operator/privileged-session.js";

const RFC_SECRET_BASE32 =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

async function expectMfaError(
  action: () => unknown,
  expectedCode: string,
): Promise<void> {
  try {
    action();

    assert.fail(
      "Expected operator MFA operation to fail",
    );
  } catch (error) {
    assert.ok(
      error instanceof
        OperatorMfaError,
    );

    assert.equal(
      error.code,
      expectedCode,
    );
  }
}

async function main() {
  const secret =
    decodeTotpSecret(
      RFC_SECRET_BASE32,
    );

  /*
   * RFC 6238 SHA-1 vector at T=59
   * is 94287082 for 8 digits.
   * The corresponding 6-digit code
   * is therefore 287082.
   */
  assert.equal(
    generateTotpCode(
      secret,
      59_000,
    ),
    "287082",
  );

  assert.throws(
    () =>
      decodeTotpSecret(
        "ABC",
      ),
    /at least 20 bytes/,
  );

  assert.throws(
    () =>
      decodeTotpSecret(
        "not-valid-***",
      ),
    /valid base32/,
  );

  let nowMs =
    59_000;

  const service =
    new OperatorPrivilegedSessionService({
      operatorId:
        "primary-operator",

      totpSecretBase32:
        RFC_SECRET_BASE32,

      now:
        () =>
          new Date(
            nowMs,
          ),
    });

  await expectMfaError(
    () =>
      service.issueSession(
        "000000",
      ),
    "operator_mfa_invalid",
  );

  let throttleNowMs =
    59_000;

  const throttledService =
    new OperatorPrivilegedSessionService({
      operatorId:
        "primary-operator",

      totpSecretBase32:
        RFC_SECRET_BASE32,

      now:
        () =>
          new Date(
            throttleNowMs,
          ),
    });

  for (
    let attempt = 0;
    attempt < 5;
    attempt += 1
  ) {
    await expectMfaError(
      () =>
        throttledService
          .issueSession(
            "000000",
          ),
      "operator_mfa_invalid",
    );
  }

  await expectMfaError(
    () =>
      throttledService
        .issueSession(
          "000000",
        ),
    "operator_mfa_rate_limited",
  );

  throttleNowMs +=
    60_001;

  await expectMfaError(
    () =>
      throttledService
        .issueSession(
          "000000",
        ),
    "operator_mfa_invalid",
  );

  const validCode =
    generateTotpCode(
      secret,
      nowMs,
    );

  const started =
    service.issueSession(
      validCode,
    );

  assert.match(
    started.token,
    /^ops1\.[A-Za-z0-9_-]{43}$/,
  );

  assert.equal(
    started.operatorId,
    "primary-operator",
  );

  assert.equal(
    started.expiresAt,
    new Date(
      59_000 +
        PRIVILEGED_SESSION_TTL_MS,
    ).toISOString(),
  );

  assert.ok(
    !started.token.includes(
      RFC_SECRET_BASE32,
    ),
  );

  const active =
    service.requireSession(
      started.token,
    );

  assert.equal(
    active.operatorId,
    "primary-operator",
  );

  assert.equal(
    active.authenticatedAt,
    new Date(
      59_000,
    ).toISOString(),
  );

  await expectMfaError(
    () =>
      service.issueSession(
        validCode,
      ),
    "operator_mfa_replayed",
  );

  await expectMfaError(
    () =>
      service.requireSession(
        "ops1.invalid",
      ),
    "operator_session_invalid",
  );

  nowMs =
    59_000 +
    PRIVILEGED_SESSION_TTL_MS -
    1;

  assert.equal(
    service.requireSession(
      started.token,
    ).operatorId,
    "primary-operator",
  );

  nowMs =
    59_000 +
    PRIVILEGED_SESSION_TTL_MS;

  await expectMfaError(
    () =>
      service.requireSession(
        started.token,
      ),
    "operator_session_expired",
  );

  nowMs =
    120_000;

  const second =
    service.issueSession(
      generateTotpCode(
        secret,
        nowMs,
      ),
    );

  assert.equal(
    service.revokeSession(
      second.token,
    ),
    true,
  );

  assert.equal(
    service.revokeSession(
      second.token,
    ),
    false,
  );

  await expectMfaError(
    () =>
      service.requireSession(
        second.token,
      ),
    "operator_session_invalid",
  );

  /*
   * Session stores are process-local.
   * A second service cannot use a live
   * token issued by the first service.
   */
  nowMs =
    180_000;

  const processLocal =
    service.issueSession(
      generateTotpCode(
        secret,
        nowMs,
      ),
    );

  assert.equal(
    service.requireSession(
      processLocal.token,
    ).operatorId,
    "primary-operator",
  );

  const restartedService =
    new OperatorPrivilegedSessionService({
      operatorId:
        "primary-operator",

      totpSecretBase32:
        RFC_SECRET_BASE32,

      now:
        () =>
          new Date(
            nowMs,
          ),
    });

  await expectMfaError(
    () =>
      restartedService
        .requireSession(
          processLocal.token,
        ),
    "operator_session_invalid",
  );

  /*
   * A privileged session authorizes
   * exactly one sensitive operation.
   */
  nowMs =
    240_000;

  const oneShot =
    service.issueSession(
      generateTotpCode(
        secret,
        nowMs,
      ),
    );

  const consumed =
    service.consumeSession(
      oneShot.token,
    );

  assert.equal(
    consumed.operatorId,
    "primary-operator",
  );

  await expectMfaError(
    () =>
      service.requireSession(
        oneShot.token,
      ),
    "operator_session_invalid",
  );

  console.log(
    "Operator TOTP and privileged session: OK",
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
