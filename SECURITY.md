# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through GitHub Private Vulnerability Reporting for this repository.

Do not open a public GitHub issue for a suspected security vulnerability.

When possible, include:

- a clear description of the issue
- affected component or tool
- reproduction steps
- expected and actual behavior
- potential security impact
- any relevant logs or traces with secrets removed

Please do not include private keys, access tokens, repository secrets, customer data, or other sensitive information in reports.

## Security-relevant issues

Examples include:

- unintended write access or destructive behavior
- GitHub App authentication or authorization issues
- exposure of repository contents beyond an authorized repository connection
- credential, encryption-key, TOTP-secret, or privileged-session disclosure
- cross-user, cross-repository, or cross-request data leakage
- incorrect OAuth principal or repository isolation
- bypasses of repository or HEAD consistency guarantees
- bypasses of operator OAuth identity checks or TOTP step-up
- reuse of a privileged operator session by another principal
- sensitive-data reveal without the required audit record
- unintended mutation or deletion of operator reveal audit records
- vulnerabilities in MCP or operator HTTP request handling that could expose sensitive data

## Supported versions

Security fixes are provided for the latest released version.

## Scope

The MCP tool surface of `repo_context_mcp` is designed to be read-only.

In OAuth mode, repository access must be derived from the authenticated
principal and that principal's active repository connection. Access to a
repository outside that authorization boundary should be treated as
security-sensitive.

The optional operator sensitive-data HTTP flow is separate from the MCP tool
surface. When explicitly configured, it can decrypt one exact stored
repository connection after operator OAuth identity verification and a fresh
TOTP step-up. Bypassing those controls, exposing decrypted connection data to
another principal, or revealing data without the required audit record should
be treated as security-sensitive.

The operator audit table is protected against normal application-level update
and delete operations, but it is not intended to be tamper-proof against an
administrator with direct access to the SQLite database files.
