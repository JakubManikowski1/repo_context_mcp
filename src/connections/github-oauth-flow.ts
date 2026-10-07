import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import type {
  PrincipalIdentity,
} from "./types.js";

const STATE_PREFIX =
  "gcs1";

const STATE_AAD =
  Buffer.from(
    "repo_context_mcp:github-connect-state:v1",
    "utf8",
  );

const STATE_KEY_DOMAIN =
  "repo_context_mcp:github-connect-state-key:v1";

const DEFAULT_STATE_TTL_MS =
  10 * 60 * 1000;

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type InstallStatePayload =
  Readonly<{
    version: 1;
    phase: "install";
    issuer: string;
    subject: string;
    browserNonce: string;
    expiresAt: number;
  }>;

type AuthorizeStatePayload =
  Readonly<{
    version: 1;
    phase: "authorize";
    issuer: string;
    subject: string;
    browserNonce: string;
    installationId: string;
    codeVerifier: string;
    expiresAt: number;
  }>;

type ConnectStatePayload =
  InstallStatePayload |
  AuthorizeStatePayload;

export type GitHubOAuthFlowErrorCode =
  | "github_connect_state_invalid"
  | "github_connect_state_expired"
  | "github_connect_browser_mismatch"
  | "github_installation_invalid"
  | "github_oauth_code_required"
  | "github_oauth_exchange_failed"
  | "github_oauth_token_invalid";

export class GitHubOAuthFlowError
  extends Error {
  readonly code:
    GitHubOAuthFlowErrorCode;

  constructor(
    code:
      GitHubOAuthFlowErrorCode,
    message: string,
  ) {
    super(message);
    this.name =
      "GitHubOAuthFlowError";
    this.code = code;
  }
}

export type GitHubOAuthFlowOptions =
  Readonly<{
    appSlug: string;
    clientId: string;
    clientSecret: string;
    callbackUrl: URL;
    stateKey: Uint8Array;
    fetch?: FetchLike;
    now?: () => Date;
    stateTtlMs?: number;
  }>;

export type GitHubInstallStart =
  Readonly<{
    installationUrl: URL;
    browserNonce: string;
    expiresAt: string;
  }>;

export type GitHubAuthorizationStart =
  Readonly<{
    authorizationUrl: URL;
    expiresAt: string;
  }>;

export type GitHubAuthorizationResult =
  Readonly<{
    principal: PrincipalIdentity;
    installationId: string;
    githubUserAccessToken: string;
  }>;

function base64url(
  value: Uint8Array,
): string {
  return Buffer
    .from(value)
    .toString("base64url");
}

function nonEmpty(
  value: string,
  label: string,
): string {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new TypeError(
      `${label} must be non-empty`,
    );
  }

  return normalized;
}

function validInstallationId(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !/^[1-9][0-9]*$/.test(
      normalized,
    )
  ) {
    throw new GitHubOAuthFlowError(
      "github_installation_invalid",
      "GitHub installation ID is invalid",
    );
  }

  return normalized;
}

function validBrowserNonce(
  value: string,
): string {
  const normalized =
    value.trim();

  if (
    !/^[A-Za-z0-9_-]{32,}$/.test(
      normalized,
    )
  ) {
    throw new GitHubOAuthFlowError(
      "github_connect_browser_mismatch",
      "GitHub connect browser binding is invalid",
    );
  }

  return normalized;
}

function statePayload(
  value: unknown,
): ConnectStatePayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new GitHubOAuthFlowError(
      "github_connect_state_invalid",
      "GitHub connect state is invalid",
    );
  }

  const record =
    value as
      Record<string, unknown>;

  if (
    record.version !== 1 ||
    (
      record.phase !==
        "install" &&
      record.phase !==
        "authorize"
    ) ||
    typeof record.issuer !==
      "string" ||
    !record.issuer ||
    typeof record.subject !==
      "string" ||
    !record.subject ||
    typeof record.browserNonce !==
      "string" ||
    !record.browserNonce ||
    typeof record.expiresAt !==
      "number" ||
    !Number.isFinite(
      record.expiresAt,
    )
  ) {
    throw new GitHubOAuthFlowError(
      "github_connect_state_invalid",
      "GitHub connect state is invalid",
    );
  }

  if (
    record.phase === "install"
  ) {
    return {
      version: 1,
      phase: "install",
      issuer:
        record.issuer,
      subject:
        record.subject,
      browserNonce:
        record.browserNonce,
      expiresAt:
        record.expiresAt,
    };
  }

  if (
    typeof record.installationId !==
      "string" ||
    typeof record.codeVerifier !==
      "string" ||
    !record.codeVerifier
  ) {
    throw new GitHubOAuthFlowError(
      "github_connect_state_invalid",
      "GitHub connect authorization state is invalid",
    );
  }

  return {
    version: 1,
    phase: "authorize",
    issuer:
      record.issuer,
    subject:
      record.subject,
    browserNonce:
      record.browserNonce,
    installationId:
      record.installationId,
    codeVerifier:
      record.codeVerifier,
    expiresAt:
      record.expiresAt,
  };
}

export function deriveGitHubConnectStateKey(
  rootKey: Uint8Array,
): Buffer {
  const key =
    Buffer.from(rootKey);

  if (key.length !== 32) {
    throw new TypeError(
      "GitHub connect root key must be exactly 32 bytes",
    );
  }

  return createHmac(
    "sha256",
    key,
  )
    .update(
      STATE_KEY_DOMAIN,
      "utf8",
    )
    .digest();
}

export class GitHubOAuthFlow {
  private readonly appSlug:
    string;

  private readonly clientId:
    string;

  private readonly clientSecret:
    string;

  private readonly callbackUrl:
    URL;

  private readonly stateKey:
    Buffer;

  private readonly fetch:
    FetchLike;

  private readonly now:
    () => Date;

  private readonly stateTtlMs:
    number;

  constructor(
    options:
      GitHubOAuthFlowOptions,
  ) {
    this.appSlug =
      nonEmpty(
        options.appSlug,
        "GitHub App slug",
      );

    if (
      !/^[A-Za-z0-9-]+$/.test(
        this.appSlug,
      )
    ) {
      throw new TypeError(
        "GitHub App slug is invalid",
      );
    }

    this.clientId =
      nonEmpty(
        options.clientId,
        "GitHub client ID",
      );

    this.clientSecret =
      nonEmpty(
        options.clientSecret,
        "GitHub client secret",
      );

    this.callbackUrl =
      new URL(
        options.callbackUrl.href,
      );

    if (
      this.callbackUrl.username ||
      this.callbackUrl.password ||
      this.callbackUrl.search ||
      this.callbackUrl.hash
    ) {
      throw new TypeError(
        "GitHub callback URL must not contain credentials, query, or fragment",
      );
    }

    this.stateKey =
      Buffer.from(
        options.stateKey,
      );

    if (
      this.stateKey.length !== 32
    ) {
      throw new TypeError(
        "GitHub connect state key must be exactly 32 bytes",
      );
    }

    this.fetch =
      options.fetch ??
      globalThis.fetch;

    this.now =
      options.now ??
      (() => new Date());

    this.stateTtlMs =
      options.stateTtlMs ??
      DEFAULT_STATE_TTL_MS;

    if (
      !Number.isSafeInteger(
        this.stateTtlMs,
      ) ||
      this.stateTtlMs <= 0
    ) {
      throw new TypeError(
        "GitHub connect state TTL must be a positive integer",
      );
    }
  }

  private expiry(): number {
    return (
      this.now().getTime() +
      this.stateTtlMs
    );
  }

  private encryptState(
    payload:
      ConnectStatePayload,
  ): string {
    const iv =
      randomBytes(12);

    const cipher =
      createCipheriv(
        "aes-256-gcm",
        this.stateKey,
        iv,
      );

    cipher.setAAD(
      STATE_AAD,
    );

    const plaintext =
      Buffer.from(
        JSON.stringify(
          payload,
        ),
        "utf8",
      );

    const ciphertext =
      Buffer.concat([
        cipher.update(
          plaintext,
        ),
        cipher.final(),
      ]);

    const tag =
      cipher.getAuthTag();

    return [
      STATE_PREFIX,
      base64url(iv),
      base64url(ciphertext),
      base64url(tag),
    ].join(".");
  }

  private decryptState(
    token: string,
  ): ConnectStatePayload {
    try {
      const parts =
        token.split(".");

      if (
        parts.length !== 4 ||
        parts[0] !==
          STATE_PREFIX
      ) {
        throw new Error();
      }

      const iv =
        Buffer.from(
          parts[1] ?? "",
          "base64url",
        );

      const ciphertext =
        Buffer.from(
          parts[2] ?? "",
          "base64url",
        );

      const tag =
        Buffer.from(
          parts[3] ?? "",
          "base64url",
        );

      if (
        iv.length !== 12 ||
        tag.length !== 16 ||
        ciphertext.length === 0
      ) {
        throw new Error();
      }

      const decipher =
        createDecipheriv(
          "aes-256-gcm",
          this.stateKey,
          iv,
        );

      decipher.setAAD(
        STATE_AAD,
      );

      decipher.setAuthTag(
        tag,
      );

      const plaintext =
        Buffer.concat([
          decipher.update(
            ciphertext,
          ),
          decipher.final(),
        ]);

      return statePayload(
        JSON.parse(
          plaintext.toString(
            "utf8",
          ),
        ),
      );
    } catch (
      error
    ) {
      if (
        error instanceof
          GitHubOAuthFlowError
      ) {
        throw error;
      }

      throw new GitHubOAuthFlowError(
        "github_connect_state_invalid",
        "GitHub connect state is invalid",
      );
    }
  }

  private verifyCommonState(
    payload:
      ConnectStatePayload,
    browserNonce: string,
  ): void {
    const nonce =
      validBrowserNonce(
        browserNonce,
      );

    if (
      payload.browserNonce !==
      nonce
    ) {
      throw new GitHubOAuthFlowError(
        "github_connect_browser_mismatch",
        "GitHub connect state does not belong to this browser",
      );
    }

    if (
      payload.expiresAt <
      this.now().getTime()
    ) {
      throw new GitHubOAuthFlowError(
        "github_connect_state_expired",
        "GitHub connect state has expired",
      );
    }
  }

  createInstallStart(
    principal:
      PrincipalIdentity,
  ): GitHubInstallStart {
    const browserNonce =
      base64url(
        randomBytes(32),
      );

    const expiresAt =
      this.expiry();

    const state =
      this.encryptState({
        version: 1,
        phase: "install",
        issuer:
          principal.issuer,
        subject:
          principal.subject,
        browserNonce,
        expiresAt,
      });

    const installationUrl =
      new URL(
        `https://github.com/apps/${this.appSlug}/installations/new`,
      );

    installationUrl
      .searchParams
      .set(
        "state",
        state,
      );

    return {
      installationUrl,
      browserNonce,
      expiresAt:
        new Date(
          expiresAt,
        ).toISOString(),
    };
  }

  createAuthorizationStart(
    installState: string,
    browserNonce: string,
    rawInstallationId: string,
  ): GitHubAuthorizationStart {
    const payload =
      this.decryptState(
        installState,
      );

    if (
      payload.phase !==
      "install"
    ) {
      throw new GitHubOAuthFlowError(
        "github_connect_state_invalid",
        "GitHub connect state is in the wrong phase",
      );
    }

    this.verifyCommonState(
      payload,
      browserNonce,
    );

    const installationId =
      validInstallationId(
        rawInstallationId,
      );

    const codeVerifier =
      base64url(
        randomBytes(32),
      );

    const codeChallenge =
      createHash("sha256")
        .update(
          codeVerifier,
          "ascii",
        )
        .digest(
          "base64url",
        );

    const expiresAt =
      this.expiry();

    const state =
      this.encryptState({
        version: 1,
        phase: "authorize",
        issuer:
          payload.issuer,
        subject:
          payload.subject,
        browserNonce:
          payload.browserNonce,
        installationId,
        codeVerifier,
        expiresAt,
      });

    const authorizationUrl =
      new URL(
        "https://github.com/login/oauth/authorize",
      );

    authorizationUrl
      .searchParams
      .set(
        "client_id",
        this.clientId,
      );

    authorizationUrl
      .searchParams
      .set(
        "redirect_uri",
        this.callbackUrl.href,
      );

    authorizationUrl
      .searchParams
      .set(
        "state",
        state,
      );

    authorizationUrl
      .searchParams
      .set(
        "code_challenge",
        codeChallenge,
      );

    authorizationUrl
      .searchParams
      .set(
        "code_challenge_method",
        "S256",
      );

    return {
      authorizationUrl,
      expiresAt:
        new Date(
          expiresAt,
        ).toISOString(),
    };
  }

  async completeAuthorization(
    state: string,
    browserNonce: string,
    rawCode: string,
  ): Promise<
    GitHubAuthorizationResult
  > {
    const payload =
      this.decryptState(
        state,
      );

    if (
      payload.phase !==
      "authorize"
    ) {
      throw new GitHubOAuthFlowError(
        "github_connect_state_invalid",
        "GitHub connect state is in the wrong phase",
      );
    }

    this.verifyCommonState(
      payload,
      browserNonce,
    );

    const code =
      rawCode.trim();

    if (!code) {
      throw new GitHubOAuthFlowError(
        "github_oauth_code_required",
        "GitHub OAuth code is required",
      );
    }

    const body =
      new URLSearchParams();

    body.set(
      "client_id",
      this.clientId,
    );

    body.set(
      "client_secret",
      this.clientSecret,
    );

    body.set(
      "code",
      code,
    );

    body.set(
      "redirect_uri",
      this.callbackUrl.href,
    );

    body.set(
      "code_verifier",
      payload.codeVerifier,
    );

    let response: Response;

    try {
      response =
        await this.fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",

            headers: {
              Accept:
                "application/json",

              "Content-Type":
                "application/x-www-form-urlencoded",
            },

            body:
              body.toString(),
          },
        );
    } catch {
      throw new GitHubOAuthFlowError(
        "github_oauth_exchange_failed",
        "GitHub OAuth token exchange failed",
      );
    }

    let result: unknown;

    try {
      result =
        await response.json();
    } catch {
      throw new GitHubOAuthFlowError(
        "github_oauth_exchange_failed",
        "GitHub OAuth token exchange returned an invalid response",
      );
    }

    if (
      !response.ok ||
      typeof result !==
        "object" ||
      result === null ||
      Array.isArray(result)
    ) {
      throw new GitHubOAuthFlowError(
        "github_oauth_exchange_failed",
        "GitHub OAuth token exchange failed",
      );
    }

    const record =
      result as
        Record<string, unknown>;

    if (
      typeof record.error ===
        "string"
    ) {
      throw new GitHubOAuthFlowError(
        "github_oauth_exchange_failed",
        "GitHub OAuth token exchange failed",
      );
    }

    if (
      typeof record.access_token !==
        "string" ||
      !record.access_token.startsWith(
        "ghu_",
      ) ||
      record.token_type !==
        "bearer"
    ) {
      throw new GitHubOAuthFlowError(
        "github_oauth_token_invalid",
        "GitHub OAuth token response is invalid",
      );
    }

    return {
      principal: {
        issuer:
          payload.issuer,
        subject:
          payload.subject,
      },

      installationId:
        payload.installationId,

      githubUserAccessToken:
        record.access_token,
    };
  }
}
