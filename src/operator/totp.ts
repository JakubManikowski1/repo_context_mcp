import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const DEFAULT_STEP_SECONDS =
  30;

const DEFAULT_DIGITS =
  6;

const MIN_SECRET_BYTES =
  20;

export type TotpVerificationResult =
  Readonly<{
    counter: number;
  }>;

export function decodeTotpSecret(
  rawSecret: string,
): Buffer {
  const compact =
    rawSecret
      .trim()
      .toUpperCase()
      .replace(
        /\s+/g,
        "",
      );

  const normalized =
    compact.replace(
      /=+$/,
      "",
    );

  if (
    !normalized ||
    !/^[A-Z2-7]+$/.test(
      normalized,
    )
  ) {
    throw new Error(
      "TOTP secret must be valid base32",
    );
  }

  let accumulator = 0;
  let bits = 0;

  const bytes:
    number[] = [];

  for (
    const character
    of normalized
  ) {
    const value =
      BASE32_ALPHABET.indexOf(
        character,
      );

    if (value < 0) {
      throw new Error(
        "TOTP secret must be valid base32",
      );
    }

    accumulator =
      (
        accumulator << 5
      ) |
      value;

    bits += 5;

    while (bits >= 8) {
      bits -= 8;

      bytes.push(
        (
          accumulator >>
          bits
        ) &
        0xff,
      );

      accumulator &=
        (
          1 << bits
        ) - 1;
    }
  }

  const decoded =
    Buffer.from(
      bytes,
    );

  if (
    decoded.length <
      MIN_SECRET_BYTES
  ) {
    throw new Error(
      `TOTP secret must decode to at least ${MIN_SECRET_BYTES} bytes`,
    );
  }

  return decoded;
}

function counterForTime(
  timeMs: number,
  stepSeconds:
    number,
): number {
  if (
    !Number.isFinite(
      timeMs,
    ) ||
    timeMs < 0
  ) {
    throw new Error(
      "TOTP time is invalid",
    );
  }

  return Math.floor(
    timeMs /
      1000 /
      stepSeconds,
  );
}

function codeForCounter(
  secret: Buffer,
  counter: number,
  digits:
    number,
): string {
  if (
    !Number.isSafeInteger(
      counter,
    ) ||
    counter < 0
  ) {
    throw new Error(
      "TOTP counter is invalid",
    );
  }

  const message =
    Buffer.alloc(8);

  message.writeBigUInt64BE(
    BigInt(
      counter,
    ),
  );

  const digest =
    createHmac(
      "sha1",
      secret,
    )
      .update(
        message,
      )
      .digest();

  const offset =
    digest[
      digest.length - 1
    ] &
    0x0f;

  const binary =
    (
      (
        digest[offset] &
        0x7f
      ) <<
      24
    ) |
    (
      digest[
        offset + 1
      ] <<
      16
    ) |
    (
      digest[
        offset + 2
      ] <<
      8
    ) |
    digest[
      offset + 3
    ];

  const modulus =
    10 ** digits;

  return String(
    binary %
      modulus,
  ).padStart(
    digits,
    "0",
  );
}

export function generateTotpCode(
  secret: Buffer,
  timeMs: number,
  options?: Readonly<{
    stepSeconds?: number;
    digits?: number;
  }>,
): string {
  const stepSeconds =
    options?.stepSeconds ??
    DEFAULT_STEP_SECONDS;

  const digits =
    options?.digits ??
    DEFAULT_DIGITS;

  if (
    !Number.isSafeInteger(
      stepSeconds,
    ) ||
    stepSeconds <= 0
  ) {
    throw new Error(
      "TOTP step must be a positive integer",
    );
  }

  if (
    !Number.isSafeInteger(
      digits,
    ) ||
    digits < 6 ||
    digits > 8
  ) {
    throw new Error(
      "TOTP digits must be between 6 and 8",
    );
  }

  return codeForCounter(
    secret,
    counterForTime(
      timeMs,
      stepSeconds,
    ),
    digits,
  );
}

export function verifyTotpCode(
  secret: Buffer,
  rawCode: string,
  timeMs: number,
): TotpVerificationResult | null {
  const code =
    rawCode.trim();

  if (
    !/^\d{6}$/.test(
      code,
    )
  ) {
    return null;
  }

  const currentCounter =
    counterForTime(
      timeMs,
      DEFAULT_STEP_SECONDS,
    );

  /*
   * Permit one 30-second step of clock
   * skew in either direction.
   */
  for (
    const offset
    of [-1, 0, 1]
  ) {
    const counter =
      currentCounter +
      offset;

    if (counter < 0) {
      continue;
    }

    const expected =
      codeForCounter(
        secret,
        counter,
        DEFAULT_DIGITS,
      );

    const expectedBytes =
      Buffer.from(
        expected,
        "ascii",
      );

    const providedBytes =
      Buffer.from(
        code,
        "ascii",
      );

    if (
      timingSafeEqual(
        expectedBytes,
        providedBytes,
      )
    ) {
      return {
        counter,
      };
    }
  }

  return null;
}
