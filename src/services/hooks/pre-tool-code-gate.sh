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
#   A RELATIVE target path is read against the directory the tool call
#   runs in ($PWD) and is then judged by where it lands inside the
#   project, so a call that runs in `src/` cannot reach `src/` by
#   spelling a shorter relative path.
#
#   The path is read TWICE — as it is SPELLED and as the file REALLY
#   sits on disk — and the STRICTEST of the two readings decides. One
#   directory can be named two ways (a symlink, a junction, macOS's
#   `/var` → `/private/var`), and the difference is what a symlinked
#   BASE inside the project looks like: the call runs in `link/`,
#   `link/` points at `src/`, and the file it writes lands in `src/`.
#   A wrongly allowed edit is a hole in the gate; a wrongly refused one
#   is only an inconvenience.
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
# Lane judgement is NOT here (deliberate, not drift)
#   This gate judges two things — the tool call and the target path — and
#   takes no driver input. Nothing in the hook payload tells it which lane
#   is driving, so the hard-blocked families below are refused
#   UNCONDITIONALLY, including for a session the Node CLI gate would let
#   through. The CLI gate (`peaks code-gate`) is the one that resolves the
#   driver and opens those families; this file cannot, and MUST NOT grow
#   that resolution — it would be a second implementation of a single
#   decision. A harness pointed at this script is therefore refused where
#   that command allows, and the asymmetry is intentional.
#
#   Nothing points a harness at it by default. `peaks hooks install
#   --scope global` copies this file into the IDE's skills directory (a
#   project-scope install copies nothing), but that copy is inert: every
#   hook entry the installer writes is a `peaks …` command, and no
#   settings template invokes a `.sh`. This script is the conservative
#   shape a non-Node harness would reproduce, not a gate any session is
#   on by default.
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

# --- 5. Normalize the SPELLING of the path ----------------------------------
# The deny families are project-relative prefixes, so how the path is
# spelled must not decide the verdict: `./src/x.ts` is the file `src/x.ts`.
# Two normalizations, and both of them are spelling-level:
#   - backslashes fold to `/` (a Windows payload spells the separator that way)
#   - leading `./` segments are dropped
# Whether the path is absolute is decided from the spelling BEFORE that drop,
# so the drop can never turn a relative path into an absolute one.
# The path is then read against the directory the tool call RUNS IN: the file
# a call writes is the one that directory names, and the project root and
# the call's own directory differ whenever the call runs in a subdirectory.
# The file it lands in is judged by where it sits inside the project, so the
# families still name this project's directories.
#
# THE PATH IS READ TWICE, and the STRICTEST reading is the verdict.
#   - the LEXICAL reading: the base as it is SPELLED ($PWD), and the project
#     root as that base spells it
#   - the CANONICAL reading: the base RESOLVED through its symlinks
#     (`pwd -P`), and the project root derived from THAT base
# One directory can be named two ways — a symlink, a junction, macOS's
# `/var` → `/private/var` — and the difference is what a symlinked BASE
# inside the project looks like: the call runs in `link/`, `link/` points
# at `src/`, and the file it writes lands in `src/`. The lexical reading
# says `link/deep/x.ts` (no family) and the canonical one says
# `src/deep/x.ts` (a family). A wrongly allowed edit is a hole in the gate
# and a wrongly refused one is only an inconvenience, so a path that EITHER
# reading places in a hard-blocked family is REFUSED.
#
# The project root is the nearest ancestor of the call's own directory that
# carries a peaks workspace. The script takes no arguments and no env vars,
# so the root is found by walking UP; the NEAREST one wins, so a project
# nested inside another repository is judged against ITSELF. A file OUTSIDE
# the project belongs to no family, and the spelling is all the project can
# judge it by, so that case falls back to the spelling read against the root.
#
# An ABSOLUTE path is NOT relativized here: that needs the project root in
# the payload's own spelling, which this script does not have, and a guess
# would be a false-positive block. The Node command (`peaks code-gate`) is
# the gate that knows the project root, and it judges the absolute spelling
# of the same file. The raw path is kept for the deny message, which names
# the file the tool asked for.

# The absolute path of `rel` under `base`, with `.` and `..` collapsed.
resolve_under() {
  local out="${1%/}"
  local rest="${2}"
  local segment=""
  while [[ -n "${rest}" ]]; do
    segment="${rest%%/*}"
    if [[ "${rest}" == */* ]]; then
      rest="${rest#*/}"
    else
      rest=""
    fi
    case "${segment}" in
      ''|'.')
        ;;
      '..')
        if [[ "${out}" == "/" ]]; then
          out="/"
        else
          out="${out%/*}"
          if [[ -z "${out}" ]]; then out="/"; fi
        fi
        ;;
      *)
        out="${out%/}/${segment}"
        ;;
    esac
  done
  printf '%s' "${out}"
}

# The path of `target` relative to `root`, or nothing when `target` is not
# inside `root`.
relativize_under() {
  local root="${1%/}"
  local target="$2"
  if [[ "${target}" == "${root}" ]]; then
    printf ''
    return 0
  fi
  if [[ "${target:0:${#root}+1}" == "${root}/" ]]; then
    printf '%s' "${target:${#root}+1}"
    return 0
  fi
  return 1
}

# The project root the deny families are relative to: the nearest ancestor of
# `dir` that carries a peaks workspace. The nearest one wins, so a project
# nested inside another repository is judged against ITSELF. The walk stops at
# a repository boundary and at the home directory, so a workspace that belongs
# to no project cannot claim a project that is not its own.
project_root() {
  local dir="${1%/}"
  local home="${HOME%/}"
  while [[ -n "${dir}" ]]; do
    # The home directory is a boundary, and it is checked FIRST: the global
    # peaks workspace lives there, and it is not the root of any project.
    if [[ -n "${home}" && "${dir}" == "${home}" ]]; then
      break
    fi
    if [[ -d "${dir}/.peaks" ]]; then
      printf '%s' "${dir}"
      return 0
    fi
    if [[ "${dir}" == "/" ]]; then
      break
    fi
    if [[ -e "${dir}/.git" ]]; then
      break
    fi
    dir="$(dirname "${dir}")"
  done
  printf '%s' "${1%/}"
}

# The physical spelling of `path`: every component that EXISTS is resolved
# through its symlinks, and the components that do not are kept as they are
# spelled. A directory that cannot be entered is kept as it is spelled too,
# so the reading falls back to the spelling rather than to nothing.
physical_path() {
  local target="$1" dir="" base="" phys=""
  dir="$(dirname "${target}")"
  base="$(basename "${target}")"
  if phys="$(CDPATH='' cd -P "${dir}" 2>/dev/null && pwd -P)"; then
    printf '%s/%s' "${phys}" "${base}"
    return 0
  fi
  printf '%s' "${target}"
}

# The project-relative reading of `spelled`, read against `base` and judged
# against `root`.
#
# A file that lands INSIDE the project is named by where it sits in the
# project. A file that lands OUTSIDE has no name in the project, so the
# project reads its SPELLING against the root — a reading that never reaches
# a family the file itself did not reach.
read_under() {
  local base="${1%/}" root="${2%/}" spelled="$3" resolved="" out=""
  resolved="$(resolve_under "${base}" "${spelled}")"
  if ! out="$(relativize_under "${root}" "${resolved}")"; then
    resolved="$(resolve_under "${root}" "${spelled}")"
    if ! out="$(relativize_under "${root}" "${resolved}")"; then
      out=""
    fi
  fi
  printf '%s' "${out}"
}

# The CANONICAL reading: the file named by the directory it REALLY sits in.
# Nothing when the file is outside the project — the project has no name for
# it there, and the reading that does is the spelling one above.
read_canonical_under() {
  local base="${1%/}" root="${2%/}" spelled="$3" resolved="" out=""
  resolved="$(physical_path "$(resolve_under "${base}" "${spelled}")")"
  if ! out="$(relativize_under "${root}" "${resolved}")"; then
    out=""
  fi
  printf '%s' "${out}"
}

MATCH_PATH="${FILE_PATH//\\//}"

# Is the path ABSOLUTE as the tool SPELLED it? Decided BEFORE the `./`
# segments are dropped: the strip turns `.//x` into `/x`, and a path that now
# starts with `/` read as absolute is never relativized, so the file lands
# outside every family and is allowed - the same edit denied in one spelling
# and allowed in another, and the allow is the one that happens.
case "${MATCH_PATH}" in
  /*|[A-Za-z]:*) IS_ABSOLUTE=1 ;;
  *) IS_ABSOLUTE=0 ;;
esac

while [[ "${MATCH_PATH}" == ./* ]]; do
  MATCH_PATH="${MATCH_PATH#./}"
done
PROJECT_ROOT="$(project_root "${PWD}")"
# The base in its other spelling, and the project root THAT base names. The
# root is walked on the SAME spelling as its base, so the two always relate
# to each other: a root found from the physical base is a physical path, and
# the file is compared against it in the same spelling.
PHYSICAL_BASE="$(pwd -P 2>/dev/null || printf '%s' "${PWD}")"
PHYSICAL_ROOT="$(project_root "${PHYSICAL_BASE}")"
# An ABSOLUTE path keeps its own shape: making it project-relative needs
# the project root in the payload's own spelling, which this script does not
# have. A RELATIVE path is read against the directory the call runs in, and
# the strip above may have left it a leading `/` - the empty segment that
# carries is skipped, so the file is still read against `$PWD`.
#
# An ABSOLUTE path therefore has NO canonical reading either: the root the
# canonical reading would relativize against is the one this script GUESSED,
# not the one the payload named, so the two answers would be about two
# different projects. The gap is pre-existing and recorded (§19.2 of the
# backlog); the Node command is the gate that knows the project root.
MATCH_CANONICAL=""
if [[ "${IS_ABSOLUTE}" == "0" ]]; then
  SPELLED="${MATCH_PATH}"
  MATCH_PATH="$(read_under "${PWD}" "${PROJECT_ROOT}" "${SPELLED}")"
  MATCH_CANONICAL="$(read_canonical_under "${PHYSICAL_BASE}" "${PHYSICAL_ROOT}" "${SPELLED}")"
fi

# The comparison folds CASE: every family name is lower-case, and on a
# case-insensitive filesystem `SRC/x.ts` IS `src/x.ts`. The trade-off is the
# one the Node gate accepts on purpose - on a case-SENSITIVE filesystem a
# repository holding both `src/` and `SRC/` refuses the `SRC/` edit too,
# because a wrongly allowed edit is a hole in the gate while a wrongly
# refused one is an inconvenience. Only the COMPARISON folds case; the deny
# message below names the path the tool asked for, as it was spelled.
# BOTH lists are folded the same way, because both are judged against the
# same path - a case variant of an allow-listed file must reach the same
# verdict as the file itself. BOTH readings are folded the same way too:
# they are two spellings of one file, and one file has one verdict.
MATCH_FOLDED="$(printf '%s' "${MATCH_PATH}" | tr '[:upper:]' '[:lower:]')"
CANONICAL_FOLDED="$(printf '%s' "${MATCH_CANONICAL}" | tr '[:upper:]' '[:lower:]')"

# --- 6. Allow-list check (.peaks/, .peaks/_runtime/, skills/) ---------------
# Allow-listed paths are NEVER blocked. The orchestrator may freely
# Edit/Write these — they are not application source code.
#
# The allow-list is read FIRST, for EACH reading on its own: a path the
# project allows is allowed, and a reading that names an allow-listed
# directory does not become a deny because ANOTHER reading names a family.
allow_listed() {
  case "$1" in
    .peaks/*|.peaks_*|skills/*|docs/*|changelog.md|readme.md|*.md) return 0 ;;
  esac
  return 1
}

# --- 7. Hard-blocked path family scan ---------------------------------------
# Match against the 6 deny families. Order matters only for the stderr
# message; the deny rule is symmetric across all 6 families.
blocked_family() {
  case "$1" in
    src/*) printf 'src/ (application source code)'; return 0 ;;
    tests/unit/*) printf 'tests/unit/ (unit test source)'; return 0 ;;
    tests/integration/*) printf 'tests/integration/ (integration test source)'; return 0 ;;
    config/*) printf 'config/ (project configuration)'; return 0 ;;
    bin/*) printf 'bin/ (binary / executable entrypoint)'; return 0 ;;
    scripts/*) printf 'scripts/ (build / release script)'; return 0 ;;
  esac
  return 1
}

# The STRICTEST of the two readings decides: a path that EITHER reading
# places in a hard-blocked family is refused. The lexical reading is asked
# first, so the family the message names is the one the spelling reached.
BLOCKED=0
BLOCKED_REASON=""
for READING in "${MATCH_FOLDED}" "${CANONICAL_FOLDED}"; do
  if allow_listed "${READING}"; then
    continue
  fi
  if REASON="$(blocked_family "${READING}")"; then
    BLOCKED=1
    BLOCKED_REASON="${REASON}"
    break
  fi
done

if [[ "${BLOCKED}" != "1" ]]; then
  exit 0
fi

# --- 8. Emit deny signal ---------------------------------------------------
# Exit 2 = the standard PreToolUse hook deny code. Stderr carries the
# structured reason string the LLM reads on its next turn; stdout is
# empty (this hook does not need a hookSpecificOutput envelope — it is
# a hard block, not a soft reminder).
echo "PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${FILE_PATH} matches hard-blocked path family ${BLOCKED_REASON}; orchestrator MUST NOT Edit/Write these directly. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>" >&2
exit 2