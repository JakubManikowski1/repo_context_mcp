#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

RUN_ENV_FILE="${REPO_CONTEXT_MCP_RUN_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/repo_context_mcp/run.env}"

if [[ -f "$RUN_ENV_FILE" ]]; then
  source "$RUN_ENV_FILE"
fi

MCP_PORT="${MCP_PORT:-3000}"
TUNNEL_CLIENT_BIN="${TUNNEL_CLIENT_BIN:-tunnel-client}"
TUNNEL_PROFILE="${TUNNEL_PROFILE:-}"

if [[ -z "$TUNNEL_PROFILE" ]]; then
  echo "Brak TUNNEL_PROFILE."
  exit 1
fi

if ! command -v "$TUNNEL_CLIENT_BIN" >/dev/null 2>&1 && [[ ! -x "$TUNNEL_CLIENT_BIN" ]]; then
  echo "Nie znaleziono tunnel-client: $TUNNEL_CLIENT_BIN"
  exit 1
fi

if [[ -z "${CONTROL_PLANE_API_KEY:-}" && -n "${CONTROL_PLANE_API_KEY_COMMAND:-}" ]]; then
  CONTROL_PLANE_API_KEY="$(eval "$CONTROL_PLANE_API_KEY_COMMAND")"
  export CONTROL_PLANE_API_KEY
fi

if [[ -z "${CONTROL_PLANE_API_KEY:-}" ]]; then
  echo "Brak CONTROL_PLANE_API_KEY."
  exit 1
fi

CLEANUP_DONE=0

cleanup() {
  if [[ "$CLEANUP_DONE" -eq 1 ]]; then
    return
  fi

  CLEANUP_DONE=1

  echo
  echo "Stopping Repo Context MCP..."
  if [[ -n "${MCP_PID:-}" ]]; then
    kill "$MCP_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting Repo Context MCP on port $MCP_PORT..."
PORT="$MCP_PORT" npm run dev &
MCP_PID=$!

echo "Waiting for MCP..."
MCP_READY=0

for i in {1..20}; do
  if curl -fsS "http://127.0.0.1:${MCP_PORT}/health" >/dev/null 2>&1; then
    MCP_READY=1
    echo "MCP ready."
    break
  fi

  if ! kill -0 "$MCP_PID" 2>/dev/null; then
    echo "MCP process stopped before becoming ready."
    exit 1
  fi

  sleep 0.5
done

if [[ "$MCP_READY" -ne 1 ]]; then
  echo "MCP did not become ready in time."
  exit 1
fi

echo "Starting Secure MCP Tunnel..."
"$TUNNEL_CLIENT_BIN" run --profile "$TUNNEL_PROFILE"
