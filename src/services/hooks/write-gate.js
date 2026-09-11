#!/usr/bin/env node
/**
 * write-gate.js — peaks Write|Edit|MultiEdit PreToolUse path gate.
 *
 * Slice c5-write-hook-exec-form (session 2026-09-10-session-528a63).
 * VERBATIM RELOCATION: the predicate chain below was character-for-character
 * the chain that used to be inlined into `claude-settings-template.ts` as a
 * `node -e "<js>"` one-liner.
 *
 * Slice c5b-write-gate-polarity (same session) NARROWED the decision to match
 * the contract `.claude/HOOKS.md` documents for this handler. The relocated
 * chain read its eight directory names as an EXCLUSION list, so `_runtime`
 * AND every other `.peaks/<slug>/` were allowed; it now allows only paths
 * under `.peaks/_runtime/` and falls through on everything else. That earlier
 * polarity also permitted a top-level `.peaks/<change-id>/` write, which
 * `CLAUDE.md`'s hard ban forbids outright.
 *
 * Why it moved into a file: the inlined form was shell-dialect-coupled. Its
 * escaping contract was defined in terms of bash reducing `\\` to `\` inside a
 * `"..."` wrapper, which PowerShell does NOT do — so the handler could not take
 * the platform `shell` pin its Bash siblings carry. `node <path>` has no inline
 * payload, so there is nothing left to escape and no dialect to couple to.
 *
 * Why `.js` and not `.sh` (the convention for the other hook scripts here):
 *   - `.sh` needs `bash`; on Windows that means Git Bash, so it is itself a
 *     shell dependency and the escaping problem merely moves to the
 *     `bash <script>` boundary.
 *   - `node` is already a hard dependency — the previous form invoked it.
 *   - A plain `.js` needs no compile step, so the SAME relative filename
 *     exists in `src/` (used by `tsx` + vitest) and in `dist/` (copied by
 *     `scripts/copy-templates.mjs`), which lets one emitted path string be
 *     valid for both the repo and an installed consumer.
 *
 * Contract (`.claude/HOOKS.md`): this handler ALWAYS ABSTAINS: exit 0, no
 * output, on every path. Only exit 2 blocks a tool call, and this handler
 * never returns it, so any other non-zero exit is a non-blocking ERROR
 * rather than a decision. See `decide` below for the correction this file
 * went through.
 *
 * Path source: the hook payload arrives as JSON on STDIN (Claude Code's
 * documented channel; it appends no argv). `process.argv[2]` is honoured as a
 * fallback so a positional-arg invocation keeps working.
 */

/** First string found at any of the candidate keys of `root`. */
function pathFrom(root) {
  if (!root || typeof root !== 'object') return '';
  for (const key of ['file_path', 'path', 'notebook_path']) {
    if (typeof root[key] === 'string') return root[key];
  }
  return '';
}

/** Pull the candidate file path out of a parsed hook payload. */
function candidatePath(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return pathFrom(payload.tool_input) || pathFrom(payload);
}

/**
 * This handler ABSTAINS on every path, including `.peaks/_runtime/`.
 *
 * It used to return 1 for anything outside `.peaks/_runtime/`, documented as
 * "fall through to the gate". That concept does not exist in the Claude Code
 * hook protocol. Exit 2 is the only code that blocks; every other non-zero
 * exit is a NON-BLOCKING ERROR — the action still proceeds, but the transcript
 * shows `<hook> hook error` followed by `Failed with non-blocking status code:
 * No stderr output`. The "silent fall-through" was therefore the LOUDEST
 * available outcome, reported once per edit for every path a developer
 * actually touches.
 *
 * The documented abstention is exit 0 with no output: "no decision". All
 * matching PreToolUse hooks run in parallel and their results are merged
 * (`deny` > `defer` > `ask` > `allow`), so abstaining neither approves the call
 * nor suppresses a sibling's deny — the fact gate still applies to every path
 * it always applied to.
 *
 * Runtime behaviour is unchanged for every path. What changes is that the
 * handler stops reporting a spurious error while abstaining.
 */
function decide(p) {
  // The path is still read (it is the payload's whole point) but no longer
  // branches: every path abstains.
  void p;
  return 0;
}

const ARGV_PATH = typeof process.argv[2] === 'string' ? process.argv[2] : '';

// No stdin to read (a human running this by hand): decide on argv alone
// instead of blocking forever waiting for an 'end' that never comes.
if (process.stdin.isTTY) {
  process.exit(decide(ARGV_PATH));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed or empty payload → no path. This is NOT a deny: `decide`
    // abstains for every input including the empty string, and a deny would
    // take exit 2. The old comment here said "deny" while returning 1, which
    // is the non-blocking error — the same misreading this file corrects.
    payload = undefined;
  }
  process.exit(decide(candidatePath(payload) || ARGV_PATH));
});
