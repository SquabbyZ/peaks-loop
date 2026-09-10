#!/usr/bin/env node
/**
 * write-gate.js — peaks Write|Edit|MultiEdit PreToolUse path gate.
 *
 * Slice c5-write-hook-exec-form (session 2026-09-10-session-528a63).
 * VERBATIM RELOCATION: the predicate chain below is character-for-character
 * the chain that used to be inlined into `claude-settings-template.ts` as a
 * `node -e "<js>"` one-liner. Nothing about the allow/deny decision changed.
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
 * Contract: exit 0 = allow, exit 1 = deny. Both are NON-BLOCKING in Claude
 * Code's PreToolUse contract — only exit 2 blocks a tool call. This handler's
 * job is to stay silent on the paths the gate is meant to skip.
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

/** The gate decision, relocated verbatim from the `node -e` one-liner. */
function decide(p) {
  if (p.includes('.peaks/_runtime/')) return 0;
  const m = p.match(/\.peaks\/([a-z0-9][a-z0-9.-]*)\//);
  if (m && m[1] && m[1] !== '_runtime' && m[1] !== '_dogfood' && m[1] !== '_sub_agents' && m[1] !== 'memory' && m[1] !== 'sops' && m[1] !== 'retrospective' && m[1] !== 'project-scan' && m[1] !== 'perf-baseline') return 0;
  return 1;
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
    // Malformed or empty payload → no path → deny, which is the same
    // outcome the old form produced for an absent `process.argv[1]`.
    payload = undefined;
  }
  process.exit(decide(candidatePath(payload) || ARGV_PATH));
});
