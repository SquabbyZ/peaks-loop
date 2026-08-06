#!/usr/bin/env bash
#
# pre-tool-code-gate.sh — peaks-code Code-Gate PreToolUse hook
# (slice 2026-08-06-codegate-vendor-neutral)
#
# Purpose
#   Read the active PreToolUse JSON payload from stdin (vendor-neutral
#   hook protocol: { tool, input }). When the tool call is
#   Edit|Write|MultiEdit AND the target file path matches any of the
#   hard-blocked path families (src/, tests/unit/, tests/integration/,
#   config/, bin/, scripts/), this hook REFUSES the call (exit 2 +
#   stderr containing PEAKS_CODE_PROHIBITED_DIRECT_EDIT) so the LLM
#   is forced to dispatch via `peaks sub-agent dispatch rd` instead
#   of editing source code directly.
#
#   Allow-listed paths (.peaks/**, .peaks/_runtime/**, skills/**,
#   docs/**) exit 0 silently.
#
# Hard rules enforced here
#   - Hook is a thin, idempotent, pure-stdin script. No env-mutating
#     side effects.
#   - Source of truth lives in the peaks-loop repo (this file). The
#     user-global copy at the IDE's skills/peaks-code/hooks/ directory
#     is installed by `peaks hooks install` and MUST be byte-identical
#     to this source after install.
#   - Vendor-neutral — this hook does NOT reference any specific IDE
#     or vendor. It uses only the standard `{tool, input}` JSON hook
#     protocol, no env vars. The vendor-specific install adapter is a
#     SEPARATE file (`src/cli/commands/hooks-commands.ts` + the IDE
#     adapter layer in `src/services/ide/`) — not this script.
#
# Karpathy §2 (Simplicity First): no retries, no jq dependency, no
# colour codes. Pure bash + grep + sed.
# Karpathy §3 (Surgical Changes): reads stdin only; never mutates
# user-global state.
# Karpathy §4 (Goal-Driven Execution): the only side effects are
#   (a) exit code 0 / 2,
#   (b) stderr containing the PEAKS_CODE_PROHIBITED_DIRECT_EDIT
#       message when blocked.
#   No stdout JSON envelope — the IDE denies the tool call before it
#   runs.

set -euo pipefail

# --- 1. Read the tool payload from stdin ------------------------------------
PAYLOAD="$(cat || true)"

# Tolerate empty stdin (the IDE may call the hook before the agent has
# produced any tool input). Empty payload → silent success; nothing to gate.
if [[ -z "${PAYLOAD}" ]]; then
  exit 0
fi

# --- 2. Extract tool name without depending on jq --------------------------
# Use a portable grep/case-match instead of jq so the hook runs on
# stock Git Bash (Windows) without an extra dependency. Accept both
# the modern `tool_name` and legacy `tool` JSON keys.
TOOL_NAME="$(printf '%s' "${PAYLOAD}" \
  | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | head -n1 \
  | sed -E 's/.*"tool_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
  || true)"

if [[ -z "${TOOL_NAME}" ]]; then
  TOOL_NAME="$(printf '%s' "${PAYLOAD}" \
    | grep -oE '"tool"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -n1 \
    | sed -E 's/.*"tool"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
    || true)"
fi

# --- 3. Only gate Edit / Write / MultiEdit ----------------------------------
# Anything else (Bash, Read, Greb, Glob, …) is allowed unconditionally.
case "${TOOL_NAME}" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

# --- 4. Extract the target file path ----------------------------------------
# The hook protocol uses different keys per vendor / version:
#   - Edit → input.file_path
#   - Write → input.file_path
#   - MultiEdit → input.file_path
# Try `file_path` first, fall back to `path`, fall back to `notebook_path`.
FILE_PATH=""
for KEY in file_path path notebook_path; do
  CAND="$(printf '%s' "${PAYLOAD}" \
    | grep -oE "\"${KEY}\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" \
    | head -n1 \
    | sed -E "s/.*\"${KEY}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/" \
    || true)"
  if [[ -n "${CAND}" ]]; then
    FILE_PATH="${CAND}"
    break
  fi
done

# No path in the payload → cannot decide; allow (fail-open on
# path-missing rather than false-positive block).
if [[ -z "${FILE_PATH}" ]]; then
  exit 0
fi

# --- 5. Allow-list check (.peaks/, .peaks/_runtime/, skills/) ---------------
# Allow-listed paths are NEVER blocked. The orchestrator may freely
# Edit/Write these — they are not application source code.
case "${FILE_PATH}" in
  .peaks/*|.peaks_*|skills/*|docs/*|CHANGELOG.md|README.md|*.md)
    exit 0 ;;
esac

# --- 6. Hard-blocked path family scan ---------------------------------------
# Match against the 6 deny families. Order matters only for the stderr
# message; the deny rule is symmetric across all 6 families.
BLOCKED=0
BLOCKED_REASON=""
case "${FILE_PATH}" in
  src/*)
    BLOCKED=1
    BLOCKED_REASON="src/ (application source code)" ;;
  tests/unit/*)
    BLOCKED=1
    BLOCKED_REASON="tests/unit/ (unit test source)" ;;
  tests/integration/*)
    BLOCKED=1
    BLOCKED_REASON="tests/integration/ (integration test source)" ;;
  config/*)
    BLOCKED=1
    BLOCKED_REASON="config/ (project configuration)" ;;
  bin/*)
    BLOCKED=1
    BLOCKED_REASON="bin/ (binary / executable entrypoint)" ;;
  scripts/*)
    BLOCKED=1
    BLOCKED_REASON="scripts/ (build / release script)" ;;
esac

if [[ "${BLOCKED}" != "1" ]]; then
  exit 0
fi

# --- 7. Emit deny signal ---------------------------------------------------
# Exit 2 = the standard PreToolUse hook deny code. Stderr carries the
# structured reason string the LLM reads on its next turn; stdout is
# empty (this hook does not need a hookSpecificOutput envelope — it is
# a hard block, not a soft reminder).
echo "PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${FILE_PATH} matches hard-blocked path family ${BLOCKED_REASON}; orchestrator MUST NOT Edit/Write these directly. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>" >&2
exit 2