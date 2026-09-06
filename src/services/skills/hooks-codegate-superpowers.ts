/**
 * Code-gate hook entries + superpowers-deny surface for the Peaks-managed
 * hooks. Extracted from `hooks-settings-service.ts` to keep that file
 * under the 800 LOC cap (mechanical verbatim move). Also carries the
 * per-IDE hook-spec table (`resolveHookSpec` / `HOOK_COMMAND_BY_IDE`)
 * and `HOOK_ENFORCE_SENTINEL`, which the entry/sentinel resolvers depend
 * on, so this module is self-contained apart from the `PeaksHookEntry`
 * type contract re-exported by the caller.
 */
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';
import {
  HOOK_OUTER_CACHE_COMMAND,
  HOOK_OUTER_CACHE_EVENT,
  HOOK_OUTER_CACHE_SENTINEL,
  HOOK_WORKSPACE_INIT_COMMAND,
  HOOK_WORKSPACE_INIT_EVENT,
  HOOK_WORKSPACE_INIT_SENTINEL
} from './session-start-hook-constants.js';

/** Sentinel substring identifying a Claude-Code gate-enforce hook entry. */
export const HOOK_ENFORCE_SENTINEL = 'peaks gate enforce';

/**
 * Resolve the adapter + per-IDE values used to render the settings.json entries.
 * Each adapter that wants its own gate command (Trae / Cursor / Codex use
 * `peaks hook handle`, the new dispatcher) overrides the default here.
 *
 * Slice #2 + #12 + #13 (2.4.0): the per-IDE hook command is read from a
 * small dispatch table below. New adapters pick a command by adding a
 * single line to that table — no if/else growth in this function.
 */
interface ResolvedHookSpec {
  readonly hookEnforceCommand: string;
  readonly hookEnforceSentinel: string;
  readonly hookEnforceMatcher: string;
  readonly hookEnforceEvent: string;
}

/**
 * Per-IDE hook command + sentinel. The default (Claude Code) uses the
 * legacy `peaks gate enforce` surface; Trae / Cursor / Codex (Cursor-style
 * siblings with `before*` / `pre_*` hook events) use `peaks hook handle`,
 * the new dispatcher. New adapters register by adding a single line here.
 *
 * Slice #12 + #13 (2.4.0) honor the framework's "fill the table" promise
 * — adding a new IDE does NOT require editing this function's control
 * flow, only adding a line to this table.
 */
const HOOK_COMMAND_BY_IDE: Readonly<Partial<Record<IdeId, { command: string; sentinel: string }>>> = {
  'claude-code': { command: 'peaks gate enforce', sentinel: 'peaks gate enforce' },
  'trae':       { command: 'peaks hook handle',  sentinel: 'peaks hook handle' },
  'cursor':     { command: 'peaks hook handle',  sentinel: 'peaks hook handle' },
  'codex':      { command: 'peaks hook handle',  sentinel: 'peaks hook handle' },
  'hermes':     { command: 'peaks gate enforce', sentinel: 'peaks gate enforce' },
  'openclaw':   { command: 'peaks gate enforce', sentinel: 'peaks gate enforce' },
  // qoder / tongyi-lingma are reserved IdeIds (slice #1) but not yet
  // registered. When a slice adds them, add a HOOK_COMMAND_BY_IDE entry
  // here — the function below fail-closes on missing entries.
};

export function resolveHookSpec(ide: IdeId): ResolvedHookSpec {
  // getAdapter throws on unregistered IDEs — the registry is the source of truth.
  const adapter = getAdapter(ide);
  const spec = HOOK_COMMAND_BY_IDE[ide];
  if (!spec) {
    // Defensive fallback: if an adapter is added to the registry without a
    // HOOK_COMMAND_BY_IDE entry, fail-closed with a clear error instead of
    // silently writing a Claude-shaped entry to a non-Claude settings.json.
    throw new Error(`peaks hooks install: unsupported IDE '${ide}' (no HOOK_COMMAND_BY_IDE entry; add one to hooks-settings-service.ts)`);
  }
  return {
    hookEnforceCommand: `${spec.command} --project "\${${adapter.envVar}}"`,
    hookEnforceSentinel: spec.sentinel,
    hookEnforceMatcher: adapter.toolMatcher,
    hookEnforceEvent: adapter.hookEvent
  };
}

/** A typed descriptor for a single peaks-managed hook entry. */
export type PeaksHookEntry = {
  sentinel: string;
  matcher: string;
  command: string;
  event: string;
};

/**
 * Slice 2026-08-06-codegate-vendor-neutral — code-gate hook entry.
 * Vendor-neutral command (`peaks code-gate --json`); the CLI adapter
 * lives in `src/cli/commands/code-gate-command.ts` and the decision
 * logic lives in `src/services/hooks/pre-tool-code-gate.ts`. The
 * shell-script sibling (`src/services/hooks/pre-tool-code-gate.sh`)
 * encodes the same logic for non-Node harnesses.
 */
export const HOOK_CODE_GATE_SENTINEL = 'peaks code-gate';
export const HOOK_CODE_GATE_MATCHER = 'Edit|Write|MultiEdit';
export const HOOK_CODE_GATE_EVENT = 'PreToolUse';
export const HOOK_CODE_GATE_COMMAND = `peaks code-gate --json`;

export function resolveHookEntries(ide: IdeId, _skipProgress = false): PeaksHookEntry[] {
  const spec = resolveHookSpec(ide);
  const entries: PeaksHookEntry[] = [
    { sentinel: spec.hookEnforceSentinel, matcher: spec.hookEnforceMatcher, command: spec.hookEnforceCommand, event: spec.hookEnforceEvent }
  ];
  if (ide === 'claude-code') {
    entries.push({
      sentinel: HOOK_OUTER_CACHE_SENTINEL,
      matcher: '',
      command: HOOK_OUTER_CACHE_COMMAND,
      event: HOOK_OUTER_CACHE_EVENT
    });
    // Slice rid-statusline-stale-ux AC-2: SessionStart outer-cache
    // write is followed by `peaks session primer` entry so that
    // rotation + presence cleanup fire BEFORE the first statusline
    // render of a fresh session. The new subcommand is idempotent
    // and short-circuits when the binding already matches — safe to
    // call on every SessionStart. Order matters conceptually:
    // outer-cache write must come first (the primer's
    // ensureSessionWithRotation reads the current outer session id).
    entries.push({
      sentinel: HOOK_WORKSPACE_INIT_SENTINEL,
      matcher: '',
      command: HOOK_WORKSPACE_INIT_COMMAND,
      event: HOOK_WORKSPACE_INIT_EVENT
    });
    // Slice 2026-08-06-codegate-vendor-neutral: code-gate entry on
    // Edit|Write|MultiEdit matcher. Vendor-neutral command
    // (`peaks code-gate --json`); the CLI adapter lives in
    // `src/cli/commands/code-gate-command.ts` and the underlying
    // decision logic is in `src/services/hooks/pre-tool-code-gate.ts`.
    entries.push({
      sentinel: HOOK_CODE_GATE_SENTINEL,
      matcher: HOOK_CODE_GATE_MATCHER,
      command: HOOK_CODE_GATE_COMMAND,
      event: HOOK_CODE_GATE_EVENT
    });
  }
  return entries;
}

/**
 * Legacy sentinel set used by uninstall + status to find and remove stale
 * progress-start entries written by pre-#014 installs. The progress-start
 * sentinel is the literal substring that older installs emitted.
 */
const LEGACY_PROGRESS_START_SENTINEL = 'peaks progress start';

export function resolveLegacySentinels(ide: IdeId): ReadonlyArray<string> {
 if (ide === 'trae') {
 return ['peaks hook handle', LEGACY_PROGRESS_START_SENTINEL];
 }
 // Slice 2026-08-06-session-outer-cache: include the SessionStart outer-cache
 // sentinel so uninstall strips it alongside the gate-enforce entry.
 // Slice 2026-08-06-codegate-vendor-neutral: also include the code-gate
 // sentinel so uninstall strips the Edit|Write|MultiEdit entry alongside
 // the rest of the peaks-managed entries.
 const base = [HOOK_ENFORCE_SENTINEL, LEGACY_PROGRESS_START_SENTINEL, HOOK_CODE_GATE_SENTINEL];
 if (ide === 'claude-code') {
   // Slice rid-statusline-stale-ux AC-2: include the SessionStart
   // workspace-init primer sentinel so uninstall strips it alongside
   // the gate-enforce entry, and so hand-added entries matching this
   // sentinel are recognized as peaks-managed (not stripped as
   // non-Peaks).
   return [...base, HOOK_OUTER_CACHE_SENTINEL, HOOK_WORKSPACE_INIT_SENTINEL];
 }
 return base;
}

// --- Slice 2026-07-29-worktree-layer3-deny -----------------------------------
// Layer 3 of the Worktree Governance 3-layer design (see
// .peaks/memory/2026-07-29-worktree-layer3-deny.md). The gateway is the IDE
// native `permissions.deny` list — Claude Code refuses to invoke any Skill
// listed there BEFORE the LLM even sees it. This is the strongest of the three
// layers because it bypasses the LLM's tool-call decision entirely: the IDE
// matches the deny entry against the Skill's namespace and returns a
// permission error, so the LLM observes "skill not available" rather than
// "skill denied" — true fail-closed.
//
// The list is intentionally tiny: only skills that the superpowers chain
// *forces* downstream from peaks-loop work paths. We do NOT deny every
// superpowers skill — only the one whose `description` field or SKILL.md body
// recommends `git worktree add` / native worktree tools as a step. Anything
// else stays available as a reference (peaks-code's
// references/external-skill-invocation.md already describes every other
// superpowers skill as informational).
//
// The IDE expects the deny entry in the form `UseSkill(<skill-id>)`. The
// prefix is fixed; the skill id is the namespace-qualified name. We render
// the entries at install time and at uninstall time so the sentinel list is
// the single source of truth.

/**
 * The set of Skills whose use is denied at the IDE permissions layer for
 * every `peaks hooks install` call. Each entry is the namespace-qualified
 * skill id; the helper `formatSuperpowersDenyEntry` wraps it in the IDE's
 * `UseSkill(...)` envelope.
 *
 * Slice 2026-07-29-worktree-layer3-deny: the list is empty-aware. To deny a
 * new skill, append its id here and re-run `peaks hooks install`. The list
 * is also the inverse for uninstall: `removeHookInstall` rebuilds the deny
 * list by filtering out anything whose wrapped form matches one of these
 * ids.
 *
 * Slice rid-skill-persistence-001 (2026-08-12): four additional skills
 * denied so the superpowers chain cannot silently override peaks-code.
 * All four are referenced by `superpowers:using-superpowers` as the
 * "bug → systematic-debugging / TDD / verification-before-completion /
 * recursion via using-superpowers" auto-routing pattern — denying the
 * trigger removes the auto-routing surface while leaving all four
 * still readable as reference material from
 * `references/external-skill-invocation.md`.
 */
export const SUPERPOWERS_DENIED_SKILLS: ReadonlyArray<string> = [
  // superpowers:using-git-worktrees is the chain's "ground zero" — its
  // SKILL.md (lines 47-99) literally instructs the LLM to run
  // `git worktree add`. Denying this Skill at the IDE layer prevents the
  // LLM from ever receiving that prompt.
  'superpowers:using-git-worktrees',
  // Slice rid-skill-persistence-001: deny the "bug → systematic-debugging"
  // auto-route. Without this entry the chain can preempt the current bee
  // any time a bug report surfaces. Reference-only via
  // references/external-skill-invocation.md §systematic-debugging.
  'superpowers:systematic-debugging',
  // Slice rid-skill-persistence-001: deny the TDD trigger that the chain
  // pairs with bug reports (write-a-failing-test-first). Reference-only
  // via references/external-skill-invocation.md §test-driven-development.
  'superpowers:test-driven-development',
  // Slice rid-skill-persistence-001: deny the verification-before-
  // completion trigger that the chain uses to override "declare done"
  // claims from peaks-code. Reference-only via
  // references/external-skill-invocation.md §verification-before-completion.
  'superpowers:verification-before-completion',
  // Slice rid-skill-persistence-001: deny the recursive chain entrypoint
  // itself. Without this entry the chain auto-spawns another
  // "using-superpowers" Skill call right after the previous chain step,
  // creating the recursive override pattern that peaks-loop's L1 guard
  // cannot see through. Reference-only via
  // references/external-skill-invocation.md §using-superpowers.
  'superpowers:using-superpowers'
];

export function formatSuperpowersDenyEntry(skillId: string): string {
  return `UseSkill(${skillId})`;
}

export const SUPERPOWERS_DENY_SENTINELS: ReadonlySet<string> = new Set(
  SUPERPOWERS_DENIED_SKILLS.map(formatSuperpowersDenyEntry)
);
