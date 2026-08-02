#!/usr/bin/env bash
#
# pre-tool-edit-enforcement.sh — peaks-code Red Line enforcement (slice 4.0.7-PR-meta-1).
#
# Purpose
#   Block the LLM from editing `src/**` directly without going
#   through the peaks-code / peaks-rd / peaks-qa sub-agent flow.
#   The pre-meta-1 SKILL.md had a prose-only Red Line ("You MUST
#   NOT write, edit, or modify any application source code
#   directly") but no enforcement layer. The 4.0.7 dogfood pass on
#   ice-cola surfaced the bug: the LLM routed 22 files / 632
#   lines of source-code edits through `Edit` directly, bypassing
#   `peaks sub-agent dispatch rd` entirely. This hook closes the
#   gap with a hard deny on `Edit` / `Write` calls that target
#   `src/**` when no RD artifact exists.
#
# Hard rules enforced here
#   - Pure stdin → stdout. No env-mutating side effects. The hook
#     is a thin shell script (no jq, no node, no Python — runs on
#     stock Git Bash on Windows).
#   - Source of truth lives in the peaks-loop repo
#     (src/services/hooks/pre-tool-edit-enforcement.sh). The
#     user-global copy at
#     `~/.claude/skills/peaks-code/hooks/pre-tool-edit-enforcement.sh`
#     is installed by `peaks hooks install --with-edit-enforcement`
#     (slice 4.0.7-PR-meta-1 follow-up) and MUST be byte-identical
#     to the repo source after install.
#   - Deny envelope shape: `hookSpecificOutput.permissionDecision: "deny"`.
#     When the IDE (Claude Code / Trae / Cursor / Codex) sees
#     `permissionDecision: "deny"`, the agent is blocked at the
#     tool-execution layer — the Edit / Write call never reaches
#     the file system. This is a HARD layer (L3 in the 3-layer
#     worktree-governance design), not a soft `additionalContext`
#     warning.
#
# Bypass conditions (legitimate Edit / Write calls that this hook
# allows without an RD artifact):
#   - The file path matches `tests/**` (tests are part of the slice
#     itself, not the application source).
#   - The file path matches `docs/**` (documentation is not
#     application source).
#   - The file path matches `.peaks/_runtime/<sid>/rd/**` (the
#     LLM is writing the RD artifact itself, which is the
#     *input* to the peaks-code flow, not a bypass of it).
#   - The file path matches `src/services/hooks/pre-tool-*.sh` (the
#     hook scripts themselves; bootstrapping problem).
#   - A peaks-managed marker `peaks:edit-bypass` is set in the
#     project root's `.peaks/standards/edit-bypass` file. This is
#     a documented escape hatch for hot-fixes; the file is
#     gitignored so the bypass never reaches the registry.
#   - The active peaks-code session is in 24H_ACTIVE state and
#     the env var `PEAKS_EDIT_BYPASS_24H=1` is set. This
#     explicitly recognizes that 24h-mode dogfood / spike work
#     may need direct Edit; the user opts in once per session.

set -euo pipefail

PAYLOAD="$(cat || true)"

if [[ -z "${PAYLOAD}" ]]; then
  exit 0
fi

# --- 1. Extract tool_name -------------------------------------------------
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

# Only act on Edit / Write / MultiEdit / NotebookEdit. Anything else
# (Bash, Read, Grep, ...) is out of scope.
case "${TOOL_NAME}" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

# --- 2. Extract the file path the LLM is targeting -----------------------
# Edit/Write payloads use `file_path`; MultiEdit uses `file_path` too;
# NotebookEdit uses `notebook_path`. Extract whichever is present.
FILE_PATH="$(printf '%s' "${PAYLOAD}" \
  | grep -oE '"(file_path|notebook_path)"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | head -n1 \
  | sed -E 's/.*"(file_path|notebook_path)"[[:space:]]*:[[:space:]]*"([^"]+)".*/\2/' \
  || true)"

if [[ -z "${FILE_PATH}" ]]; then
  # No path = something exotic. Don't block; let the IDE handle.
  exit 0
fi

# --- 3. Bypass conditions -------------------------------------------------
# 3a. Tests, docs, RD artifacts, and the hook script itself are exempt.
case "${FILE_PATH}" in
  */tests/*|*/test/*|*/__tests__/*) exit 0 ;;
  */docs/*) exit 0 ;;
  */.peaks/_runtime/*/rd/*) exit 0 ;;
  */src/services/hooks/pre-tool-*.sh) exit 0 ;;
  */.peaks/standards/edit-bypass) exit 0 ;;
esac

# 3b. Hot-fix escape hatch: .peaks/standards/edit-bypass file exists.
if [[ -f ".peaks/standards/edit-bypass" ]]; then
  exit 0
fi

# 3c. 24h-mode opt-in env var.
if [[ "${PEAKS_EDIT_BYPASS_24H:-0}" == "1" ]]; then
  exit 0
fi

# --- 4. The only path this hook blocks: src/** ---------------------------
# We use a portable regex match against the file path. Trailing-slash
# variants (e.g. `src/`) are also matched.
if [[ ! "${FILE_PATH}" =~ (^|/)src(/|$) ]]; then
  # Not an application-source edit. Allow.
  exit 0
fi

# --- 5. RD artifact check ------------------------------------------------
# Look for the active peaks-code session's RD artifact directory.
# The session id is the basename of `.peaks/_runtime/<sid>/` — we
# accept any sibling RD request under the active session.
PEAKS_RUNTIME_DIR=".peaks/_runtime"
if [[ ! -d "${PEAKS_RUNTIME_DIR}" ]]; then
  # No peaks workspace at all. The Edit is on application source in
  # a repo that has no peaks-code session — that's a legitimate
  # user-not-using-peaks-code case. Don't block; surface a hint.
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "additionalContext": "[peaks-loop] editing src/** in a repo without an active peaks-code session. If this is intentional, no action is needed. If you expected peaks-code to govern this, run `peaks workspace init --project <repo> --json` first."
  }
}
EOF
  exit 0
fi

# Look for any RD request artifact under any session dir.
RD_ARTIFACT_FOUND=0
for session_dir in "${PEAKS_RUNTIME_DIR}"/*/; do
  if [[ -d "${session_dir}rd/requests" ]]; then
    # Any non-empty RD request file proves a peak-rd is in flight.
    if compgen -G "${session_dir}rd/requests/*.md" > /dev/null; then
      RD_ARTIFACT_FOUND=1
      break
    fi
  fi
done

if [[ "${RD_ARTIFACT_FOUND}" == "1" ]]; then
  # An RD request exists — the LLM is editing src/** as part of an
  # active peak-rd. Allow.
  exit 0
fi

# --- 6. Deny envelope -----------------------------------------------------
# The LLM is about to edit src/** with no RD artifact on disk. This
# is exactly the bypass pattern the 4.0.7 ice-cola dogfood pass
# surfaced (22 files / 632 lines of Edit calls without a single
# peaks sub-agent dispatch). Deny and point the LLM at the right
# next step.
DENY_REASON="peaks-code Red Line: direct Edit of application source (\`${FILE_PATH}\`) without an active peaks-rd artifact. Per skills/peaks-code/SKILL.md §Code-Change Red Line, every code change must go through the peaks-code → peaks-rd → peaks-qa → verdict flow. Run: 1) \`peaks request init --role rd --id <kebab-rid> --type <feature|bugfix|refactor|docs|config|chore> --project <repo> --apply --json\` 2) \`peaks sub-agent dispatch rd --request-id <rid> --prompt '<task>' --json\` — then re-run the Edit. Or, if this is a hot-fix / dogfood session outside peaks-code governance, opt in once: \`echo > .peaks/standards/edit-bypass\` (gitignored) or set \`PEAKS_EDIT_BYPASS_24H=1\` in the shell that the IDE spawned."

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": ${DENY_REASON@Q}
  }
}
EOF
exit 0
