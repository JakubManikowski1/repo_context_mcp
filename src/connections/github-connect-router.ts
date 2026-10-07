import {
  Router,
  json,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import {
  GitHubConnectError,
  type ConnectedRepository,
  type GitHubConnectRepository,
} from "./github-connect.js";

import {
  GitHubOAuthFlowError,
  type GitHubAuthorizationResult,
  type GitHubInstallStart,
  type GitHubAuthorizationStart,
} from "./github-oauth-flow.js";

import {
  GitHubRepositorySelectionError,
  type GitHubRepositorySelectionStart,
  type GitHubRepositorySelectionResult,
} from "./github-selection.js";

import type {
  PrincipalIdentity,
} from "./types.js";

const COOKIE_NAME =
  "repo_context_github_connect";

const COOKIE_PATH =
  "/connect/github";

const MAX_JSON_BODY =
  "16kb";

type GitHubOAuthFlowLike =
  Readonly<{
    createInstallStart(
      principal:
        PrincipalIdentity,
    ): GitHubInstallStart;

    createAuthorizationStart(
      installState: string,
      browserNonce: string,
      installationId: string,
    ): GitHubAuthorizationStart;

    completeAuthorization(
      state: string,
      browserNonce: string,
      code: string,
    ): Promise<
      GitHubAuthorizationResult
    >;
  }>;

type GitHubUserRepositoryConnector =
  Readonly<{
    listRepositories(
      githubUserAccessToken:
        string,
      installationId:
        string,
    ): Promise<
      readonly GitHubConnectRepository[]
    >;
  }>;

type GitHubRepositorySelectionLike =
  Readonly<{
    create(
      principal:
        PrincipalIdentity,
      browserNonce:
        string,
      installationId:
        string,
      repositories:
        readonly GitHubConnectRepository[],
    ): GitHubRepositorySelectionStart;

    complete(
      selectionToken:
        string,
      browserNonce:
        string,
      repositoryId:
        string,
    ): GitHubRepositorySelectionResult;
  }>;

type GitHubInstallationSelectionLike =
  Readonly<{
    connect(
      principal:
        PrincipalIdentity,
      installationId:
        string,
      repositoryId:
        string,
    ): Promise<
      ConnectedRepository
    >;
  }>;

export type GitHubConnectRouterOptions =
  Readonly<{
    authenticate:
      RequestHandler;

    getPrincipal:
      (
        request:
          Request,
      ) =>
        PrincipalIdentity;

    oauthFlow:
      GitHubOAuthFlowLike;

    userRepositoryConnector:
      GitHubUserRepositoryConnector;

    repositorySelection:
      GitHubRepositorySelectionLike;

    installationSelection:
      GitHubInstallationSelectionLike;

    cookieSecure?:
      boolean;
  }>;

function queryString(
  request:
    Request,
  name:
    string,
): string {
  const value =
    request.query[name];

  if (
    typeof value !==
      "string" ||
    !value.trim()
  ) {
    throw new GitHubOAuthFlowError(
      "github_connect_state_invalid",
      `Missing GitHub connect query parameter: ${name}`,
    );
  }

  return value;
}

function bodyString(
  request:
    Request,
  name:
    string,
): string {
  const body =
    request.body;

  if (
    typeof body !==
      "object" ||
    body === null ||
    Array.isArray(
      body,
    )
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_invalid",
      "GitHub repository selection body is invalid",
    );
  }

  const value =
    (
      body as
        Record<string, unknown>
    )[name];

  if (
    typeof value !==
      "string" ||
    !value.trim()
  ) {
    throw new GitHubRepositorySelectionError(
      "github_repository_selection_invalid",
      `Missing GitHub repository selection field: ${name}`,
    );
  }

  return value;
}

function parseCookie(
  request:
    Request,
  name:
    string,
): string | null {
  const header =
    request.headers.cookie;

  if (!header) {
    return null;
  }

  for (
    const part
    of header.split(";")
  ) {
    const separator =
      part.indexOf("=");

    if (separator < 0) {
      continue;
    }

    const key =
      part
        .slice(
          0,
          separator,
        )
        .trim();

    if (key !== name) {
      continue;
    }

    const rawValue =
      part
        .slice(
          separator + 1,
        )
        .trim();

    try {
      return decodeURIComponent(
        rawValue,
      );
    } catch {
      return null;
    }
  }

  return null;
}

function browserNonce(
  request:
    Request,
): string {
  const nonce =
    parseCookie(
      request,
      COOKIE_NAME,
    );

  if (!nonce) {
    throw new GitHubOAuthFlowError(
      "github_connect_browser_mismatch",
      "GitHub connect browser binding is missing",
    );
  }

  return nonce;
}

function samePrincipal(
  left:
    PrincipalIdentity,
  right:
    PrincipalIdentity,
): boolean {
  return (
    left.issuer ===
      right.issuer &&
    left.subject ===
      right.subject
  );
}

function noStore(
  response:
    Response,
): void {
  response.setHeader(
    "Cache-Control",
    "no-store",
  );

  response.setHeader(
    "Pragma",
    "no-cache",
  );
}

function sendError(
  response:
    Response,
  error:
    unknown,
): void {
  noStore(
    response,
  );

  if (
    error instanceof
      GitHubOAuthFlowError
  ) {
    const status =
      (
        error.code ===
          "github_oauth_exchange_failed" ||
        error.code ===
          "github_oauth_token_invalid"
      )
        ? 502
        : 400;

    response
      .status(status)
      .json({
        error:
          error.code,
      });

    return;
  }

  if (
    error instanceof
      GitHubRepositorySelectionError
  ) {
    let status =
      400;

    if (
      error.code ===
        "github_repository_unavailable" ||
      error.code ===
        "github_repository_selection_empty"
    ) {
      status = 404;
    } else if (
      error.code ===
        "github_repository_selection_too_large"
    ) {
      status = 413;
    }

    response
      .status(status)
      .json({
        error:
          error.code,
      });

    return;
  }

  if (
    error instanceof
      GitHubConnectError
  ) {
    let status =
      502;

    if (
      error.code ===
        "github_installation_unavailable" ||
      error.code ===
        "github_repository_unavailable"
    ) {
      status = 404;
    }

    response
      .status(status)
      .json({
        error:
          error.code,
      });

    return;
  }

  console.error(
    "GitHub connect route failed",
    error,
  );

  response
    .status(500)
    .json({
      error:
        "github_connect_internal_error",
    });
}

export function createGitHubConnectRouter(
  options:
    GitHubConnectRouterOptions,
): Router {
  const router =
    Router();

  const cookieSecure =
    options.cookieSecure ??
    true;

  router.use(
    json({
      limit:
        MAX_JSON_BODY,
    }),
  );

  router.post(
    "/start",
    options.authenticate,
    (
      request,
      response,
    ) => {
      try {
        const principal =
          options.getPrincipal(
            request,
          );

        const start =
          options.oauthFlow
            .createInstallStart(
              principal,
            );

        const expiresAt =
          Date.parse(
            start.expiresAt,
          );

        const maxAge =
          Number.isFinite(
            expiresAt,
          )
            ? Math.max(
                0,
                expiresAt -
                  Date.now(),
              )
            : undefined;

        response.cookie(
          COOKIE_NAME,
          start.browserNonce,
          {
            httpOnly:
              true,

            secure:
              cookieSecure,

            sameSite:
              "lax",

            path:
              COOKIE_PATH,

            ...(maxAge ===
            undefined
              ? {}
              : {
                  maxAge,
                }),
          },
        );

        noStore(
          response,
        );

        response.json({
          installation_url:
            start
              .installationUrl
              .href,

          expires_at:
            start.expiresAt,
        });
      } catch (error) {
        sendError(
          response,
          error,
        );
      }
    },
  );

  router.get(
    "/setup",
    (
      request,
      response,
    ) => {
      try {
        const state =
          queryString(
            request,
            "state",
          );

        const installationId =
          queryString(
            request,
            "installation_id",
          );

        const nonce =
          browserNonce(
            request,
          );

        const authorization =
          options.oauthFlow
            .createAuthorizationStart(
              state,
              nonce,
              installationId,
            );

        noStore(
          response,
        );

        response.redirect(
          303,
          authorization
            .authorizationUrl
            .href,
        );
      } catch (error) {
        sendError(
          response,
          error,
        );
      }
    },
  );

  router.get(
    "/callback",
    async (
      request,
      response,
    ) => {
      try {
        const state =
          queryString(
            request,
            "state",
          );

        const code =
          queryString(
            request,
            "code",
          );

        const nonce =
          browserNonce(
            request,
          );

        const authorization =
          await options.oauthFlow
            .completeAuthorization(
              state,
              nonce,
              code,
            );

        const repositories =
          await options
            .userRepositoryConnector
            .listRepositories(
              authorization
                .githubUserAccessToken,

              authorization
                .installationId,
            );

        const selection =
          options
            .repositorySelection
            .create(
              authorization
                .principal,

              nonce,

              authorization
                .installationId,

              repositories,
            );

        noStore(
          response,
        );

        response.json({
          repositories:
            selection
              .repositories,

          selection_token:
            selection
              .selectionToken,

          expires_at:
            selection
              .expiresAt,
        });
      } catch (error) {
        sendError(
          response,
          error,
        );
      }
    },
  );

  router.post(
    "/select",
    options.authenticate,
    async (
      request,
      response,
    ) => {
      try {
        const authenticatedPrincipal =
          options.getPrincipal(
            request,
          );

        const nonce =
          browserNonce(
            request,
          );

        const selectionToken =
          bodyString(
            request,
            "selection_token",
          );

        const repositoryId =
          bodyString(
            request,
            "repository_id",
          );

        const selected =
          options
            .repositorySelection
            .complete(
              selectionToken,
              nonce,
              repositoryId,
            );

        if (
          !samePrincipal(
            authenticatedPrincipal,
            selected.principal,
          )
        ) {
          noStore(
            response,
          );

          response
            .status(403)
            .json({
              error:
                "github_connect_principal_mismatch",
            });

          return;
        }

        const connected =
          await options
            .installationSelection
            .connect(
              selected
                .principal,

              selected
                .installationId,

              selected
                .repositoryId,
            );

        response.clearCookie(
          COOKIE_NAME,
          {
            httpOnly:
              true,

            secure:
              cookieSecure,

            sameSite:
              "lax",

            path:
              COOKIE_PATH,
          },
        );

        noStore(
          response,
        );

        response
          .status(201)
          .json({
            connection:
              connected,
          });
      } catch (error) {
        sendError(
          response,
          error,
        );
      }
    },
  );

  return router;
}
