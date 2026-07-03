/**
 * Slice 2.0.1-bug3-fact-forcing-bypass — pure-data template for the
 * consumer-project `.claude/settings.local.json` file.
 *
 * The template is a PreToolUse hook allow-list that bypasses the
 * Claude Code [Fact-Forcing Gate] for tool calls whose paths target
 * the peaks-managed `.peaks/` workspace. Without this bypass,
 * `peaks workspace init` (Step 0 of every peaks-solo session) is
 * unrunnable in a consumer project because the gate blocks the very
 * first Write.
 *
 * The template is a pure-data function (no filesystem, no clock) so
 * it can be unit-tested in isolation and so the on-disk file matches
 * the in-memory template byte-for-byte.
 *
 * One matcher is emitted:
 *   1. `Write|Edit|MultiEdit` — a node one-liner that path-matches
 *      `.peaks/_runtime/` and `.peaks/_runtime/<sessionId>/`. Exits 0 (allow)
 *      for those paths, non-zero (deny → fall through to gate) for
 *      everything else.
 *
 * The previous `Bash` matcher (which whitelisted a fixed `peaks
 * <subcommand>` prefix) was removed in TEMPLATE_VERSION 1.2.0. The
 * [Fact-Forcing Gate] is an Edit/Write concern (it forces the LLM
 * to quote user instructions before any file write), and the Bash
 * matcher was emitting `process.exit(1)` with no stderr on every
 * non-peaks Bash call — a non-blocking "No stderr output" noise
 * decoration in the Claude Code UI even though the underlying tool
 * call still proceeded. Bash command enforcement is now owned by
 * `peaks gate enforce`, which `peaks hooks install` injects into the
 * consumer project's `.claude/settings.json` and which exits 0
 * silently for any command not guarded by a registered SOP gate.
 */

export const CLAUDE_SETTINGS_LOCAL_FILENAME = '.claude/settings.local.json';

/**
 * Informational version of the offline template shape. Bumped when the
 * template's hooks tree (matchers, allow-list content, wrapper format)
 * changes in a way that should trigger a refresh of stale on-disk
 * copies. The comparator (`templateContentMatches`) is the source of
 * truth for refresh decisions — this constant exists so a developer
 * reading the diff can correlate a template change with a deliberate
 * bump. Future work may write a version-marker file to short-circuit
 * the comparator; for now the constant is informational only.
 *
 * History:
 *   1.0.0 — initial template with `Write|Edit|MultiEdit` and `Bash`
 *           matchers (slice 2.0.1-bug3-fact-forcing-bypass)
 *   1.1.0 — added `node -e "..."` wrapper contract
 *           (slice fix-claude-settings-template-hook-node-wrapper)
 *   1.2.0 — removed the `Bash` matcher; Edit/Write fact-forcing
 *           bypass is the only emit. Bash enforcement is owned by
 *           `peaks gate enforce` in `settings.json`.
 *   1.3.0 — added the v3.1.2 `Bash` PreToolUse matcher that runs
 *           `peaks solo gate-step-08 --project .` (Step 0.8 mechanical
 *           gate). The existing Write|Edit|MultiEdit matcher is
 *           preserved. The new matcher's exit code is the load-bearing
 *           signal: 0 = allow, 2 = block (with stderr BLOCKED reason).
 */
export const TEMPLATE_VERSION = '1.3.0';

/**
 * Compare two serialized template strings for semantic equivalence.
 *
 * Returns `true` iff both strings parse to objects whose
 * `hooks.PreToolUse` arrays are structurally identical (same length;
 * each entry's `matcher`, `hooks[].type`, `hooks[].command` match).
 *
 * Returns `false` on any `JSON.parse` error, shape mismatch, or
 * missing `hooks.PreToolUse`. Whitespace and key order do NOT affect
 * the result — the comparison is on the parsed AST, not on bytes.
 *
 * This is the comparator `initWorkspace` uses to decide whether to
 * refresh a stale `.peaks/.claude-settings-template.json` on disk.
 */
export function templateContentMatches(generated: string, onDisk: string): boolean {
  let parsedGenerated: unknown;
  let parsedOnDisk: unknown;
  try {
    parsedGenerated = JSON.parse(generated);
  } catch {
    return false;
  }
  try {
    parsedOnDisk = JSON.parse(onDisk);
  } catch {
    return false;
  }

  if (!isTemplateShape(parsedGenerated) || !isTemplateShape(parsedOnDisk)) {
    return false;
  }

  const generatedEntries = parsedGenerated.hooks.PreToolUse;
  const onDiskEntries = parsedOnDisk.hooks.PreToolUse;

  if (generatedEntries.length !== onDiskEntries.length) {
    return false;
  }

  for (let i = 0; i < generatedEntries.length; i += 1) {
    const a = generatedEntries[i]!;
    const b = onDiskEntries[i]!;
    if (a.matcher !== b.matcher) {
      return false;
    }
    if (!sameHooksArray(a.hooks, b.hooks)) {
      return false;
    }
  }

  return true;
}

type TemplateShape = {
  hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
};

function isTemplateShape(value: unknown): value is TemplateShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { hooks?: unknown };
  if (typeof candidate.hooks !== 'object' || candidate.hooks === null) {
    return false;
  }
  const hooksObj = candidate.hooks as { PreToolUse?: unknown };
  return Array.isArray(hooksObj.PreToolUse);
}

function sameHooksArray(
  a: ReadonlyArray<{ type: string; command: string }>,
  b: ReadonlyArray<{ type: string; command: string }>
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const ha = a[i]!;
    const hb = b[i]!;
    if (ha.type !== hb.type || ha.command !== hb.command) {
      return false;
    }
  }
  return true;
}

/**
 * Wrap an inner JavaScript payload as a shell-evaluable `node -e "..."`
 * one-liner. The returned string is what Claude Code writes verbatim
 * into `.claude/settings.local.json` under the `command` field. Per
 * Node.js docs (https://nodejs.org/api/process.html#processargv), when
 * using `-e` there is no script-file slot, so `process.argv[1]` is the
 * first user-passed extra argument. This is consistent across Windows,
 * macOS, and Linux.
 *
 * Every `"` character in the inner JS must be JSON-escaped as `\\"`
 * so that the surrounding wrapper `node -e "..."` parses correctly:
 * the shell sees the escape and passes a literal `"` to Node. A
 * single missed escape closes the wrapper early and the entire hook
 * regresses to the bash-syntax-error class of bug.
 *
 * @param js Inner JavaScript payload. Must be a single statement or a
 *           sequence of statements joined with `;`. The wrapper does
 *           not insert any `;` between the payload and the closing
 *           `"` because Node accepts a trailing expression with `;`
 *           already terminated by the payload itself.
 */
function wrapAsNodeOneLiner(js: string): string {
  // Only `"` needs JSON-escaping: the wrapper uses double quotes, so an
  // unescaped inner `"` would close the wrapper prematurely. Backslashes
  // do NOT need escaping here — bash inside a `"..."` wrapper reduces
  // `\\` to `\`, so any `\X` in the inner JS reaches Node as `\X`,
  // which is what regex literals like `/\.peaks\//` need. Adding a
  // second `\\` → `\\` pass would double-escape backslashes and break
  // every regex literal the inner JS contains.
  const escaped = js.replace(/"/g, '\\"');
  return `node -e "${escaped}"`;
}

/**
 * Build the Write|Edit|MultiEdit matcher command. The command reads
 * the candidate file path from argv[2] and exits 0 iff the path
 * contains `.peaks/_runtime/` or `.peaks/_runtime/<sessionId>/` (the change-id
 * segment is the next path component after `.peaks/`). All other
 * paths exit 1 so the gate fires normally.
 *
 * The matcher is intentionally narrow: it only fires for tools that
 * take a `file_path` (Write/Edit/MultiEdit) and for the Bash
 * subcommand allow-list. It does NOT silently allow arbitrary paths
 * under `.peaks/_runtime/<sessionId>/` — only those matching the documented
 * pattern. Future slice work can broaden the allow-list if the
 * peaks-solo workflow needs more paths.
 */
function buildWriteHookCommand(): string {
  // Path-matching: allow when the path contains `.peaks/_runtime/`
  // OR when the second `.peaks/` segment starts with anything that
  // looks like a change-id (kebab-case slug). Exit 0 for allow, exit
  // 1 for deny. The candidate path arrives on `process.argv[1]` per
  // Node.js argv layout under `-e` (cross-platform consistent).
  const js =
    'const p=process.argv[1]||"";' +
    'if(p.includes(".peaks/_runtime/"))process.exit(0);' +
    'const m=p.match(/\\.peaks\\/([a-z0-9][a-z0-9.-]*)\\//);' +
    'if(m&&m[1]&&m[1]!=="_runtime"&&m[1]!=="_dogfood"&&m[1]!=="_sub_agents"&&m[1]!=="memory"&&m[1]!=="sops"&&m[1]!=="retrospective"&&m[1]!=="project-scan"&&m[1]!=="perf-baseline")process.exit(0);' +
    'process.exit(1)';
  return wrapAsNodeOneLiner(js);
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
 *
 * As of TEMPLATE_VERSION 1.2.0, only the `Write|Edit|MultiEdit`
 * matcher is emitted. Bash command enforcement is the responsibility
 * of `peaks gate enforce`, which `peaks hooks install` injects into
 * `.claude/settings.json` (not `.claude/settings.local.json`).
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
          // v3.1.2 Step 0.8 — Mechanical PreToolUse gate. Runs
          // `peaks solo gate-step-08 --project .` before every Bash
          // tool call. Exit 0 = allow (with structured stdout
          // describing the decision + optional `Next: slice #N+1 of
          // M (<currentSlice>)` line when progress.json exists). Exit
          // 2 = block (stderr contains the BLOCKED: ... reason).
          // The existing Write|Edit|MultiEdit matcher is preserved.
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: buildBashGateStep08Command()
            }
          ]
        }
      ]
    }
  };
}

/**
 * v3.1.2: build the Bash matcher command that runs `peaks solo
 * gate-step-08`. We invoke the CLI directly (not via `node -e "..."`)
 * because the CLI is the only legitimate source of the structured
 * decision + Next: slice context. Exit code is the load-bearing
 * signal — 0 = allow, 2 = block. The hook installer is idempotent:
 * `templateContentMatches` compares the parsed matcher entries, so
 * re-running `peaks workspace init` on a project that already has the
 * Bash hook is a no-op (already-current).
 */
function buildBashGateStep08Command(): string {
  // The hook receives the tool call on stdin. We ignore stdin and
  // delegate entirely to `peaks solo gate-step-08`, which reads
  // .peaks/_runtime/<sessionId>/job-shape.json and last-prompt.txt.
  // `${CLAUDE_PROJECT_DIR}` resolves to the consumer project's root
  // (Claude Code's standard convention).
  return 'peaks solo gate-step-08 --project "${CLAUDE_PROJECT_DIR}"';
}
