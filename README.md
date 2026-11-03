# repo_context_mcp

Fast, read-only MCP server for GitHub issues and repository code with bounded context and HEAD-consistent reads.

`repo_context_mcp` is designed to give AI clients useful repository context without encouraging broad, expensive repository exploration.

The default tool surface is intentionally small. Specialized capabilities can be enabled as optional profiles.

## Features

### Core tools

- `issue_get` — fetch one GitHub issue with comments
- `issues_list` — list issues from the configured repository
- `issue_lookup` — resolve an issue from a number, title, description, or optional repository index
- `repo_code` — locate and read relevant repository code with bounded output

### Optional profiles

Enable additional capabilities with `REPO_CONTEXT_FEATURES`.

Available profiles:

- `db`
  - `db_context`
  - `db_impact`
  - `db_mermaid`
- `ui`
  - `ui_context`
  - `ui_inventory`
  - `ui_flow`
- `history`
  - `repo_file_history`
  - `repo_diff`
- `workflow`
  - `repo_guidance`
  - `repo_commands`

Example:

```env
REPO_CONTEXT_FEATURES=db,ui,history,workflow
```

If the variable is empty or omitted, the optional capability profiles are not exposed.
The core tools remain available. `page_render` is configured separately and is not part
of `REPO_CONTEXT_FEATURES`.

### Optional page rendering

`page_render` renders a route from an explicitly configured, already-running application.
It is separate from the static `ui` profile and can be enabled in either legacy or OAuth
mode.

Page rendering is disabled unless both of these values are configured:

```env
REPO_CONTEXT_RENDER_ORIGIN=http://127.0.0.1:5173
REPO_CONTEXT_RENDER_BROWSER_EXECUTABLE=/absolute/path/to/chromium-compatible-browser
```

`REPO_CONTEXT_RENDER_ORIGIN` must be an exact HTTP(S) origin containing only the scheme,
host, and optional port.

The browser executable must already exist. Repo Context MCP does not discover, download,
or install a browser, and it does not install dependencies or start the target
application.

In legacy mode, the render target is bound to the configured legacy repository. Do not
set `REPO_CONTEXT_RENDER_REPOSITORY_ID`.

In OAuth mode, rendering must additionally be bound to exactly one repository connection:

```env
REPO_CONTEXT_RENDER_REPOSITORY_ID=connection-id
```

The binding is connection-scoped. A principal must still be authorized for the requested
repository through normal `RepositoryToolAccess`; knowing a repository connection ID is
not sufficient authorization.

The renderer uses a fresh browser context and:

- renders only application-local routes below the configured origin,
- blocks cross-origin HTTP(S) resource requests,
- blocks cross-origin WebSocket connections,
- blocks top-level navigation away from the configured origin,
- disables downloads and service workers,
- bounds extracted text, visible interactive elements, and screenshot size,
- always closes the browser after the render.

`page_render` returns structured rendered-page metadata as text and, when within the
configured size limit, a JPEG screenshot as separate MCP image content.

## Design goals

### Small tool surface

The default configuration exposes only the tools needed for normal issue analysis and repository code retrieval.

This reduces unnecessary tool selection and repeated repository exploration.

### Bounded context

`repo_code` applies limits to:

- search queries
- candidate files
- lines returned per file
- total response size

The goal is to return enough code for reasoning without dumping large parts of the repository into model context.

### HEAD-consistent reads

Repository code is read against a concrete Git commit SHA.

The server resolves the configured branch to its current HEAD and uses that snapshot for tree discovery and file reads.

This prevents a single tool result from accidentally combining files from different commits if the branch changes during analysis.

### Repository drift detection

`repo_code` tracks repository HEAD during a model response when the MCP host provides a request identifier.

If the branch changes between productive `repo_code` calls, the tool can return:

```text
mode=repository_changed
```

The client should then discard conclusions derived from the previous HEAD and restart repository analysis against the new snapshot.

The per-response call budget is best-effort and is only enforced when the host supplies a usable request identifier.

### Read-only access

The current server does not modify the configured repository.

GitHub App permissions should therefore be limited to read-only access.

## Requirements

- Node.js
- a GitHub App installed on the repository you want to expose
- GitHub App access to:
  - repository contents: read-only
  - issues: read-only
- a GitHub App private key stored outside this repository

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/JakubManikowski1/repo_context_mcp.git
cd repo_context_mcp
npm ci
```

Copy the environment template:

```bash
cp .env.example .env
```

Configure the server explicitly for one of two modes.

### Legacy / single-repository mode

Legacy mode preserves the original self-hosted setup. One GitHub App
installation and one repository are configured globally.

```env
REPO_CONTEXT_AUTH_MODE=legacy

GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY_PATH=/absolute/path/to/github-app.pem

GITHUB_INSTALLATION_ID=12345678
GITHUB_OWNER=your-github-user-or-org
GITHUB_REPO=your-repository
GITHUB_BRANCH=main

PORT=3000
```

`legacy` is currently the default when `REPO_CONTEXT_AUTH_MODE` is
not set.

Optional capability profiles (`db`, `ui`, `history`, `workflow`) are
legacy-only.

### OAuth / multi-user mode

OAuth mode does not use a globally configured repository as proof of
repository access. Repository access is derived from the verified MCP
principal and that principal's active encrypted repository connections.

```env
REPO_CONTEXT_AUTH_MODE=oauth

REPO_CONTEXT_MCP_URL=https://mcp.example.com/mcp

REPO_CONTEXT_OAUTH_ISSUER=https://auth.example.com/
REPO_CONTEXT_OAUTH_AUTHORIZATION_ENDPOINT=https://auth.example.com/authorize
REPO_CONTEXT_OAUTH_TOKEN_ENDPOINT=https://auth.example.com/oauth/token
REPO_CONTEXT_OAUTH_JWKS_URL=https://auth.example.com/.well-known/jwks.json

REPO_CONTEXT_CONNECTION_DB_PATH=/absolute/path/to/repository-connections.sqlite

REPO_CONTEXT_USER_LOOKUP_KEY=<base64-32-byte-key>
REPO_CONTEXT_CONNECTION_ENCRYPTION_KEY=<different-base64-32-byte-key>

GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY_PATH=/absolute/path/to/github-app.pem

REPO_CONTEXT_GITHUB_APP_SLUG=your-github-app-slug
REPO_CONTEXT_GITHUB_CLIENT_ID=Iv1.example
REPO_CONTEXT_GITHUB_CLIENT_SECRET=<github-app-client-secret>

# Optional operator sensitive-data access.
# These three values must be configured together.
REPO_CONTEXT_OPERATOR_ID=primary-operator
REPO_CONTEXT_OPERATOR_SUBJECT=<exact-oauth-sub>
REPO_CONTEXT_OPERATOR_TOTP_SECRET=<base32-totp-secret>

PORT=3000
```

Generate the lookup and encryption keys independently, for example:

```bash
openssl rand -base64 32
```

MCP OAuth and GitHub OAuth serve different purposes:

- MCP OAuth authenticates the MCP user.
- GitHub OAuth is temporary and is used during repository connection.
- Repository access after connection uses the GitHub App installation.
- GitHub user access and refresh tokens are not persisted as repository
  connection data.

When GitHub connect is enabled, configure the GitHub App with:

```text
Setup URL:
https://mcp.example.com/connect/github/setup

Callback URL:
https://mcp.example.com/connect/github/callback
```

`REPO_CONTEXT_GITHUB_APP_SLUG`, `REPO_CONTEXT_GITHUB_CLIENT_ID`, and
`REPO_CONTEXT_GITHUB_CLIENT_SECRET` must either all be configured or
all be absent. Partial configuration fails closed.

### Optional operator sensitive-data access

Operator reveal is disabled unless all three operator variables are configured:

```env
REPO_CONTEXT_OPERATOR_ID=primary-operator
REPO_CONTEXT_OPERATOR_SUBJECT=<exact-oauth-sub>
REPO_CONTEXT_OPERATOR_TOTP_SECRET=<base32-totp-secret>
```

`REPO_CONTEXT_OPERATOR_ID` is an operator label written to the reveal audit.
It is not an authentication credential.

The operator identity is bound to:

- the exact OAuth issuer from `REPO_CONTEXT_OAUTH_ISSUER`
- the exact OAuth `sub` in `REPO_CONTEXT_OPERATOR_SUBJECT`

The TOTP secret must be valid Base32 and decode to at least 20 bytes.

Operator access is OAuth-only. Supplying any operator configuration in
legacy mode fails closed. Supplying only part of the operator configuration
also fails closed.

The flow has two HTTP endpoints:

```text
POST /operator/session
POST /operator/reveal
```

Both require the normal OAuth bearer token of the configured operator.

`POST /operator/session` performs the TOTP step-up:

```json
{
  "totp_code": "123456"
}
```

A successful response contains a short-lived privileged session token:

```json
{
  "session_token": "ops1.<opaque-token>",
  "expires_at": "..."
}
```

The privileged session:

- expires after 5 minutes
- is stored only in process memory
- is invalidated by a process restart
- authorizes exactly one reveal attempt
- cannot be used by another OAuth principal

`POST /operator/reveal` requires the OAuth bearer token, privileged session,
an exact repository connection ID, and an explicit reason:

```json
{
  "session_token": "ops1.<opaque-token>",
  "connection_id": "<exact-connection-id>",
  "reason": "Investigate support case 123"
}
```

There is intentionally no operator repository list, search, or reveal-all
endpoint.

Reveal responses are sent with `Cache-Control: no-store`. The internal
pseudonymous `userLookup` is not returned by the HTTP endpoint.

Valid reveal attempts are audited with one of:

- `success`
- `not_found`
- `decrypt_failed`

The audit table is append-only through application code and SQLite triggers.
This prevents ordinary updates and deletes through the application database
connection, but it is not tamper-proof against an administrator with direct
access to the SQLite files.

Invalid TOTP attempts are throttled after 5 failures in a rolling 60-second
window. TOTP replay tracking and privileged sessions are process-local, so
both reset when the process restarts.

Do not configure optional capability profiles in OAuth mode.

Keep the GitHub App private key outside the repository.

Do not commit `.env`, private keys, OAuth client secrets, connection
encryption keys, or user lookup keys.

## Optional issue index

`issue_lookup` works with GitHub Issues without any additional configuration.

A repository-local issue index can optionally be configured:

```env
ISSUE_INDEX_PATH=Backlog.md
```

The index is used only to help resolve references to issue numbers.

GitHub Issues remain the source of truth.

If the index is missing, unreadable, or cannot confidently resolve the query, `issue_lookup` falls back to GitHub issue search.

## Run locally

Development mode:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

Default endpoints:

```text
http://127.0.0.1:3000/mcp
http://127.0.0.1:3000/health
```

The MCP endpoint must be reachable by the MCP client you want to connect.

For remote clients, expose the server through an HTTPS endpoint using infrastructure appropriate for your environment.

## Verify GitHub access

Run:

```bash
npm run check:github
```

This checks:

- GitHub App authentication
- configured repository access
- configured branch
- current HEAD
- issue read access

The command does not print credentials or private keys.

## Development

Type-check:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Build:

```bash
npm run build
```

## repo_code

`repo_code` supports two primary modes.

### Search

Use `queries` when exact repository-relative paths are not known.

Example:

```json
{
  "queries": [
    "createUser",
    "userService",
    "user validation"
  ]
}
```

The tool uses repository-tree discovery and bounded search to identify relevant files and return compact source excerpts.

### Fetch

Use `paths` only when exact repository-relative paths are already known.

Example:

```json
{
  "paths": [
    "src/services/userService.ts"
  ],
  "focusQueries": [
    "createUser"
  ]
}
```

For large files, `focusQueries` can extract relevant regions and, where possible, expand complete function or callback definitions.

Do not provide both `queries` and `paths` in the same call.

## Database profile

The `db` profile is currently oriented toward repositories using database migrations and includes additional PocketBase-aware behavior.

It can:

- locate schema and migration files
- gather database context
- estimate code impact of collection or field changes
- generate Mermaid ER diagrams from PocketBase schemas or migrations

Migration-derived diagrams are best-effort and should be verified against the actual schema.

## UI analysis profile

The `ui` profile analyzes frontend source code.

It can:

- locate files related to a route
- inventory headings, buttons, links, form controls, labels, and states
- identify navigation, API calls, clicks, form submissions, overlays, and guards

This profile analyzes repository UI code.

Runtime page rendering is intentionally separate from static UI analysis. When
`page_render` is configured, it can inspect the current rendered state of an
already-running application and return a bounded screenshot plus rendered DOM context.

This does **not** turn the repository tools into an interactive MCP App UI inside the
chat client.

## Workflow profile

The `workflow` profile discovers repository-specific development instructions and commands.

It can inspect files such as:

- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- Cursor rules
- GitHub prompts
- Claude commands
- `package.json` scripts
- `Makefile`
- `Taskfile`
- `justfile`

These tools are intended for tasks where repository-specific procedures materially affect implementation.

## History profile

The `history` profile provides:

- recent commits affecting a file
- diffs between Git refs
- changed files and commit metadata
- bounded patches

Use it for regression analysis, investigating why code exists, or comparing implementations.

## Benchmarks

The `scripts/` directory contains development benchmarks used while designing the retrieval strategy.

Most benchmark inputs can be customized with:

```env
BENCHMARK_QUERIES=query1,query2,query3
```

The MCP benchmark endpoint can be changed with:

```env
MCP_URL=http://127.0.0.1:3000/mcp
```

## Security

Recommended deployment rules:

- use a dedicated GitHub App
- grant only required repositories
- use read-only repository permissions
- keep the private key outside the project directory
- never commit `.env`
- terminate public access through HTTPS
- protect externally reachable MCP endpoints according to your deployment environment
- keep operator TOTP secrets outside the repository
- enable operator reveal only when operationally required
- treat repository reveal responses as sensitive data
- protect the repository connection SQLite database and its WAL/SHM files

The MCP tool set is designed to be read-only.

The optional operator reveal HTTP flow is deliberately separate from the MCP
tool surface and can decrypt stored repository connection metadata after
OAuth identity verification and a fresh TOTP step-up.

## License

Apache License 2.0.

See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Roadmap

**Current focus: Phase 1 — Multi-repository context.**

The project is evolving from a single-repository, read-only context server into a repository-aware development and review assistant.

The roadmap is intentionally incremental. Each phase should remain useful on its own and should avoid introducing infrastructure that is not yet required by the active use case.

### Phase 1 — Multi-repository context

Run a single MCP server behind a single endpoint and allow the client to choose which configured repository a tool call should operate on.

Goals:

- support multiple repositories from one MCP instance,
- expose available repositories through `repositories_list`,
- use an opaque `repository_id` consistently across all repository-bound tools,
- keep repository selection request-scoped rather than storing global mutable active-repository state,
- preserve repository isolation in caches, budgets, and request context,
- support repository-specific optional capabilities such as page-render targets,
- retain simple single-user operation during this phase.

The intended interaction is:

```text
ChatGPT
    ↓
one Repo Context MCP
    ↓
repository selection
    ├── repository A
    ├── repository B
    └── repository C
```

Separate MCP deployments per repository are considered a transitional configuration rather than the target architecture.

### Phase 2 — Interactive ChatGPT views

Once repository selection is stable, improve the user experience with interactive views inside ChatGPT.

Goals:

- provide a repository picker,
- expose repository and route context visually where useful,
- integrate static UI analysis with runtime page rendering,
- make UI review workflows usable by non-developers,
- keep text and tool interfaces available as a fallback when rich UI is unavailable.

The UI must remain a client convenience. Repository authorization and tool behavior must never depend solely on client-side state.

### Phase 3 — Bounded GitHub write operations

After the read and review workflow is mature, introduce narrowly scoped write capabilities.

The first planned write workflow is GitHub issue creation.

Goals:

- create issues from repository or UI review context,
- include evidence such as relevant routes, files, and analysis summaries,
- require an explicit target repository,
- clearly distinguish read-only tools from write tools,
- mark MCP tool annotations accurately,
- keep write operations narrow and auditable rather than adding generic repository mutation.

Source-code modification is not part of this phase.

### Phase 4 — Multi-user authentication and authorization

Authentication and fine-grained repository authorization are deliberately deferred until the repository-selection, UI, and review workflows are established.

The target model separates:

```text
RepositoryConnection
    = how the service technically accesses a repository

RepositoryAccess
    = who is allowed to use that connection and with what role
```

Goals:

- authenticate each MCP user,
- identify users through a stable external identity rather than GitHub account ownership,
- allow users without GitHub accounts to receive repository access,
- authorize every repository-bound request independently,
- support grants and revocation,
- support repository-specific roles such as viewer, reviewer, and administrator,
- ensure knowledge of a `repository_id` never grants access by itself,
- keep provider credentials and repository connection details server-side.

This phase should make the MCP suitable for broader multi-user deployment without changing the repository-facing workflow introduced in earlier phases.

### Planned sequencing

```text
multi-repository selection
        ↓
interactive ChatGPT views
        ↓
bounded GitHub issue creation
        ↓
multi-user authentication and authorization
```

This order is intentional. The immediate goal is to validate repository and UI workflows with a minimal operational model before adding multi-user identity and access-management complexity.

### Design principles

Across all phases:

- prefer one MCP service over repository-specific MCP deployments,
- keep repository choice explicit and request-scoped,
- fail closed when repository access cannot be established,
- treat UI state as convenience rather than authorization,
- keep read and write capabilities clearly separated,
- add write operations individually rather than introducing generic mutation,
- preserve compatibility with simple local and private deployments where practical,
- avoid coupling repository access to a user's personal GitHub account unless the deployment explicitly requires it.
