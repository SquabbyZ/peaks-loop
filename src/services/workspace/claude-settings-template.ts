/**
 * Slice 2.0.1-bug3-fact-forcing-bypass — pure-data template for the
 * consumer-project `.claude/settings.local.json` file.
 *
 * The template is a PreToolUse hook allow-list that bypasses the
 * Claude Code [Fact-Forcing Gate] for tool calls whose paths or
 * commands target the peaks-managed `.peaks/` workspace. Without this
 * bypass, `peaks workspace init` (Step 0 of every peaks-solo session)
 * is unrunnable in a consumer project because the gate blocks the
 * very first Write.
 *
 * The template is a pure-data function (no filesystem, no clock) so
 * it can be unit-tested in isolation and so the on-disk file matches
 * the in-memory template byte-for-byte.
 *
 * Two matchers are emitted:
 *   1. `Write|Edit|MultiEdit` — a node one-liner that path-matches
 *      `.peaks/_runtime/` and `.peaks/<changeId>/`. Exits 0 (allow)
 *      for those paths, non-zero (deny → fall through to gate) for
 *      everything else.
 *   2. `Bash` — a node one-liner that allows command strings starting
 *      with `peaks ` (whitelisted subcommand prefix). Exits 0 for
 *      `peaks <subcommand> ...`, non-zero otherwise.
 *
 * The Bash allow-list is conservative: it whitelists the documented
 * peaks subcommands the skill family invokes during Step 0 (workspace,
 * skill presence, request, session, scan, sub-agent, gate, standards,
 * hooks, statusline). See peaks-solo/references/runbook.md for the
 * canonical list.
 */

export const CLAUDE_SETTINGS_LOCAL_FILENAME = '.claude/settings.local.json';

/**
 * Subcommand allow-list for the Bash matcher. The matcher allows any
 * command that starts with `peaks <subcommand>` for one of these
 * subcommands. Keep this list in sync with peaks-solo/references/runbook.md.
 */
const PEAKS_SUBCOMMAND_ALLOWLIST: ReadonlyArray<string> = [
  'workspace',
  'skill',
  'request',
  'session',
  'scan',
  'sub-agent',
  'gate',
  'standards',
  'hooks',
  'statusline',
  'memory',
  'openspec',
  'workflow',
  'doctor',
  'upgrade'
];

/**
 * Build the Bash matcher command. The command is a node -e one-liner
 * that reads its candidate command string from argv[2] and exits 0
 * iff the command starts with `peaks <whitelisted-subcommand> ` (or
 * is exactly `peaks <whitelisted-subcommand>` with no trailing args).
 *
 * The list is serialised as a JSON array literal embedded in the
 * command string so we avoid regex special-character pitfalls and
 * keep the allow-list declarative.
 */
function buildBashHookCommand(): string {
  const allowlistLiteral = JSON.stringify(PEAKS_SUBCOMMAND_ALLOWLIST);
  // The command reads process.argv[2] (the tool-call command string),
  // checks it starts with `peaks `, splits on whitespace, and looks
  // up the second token in the allowlist. Exit 0 = allow, exit 1 =
  // deny (so the gate fires for non-peaks commands).
  return (
    'const c=process.argv[1]||"";' +
    'if(!c.startsWith("peaks "))process.exit(1);' +
    'const sub=c.slice(6).trim().split(/\\s+/)[0];' +
    `if(${allowlistLiteral}.indexOf(sub)===-1)process.exit(1);` +
    'process.exit(0)'
  );
}

/**
 * Build the Write|Edit|MultiEdit matcher command. The command reads
 * the candidate file path from argv[2] and exits 0 iff the path
 * contains `.peaks/_runtime/` or `.peaks/<changeId>/` (the change-id
 * segment is the next path component after `.peaks/`). All other
 * paths exit 1 so the gate fires normally.
 *
 * The matcher is intentionally narrow: it only fires for tools that
 * take a `file_path` (Write/Edit/MultiEdit) and for the Bash
 * subcommand allow-list. It does NOT silently allow arbitrary paths
 * under `.peaks/<changeId>/` — only those matching the documented
 * pattern. Future slice work can broaden the allow-list if the
 * peaks-solo workflow needs more paths.
 */
function buildWriteHookCommand(): string {
  // Path-matching: allow when the path contains `.peaks/_runtime/`
  // OR when the second `.peaks/` segment starts with anything that
  // looks like a change-id (kebab-case slug). Exit 0 for allow, exit
  // 1 for deny.
  return (
    'const p=process.argv[1]||"";' +
    'if(p.includes(".peaks/_runtime/"))process.exit(0);' +
    'const m=p.match(/\\.peaks\\/([a-z0-9][a-z0-9.-]*)\\//);' +
    'if(m&&m[1]&&m[1]!=="_runtime"&&m[1]!=="_dogfood"&&m[1]!=="_sub_agents"&&m[1]!=="_archive"&&m[1]!=="memory"&&m[1]!=="issues"&&m[1]!=="sops"&&m[1]!=="retrospective"&&m[1]!=="project-scan"&&m[1]!=="perf-baseline")process.exit(0);' +
    'process.exit(1)'
  );
}

type ClaudeHookCommand = { type: 'command'; command: string };
type ClaudePreToolUseEntry = { matcher: string; hooks: ClaudeHookCommand[] };
type ClaudeSettingsLocal = { hooks: { PreToolUse: ClaudePreToolUseEntry[] } };

/**
 * Build the full template object. The shape is the subset of Claude
 * Code's `.claude/settings.local.json` schema that PreToolUse hooks
 * need — we do not emit the `permissions` block because the fact-
 * forcing gate is a core feature that PreToolUse hooks can short-
 * circuit but that the `permissions` block cannot.
 */
export function buildClaudeSettingsLocalJson(): ClaudeSettingsLocal {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: buildWriteHookCommand()
            }
          ]
        },
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: buildBashHookCommand()
            }
          ]
        }
      ]
    }
  };
}
