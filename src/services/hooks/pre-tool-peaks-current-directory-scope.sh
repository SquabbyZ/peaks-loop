#!/usr/bin/env bash
#
# pre-tool-peaks-current-directory-scope.sh — PreToolUse hook for the
# `peaks-current-directory-scope` feedback rule
# (`.peaks/memory/peaks-current-directory-scope.md`).
#
# Purpose
#   Read the active PreToolUse JSON payload from stdin (vendor-neutral
#   hook protocol: { tool_name, tool_input } and the older { tool, input }
#   shape). When the tool call is a `Bash` command that would MODIFY global
#   state — the user's `~/.claude` or `~/.peaks` trees, a globally installed
#   package, or a peaks command that writes user-global config — REFUSE it
#   (exit 2 + stderr naming the rule). The rule is that Peaks-related changes
#   stay inside the current project directory UNLESS the user explicitly
#   authorises touching global state.
#
#   The escape hatch is real, because the rule has one. A command run with
#   `PEAKS_ALLOW_GLOBAL_STATE=1` in its environment, or prefixed with that
#   assignment inline, is allowed through: authorisation becomes a deliberate,
#   visible act rather than something the hook has to guess.
#
# What is deliberately NOT blocked (this hook has one job, not two)
#   - read-only inspection of global paths (`ls ~/.claude`, `cat …`) — no
#     writing verb and no redirect to the global path, so nothing fires;
#   - writes anywhere inside the project, `~/.claude`'s contents included
#     when they are the project's own `.peaks/**` tree;
#   - `--dry-run` forms of the peaks commands, on a command with no shell
#     separators (a read-only mode must not be a way to smuggle a real run
#     in behind `&&`);
#   - a global path that appears only inside quotes (`grep "npm i -g" src/`):
#     the scan strips quoted spans before it looks for an invocation.
#
# Hard rules enforced here
#   - Thin, idempotent, pure-stdin script. No retries, no jq, no colour codes,
#     no environment mutation, no filesystem writes.
#   - The only side effects are the exit code and the stderr message.
#
# Karpathy §2 (Simplicity First): one detection table, read once.
# Karpathy §3 (Surgical Changes): reads stdin only; never mutates global state.
# Karpathy §4 (Goal-Driven Execution): 0 = allow, 2 = refuse with a named rule.
#
# KNOWN RESIDUAL: a global path mentioned inside a DOUBLE-quoted string
# (`echo "note > ~/.claude/x"`) is still read as a redirect target, because a
# double-quoted span is exactly where a legitimate quoted redirect target
# lives (`> "$HOME/.claude/settings.json"`). The two are indistinguishable to a
# line-oriented scan; this hook chooses to see the violation.

set -euo pipefail

# --- 1. Read the tool payload from stdin ------------------------------------
PAYLOAD="$(cat || true)"

# Empty payload → nothing to gate (the IDE may call the hook before the agent
# has produced any tool input). Exit 0 silently.
if [[ -z "${PAYLOAD}" ]]; then
  exit 0
fi

# --- 2. Extract the tool name without depending on jq -----------------------
# Accept both the modern `tool_name` and the legacy `tool` JSON key, the same
# portable grep/sed pair the sibling hooks use.
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

# Only Bash commands can be judged here. Anything else is allowed.
case "${TOOL_NAME}" in
  Bash|bash) ;;
  *) exit 0 ;;
esac

# --- 3. Extract the command string -----------------------------------------
# The `([^"\\]|\\.)*` body is the JSON string grammar, so an escaped quote
# inside the command does not truncate the match the way `"[^"]+"` would.
COMMAND="$(printf '%s' "${PAYLOAD}" \
  | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' \
  | head -n1 \
  | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"(.*)"/\1/' \
  || true)"

if [[ -z "${COMMAND}" ]]; then
  exit 0
fi

# --- 4. The authorisation escape -------------------------------------------
# (a) the whole process was launched under the escape, or (b) the command
# carries the assignment itself, as a command-prefix assignment.
case "${PEAKS_ALLOW_GLOBAL_STATE:-}" in
  1|true|TRUE|yes|on) exit 0 ;;
esac

if printf '%s' "${COMMAND}" \
  | grep -qE '(^|[;&|])[[:space:]]*PEAKS_ALLOW_GLOBAL_STATE=(1|true|TRUE|yes|on)([[:space:]]|$)'; then
  exit 0
fi

# --- 5. Quoted spans are arguments, not invocations ------------------------
# `grep -rn "npm i -g" src/` mentions the verb; it does not run it. Strip the
# CONTENTS of single- and double-quoted spans before scanning for a verb.
STRIPPED="$(printf '%s' "${COMMAND}" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")"

# --- 6. `--dry-run` on a single simple command is a read-only mode ----------
if printf '%s' "${STRIPPED}" | grep -qE '(^|[[:space:]])--dry-run([[:space:]]|$)'; then
  if ! printf '%s' "${STRIPPED}" | grep -qE '(&&|\|\||;|\|)'; then
    exit 0
  fi
fi

# --- 7. Is this token a user-global path? ----------------------------------
# Home-rooted only. `.peaks/` and `~/.claude` are different things: a project's
# own `.peaks/**` write is exactly what the sibling hooks are built around, so
# the pattern never matches a relative path.
is_global_path() {
  local token="$1"
  case "${token}" in
    '~/.claude'|'~/.claude/'*|'~/.peaks'|'~/.peaks/'*) return 0 ;;
    '$HOME/.claude'|'$HOME/.claude/'*|'$HOME/.peaks'|'$HOME/.peaks/'*) return 0 ;;
    '${HOME}/.claude'|'${HOME}/.claude/'*|'${HOME}/.peaks'|'${HOME}/.peaks/'*) return 0 ;;
    /home/*/.claude|/home/*/.claude/*|/home/*/.peaks|/home/*/.peaks/*) return 0 ;;
    /Users/*/.claude|/Users/*/.claude/*|/Users/*/.peaks|/Users/*/.peaks/*) return 0 ;;
    [A-Za-z]:/Users/*/.claude|[A-Za-z]:/Users/*/.claude/*) return 0 ;;
    [A-Za-z]:/Users/*/.peaks|[A-Za-z]:/Users/*/.peaks/*) return 0 ;;
    [A-Za-z]:\\Users\\*\\.claude|[A-Za-z]:\\Users\\*\\.claude\\*) return 0 ;;
    [A-Za-z]:\\Users\\*\\.peaks|[A-Za-z]:\\Users\\*\\.peaks\\*) return 0 ;;
  esac
  return 1
}

REASON=""

# --- 8. Globally installed / globally linked packages ----------------------
# Anchored to the start of a simple command so a verb merely named as an
# argument (`echo npm i -g`) does not fire.
GLOBAL_INSTALL_RE='(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(npm|pnpm|yarn|bun)[[:space:]]+(i|install|add|global)[[:space:]]+(-g|--global)([[:space:]]|$)'
GLOBAL_LINK_RE='(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(npm|pnpm|yarn|bun)[[:space:]]+(link|unlink)([[:space:]]|$)'
YARN_GLOBAL_RE='(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?yarn[[:space:]]+global[[:space:]]+(add|upgrade|remove)([[:space:]]|$)'

if printf '%s' "${STRIPPED}" | grep -qE "${GLOBAL_INSTALL_RE}"; then
  REASON="it installs a package into the user-global prefix"
elif printf '%s' "${STRIPPED}" | grep -qE "${YARN_GLOBAL_RE}"; then
  REASON="it installs a package into the user-global prefix"
elif printf '%s' "${STRIPPED}" | grep -qE "${GLOBAL_LINK_RE}"; then
  REASON="it links a package into the user-global node_modules"
fi

# --- 9. Peaks verbs that write user-global config ---------------------------
# `peaks hooks install` distributes hook scripts into `~/.claude/skills/**`
# and merges the user-level settings; `peaks skill sync` rewrites the global
# skill tree. Both are global-state writers, and both have a `--dry-run`.
if [[ -z "${REASON}" ]]; then
  if printf '%s' "${STRIPPED}" \
    | grep -qE '(^|[;&|])[[:space:]]*peaks[[:space:]]+hooks[[:space:]]+install([[:space:]]|$)'; then
    REASON="\`peaks hooks install\` distributes hook scripts and settings into user-global state"
  elif printf '%s' "${STRIPPED}" \
    | grep -qE '(^|[;&|])[[:space:]]*peaks[[:space:]]+skills?[[:space:]]+sync([[:space:]]|$)'; then
    REASON="\`peaks skill sync\` rewrites the user-global skill tree"
  fi
fi

# --- 10. Redirects whose target is a global path ---------------------------
if [[ -z "${REASON}" ]]; then
  while IFS= read -r target; do
    [[ -z "${target}" ]] && continue
    # A redirect target may itself be quoted: `> "$HOME/.claude/settings.json"`.
    target="${target%\"}"
    target="${target#\"}"
    target="${target%\'}"
    target="${target#\'}"
    if is_global_path "${target}"; then
      REASON="its redirect target ${target} is outside the project"
      break
    fi
  done < <(printf '%s' "${STRIPPED}" \
    | grep -oE '(>>?|&>)[[:space:]]*[^[:space:]|;&]+' \
    | sed -E 's/^(>>?|&>)[[:space:]]*//' \
    || true)
fi

# --- 11. A writing verb whose argument is a global path --------------------
if [[ -z "${REASON}" ]]; then
  if printf '%s' "${STRIPPED}" \
    | grep -qE '(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(cp|mv|rsync|install|mkdir|rmdir|rm|touch|tee|ln|chmod|chown)([[:space:]]|$)'; then
    for token in ${STRIPPED}; do
      if is_global_path "${token}"; then
        REASON="it hands ${token} to a command that modifies it"
        break
      fi
    done
  fi
fi

if [[ -z "${REASON}" ]]; then
  exit 0
fi

# --- 12. Emit the deny signal ----------------------------------------------
# Exit 2 is the PreToolUse block code. The message names the rule, states the
# "unless explicitly authorised" clause, and says how to exercise it.
echo "PEAKS_CURRENT_DIRECTORY_SCOPE: blocked — this Bash command would modify user-global state (${REASON})." >&2
echo "Rule \`peaks-current-directory-scope\`: Peaks-related changes stay inside the current project directory UNLESS the user explicitly authorises touching global state (\`~/.claude\`, \`~/.peaks\`, global settings / skills / config)." >&2
echo "If the user HAS authorised this exact action, make the authorisation deliberate and visible by re-running the command with the escape prefix: PEAKS_ALLOW_GLOBAL_STATE=1 <command> (or export PEAKS_ALLOW_GLOBAL_STATE=1 first)." >&2
echo "Read-only inspection of global paths (\`ls\`, \`cat\`), every write inside the project (including this repo's own .peaks/** tree), and \`--dry-run\` on a single simple command are already allowed." >&2
exit 2
