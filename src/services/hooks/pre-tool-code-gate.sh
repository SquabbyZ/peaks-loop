#!/usr/bin/env bash
#
# pre-tool-code-gate.sh — the peaks-code Code-Gate PreToolUse hook.
#
# WHAT THIS FILE IS
#   A THIN WRAPPER over the Node CLI. The rule — which paths a tool call may
#   not write directly — lives in ONE implementation: `peaks code-gate`
#   (src/services/hooks/pre-tool-code-gate.ts, with the path arithmetic in
#   src/services/hooks/gate-path-normalize.ts and the payload's own directory
#   in src/services/hooks/hook-payload-cwd.ts). Where a Node CLI is reachable
#   this script EXECS it with the payload on stdin, so there is nothing here
#   that can drift from it. Where no Node CLI is reachable, the conservative
#   guard at the bottom of this file decides on its own.
#
# HOW THE NODE CLI IS FOUND — this order, and nothing else
#   1. `peaks` on PATH (`command -v peaks`).
#   2. A SIBLING FILE the installer writes, recording the PACKAGE ROOT:
#      `pre-tool-code-gate.package-root`, next to this file. That is
#      INSTALLER information (where the installed package lives), not PROJECT
#      information, so one user-global copy may carry it. The project root is
#      per-project and is therefore NOT stored here.
#   3. Nothing — the conservative guard below.
#
# THE INTERFACE
#   pre-tool-code-gate.sh [PROJECT-ROOT]
#   The payload arrives on STDIN and is passed on UNCHANGED. The single
#   optional positional argument is the PROJECT ROOT: it is forwarded to the
#   Node CLI as `--project`, and the CLI falls back to its own working
#   directory when it is absent. A harness that points at this file without
#   naming a root gets that default.
#
# THE HOOK CONTRACT (unchanged by this rewrite)
#   exit 0 — the call is allowed.
#   exit 2 — the call is refused, with PEAKS_CODE_PROHIBITED_DIRECT_EDIT on
#   stderr. stdout stays empty: the IDE denies the call before it runs.
#
# WHY THE INSTALLED COPY LIES INERT
#   `peaks hooks install --scope global` copies this file into the IDE's
#   skills/peaks-code/hooks/ directory, and every hook entry the installer
#   writes is a `peaks …` command — no settings template invokes a `.sh`. So
#   the copy is on no session's path by default; it is the shape a non-Node
#   harness reproduces when a harness is pointed at it by hand. The source of
#   truth is this file: the installed copy is byte-identical to it, and the
#   installer writes the package-root pointer BESIDE it rather than into it.
#
# VENDOR-NEUTRAL
#   No IDE and no vendor is named here. The hook protocol is the standard
#   `{tool, input}` JSON payload. The vendor-specific install adapter is a
#   SEPARATE file (src/cli/commands/hooks-commands.ts and the IDE adapter
#   layer in src/services/ide/).

set -euo pipefail

# --- 0. The Node CLI, if one is reachable ------------------------------------
# The payload is NOT read here: the child inherits this script's stdin, so the
# payload reaches it unchanged. Only the fallback below reads stdin.
PROJECT_ROOT_ARG="${1:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" >/dev/null 2>&1 && pwd -P || printf '%s' '.')"
PACKAGE_ROOT_FILE="${SCRIPT_DIR}/pre-tool-code-gate.package-root"

CLI=()
if command -v peaks >/dev/null 2>&1; then
  CLI=("peaks")
elif [[ -f "${PACKAGE_ROOT_FILE}" ]]; then
  # The installer writes the package root next to the copy it installs, so a
  # global copy can still find the CLI when the command is not on PATH.
  PKG_ROOT="$(tr -d '\r\n' <"${PACKAGE_ROOT_FILE}" 2>/dev/null || true)"
  if [[ -n "${PKG_ROOT}" && -f "${PKG_ROOT}/bin/peaks.js" ]] && command -v node >/dev/null 2>&1; then
    CLI=(node "${PKG_ROOT}/bin/peaks.js")
  fi
fi

if [[ "${#CLI[@]}" -gt 0 ]]; then
  GATE_ARGS=(code-gate)
  if [[ -n "${PROJECT_ROOT_ARG}" ]]; then
    GATE_ARGS+=(--project "${PROJECT_ROOT_ARG}")
  fi
  exec "${CLI[@]}" "${GATE_ARGS[@]}"
fi

# --- 1. The fallback: no Node CLI is reachable -------------------------------
# The conservative guard below decides on its own. Its contract:
#
#   (a) A RELATIVE target path is read against the WORKING DIRECTORY ($PWD)
#       — the directory the tool call runs in, not the directory this script
#       lives in — and denied when the file it lands in is inside a
#       hard-blocked family.
#   (b) "Is this absolute?" is decided from the SPELLING, BEFORE the leading
#       `./` segments are dropped — a drop can never turn a relative path into
#       an absolute one.
#   (c) A payload that states a directory this guard cannot use as its base
#       is REFUSED: a directory it cannot read, and a directory that is not
#       the one this script runs in. The keys this guard reads are read at
#       the payload's TOP LEVEL, by a scan that knows the nesting depth, so a
#       `cwd` nested inside the tool's own arguments is an ARGUMENT and not
#       the directory the call runs in. A payload the scan cannot read at all
#       is REFUSED too: an unknown location is a reason to REFUSE, not to
#       guess.
#   (d) It takes NO caller identity into account and names no session type:
#       it refuses the hard-blocked families in every session. That asymmetry
#       with the Node gate is deliberate and documented.
#
# The refusal code and the stderr shape are the hook contract above.

PAYLOAD="$(cat || true)"

# Tolerate empty stdin (the IDE may call the hook before the agent has
# produced any tool input). Empty payload → silent success; nothing to gate.
if [[ -z "${PAYLOAD}" ]]; then
  exit 0
fi

# --- 2. Read the payload's OWN top-level keys --------------------------------
# The keys the gate reads are read at the TOP LEVEL of the payload. A `cwd`
# nested inside the tool's own arguments is an ARGUMENT the tool was handed,
# not the directory the call runs in, and a `tool_name` nested there is not the
# name of the call either. A line-oriented grep cannot tell the two apart —
# the FIRST `"cwd"` in the text wins, so a nested one written before the
# top-level one decides the verdict — so the payload is read by a scan that
# knows the nesting depth, and a key is read only where it belongs.
#
# The scan is `awk`, which every POSIX shell environment carries, so the
# fallback needs no runtime and no extra dependency — the reason `jq` is not
# used. It reads the SAME keys the Node command reads: `tool_name` and then
# `tool` for the name, `tool_input` and then `input` for the arguments, and
# `file_path`, `path` and `notebook_path` inside those arguments. A repeated
# key resolves the way `JSON.parse` resolves it — the LAST one — so the two
# read the same payload the same way. A `\uXXXX` escape above the ASCII range
# is left as it was written: it is a spelling of a character no path
# carries, and reading it as the character itself would need an encoder the
# scan does not have.
#
# A payload the scan cannot read — no reader at all, or braces that do not
# balance — is REFUSED. The file's location is then unknown, and an unknown
# location is a reason to REFUSE, not to guess.
PAYLOAD_KEYS="$(printf '%s' "${PAYLOAD}" | awk '
function isws(c) { return (c == " " || c == "\t" || c == "\r" || c == "\n") }
function hexval(c) {
  if (c >= "0" && c <= "9") return c + 0
  if (c >= "a" && c <= "f") return index("abcdef", c) + 9
  return index("ABCDEF", c) + 9
}
function hexchar(code,   i, n) {
  n = 0
  for (i = 1; i <= 4; i++) n = n * 16 + hexval(substr(code, i, 1))
  if (n < 32 || n > 126) return "\\u" code
  return sprintf("%c", n)
}
function unescape(s,   out, i, n, c) {
  out = ""; n = length(s); i = 1
  while (i <= n) {
    c = substr(s, i, 1)
    if (c != "\\") { out = out c; i++; continue }
    i++
    if (i > n) { out = out "\\"; break }
    c = substr(s, i, 1)
    if (c == "n") out = out "\n"
    else if (c == "t") out = out "\t"
    else if (c == "r") out = out "\r"
    else if (c == "b") out = out "\b"
    else if (c == "f") out = out "\f"
    else if (c == "u") { out = out hexchar(substr(s, i + 1, 4)); i = i + 5; continue }
    else out = out c
    i++
  }
  return out
}
function addMember(key, kind, val, d) {
  nm++
  m_parent[nm] = stk_id[d]; m_key[nm] = key; m_kind[nm] = kind; m_val[nm] = val
}
function openObject(   id) {
  oid++; id = oid; depth++; stk_id[depth] = id
  if (depth == 1) ROOT = id
  if (pend) { addMember(pendKey, "o", id, depth - 1); pend = 0 }
}
function closeObject() { if (depth > 0) depth--; pend = 0 }
function addString(v) {
  if (depth < 1 || !pend) return
  addMember(pendKey, "s", v, depth); pend = 0
}
function skipString(j,   c) {
  j++
  while (j <= TLEN) {
    c = substr(TXT, j, 1)
    if (c == "\\") { j = j + 2; continue }
    if (c == "\"") return j + 1
    j++
  }
  return TLEN + 1
}
function skipArray(   j, c, lvl) {
  lvl = 1; j = POS + 1
  while (j <= TLEN) {
    c = substr(TXT, j, 1)
    if (c == "\"") { j = skipString(j); continue }
    if (c == "[") { lvl++; j++; continue }
    if (c == "]") { lvl--; j++; if (lvl == 0) { POS = j; return } continue }
    j++
  }
  POS = TLEN + 1
}
function scan(   i, c, j) {
  i = 1
  while (i <= TLEN) {
    c = substr(TXT, i, 1)
    if (inStr) {
      if (esc) { esc = 0; buf = buf c; i++; continue }
      if (c == "\\") { esc = 1; buf = buf c; i++; continue }
      if (c == "\"") {
        inStr = 0
        j = i + 1
        while (j <= TLEN && isws(substr(TXT, j, 1))) j++
        if (j <= TLEN && substr(TXT, j, 1) == ":") {
          pend = 1; pendKey = buf; i = j + 1
        } else {
          addString(unescape(buf)); i = j
        }
        buf = ""
        continue
      }
      buf = buf c; i++; continue
    }
    if (c == "\"") { inStr = 1; esc = 0; buf = ""; i++; continue }
    if (c == "{") { openObject(); i++; continue }
    if (c == "}") { closeObject(); i++; continue }
    if (c == "[") {
      if (pend && depth >= 1) { addMember(pendKey, "a", "", depth); pend = 0 }
      POS = i; skipArray(); i = POS; continue
    }
    if (pend && depth >= 1 && (c ~ /[-+0-9tfn]/)) { addMember(pendKey, "x", "", depth); pend = 0 }
    i++
  }
}
function findLast(parent, key,   i, idx) {
  idx = 0
  for (i = 1; i <= nm; i++) if (m_parent[i] == parent && m_key[i] == key) idx = i
  return idx
}
{ TXT = TXT $0 "\n" }
END {
  TLEN = length(TXT)
  scan()
  tool = ""; cwd = ""; filePath = ""; inputId = 0
  if (ROOT > 0) {
    idx = findLast(ROOT, "tool_name")
    if (idx > 0 && m_kind[idx] == "s") tool = m_val[idx]
    else {
      idx = findLast(ROOT, "tool")
      if (idx > 0 && m_kind[idx] == "s") tool = m_val[idx]
    }
    idx = findLast(ROOT, "cwd")
    if (idx > 0 && m_kind[idx] == "s") {
      cwd = m_val[idx]
      sub(/^[[:space:]]+/, "", cwd); sub(/[[:space:]]+$/, "", cwd)
    }
    idx = findLast(ROOT, "tool_input")
    if (idx > 0 && m_kind[idx] == "o") inputId = m_val[idx]
    if (inputId == 0) {
      idx = findLast(ROOT, "input")
      if (idx > 0 && m_kind[idx] == "o") inputId = m_val[idx]
    }
  }
  if (inputId > 0) {
    idx = findLast(inputId, "file_path")
    if (idx > 0 && m_kind[idx] == "s" && length(m_val[idx]) > 0) filePath = m_val[idx]
    else {
      idx = findLast(inputId, "path")
      if (idx > 0 && m_kind[idx] == "s" && length(m_val[idx]) > 0) filePath = m_val[idx]
      else {
        idx = findLast(inputId, "notebook_path")
        if (idx > 0 && m_kind[idx] == "s" && length(m_val[idx]) > 0) filePath = m_val[idx]
      }
    }
  }
  # A value that carries a line break cannot be carried by this line-based
  # protocol, and a value that COULD would let a payload write a line of its
  # own — a file path spelling "x\nstatus=ok" would then say what it likes.
  # Such a payload is REFUSED, not guessed at.
  status = "ok"
  if (depth != 0 || inStr) status = "unbalanced"
  else if (index(tool, "\n") > 0 || index(tool, "\r") > 0 || index(cwd, "\n") > 0 || index(cwd, "\r") > 0 || index(filePath, "\n") > 0 || index(filePath, "\r") > 0) status = "unreadable"
  printf "tool=%s\n", tool
  printf "cwd=%s\n", cwd
  printf "file_path=%s\n", filePath
  printf "status=%s\n", status
}
' 2>/dev/null || true)"

if [[ -z "${PAYLOAD_KEYS}" ]]; then
  echo "PEAKS_CODE_PROHIBITED_DIRECT_EDIT: cannot be placed: this gate has no reader for the payload, so the file's location is unknown; refusing rather than guessing. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>" >&2
  exit 2
fi

SCAN_STATUS=""
TOOL_NAME=""
FILE_PATH=""
PAYLOAD_CWD=""
while IFS= read -r KEY_LINE; do
  case "${KEY_LINE}" in
    status=*) SCAN_STATUS="${KEY_LINE#status=}" ;;
    tool=*) TOOL_NAME="${KEY_LINE#tool=}" ;;
    file_path=*) FILE_PATH="${KEY_LINE#file_path=}" ;;
    cwd=*) PAYLOAD_CWD="${KEY_LINE#cwd=}" ;;
  esac
done <<< "${PAYLOAD_KEYS}"

if [[ "${SCAN_STATUS}" != "ok" ]]; then
  echo "PEAKS_CODE_PROHIBITED_DIRECT_EDIT: cannot be placed: the payload is not a JSON object this gate can read at its top level, so the file's location is unknown; refusing rather than guessing. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>" >&2
  exit 2
fi

# --- 3. Only gate Edit / Write / MultiEdit ----------------------------------
# Anything else (Bash, Read, Greb, Glob, …) is allowed unconditionally.
case "${TOOL_NAME}" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

# --- 4. The target file path -----------------------------------------------
# The hook protocol uses different keys per vendor / version:
#   - Edit → input.file_path
#   - Write → input.file_path
#   - MultiEdit → input.file_path
# and the scan above read them out of the tool's own arguments, in that
# order: `file_path`, then `path`, then `notebook_path`.
#
# No path in the payload → cannot decide; allow (fail-open on
# path-missing rather than false-positive block).
if [[ -z "${FILE_PATH}" ]]; then
  exit 0
fi

# --- 5. The directory the tool call runs in ----------------------------------
# The payload states it in its own top-level `cwd` key, and the scan above
# read that key at the top level only — a `cwd` nested inside the tool's own
# arguments is an argument, not the directory the call runs in. The
# directory the call runs in is the base a RELATIVE path is read against, and
# the guard reads the path against its OWN working directory, so a stated
# directory it cannot use as that base leaves the file's location unknown.
# Unknown is a reason to REFUSE, not to guess: this is the refusal that
# closes the gap where the sibling allowed what the Node command denies.
if [[ -n "${PAYLOAD_CWD}" ]]; then
  # The physical spelling of the WORKING DIRECTORY, and of the directory the
  # payload states. Both are resolved through their symlinks, so two
  # spellings of ONE directory compare equal.
  OWN_CANON="$(pwd -P 2>/dev/null || printf '%s' "${PWD}")"
  STATED_CANON="$(CDPATH='' cd -P -- "${PAYLOAD_CWD}" 2>/dev/null && pwd -P || true)"
  if [[ -z "${STATED_CANON}" ]]; then
    echo "PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${FILE_PATH} cannot be placed: the payload states the tool call's directory (${PAYLOAD_CWD}), which this gate cannot read; refusing rather than guessing. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>" >&2
    exit 2
  fi
  if [[ "${STATED_CANON}" != "${OWN_CANON}" ]]; then
    echo "PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${FILE_PATH} cannot be placed: the payload states the tool call's directory (${PAYLOAD_CWD}), which is not the directory this gate runs in; refusing rather than guessing. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>" >&2
    exit 2
  fi
fi

# --- 6. Normalize the SPELLING of the path ----------------------------------
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
#     (`pwd -P`), and the project root in its own canonical spelling
# One directory can be named two ways — a symlink, a junction, macOS's
# `/var` → `/private/var` — and the difference is what a symlinked BASE
# inside the project looks like: the call runs in `link/`, `link/` points at
# `src/`, and the file it writes lands in `src/`. The lexical reading says
# `link/deep/x.ts` (no family) and the canonical one says `src/deep/x.ts`
# (a family). A wrongly allowed edit is a hole in the gate; a wrongly refused
# one is only an inconvenience.
#
# The project root the deny families are relative to: the one the caller named
# as this script's argument, and otherwise the nearest ancestor of the
# WORKING DIRECTORY ($PWD) that carries a peaks workspace. $PWD is the
# directory the tool call runs in — NOT the directory this script lives in.
# The nearest one wins, so a project nested inside another repository is
# judged against ITSELF. A file OUTSIDE the project belongs to no family, and
# the spelling is all the project can judge it by, so that case falls back to
# the spelling read against the root.
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

# The canonical spelling of a directory, or nothing when it cannot be entered.
canonical_dir() {
  (CDPATH='' cd -P -- "$1" 2>/dev/null && pwd -P) || true
}

# The ancestor of `dir` that IS `wanted`, in `dir`'s OWN spelling. Nothing
# when there is no such ancestor.
#
# The caller's root arrives in the caller's spelling — a Windows path on
# Windows, a POSIX one elsewhere — and two spellings of one directory have
# to be compared before a path can be read against them. The ancestor is
# therefore found by asking which one of them the caller named.
ancestor_named() {
  local dir="${1%/}" wanted="$2" canon=""
  while [[ -n "${dir}" ]]; do
    canon="$(canonical_dir "${dir}")"
    if [[ -n "${canon}" && "${canon}" == "${wanted}" ]]; then
      printf '%s' "${dir}"
      return 0
    fi
    if [[ "${dir}" == "/" ]]; then
      break
    fi
    dir="$(dirname "${dir}")"
  done
  return 1
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

# The project root: the one the caller named, and otherwise the nearest
# peaks workspace above $PWD — the WORKING DIRECTORY, which is the directory
# the tool call runs in and NOT the directory this script lives in. It is ONE
# root, read in two spellings — the lexical one and its canonical one — so the
# two readings of a file are always judged against the same project. A root
# DERIVED from the physical base would degenerate when that base sits outside
# the project, and the two readings would then answer about two different
# projects.
PROJECT_ROOT=""
if [[ -n "${PROJECT_ROOT_ARG}" && -d "${PROJECT_ROOT_ARG}" ]]; then
  GIVEN_CANON="$(canonical_dir "${PROJECT_ROOT_ARG}")"
  if [[ -n "${GIVEN_CANON}" ]]; then
    PROJECT_ROOT="$(ancestor_named "${PWD}" "${GIVEN_CANON}" || true)"
  fi
fi
if [[ -z "${PROJECT_ROOT}" ]]; then
  PROJECT_ROOT="$(project_root "${PWD}")"
fi
PHYSICAL_BASE="$(pwd -P 2>/dev/null || printf '%s' "${PWD}")"
PHYSICAL_ROOT="$(canonical_dir "${PROJECT_ROOT}")"
if [[ -z "${PHYSICAL_ROOT}" ]]; then
  PHYSICAL_ROOT="${PROJECT_ROOT}"
fi

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

# --- 7. Allow-list check (.peaks/, .peaks/_runtime/, skills/) ---------------
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

# --- 8. Hard-blocked path family scan ---------------------------------------
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

# --- 9. Emit deny signal ---------------------------------------------------
# Exit 2 = the standard PreToolUse hook deny code. Stderr carries the
# structured reason string the LLM reads on its next turn; stdout is
# empty (this hook does not need a hookSpecificOutput envelope — it is
# a hard block, not a soft reminder).
echo "PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${FILE_PATH} matches hard-blocked path family ${BLOCKED_REASON}; orchestrator MUST NOT Edit/Write these directly. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>" >&2
exit 2
