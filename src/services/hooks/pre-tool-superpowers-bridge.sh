#!/usr/bin/env bash
#
# pre-tool-superpowers-bridge.sh — peaks-loop ↔ superpowers bridge PreToolUse hook
# (slice 2026-07-24-peaks-code-bridge-002-rootcause)
#
# Purpose
#   Read the active PreToolUse JSON payload from stdin (Claude Code /
#   Trae / Cursor / Codex schema: { tool_name, tool_input, ... }). When the
#   tool call would route a peak-* request straight to a superpowers
#   planner/executor (superpowers:brainstorming, superpowers:writing-plans,
#   superpowers:executing-plans, superpowers:subagent-driven-development)
#   instead of `peaks sub-agent dispatch rd|qa`, this hook emits a non-blocking
#   `additionalContext` reminder to the agent. The hook does NOT deny the
#   tool call — superpowers is reference material, not banned — but it makes
#   the governance expectation explicit at the exact moment the agent is
#   about to short-circuit peaks-rd.
#
# Hard rules enforced here
#   - Hook is a thin, idempotent, pure-stdin script. No env-mutating side effects.
#   - Source of truth lives in the peaks-loop repo (this file). The user-global
#     copy at ~/.claude/skills/peaks-code/hooks/pre-tool-superpowers-bridge.sh
#     is installed by `peaks hooks install` and MUST be byte-identical to this
#     source after install.
#   - If the user-global copy and this source diverge, treat the user-global
#     copy as pollution (do not patch it in place) and re-run `peaks hooks install`.
#
# Karpathy §2 (Simplicity First): no retries, no jq dependency, no colour codes.
# Karpathy §3 (Surgical Changes): reads stdin only; never mutates user-global state.
# Karpathy §4 (Goal-Driven Execution): the only side effect is a stdout JSON
#   envelope with hookSpecificOutput.additionalContext; the IDE merges it into
#   the tool call's pre-execution context.

set -euo pipefail

# --- 1. Read the tool payload from stdin ------------------------------------
PAYLOAD="$(cat || true)"

# Tolerate empty stdin (the IDE may call the hook before the agent has produced
# any tool input). Empty payload → silent success; nothing to bridge.
if [[ -z "${PAYLOAD}" ]]; then
  exit 0
fi

# --- 2. Extract tool_name without depending on jq --------------------------
# Use a portable grep/case-match instead of jq so the hook runs on stock Git
# Bash (Windows) without an extra dependency. The payload is JSON; we read
# the first matching "tool_name":"<value>" occurrence.
TOOL_NAME="$(printf '%s' "${PAYLOAD}" \
  | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | head -n1 \
  | sed -E 's/.*"tool_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
  || true)"

# Also try the older Claude-Code PreToolUse shape: { tool: "Bash", ... }
if [[ -z "${TOOL_NAME}" ]]; then
  TOOL_NAME="$(printf '%s' "${PAYLOAD}" \
    | grep -oE '"tool"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -n1 \
    | sed -E 's/.*"tool"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
    || true)"
fi

# --- 3. Decide whether to emit the bridge reminder -------------------------
# We only emit when the tool call's *intent* is to invoke a superpowers
# planner/executor. This is detectable when:
#   (a) tool_name is one of the superpowers skill-invocation tool shapes, OR
#   (b) the tool_input.command / tool_input.skill references a superpowers skill name.
# We deliberately do NOT trigger on Bash commands that merely mention
# superpowers in a comment — keep the hook intent-focused.
#
# Slice rid-skill-persistence-001 (2026-08-12): the deny list widened to
# four additional superpowers skills (systematic-debugging /
# test-driven-development / verification-before-completion / using-
# superpowers). The L3 IDE deny list (`SUPERPOWERS_DENIED_SKILLS` in
# hooks-settings-service.ts) blocks the Skill tool at the IDE layer,
# but the bridge hook is the L2 backstop for non-Claude harnesses
# (Trae / Cursor / Codex) that do NOT enforce L3 deny. Mirror the
# four new entries in the regex below so the bridge reminder fires
# for every chain step, regardless of which IDE the user is on.
NEEDS_BRIDGE=0
case "${TOOL_NAME}" in
  Skill|skill|mcp__claude_code__Skill)
    if printf '%s' "${PAYLOAD}" | grep -qE 'superpowers:(brainstorming|writing-plans|executing-plans|subagent-driven-development|systematic-debugging|test-driven-development|verification-before-completion|using-superpowers)'; then
      NEEDS_BRIDGE=1
    fi
    ;;
esac

if [[ "${NEEDS_BRIDGE}" != "1" ]]; then
  # Also check for a Bash command line that directly references a superpowers
  # planning/execution skill (legacy shape).
  if printf '%s' "${PAYLOAD}" | grep -qE 'superpowers:(brainstorming|writing-plans|executing-plans|subagent-driven-development|systematic-debugging|test-driven-development|verification-before-completion|using-superpowers)'; then
    NEEDS_BRIDGE=1
  fi
fi

if [[ "${NEEDS_BRIDGE}" != "1" ]]; then
  exit 0
fi

# --- 4. Emit the hookSpecificOutput envelope -------------------------------
# The IDE (Claude Code / Trae) parses this JSON and merges the
# additionalContext into the agent's pre-execution context. This is a
# soft signal — the agent MAY proceed, but it MUST follow the bridge.
cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "[peaks-loop bridge] superpowers:brainstorming / writing-plans / executing-plans / subagent-driven-development is REFERENCE ONLY inside a peaks-code request. Re-author the resulting plan via `peaks sub-agent dispatch rd --prompt '<brainstorm-seed>' --request-id <rid> --batch-id <uuid> --json`, then continue from Step 3 of the peaks-code 11-step sequence. Do NOT dispatch superpowers:executing-plans or superpowers:subagent-driven-development in place of peaks-rd / peaks-qa. See skills/peaks-code/SKILL.md (BRIDGE chapter), references/runbook.md Step 2.7, references/boundaries.md (superpowers red lines), and references/external-skill-invocation.md (superpowers transition contract)."
  }
}
EOF

exit 0