/**
 * Slice 2.0.1-bug3-fact-forcing-bypass — pure-data template for the
 * consumer-project `.claude/settings.local.json` file.
 *
 * The template is a PreToolUse hook allow-list that bypasses the
 * Claude Code [Fact-Forcing Gate] for tool calls whose paths target
 * the peaks-managed `.peaks/` workspace. Without this bypass,
 * `peaks workspace init` (Step 0 of every peaks-code session) is
 * unrunnable in a consumer project because the gate blocks the very
 * first Write.
 *
 * The template is a pure-data function (no filesystem, no clock) so
 * it can be unit-tested in isolation and so the on-disk file matches
 * the in-memory template byte-for-byte.
 *
 * One matcher is emitted:
 *   1. `Write|Edit|MultiEdit` — a `node <script>` handler that runs the
 *      path gate shipped at `src/services/hooks/write-gate.js`. Exits 0
 *      (allow) for the paths the gate skips, exit 1 (deny → fall through to
 *      gate) for everything else. TEMPLATE_VERSION 1.6.0 moved the decision
 *      out of an inlined `node -e "<js>"` one-liner, whose escaping was
 *      bash-specific and therefore could not take a platform `shell` pin.
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

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXTERNAL_GATE_EXEMPT_ENV, hasExternalGateExemptions, resolveHookShell, resolveHookSpec } from '../skills/hooks-codegate-superpowers.js';

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
 *           `peaks code gate-step-08 --project .` (Step 0.8 mechanical
 *           gate). The existing Write|Edit|MultiEdit matcher is
 *           preserved. The new matcher's exit code is the load-bearing
 *           signal: 0 = allow, 2 = block (with stderr BLOCKED reason).
 *   1.4.0 — added the `peaks gate enforce` `Bash` PreToolUse entry. It
 *           lives here (machine-local, gitignored file) rather than in
 *           the committed `.claude/settings.json` because its `shell`
 *           is machine-specific: on Windows the default Git-Bash shell
 *           force-allocates a console window on every Bash tool call.
 *           This template is the second writer of that file, so it must
 *           emit the entry too — otherwise `peaks workspace init` would
 *           overwrite whatever `peaks hooks install` put there.
 *   1.5.0 — pinned the same platform `shell` on the `peaks code
 *           gate-step-08` handler. It runs on the same `Bash` matcher,
 *           so leaving it un-pinned left the console-window defect in
 *           place for half of every Bash tool call.
 *   1.6.0 — the `Write|Edit|MultiEdit` handler no longer inlines its
 *           JavaScript as `node -e "<js>"`. It invokes the shipped script
 *           `src/services/hooks/write-gate.js` instead, so the command
 *           string carries no shell-escaped payload at all and the handler
 *           can take the same platform `shell` pin as its siblings. The
 *           decision itself is a verbatim relocation — see that file.
 *   1.7.0 — added the `env` block declaring Peaks' workspace tree exempt
 *           from a THIRD-PARTY PreToolUse fact-forcing gate
 *           (`EXTERNAL_GATE_EXEMPT_ENV`). The comparator now requires the
 *           on-disk file to declare those exemptions too, so a project
 *           installed by an earlier release refreshes once and converges.
 */
export const TEMPLATE_VERSION = '1.7.0';

/**
 * Compare two serialized template strings: does the on-disk file already
 * declare every entry the generated tree declares?
 *
 * OWNERSHIP IS PER ENTRY, NOT PER KEY (rid 2026-09-13-two-decisions item ②).
 * This comparator answers "is each entry the GENERATED tree declares present
 * on disk?", NOT "are the two `hooks` trees identical". Extra on-disk entries
 * are IGNORED, so an entry another writer put in this file never makes it look
 * drifted.
 *
 * That is the deliberate other half of the entry-level merge in
 * `mergeTemplateOwnedHooks` / `workspace-claude-settings-materializer.ts`.
 * `.claude/settings.local.json` has a SECOND writer of `hooks.PreToolUse`:
 * `installAutoCompactHook` appends a `Bash|Task` entry. Under the previous
 * exact-tree rule the merged file carried 4 entries against a 3-entry
 * generated tree, so every `peaks workspace init` answered "drifted",
 * rewrote, and reported `refreshed` forever — precisely the state whole-key
 * ownership existed to prevent, and the reason the merge could not ship alone.
 *
 * Matching is order-insensitive AND multiset-aware: the template declares TWO
 * `Bash` entries, and each must have its own counterpart on disk, so a file
 * carrying only one of them is still reported as drifted (the previous
 * index-by-index loop had the same property; it is load-bearing, not a
 * detail).
 *
 * Returns `true` iff both strings parse to objects whose `hooks.PreToolUse`
 * arrays satisfy that containment AND the on-disk `env` already carries every
 * exemption the template declares (extra on-disk keys and extra globs are
 * allowed — a user may exempt other trees, and a requirement the file already
 * exceeds must not re-trigger a write).
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

  // Multiset containment: consume one on-disk entry per generated entry so a
  // file holding a single copy of a doubly-declared entry still fails.
  const unmatched = [...parsedOnDisk.hooks.PreToolUse];
  for (const required of parsedGenerated.hooks.PreToolUse) {
    const at = unmatched.findIndex((candidate) => sameEntry(required, candidate));
    if (at === -1) {
      return false;
    }
    unmatched.splice(at, 1);
  }

  // A project installed by a release that predates a template-declared
  // exemption still needs the refresh this comparator gates — otherwise the
  // entry would only ever appear on a machine that re-ran `peaks hooks
  // install`. `hasExternalGateExemptions` is the same predicate the installer
  // uses, so the two writers cannot drift apart.
  return hasExternalGateExemptions({ env: (parsedOnDisk as { env?: unknown }).env });
}

/**
 * Merge the on-disk `hooks.PreToolUse` list with the template's.
 *
 * THE OWNERSHIP RULE (rid 2026-09-13-two-decisions item ②): this template owns
 * the entries IT DECLARES — and nothing else. Every other on-disk entry is
 * carried across verbatim, whatever its matcher, because the template has no
 * opinion about it:
 *
 *   - a `matcher` the template does not declare (`Bash|Task`, the auto-compact
 *     hook `installAutoCompactHook` appends) is never touched;
 *   - surplus entries BEYOND the template's count for a declared matcher (a
 *     user's own `Bash` hook) are surplus too, and survive;
 *   - an on-disk entry that fills a declared slot is REPLACED by the template's
 *     entry for it. That is what makes a hand-edited (or older-release) entry
 *     self-heal instead of lingering next to a correct copy of itself.
 *
 * Slot counting is per `matcher` and positional within it: the template
 * declares TWO `Bash` entries, so the first two on-disk `Bash` entries are
 * theirs and a third is the user's. The template's entries are emitted first,
 * in template order, then the preserved ones in their on-disk order — which is
 * a fixed point: re-merging the result yields the result (the template's own
 * entries are encountered first and refill their own slots).
 *
 * Non-conforming entries (no string `matcher`, no `hooks` array) are preserved
 * rather than dropped: guessing at their shape is how a user's entry gets
 * deleted.
 */
export function mergeTemplateOwnedHooks(
  onDisk: ReadonlyArray<unknown>,
  template: ReadonlyArray<unknown>
): unknown[] {
  const slots = new Map<string, number>();
  for (const entry of template) {
    if (!isPreToolUseEntry(entry)) continue;
    slots.set(entry.matcher, (slots.get(entry.matcher) ?? 0) + 1);
  }

  const taken = new Map<string, number>();
  const preserved: unknown[] = [];
  for (const entry of onDisk) {
    // Unowned by construction: not a shape the template could have declared.
    if (!isPreToolUseEntry(entry)) {
      preserved.push(entry);
      continue;
    }
    const declared = slots.get(entry.matcher) ?? 0;
    const used = taken.get(entry.matcher) ?? 0;
    if (used >= declared) {
      preserved.push(entry);
      continue;
    }
    taken.set(entry.matcher, used + 1);
  }

  return [...template, ...preserved];
}

/** Structural equality of two `PreToolUse` entries. */
function sameEntry(a: TemplatePreToolUseEntry, b: TemplatePreToolUseEntry): boolean {
  return a.matcher === b.matcher && sameHooksArray(a.hooks, b.hooks);
}

type TemplateHookCommand = { type: string; command: string; shell?: string };

/**
 * One `hooks.PreToolUse` entry in the shape this template declares. The
 * `matcher` + `hooks` pair is the entry's identity everywhere below: `matcher`
 * alone is not unique (two `Bash` entries), and whole-object identity would
 * make a hand-edited entry unrecognizable and therefore unrepairable.
 */
type TemplatePreToolUseEntry = { matcher: string; hooks: TemplateHookCommand[] };

type TemplateShape = {
  hooks: { PreToolUse: TemplatePreToolUseEntry[] };
};

function isPreToolUseEntry(value: unknown): value is TemplatePreToolUseEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { matcher?: unknown; hooks?: unknown };
  return typeof candidate.matcher === 'string' && Array.isArray(candidate.hooks);
}

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
  a: ReadonlyArray<TemplateHookCommand>,
  b: ReadonlyArray<TemplateHookCommand>
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const ha = a[i]!;
    const hb = b[i]!;
    // `shell` participates in the comparison: it is machine-specific (see
    // `resolveHookShell`), so a file written on one platform must be
    // recognized as drifted on the other instead of silently kept.
    if (ha.type !== hb.type || ha.command !== hb.command || ha.shell !== hb.shell) {
      return false;
    }
  }
  return true;
}

/**
 * This module's own directory — `<root>/src/services/workspace` in the
 * source tree, `<root>/dist/services/workspace` in a build.
 *
 * Anchored on the running module rather than on `process.argv[1]`: the
 * same reason `daemon-supervisor.ts` documents — `argv[1]` is a different
 * file in each way the CLI is entered (`bin/peaks.js`, `src/cli/index.ts`
 * under tsx, `dist/cli/index.js` when invoked directly), whereas the
 * module's own location is the one fact that is always true.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path of the shipped Write|Edit|MultiEdit gate script.
 *
 * `write-gate.js` is a plain `.js` (not a compiled `.ts`) precisely so this
 * single relative filename resolves in BOTH trees: `src/services/hooks/` for
 * `tsx` / vitest, `dist/services/hooks/` for an installed consumer (copied by
 * `scripts/copy-templates.mjs`; the `dist/**` `*.js` glob in
 * `package.json#files` already ships it).
 *
 * Separators are normalized to `/` so the emitted command contains no
 * backslash at all. That is what makes the handler shell-agnostic: bash
 * reduces `\X` inside `"..."` and PowerShell escapes with a backtick, so any
 * backslash in the string is one dialect's problem waiting to happen.
 */
export function writeGateScriptPath(): string {
  return resolve(MODULE_DIR, '..', 'hooks', 'write-gate.js').replaceAll('\\', '/');
}

/**
 * Build the Write|Edit|MultiEdit matcher command.
 *
 * TEMPLATE_VERSION 1.6.0: `node "<script>"` with NO inline payload. The
 * decision lives in `src/services/hooks/write-gate.js` and was relocated
 * there verbatim. Because there is nothing left to escape, this handler is
 * shell-dialect-independent and can carry the same platform `shell` pin as
 * its Bash siblings (see `resolveHookShell`).
 */
function buildWriteHookCommand(): string {
  return `node "${writeGateScriptPath()}"`;
}

/**
 * TEMPLATE_VERSION 1.4.0 — the SOP gate-enforce handler, read from the same
 * canonical hook spec `peaks hooks install` uses. Deriving it here (rather
 * than re-typing the literal) is what keeps the two writers of this file
 * byte-compatible: `templateContentMatches` compares the `command` string,
 * so any drift would make every `peaks workspace init` rewrite the file and
 * drop whatever `peaks hooks install` had merged in.
 */
function buildGateEnforceHandler(): ClaudeHookCommand {
  const spec = resolveHookSpec('claude-code');
  return {
    type: 'command',
    command: spec.hookEnforceCommand,
    ...(spec.hookEnforceShell !== undefined ? { shell: spec.hookEnforceShell } : {})
  };
}

type ClaudeHookCommand = { type: 'command'; command: string; shell?: string };
type ClaudePreToolUseEntry = { matcher: string; hooks: ClaudeHookCommand[] };
type ClaudeSettingsLocal = {
  hooks: { PreToolUse: ClaudePreToolUseEntry[] };
  /**
   * Exemptions declared to the third-party PreToolUse gate peaks does not own
   * (`EXTERNAL_GATE_EXEMPT_ENV`). They belong in THIS file because it is
   * machine-local and gitignored: a third-party variable name in the committed
   * shared `settings.json` would be pushed to every consumer of the project.
   */
  env: Record<string, string>;
};

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
  // TEMPLATE_VERSION 1.6.0 — the write handler can now be shell-pinned for the
  // same Windows reason as the two Bash handlers below: a shell-form command is
  // executed by Git Bash / MSYS2, which force-allocates a console window on
  // every matching tool call. It could NOT take the pin while its payload was
  // inlined JavaScript, because PowerShell does not perform bash's backslash
  // reduction and would have corrupted the payload. `undefined` on POSIX omits
  // the key entirely.
  const writeShell = resolveHookShell();
  return {
    // Slice emit-gateguard-exemption — the third-party gate exemption. Peaks
    // already bypasses its OWN fact-forcing gate for `.peaks/**` (the
    // Write|Edit|MultiEdit handler below); this is the same intent declared in
    // the currency an external PreToolUse gate reads. `peaks hooks install`
    // merges the same row into this file, so the two writers agree.
    env: { ...EXTERNAL_GATE_EXEMPT_ENV },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [
            {
              type: 'command',
              command: buildWriteHookCommand(),
              ...(writeShell !== undefined ? { shell: writeShell } : {})
            }
          ]
        },
        {
          // v3.1.2 Step 0.8 — Mechanical PreToolUse gate. Runs
          // `peaks code gate-step-08 --project .` before every Bash
          // tool call. Exit 0 = allow (with structured stdout
          // describing the decision + optional `Next: slice #N+1 of
          // M (<currentSlice>)` line when progress.json exists). Exit
          // 2 = block (stderr contains the BLOCKED: ... reason).
          // The existing Write|Edit|MultiEdit matcher is preserved.
          matcher: 'Bash',
          hooks: [buildBashGateStep08Handler()]
        },
        {
          // TEMPLATE_VERSION 1.4.0 — SOP gate enforcement. Lives in this
          // machine-local file (not the committed settings.json) because
          // `shell` is machine-specific; see the version history above and
          // `resolveHookShell`.
          //
          // It sits in its own matcher group on purpose: a group counts as
          // peaks-managed only when EVERY handler in it carries a peaks
          // sentinel, and the `peaks code gate-step-08` handler above does
          // not. Sharing a group with it would make the whole group
          // unmanaged, so `peaks hooks install` would append a second Bash
          // group and the gate would run twice per Bash call.
          matcher: 'Bash',
          hooks: [buildGateEnforceHandler()]
        }
      ]
    }
  };
}

/**
 * v3.1.2: build the Bash matcher command that runs `peaks code
 * gate-step-08`. We invoke the CLI directly (not via `node -e "..."`)
 * because the CLI is the only legitimate source of the structured
 * decision + Next: slice context. Exit code is the load-bearing
 * signal — 0 = allow, 2 = block. The hook installer is idempotent:
 * `templateContentMatches` compares the parsed matcher entries, so
 * re-running `peaks workspace init` on a project that already has the
 * Bash hook is a no-op (already-current).
 */
function buildBashGateStep08Handler(): ClaudeHookCommand {
  // The hook receives the tool call on stdin. We ignore stdin and
  // delegate entirely to `peaks code gate-step-08`, which reads
  // .peaks/_runtime/<sessionId>/job-shape.json and last-prompt.txt.
  // `${CLAUDE_PROJECT_DIR}` resolves to the consumer project's root
  // (Claude Code's standard convention).
  //
  // TEMPLATE_VERSION 1.5.0 — shell-pinned on Windows for the same reason
  // as the gate-enforce handler below: this runs on the same `Bash`
  // matcher, so a shell-form command is executed by Git Bash / MSYS2,
  // which force-allocates a console window on every Bash tool call.
  const shell = resolveHookShell();
  return {
    type: 'command',
    command: 'peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"',
    ...(shell !== undefined ? { shell } : {})
  };
}
