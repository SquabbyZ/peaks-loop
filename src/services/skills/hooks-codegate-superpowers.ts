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
  /**
   * True when the gate-enforce entry must be materialized into the IDE's
   * MACHINE-LOCAL settings file rather than the shared one (see
   * `hookEnforceShell` below). Set for Claude Code, whose project-scope
   * hooks have a gitignored per-machine sibling file.
   */
  readonly hookEnforceMachineLocal: boolean;
  /**
   * The `shell` field for the gate-enforce handler, or `undefined` to omit
   * the key entirely and let the IDE use its documented default.
   *
   * Claude Code only. See `resolveHookShell` for why Windows needs this.
   */
  readonly hookEnforceShell: string | undefined;
}

/**
 * Claude Code runs a shell-form hook command through a shell that defaults
 * to bash — which on Windows means Git Bash, and MSYS2's bash
 * force-allocates its own console window. The result is a visible window on
 * EVERY Bash tool call. The window is created by the spawner (Claude Code)
 * before any peaks code runs, so `windowsHide` and any in-process hiding
 * cannot help; pinning the hook's `shell` is the only lever the hook schema
 * offers. The platform-neutral default (`undefined` → omit the key) is kept
 * everywhere else.
 */
export function resolveHookShell(platform: NodeJS.Platform = process.platform): string | undefined {
  return platform === 'win32' ? 'powershell' : undefined;
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
  const isClaudeCode = ide === 'claude-code';
  // Claude Code's gate hook must emit its structured decision as JSON:
  // without `--json` the hook validator rejects the plain `{}` stdout with
  // "Hook JSON output validation failed". See
  // .peaks/memory/bash-pretooluse-hook-json-error-fix.md.
  const jsonFlag = isClaudeCode ? ' --json' : '';
  return {
    hookEnforceCommand: `${spec.command} --project "\${${adapter.envVar}}"${jsonFlag}`,
    hookEnforceSentinel: spec.sentinel,
    hookEnforceMatcher: adapter.toolMatcher,
    hookEnforceEvent: adapter.hookEvent,
    // Only Claude Code has the machine-local sibling settings file the
    // routing depends on, and only Claude Code's hook schema accepts a
    // `shell` key.
    hookEnforceMachineLocal: isClaudeCode,
    hookEnforceShell: isClaudeCode ? resolveHookShell() : undefined
  };
}

/** A typed descriptor for a single peaks-managed hook entry. */
export type PeaksHookEntry = {
  sentinel: string;
  matcher: string;
  command: string;
  event: string;
  /**
   * When true the entry is written to the machine-local, gitignored settings
   * file (`.claude/settings.local.json`) instead of the shared one, because
   * the entry carries a machine-specific value (the `shell` field).
   */
  machineLocal?: boolean;
  /** Optional `shell` field for the emitted handler. */
  shell?: string;
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
    {
      sentinel: spec.hookEnforceSentinel,
      matcher: spec.hookEnforceMatcher,
      command: spec.hookEnforceCommand,
      event: spec.hookEnforceEvent,
      machineLocal: spec.hookEnforceMachineLocal,
      ...(spec.hookEnforceShell !== undefined ? { shell: spec.hookEnforceShell } : {})
    }
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

// --- External (third-party) PreToolUse gate exemptions ---------------------

/**
 * Adapter table: a Peaks *concept* → the settings value an EXTERNAL,
 * non-Peaks PreToolUse gate must read to honour it.
 *
 * The concept Peaks holds is "the `.peaks/**` workspace tree is not project
 * source, so 'who imports this / what schema' carries no signal there".
 * Peaks already enforces it for its own hooks: slice 2.0.1-bug3 materializes
 * a `Write|Edit|MultiEdit` bypass in `.claude/settings.local.json` precisely
 * so the first workspace write is never fact-gated. This table is that same
 * intent declared to a gate Peaks does not own.
 *
 * The mapped key is read by the ECC plugin's `gateguard-fact-force` hook: a
 * comma-separated glob list matched against the normalized (forward-slash,
 * lowercased) path, where a match skips first-touch fact-forcing. The row is
 * INERT when that plugin is absent — an env var nothing reads.
 *
 * The key below is the ONLY occurrence of that third-party name in the source
 * tree (a test pins the count). Vendor-specific translation belongs in the
 * adapter layer, next to `HOOK_COMMAND_BY_IDE` and `resolveHookShell` — never
 * scattered through the installer. And it is emitted into a MACHINE-LOCAL
 * settings file only (see `resolveHookTargets`): a third-party variable name in
 * the COMMITTED shared settings would be pushed to every consumer of this repo.
 */
export const EXTERNAL_GATE_EXEMPT_ENV: Readonly<Record<string, string>> = Object.freeze({
  // peaks' `.peaks/**` workspace tree is not project source → skip fact-forcing
  GATEGUARD_EXEMPT_GLOBS: '.peaks/**'
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Split a comma-separated glob list, dropping blanks and surrounding space. */
function splitGlobList(value: string): string[] {
  return value.split(',').map((glob) => glob.trim()).filter((glob) => glob.length > 0);
}

/** True when every `EXTERNAL_GATE_EXEMPT_ENV` glob is already declared in `settings.env`. */
export function hasExternalGateExemptions(settings: Record<string, unknown>): boolean {
  const env = isPlainObject(settings.env) ? settings.env : {};
  return Object.entries(EXTERNAL_GATE_EXEMPT_ENV).every(([key, glob]) => {
    const current = env[key];
    return typeof current === 'string' && splitGlobList(current).includes(glob);
  });
}

/**
 * Union every `EXTERNAL_GATE_EXEMPT_ENV` row into `settings.env`. An existing
 * value is EXTENDED, never replaced, so a user who exempted other trees keeps
 * them; unrelated `env` keys are untouched. Rows already carrying our glob are
 * left byte-identical (so a re-run cannot churn the file), and the input object
 * is returned unchanged when there is nothing to add. Pure.
 */
export function withExternalGateExemptions(settings: Record<string, unknown>): Record<string, unknown> {
  const env: Record<string, unknown> = isPlainObject(settings.env) ? { ...settings.env } : {};
  let changed = false;
  for (const [key, glob] of Object.entries(EXTERNAL_GATE_EXEMPT_ENV)) {
    const current = typeof env[key] === 'string' ? (env[key] as string) : '';
    const existing = splitGlobList(current);
    if (existing.includes(glob)) continue;
    env[key] = [...existing, glob].join(',');
    changed = true;
  }
  return changed ? { ...settings, env } : settings;
}

/**
 * Inverse of `withExternalGateExemptions`: remove exactly the globs this repo
 * added, keeping any the user wrote. The key is deleted once it holds nothing
 * of ours, and `env` itself is dropped when it becomes empty — so uninstall
 * leaves no orphan field behind. Pure.
 */
export function withoutExternalGateExemptions(settings: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(settings.env)) return settings;
  const env: Record<string, unknown> = { ...settings.env };
  let changed = false;
  for (const [key, glob] of Object.entries(EXTERNAL_GATE_EXEMPT_ENV)) {
    const current = env[key];
    if (typeof current !== 'string') continue;
    const kept = splitGlobList(current).filter((entry) => entry !== glob);
    changed = true;
    if (kept.length > 0) {
      env[key] = kept.join(',');
    } else {
      delete env[key];
    }
  }
  if (!changed) return settings;
  if (Object.keys(env).length === 0) {
    const { env: _omit, ...rest } = settings;
    return rest;
  }
  return { ...settings, env };
}
