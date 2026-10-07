export type PrincipalIdentity = Readonly<{
  issuer: string;
  subject: string;
}>;

export type GitHubRepositoryConnectionPayload = Readonly<{
  version: 1;
  provider: "github";
  installationId: string;
  repositoryId: string;
  owner: string;
  name: string;
  branch: string;
}>;

export type RepositoryConnectionPayload =
  GitHubRepositoryConnectionPayload;

export type StoredRepositoryConnection = Readonly<{
  id: string;
  userLookup: string;
  encryptedPayload: string;
  createdAt: string;
  revokedAt: string | null;
}>;

export type NewRepositoryConnection = Readonly<
  Omit<StoredRepositoryConnection, "revokedAt">
>;
