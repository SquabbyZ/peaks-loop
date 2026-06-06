import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { assertSafeSettingsFile } from '../ide/shared/safe-path.js';
import { atomicWriteJson, readJsonObjectFile } from '../ide/shared/atomic-json.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';
import type { HookScope } from '../ide/shared/safe-path.js';

/**
 * Install (and remove) the Peaks-managed hooks in an IDE's settings.json.
 *
 * The hook runs `peaks gate enforce` (Claude) or `peaks hook handle` (Trae /
 * other future adapters) before every relevant tool call; when a SOP guard's
 * gates fail it returns the adapter-specific deny shape, which blocks the
 * tool call BEFORE the IDE's permission checks — making the gate
 * un-bypassable by the agent.
 *
 * Slice #1 refactor: this service delegates to the `IdeAdapter` for
 * `claude-code`. Slice #2 added Trae. Adapter provides `dirName` /
 * `settingsFileName` / `envVar` / `hookEvent` / `toolMatcher`. The Claude
 * install path is byte-level-compat with slice #0 (AC-1).
 *
 * Slice #3 refactor (this commit): the service is now per-IDE aware via an
 * optional `options.ide` parameter. The CLI command is responsible for
 * resolving the IDE (env → stdin shape → cwd → fallback to 'claude-code')
 * via `detectIdeFromContext` and passing the result here. When `ide` is
 * omitted, the service defaults to `'claude-code'` so existing tests and
 * downstream callers continue to work without modification.
 *
 * Installation is an EXPLICIT user command (never postinstall): skills describe,
 * the CLI performs side effects. Writes preserve all other settings keys and
 * any other hooks, reject symlinked targets, and use an atomic rename so a
 * partial write can never corrupt the settings file. Our entry is merged into
 * (not replacing) the existing `hooks.<event>` array and is identified by a
 * sentinel substring in its command, so install is idempotent and uninstall
 * removes only our own entry.
 */

export type { HookScope } from '../ide/shared/safe-path.js';

export type HookInstallOptions = {
  /**
   * Which IDE's adapter to install for. Defaults to `'claude-code'` for
   * backward compatibility. The CLI command should resolve this from
   * `detectIdeFromContext({ env, cwd, parsedStdin })` and pass the result.
   * Throws if the IDE is not registered in the adapter registry.
   */
  readonly ide?: IdeId;
};

// --- Module-level defaults (claude-code) -----------------------------------
// These exports remain for backward compat — tests and downstream callers
// that only care about Claude Code can keep importing them. The per-IDE
// values are computed lazily inside each public function call.

/** Sentinel substring identifying a Claude-Code gate-enforce hook entry. */
export const HOOK_ENFORCE_SENTINEL = 'peaks gate enforce';
/** Sentinel substring identifying a peaks-managed sub-agent-progress hook entry. */
export const HOOK_PROGRESS_SENTINEL = 'peaks progress start';

/** Default (claude-code) hook command — kept as a stable export for tests. */
export const HOOK_ENFORCE_COMMAND = `peaks gate enforce --project "\${CLAUDE_PROJECT_DIR}"`;
/** Default (claude-code) progress command — kept as a stable export for tests. */
export const HOOK_PROGRESS_COMMAND = `peaks progress start --project "\${CLAUDE_PROJECT_DIR}" --reason "auto-spawn for sub-agent Task" --quiet`;

/**
 * Resolve the adapter + per-IDE values used to render the settings.json entries.
 * Each adapter that wants its own gate command (Trae uses `peaks hook handle`,
 * the new dispatcher) overrides the default here.
 */
interface ResolvedHookSpec {
  readonly hookEnforceCommand: string;
  readonly hookProgressCommand: string;
  readonly hookEnforceSentinel: string;
  readonly hookProgressSentinel: string;
  readonly hookEnforceMatcher: string;
  readonly hookProgressMatcher: string;
  readonly hookEnforceEvent: string;
  readonly hookProgressEvent: string;
}

function resolveHookSpec(ide: IdeId): ResolvedHookSpec {
  const adapter = getAdapter(ide);
  if (ide === 'claude-code') {
    return {
      hookEnforceCommand: `peaks gate enforce --project "\${${adapter.envVar}}"`,
      hookProgressCommand: `peaks progress start --project "\${${adapter.envVar}}" --reason "auto-spawn for sub-agent Task" --quiet`,
      hookEnforceSentinel: HOOK_ENFORCE_SENTINEL,
      hookProgressSentinel: HOOK_PROGRESS_SENTINEL,
      hookEnforceMatcher: adapter.toolMatcher, // 'Bash'
      hookProgressMatcher: 'Task',
      hookEnforceEvent: adapter.hookEvent, // 'PreToolUse'
      hookProgressEvent: adapter.hookEvent  // 'PreToolUse' for Claude
    };
  }
  if (ide === 'trae') {
    return {
      hookEnforceCommand: `peaks hook handle --project "\${${adapter.envVar}}"`,
      hookProgressCommand: `peaks progress start --project "\${${adapter.envVar}}" --reason "auto-spawn for sub-agent Task" --quiet`,
      hookEnforceSentinel: 'peaks hook handle',
      hookProgressSentinel: HOOK_PROGRESS_SENTINEL,
      hookEnforceMatcher: adapter.toolMatcher, // 'terminal'
      hookProgressMatcher: 'Task',
      hookEnforceEvent: adapter.hookEvent, // 'beforeToolCall'
      hookProgressEvent: adapter.hookEvent  // 'beforeToolCall' (no separate progress event yet for Trae)
    };
  }
  // Future adapters (codex, cursor, qoder, tongyi-lingma) — not yet registered.
  // When a slice adds them, branch here. Until then, throw a clear error so
  // the CLI surfaces "unsupported IDE" instead of writing a Claude-shaped
  // entry to a non-Claude settings.json.
  throw new Error(`peaks hooks install: unsupported IDE '${ide}' (not registered in adapter registry; future slice will add support)`);
}

function resolveIde(options: HookInstallOptions | undefined): IdeId {
  return options?.ide ?? 'claude-code';
}

export type HookInstallPlan = {
  scope: HookScope;
  settingsPath: string;
  exists: boolean;
  alreadyInstalled: boolean;
  desiredCommand: string;
  sentinel: string;
  matcher: string;
};

export type HookInstallResult = HookInstallPlan & { applied: boolean };
export type HookRemoveResult = { scope: HookScope; settingsPath: string; removed: boolean };
export type HookStatus = { scope: HookScope; settingsPath: string; exists: boolean; installed: boolean };

type HookHandler = { type?: string; command?: string };
type HookMatcherEntry = { matcher?: string; hooks?: HookHandler[] };

/** Resolve settings root dir for a scope. */
function resolveSettingsRoot(scope: HookScope, projectRoot: string | undefined): string {
  if (scope === 'global') return resolve(homedir());
  if (!projectRoot) {
    throw new Error('Project scope requires a project root');
  }
  return resolve(projectRoot);
}

function resolveSettingsPath(scope: HookScope, ide: IdeId, projectRoot: string | undefined): string {
  const root = resolveSettingsRoot(scope, projectRoot);
  const adapter = getAdapter(ide);
  return adapter.settings.resolveSettingsFile(scope, scope === 'global' ? homedir() : projectRoot);
}

function assertSafeSettingsPathCompat(scope: HookScope, ide: IdeId, root: string, settingsPath: string): void {
  const adapter = getAdapter(ide);
  assertSafeSettingsFile(scope, root, adapter.settings.dirName, adapter.settings.settingsFileName);
  // The compat path receives the already-computed settingsPath; double-check
  // that the computed path matches what assertSafeSettingsFile would have
  // produced. This guards against drift between the two resolvers.
  const expected = adapter.settings.resolveSettingsFile(scope, scope === 'global' ? homedir() : root);
  if (expected !== settingsPath) {
    throw new Error(`settings path drift: ${expected} vs ${settingsPath}`);
  }
}

/** Read the existing hook array entries for the adapter's hookEvent (tolerant of any prior shape). */
function readHookEventEntries(settings: Record<string, unknown>, eventKey: string): HookMatcherEntry[] {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const arr = (hooks as Record<string, unknown>)[eventKey];
  return Array.isArray(arr) ? (arr as HookMatcherEntry[]) : [];
}

/** Read the existing hook array entries from a `settings.hooks` object (already extracted). */
function readHookEntriesFromHooks(hooks: Record<string, unknown>, eventKey: string): HookMatcherEntry[] {
  const arr = hooks[eventKey];
  return Array.isArray(arr) ? (arr as HookMatcherEntry[]) : [];
}

/** True when every command handler in the entry matches a known peaks sentinel for the given IDE. */
function entryIsPeaksManaged(entry: HookMatcherEntry, sentinels: ReadonlyArray<string>): boolean {
  const handlers = Array.isArray(entry?.hooks) ? entry.hooks : [];
  if (handlers.length === 0) return false;
  return handlers.every((h) => {
    if (typeof h?.command !== 'string') return false;
    const cmd = h.command;
    return sentinels.some((sentinel) => cmd.includes(sentinel));
  });
}

/** A typed descriptor for a single peaks-managed hook entry. */
export type PeaksHookEntry = {
  sentinel: string;
  matcher: string;
  command: string;
  event: string;
};

/**
 * Compute the per-IDE peaks hook entries to merge into the settings file.
 * Replaces the slice #1 hardcoded `PEAKS_HOOK_ENTRIES` constant; the constant
 * remains exported (computed for claude-code) for backward compat.
 */
function resolveHookEntries(ide: IdeId): PeaksHookEntry[] {
  const spec = resolveHookSpec(ide);
  return [
    { sentinel: spec.hookEnforceSentinel, matcher: spec.hookEnforceMatcher, command: spec.hookEnforceCommand, event: spec.hookEnforceEvent },
    { sentinel: spec.hookProgressSentinel, matcher: spec.hookProgressMatcher, command: spec.hookProgressCommand, event: spec.hookProgressEvent }
  ];
}

/** Default (claude-code) peaks-managed hook entries — kept as a stable export for tests. */
export const PEAKS_HOOK_ENTRIES: ReadonlyArray<PeaksHookEntry> = (() => {
  const spec = resolveHookSpec('claude-code');
  return [
    { sentinel: spec.hookEnforceSentinel, matcher: spec.hookEnforceMatcher, command: spec.hookEnforceCommand, event: spec.hookEnforceEvent },
    { sentinel: spec.hookProgressSentinel, matcher: spec.hookProgressMatcher, command: spec.hookProgressCommand, event: spec.hookProgressEvent }
  ];
})();

function isInstalledForIde(settings: Record<string, unknown>, ide: IdeId): boolean {
  const entries = resolveHookEntries(ide);
  const sentinels = entries.map((e) => e.sentinel);
  // Check every distinct event key our entries could be on.
  const eventKeys = new Set(entries.map((e) => e.event));
  for (const eventKey of eventKeys) {
    if (readHookEventEntries(settings, eventKey).some((e) => entryIsPeaksManaged(e, sentinels))) {
      return true;
    }
  }
  return false;
}

export function planHookInstall(scope: HookScope, projectRoot?: string, options?: HookInstallOptions): HookInstallPlan {
  const ide = resolveIde(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readJsonObjectFile(settingsPath) : {};
  const spec = resolveHookSpec(ide);
  return {
    scope,
    settingsPath,
    exists,
    alreadyInstalled: isInstalledForIde(settings, ide),
    desiredCommand: spec.hookEnforceCommand,
    sentinel: spec.hookEnforceSentinel,
    matcher: spec.hookEnforceMatcher
  };
}

/** Merge all peaks-managed hook entries into settings, preserving all other keys and hooks. */
function withHooksInstalledForIde(settings: Record<string, unknown>, ide: IdeId): Record<string, unknown> {
  const existingHooks = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks))
    ? (settings.hooks as Record<string, unknown>)
    : {};

  // Per-IDE entries may map to different events (Trae: both on beforeToolCall;
  // Claude: both on PreToolUse). Group by event so each event array is
  // independently merged.
  const ourByEvent = new Map<string, PeaksHookEntry[]>();
  for (const spec of resolveHookEntries(ide)) {
    const list = ourByEvent.get(spec.event) ?? [];
    list.push(spec);
    ourByEvent.set(spec.event, list);
  }

  const sentinels = resolveHookEntries(ide).map((e) => e.sentinel);
  const nextHooks: Record<string, unknown> = { ...existingHooks };

  for (const [eventKey, ourEntries] of ourByEvent) {
    const existing = readHookEntriesFromHooks(nextHooks, eventKey);
    const nonPeaks = existing.filter((entry) => !entryIsPeaksManaged(entry, sentinels));
    const ourFormatted: HookMatcherEntry[] = ourEntries.map((spec) => ({
      matcher: spec.matcher,
      hooks: [{ type: 'command', command: spec.command }]
    }));
    const merged = [...nonPeaks, ...ourFormatted];
    if (merged.length > 0) {
      nextHooks[eventKey] = merged;
    } else {
      delete nextHooks[eventKey];
    }
  }
  return {
    ...settings,
    hooks: nextHooks
  };
}

export function applyHookInstall(scope: HookScope, projectRoot?: string, options?: HookInstallOptions): HookInstallResult {
  const ide = resolveIde(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readJsonObjectFile(settingsPath) : {};
  const spec = resolveHookSpec(ide);
  const baseResult: HookInstallPlan = {
    scope,
    settingsPath,
    exists,
    alreadyInstalled: isInstalledForIde(settings, ide),
    desiredCommand: spec.hookEnforceCommand,
    sentinel: spec.hookEnforceSentinel,
    matcher: spec.hookEnforceMatcher
  };
  if (baseResult.alreadyInstalled) {
    return { ...baseResult, applied: false };
  }
  atomicWriteJson(settingsPath, withHooksInstalledForIde(settings, ide));
  return { ...baseResult, alreadyInstalled: false, applied: true };
}

export function removeHookInstall(scope: HookScope, projectRoot?: string, options?: HookInstallOptions): HookRemoveResult {
  const ide = resolveIde(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  if (!existsSync(settingsPath)) {
    return { scope, settingsPath, removed: false };
  }
  const settings = readJsonObjectFile(settingsPath);

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const sentinels = resolveHookEntries(ide).map((e) => e.sentinel);
  const eventKeys = new Set(resolveHookEntries(ide).map((e) => e.event));
  let removedAny = false;
  const nextHooks: Record<string, unknown> = { ...existingHooks };
  for (const eventKey of eventKeys) {
    const entries = readHookEntriesFromHooks(nextHooks, eventKey);
    const kept = entries.filter((entry) => !entryIsPeaksManaged(entry, sentinels));
    if (kept.length !== entries.length) removedAny = true;
    if (kept.length > 0) {
      nextHooks[eventKey] = kept;
    } else {
      delete nextHooks[eventKey];
    }
  }

  const nextSettings: Record<string, unknown> = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }
  atomicWriteJson(settingsPath, nextSettings);
  return { scope, settingsPath, removed: removedAny };
}

export function readHookStatus(scope: HookScope, projectRoot?: string, options?: HookInstallOptions): HookStatus {
  const ide = resolveIde(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readJsonObjectFile(settingsPath) : {};
  return { scope, settingsPath, exists, installed: isInstalledForIde(settings, ide) };
}
