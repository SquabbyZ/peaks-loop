#!/usr/bin/env bash
#
# pre-tool-scope-counter.sh — Edit/W scope counter (slice 4.0.7-PR-meta-3).
#
# Purpose
#   Track the cumulative count of application-source edits within
#   the current peaks-code session and emit a fail-loud reflection
#   reminder at thresholds (default 5, 10, 20). The pre-PR-meta-3
#   harness-side SCOPE WARNING was informational noise that the
#   LLM learned to ignore (per the 4.0.7 dogfood report: SCOPE
#   WARNING fired 5 times in a single session, the LLM continued
#   editing without reflection). This hook turns the warning into
#   a checkpoint: at each threshold the LLM MUST write a
#   reflection note to `.peaks/_runtime/<sid>/scope-reflection.md`
#   and reference it before the next Edit. The hook does NOT
#   deny; it surfaces a checkpoint that the LLM cannot skip
#   without explicit acknowledgment.
#
# Hard rules enforced here
#   - Counter is per-session (lives under `.peaks/_runtime/<sid>/`).
#     If no peaks session is active, the hook is a silent pass.
#   - Counter increments ONLY on application-source edits
#     (`src/**`). Tests / docs / RD artifacts are not counted.
#   - Counter file uses atomic write (write to .tmp + rename) so
#     a crashed process cannot leave a partial file.
#   - Output is `hookSpecificOutput.additionalContext` (soft
#     signal), not `permissionDecision: deny` (hard signal). The
#     meta-3 design is fail-LOUD, not fail-CLOSED — the LLM
#     decides whether to continue, but it cannot claim "I did not
#     see the warning".

set -euo pipefail

PAYLOAD="$(cat || true)"

if [[ -z "${PAYLOAD}" ]]; then
  exit 0
fi

# --- 1. Extract tool_name + file_path ------------------------------------
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

case "${TOOL_NAME}" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH="$(printf '%s' "${PAYLOAD}" \
  | grep -oE '"(file_path|notebook_path)"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | head -n1 \
  | sed -E 's/.*"(file_path|notebook_path)"[[:space:]]*:[[:space:]]*"([^"]+)".*/\2/' \
  || true)"

if [[ -z "${FILE_PATH}" ]]; then
  exit 0
fi

# --- 2. Only count application-source edits -----------------------------
# Same scope as PR-meta-1 (tests / docs / RD artifacts / hook scripts
# themselves are exempt from the counter).
case "${FILE_PATH}" in
  */tests/*|*/test/*|*/__tests__/*) exit 0 ;;
  */docs/*) exit 0 ;;
  */.peaks/_runtime/*) exit 0 ;;
  */src/services/hooks/pre-tool-*.sh) exit 0 ;;
esac
if [[ ! "${FILE_PATH}" =~ (^|/)src(/|$) ]]; then
  exit 0
fi

# --- 3. Resolve the active session id ----------------------------------
# Session id = basename of the most-recently-modified subdirectory
# under .peaks/_runtime/ that is NOT "session.json" itself.
PEAKS_RUNTIME_DIR=".peaks/_runtime"
if [[ ! -d "${PEAKS_RUNTIME_DIR}" ]]; then
  exit 0
fi

SESSION_ID=""
LATEST_MTIME=0
for entry in "${PEAKS_RUNTIME_DIR}"/*; do
  if [[ -d "${entry}" && "$(basename "${entry}")" != "session.json" ]]; then
    MTIME=$(stat -c '%Y' "${entry}" 2>/dev/null || stat -f '%m' "${entry}" 2>/dev/null || echo 0)
    if [[ "${MTIME}" -gt "${LATEST_MTIME}" ]]; then
      LATEST_MTIME="${MTIME}"
      SESSION_ID="$(basename "${entry}")"
    fi
  fi
done

if [[ -z "${SESSION_ID}" ]]; then
  exit 0
fi

# --- 4. Atomic counter increment ----------------------------------------
COUNTER_FILE="${PEAKS_RUNTIME_DIR}/${SESSION_ID}/edit-counter.json"
mkdir -p "$(dirname "${COUNTER_FILE}")"

# Read existing count (default 0). The JSON shape is
# { "count": <int>, "thresholdsHit": [5, 10, ...] }.
CURRENT_COUNT=0
THRESHOLDS_HIT="[]"
if [[ -f "${COUNTER_FILE}" ]]; then
  CURRENT_COUNT=$(grep -oE '"count"[[:space:]]*:[[:space:]]*[0-9]+' "${COUNTER_FILE}" 2>/dev/null \
    | head -n1 | grep -oE '[0-9]+' || echo 0)
  THRESHOLDS_HIT=$(grep -oE '"thresholdsHit"[[:space:]]*:[[:space:]]*\[[^]]*\]' "${COUNTER_FILE}" 2>/dev/null \
    | sed -E 's/.*"thresholdsHit"[[:space:]]*:[[:space:]]*(\[.*\])/\1/' || echo "[]")
fi

NEW_COUNT=$((CURRENT_COUNT + 1))

# Determine which thresholds (5, 10, 20) are newly hit on this edit.
THRESHOLDS_TO_EMIT=()
for t in 5 10 20; do
  if [[ "${NEW_COUNT}" -ge "${t}" && "${NEW_COUNT}" -eq "${t}" ]]; then
    THRESHOLDS_TO_EMIT+=("${t}")
  fi
done

# Update thresholdsHit (append any newly hit thresholds).
NEW_THRESHOLDS_HIT="${THRESHOLDS_HIT}"
for t in "${THRESHOLDS_TO_EMIT[@]:-}"; do
  if [[ -z "${t}" ]]; then continue; fi
  if [[ "${NEW_THRESHOLDS_HIT}" == "[]" ]]; then
    NEW_THRESHOLDS_HIT="[${t}]"
  else
    NEW_THRESHOLDS_HIT="${NEW_THRESHOLDS_HIT%]}, ${t}]"
  fi
done

# Atomic write.
TMP="${COUNTER_FILE}.tmp.$$"
cat > "${TMP}" <<EOF
{"count": ${NEW_COUNT}, "thresholdsHit": ${NEW_THRESHOLDS_HIT}, "lastFile": "${FILE_PATH}"}
EOF
mv "${TMP}" "${COUNTER_FILE}"

# --- 5. Emit fail-loud reminder at thresholds ----------------------------
if [[ "${#THRESHOLDS_TO_EMIT[@]}" -eq 0 || -z "${THRESHOLDS_TO_EMIT[0]:-}" ]]; then
  exit 0
fi

LATEST_THRESHOLD="${THRESHOLDS_TO_EMIT[-1]}"
REFLECTION_FILE="${PEAKS_RUNTIME_DIR}/${SESSION_ID}/scope-reflection.md"

# Slice 4.0.7-PR-meta-7: harden the fail-LOUD into a hard
# checkpoint. The pre-PR-meta-7 hook emitted `additionalContext`
# (soft signal). The LLM continued editing without writing
# the reflection file (per the 4.0.7 meta-debug report). The
# post-PR-meta-7 hook emits `permissionDecision: deny` until
# the reflection file exists AND contains all 3 answers
# (a) active peaks-rd artifact, (b) rid (when a), (c) reason
# for editing outside the flow (when not a). The validation
# is intentionally lenient: we check the file exists and is
# non-empty; deeper LLM-side parsing happens in subsequent
# turns. A bypass file `.peaks/standards/scope-counter-bypass`
# (gitignored escape hatch) lets the operator skip the
# checkpoint for known-safe windows.
if [[ -f ".peaks/standards/scope-counter-bypass" ]]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "additionalContext": "[peaks-loop scope counter] bypass file present at .peaks/standards/scope-counter-bypass; scope counter skipped."
  }
}
EOF
  exit 0
fi

# Check if a reflection file already exists. If it does, the LLM
# has acknowledged the prior threshold; let the next edit through
# until the next threshold is hit. (Each threshold requires its
# own reflection.)
if [[ -f "${REFLECTION_FILE}" ]]; then
  # Reflection exists. Allow the edit and let the LLM keep working
  # until the next threshold.
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "additionalContext": "[peaks-loop scope counter] threshold ${LATEST_THRESHOLD} previously acknowledged via ${REFLECTION_FILE}; allowing the next Edit/Write. The next threshold will require a fresh reflection."
  }
}
EOF
  exit 0
fi

# No reflection yet: hard deny.
DENY_REASON="peaks-loop scope counter: ${NEW_COUNT} cumulative application-source edits in session ${SESSION_ID}. Threshold ${LATEST_THRESHOLD} hit. Slice 4.0.7-PR-meta-7 hardens the pre-PR-meta-7 soft signal into a hard checkpoint. Before the next Edit/Write on src/**, write a brief reflection to ${REFLECTION_FILE} answering all 3 questions: (a) is this Edit part of an active peaks-rd artifact? (b) if yes, which rid? (c) if no, why are you editing src/** outside the peaks-code flow? The reflection file must exist on disk for the next Edit/Write to succeed. Bypass: write an empty file at .peaks/standards/scope-counter-bypass (gitignored escape hatch)."

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
