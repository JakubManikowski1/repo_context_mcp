import type {
  Express,
  RequestHandler,
} from "express";

import type {
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from "@modelcontextprotocol/express";

export type OAuthResourceServerOptions =
  Readonly<{
    mcpServerUrl: URL;
    oauthMetadata: OAuthMetadata;
    verifier: OAuthTokenVerifier;
    requiredScopes?: readonly string[];
    resourceName?: string;
  }>;

export type OAuthResourceServerWiring =
  Readonly<{
    auth: RequestHandler;
    resourceMetadataUrl: string;
  }>;

export function configureOAuthResourceServer(
  app: Express,
  options: OAuthResourceServerOptions,
): OAuthResourceServerWiring {
  const requiredScopes = [
    ...(options.requiredScopes ?? []),
  ];

  const resourceMetadataUrl =
    getOAuthProtectedResourceMetadataUrl(
      options.mcpServerUrl,
    );

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata:
        options.oauthMetadata,

      resourceServerUrl:
        options.mcpServerUrl,

      scopesSupported:
        requiredScopes,

      resourceName:
        options.resourceName ??
        "repo_context_mcp",
    }),
  );

  const auth =
    requireBearerAuth({
      verifier:
        options.verifier,

      requiredScopes,

      expectedResource:
        options.mcpServerUrl,

      resourceMetadataUrl,
    });

  return {
    auth,
    resourceMetadataUrl,
  };
}
