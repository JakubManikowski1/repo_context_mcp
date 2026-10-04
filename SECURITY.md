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
- exposure of repository contents beyond the configured repository
- credential or secret disclosure
- cross-request data leakage
- incorrect request isolation
- bypasses of repository or HEAD consistency guarantees
- vulnerabilities in MCP request handling that could expose sensitive data

## Supported versions

Security fixes are provided for the latest released version.

## Scope

`repo_context_mcp` is designed as a read-only MCP server. A vulnerability that allows mutation of GitHub repository data or access beyond the configured permissions should be treated as security-sensitive.
