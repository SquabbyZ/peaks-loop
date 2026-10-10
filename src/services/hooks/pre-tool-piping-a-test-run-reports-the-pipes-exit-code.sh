#!/usr/bin/env bash
#
# pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh — PreToolUse hook
# for the `piping-a-test-run-reports-the-pipes-exit-code` feedback rule
# (`.peaks/memory/piping-a-test-run-reports-the-pipes-exit-code.md`).
#
# Purpose
#   Read the active PreToolUse JSON payload from stdin (vendor-neutral hook
#   protocol: { tool_name, tool_input } and the older { tool, input } shape).
#   When the tool call is a `Bash` command that pipes a TEST RUNNER into a
#   filter or pager — `vitest … | tail`, `pnpm test:unit | head` — REFUSE it
#   (exit 2 + stderr naming the rule and the fix).
#
#   The rule: after a pipeline, `$?` is the exit status of the LAST command.
#   A piped test run therefore reports the filter's status, so "0 failed" and
#   "the process exited 0" become two different assertions that a single number
#   silently conflates. An unhandled error fails the run with no test-level
#   failure at all — the case this rule was written from.
#
# What is deliberately NOT blocked (this hook has one job, not two)
#   - any pipeline with no test runner in it (`git log | head`, `ls | grep`,
#     `git diff | tail`) — the rule is about the exit code of a TEST run;
#   - a test run with no pipe at all, which is the prescribed fix
#     (`vitest run > suite.log 2>&1`);
#   - a pipeline whose later stage is not a filter or pager (`vitest run | tee
#     log`), because the rule's harm is reading the wrong number as the suite's,
#     not streaming output;
#   - a test runner merely NAMED as an argument rather than invoked
#     (`grep vitest package.json | head`): the runner has to start the command.
#
# Hard rules enforced here
#   - Thin, idempotent, pure-stdin script. No retries, no jq, no colour codes,
#     no environment mutation, no filesystem writes, no subprocess execution.
#   - The only side effects are the exit code and the stderr message.
#
# Karpathy §2 (Simplicity First): one split, two predicates, read once.
# Karpathy §3 (Surgical Changes): reads stdin only; never runs the command.
# Karpathy §4 (Goal-Driven Execution): 0 = allow, 2 = refuse with a named rule.
#
# KNOWN RESIDUAL: the pipeline is split on `|` textually, so a `|` inside a
# quoted argument (`bash -c "vitest run | tail"`) is read as a pipeline
# separator — which makes the first segment start with `bash`, not a runner, so
# that spelling is ALLOWED rather than refused. Being permissive here is the
# deliberate choice: the alternative misreads a literal `|` argument as a pipe.

set -euo pipefail

# --- 1. Read the tool payload from stdin ------------------------------------
PAYLOAD="$(cat || true)"

if [[ -z "${PAYLOAD}" ]]; then
  exit 0
fi

# --- 2. Extract the tool name without depending on jq -----------------------
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
  Bash|bash) ;;
  *) exit 0 ;;
esac

# --- 3. Extract the command string -----------------------------------------
COMMAND="$(printf '%s' "${PAYLOAD}" \
  | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
  | head -n1 \
  | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"(.*)"/\1/' \
  || true)"

if [[ -z "${COMMAND}" ]]; then
  exit 0
fi

# --- 4. No pipe, no piped exit code ----------------------------------------
# This is the arm that keeps the hook off every legitimate redirect-form test
# run: `vitest run > suite.log 2>&1` has no `|` and never reaches the scan.
if ! printf '%s' "${COMMAND}" | grep -q '|'; then
  exit 0
fi

# --- 5. Word helpers (pure bash — no awk, no cut) --------------------------
ltrim() {
  local s="$1"
  printf '%s' "${s#"${s%%[![:space:]]*}"}"
}

first_word() {
  local s
  s="$(ltrim "$1")"
  printf '%s' "${s%%[[:space:]]*}"
}

# The simple command a pipeline segment ENDS with: `cd repo && vitest run`
# runs tests, so everything before the last separator is context, not the verb.
# Leading `VAR=value` assignments are prefix environment, not the verb either.
normalize_segment() {
  printf '%s' "$1" \
    | sed -E 's/.*(&&|\|\||;)[[:space:]]*//' \
    | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)+//'
}

second_word() {
  local s rest
  s="$(ltrim "$1")"
  rest="${s#*[[:space:]]}"
  if [[ "${rest}" == "${s}" ]]; then
    printf ''
  else
    first_word "${rest}"
  fi
}

third_word() {
  local s rest
  s="$(ltrim "$1")"
  rest="${s#*[[:space:]]}"
  if [[ "${rest}" == "${s}" ]]; then
    printf ''
  else
    second_word "${rest}"
  fi
}

# --- 6. Does this segment START a test runner? -----------------------------
segment_runs_tests() {
  local seg first second
  seg="$(normalize_segment "$1")"
  first="$(first_word "${seg}")"
  second="$(second_word "${seg}")"
  case "${first}" in
    vitest|jest)
      return 0
      ;;
    node|node.exe)
      case "${second}" in
        *vitest*|*jest*) return 0 ;;
      esac
      return 1
      ;;
    pnpm|pnpm.cmd|npm|npm.cmd|yarn|npx|npx.cmd|bun|bunx)
      case "${second}" in
        test|test:*|vitest|jest) return 0 ;;
        run)
          case "$(third_word "${seg}")" in
            test|test:*|vitest|jest) return 0 ;;
          esac
          return 1
          ;;
      esac
      return 1
      ;;
  esac
  return 1
}

# --- 7. Is this segment a filter or pager? ---------------------------------
segment_is_filter() {
  case "$(first_word "$(normalize_segment "$1")")" in
    tail|head|more|less|cat|cut|sed|awk|grep) return 0 ;;
  esac
  return 1
}

# --- 8. Split the pipeline, keeping `||` out of it -------------------------
SEGMENTS="$(printf '%s' "${COMMAND}" \
  | sed -E 's/\|\|/__PEAKS_OR__/g' \
  | tr '|' '\n' \
  | sed -E 's/__PEAKS_OR__/||/g')"

RUNNER=""
FILTER=""
while IFS= read -r segment; do
  if [[ -z "${RUNNER}" ]]; then
    if segment_runs_tests "${segment}"; then
      RUNNER="$(first_word "$(normalize_segment "${segment}")")"
    fi
  elif [[ -z "${FILTER}" ]] && segment_is_filter "${segment}"; then
    FILTER="$(first_word "$(normalize_segment "${segment}")")"
  fi
done <<< "${SEGMENTS}"

if [[ -z "${RUNNER}" || -z "${FILTER}" ]]; then
  exit 0
fi

# --- 9. Emit the deny signal with the fix ----------------------------------
echo "PEAKS_PIPED_TEST_RUN_EXIT_CODE: blocked — \`${RUNNER} … | ${FILTER}\` reports ${FILTER}'s exit status, not ${RUNNER}'s, so the number you read is not the suite's." >&2
echo "Rule \`piping-a-test-run-reports-the-pipes-exit-code\`: after a pipeline \`\$?\` is the LAST command's status. Unhandled errors fail a test run with NO test-level failure, so \"0 failed\" and \"the process exited 0\" are two different assertions — and the pipe silently substitutes an unrelated process's result for the second." >&2
echo "Fix — redirect to a file and read the real code, in two steps:" >&2
echo "  node node_modules/vitest/vitest.mjs run > suite.log 2>&1; echo \"EXIT=\$?\"" >&2
echo "  then read suite.log in a separate command." >&2
echo "Or, under bash only, read the runner's own status out of the pipeline immediately: \`… | tail; echo \"\${PIPESTATUS[0]}\"\`." >&2
exit 2
