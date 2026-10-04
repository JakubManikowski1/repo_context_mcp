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

If the variable is empty or omitted, only the core tools are exposed.

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

Configure:

```env
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=12345678

GITHUB_OWNER=your-github-user-or-org
GITHUB_REPO=your-repository
GITHUB_BRANCH=main

GITHUB_PRIVATE_KEY_PATH=/absolute/path/to/github-app.pem

PORT=3000
```

Keep the GitHub App private key outside the repository.

Do not commit `.env` or private key files.

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

It does **not** currently render interactive MCP App UI inside the chat client.

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

The current tool set is designed to be read-only.

## License

Apache License 2.0.

See [LICENSE](LICENSE) and [NOTICE](NOTICE).
