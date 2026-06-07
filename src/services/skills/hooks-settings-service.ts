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
  /**
   * Slice #013 (bugfix — peaks hooks install --no-progress): when `true`,
   * skip emitting the progress-start PreToolUse hook entry while still
   * installing the gate-enforce entry. The progress-start hook auto-spawns
   * a new terminal running `peaks progress watch`; with dispatch +
   * heartbeat (slice #009 + #010) that auto-spawn is dead weight. Default
   * `false` preserves the pre-slice install shape (both entries). The
   * sentinel-based install is idempotent: re-running with `skipProgress:
   * true` over a settings.json that previously had the progress entry
   * installed will remove that entry. `uninstall` honors the same flag
   * so it can find and remove both entries when both are present and
   * only the gate-enforce entry when only the gate-enforce is present.
   *
   * Slice #014 (refactor — full removal of legacy progress-start surface):
   * the field is preserved for API stability, but the underlying
   * install only ever emits the gate-enforce entry. The progress-start
   * entry is no longer installed regardless of this flag's value. The
   * legacy `peaks progress start|watch|close` CLI surface is gone
   * (replaced by `peaks sub-agent dispatch|heartbeat|share`); the hook
   * entry would have been pointing at a `peaks progress start` that no
   * longer exists. The sentinel `peaks progress start` constant is still
   * exported (some tests + back-compat reads rely on it) but no new
   * hook entries use it.
   */
  readonly skipProgress?: boolean;
};

// --- Module-level defaults (claude-code) -----------------------------------
// These exports remain for backward compat — tests and downstream callers
// that only care about Claude Code can keep importing them. The per-IDE
// values are computed lazily inside each public function call.

/** Sentinel substring identifying a Claude-Code gate-enforce hook entry. */
export const HOOK_ENFORCE_SENTINEL = 'peaks gate enforce';

/** Default (claude-code) hook command — kept as a stable export for tests. */
export const HOOK_ENFORCE_COMMAND = `peaks gate enforce --project "\${CLAUDE_PROJECT_DIR}"`;

/**
 * Resolve the adapter + per-IDE values used to render the settings.json entries.
 * Each adapter that wants its own gate command (Trae uses `peaks hook handle`,
 * the new dispatcher) overrides the default here.
 */
interface ResolvedHookSpec {
  readonly hookEnforceCommand: string;
  readonly hookEnforceSentinel: string;
  readonly hookEnforceMatcher: string;
  readonly hookEnforceEvent: string;
}

function resolveHookSpec(ide: IdeId): ResolvedHookSpec {
  const adapter = getAdapter(ide);
  if (ide === 'claude-code') {
    return {
      hookEnforceCommand: `peaks gate enforce --project "\${${adapter.envVar}}"`,
      hookEnforceSentinel: HOOK_ENFORCE_SENTINEL,
      hookEnforceMatcher: adapter.toolMatcher, // 'Bash'
      hookEnforceEvent: adapter.hookEvent // 'PreToolUse'
    };
  }
  if (ide === 'trae') {
    return {
      hookEnforceCommand: `peaks hook handle --project "\${${adapter.envVar}}"`,
      hookEnforceSentinel: 'peaks hook handle',
      hookEnforceMatcher: adapter.toolMatcher, // 'terminal'
      hookEnforceEvent: adapter.hookEvent // 'beforeToolCall'
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

/** Slice #013: read the skipProgress opt-in flag. Slice #014: the underlying install no longer emits the progress-start entry, so the flag is effectively a no-op (kept for API stability). */
function resolveSkipProgress(options: HookInstallOptions | undefined): boolean {
  return options?.skipProgress === true;
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

/**
 * Slice #014: read the *actually-installed* peaks-managed hook entries
 * from a settings object. Replaces the pre-#014 `listInstalledEntriesForIde`
 * helper in `hooks-commands.ts`, which returned the IDE-EXPECTED list
 * (a hardcoded 2-entry array per adapter) rather than what was on disk.
 * That bug surfaced when slice #013's local cleanup installed
 * `peaks hooks install --no-progress` (gate-enforce only), but the
 * status command still reported `entries: [Bash, Task]` because the
 * helper didn't read the file.
 *
 * The new helper:
 *   1. reads each `hooks.<event>` array,
 *   2. filters to entries that are peaks-managed for the given IDE
 *      (matches the legacy sentinel set: gate-enforce + the no-longer-
 *      installed progress-start),
 *   3. returns one `{ matcher, sentinel }` row per entry, taking the
 *      FIRST matching sentinel per entry (entries have a single command
 *      handler in practice, but the loop tolerates multi-handler
 *      entries by taking the first match).
 *
 * Pre-#014 settings.json files that have a stale progress-start entry
 * will see it surface in the result. This is intentional: the status
 * command is the user's tool for "what is on disk right now", and
 * surfacing a stale entry is the only way the user can know to run
 * `peaks hooks install` (which now strips it) or `peaks hooks
 * uninstall` (which removes it).
 */
export function readInstalledEntriesFromSettings(
  settings: Record<string, unknown>,
  ide: IdeId
): ReadonlyArray<{ matcher: string; sentinel: string }> {
  const sentinels = resolveLegacySentinels(ide);
  // Walk every event key the settings file has, not just the
  // adapter-declared one. A pre-#014 install could have left a
  // progress-start entry on a different event than the gate-enforce
  // entry (Trae: both on beforeToolCall, but a stale install on a
  // future IDE could split them).
  const hooksRoot = settings.hooks;
  if (!hooksRoot || typeof hooksRoot !== 'object' || Array.isArray(hooksRoot)) return [];
  const result: { matcher: string; sentinel: string }[] = [];
  for (const eventKey of Object.keys(hooksRoot as Record<string, unknown>)) {
    const entries = readHookEntriesFromHooks(hooksRoot as Record<string, unknown>, eventKey);
    for (const entry of entries) {
      if (!entryIsPeaksManaged(entry, sentinels)) continue;
      const matcher = typeof entry.matcher === 'string' ? entry.matcher : '';
      // Find the first matching sentinel inside the entry's command
      // handlers. For each handler, find the first sentinel substring
      // it contains. We pick the first handler's first matching
      // sentinel (entries have a single command in practice).
      const firstHandler = Array.isArray(entry.hooks) ? entry.hooks[0] : undefined;
      const cmd = typeof firstHandler?.command === 'string' ? firstHandler.command : '';
      const sentinel = sentinels.find((s) => cmd.includes(s));
      if (matcher === '' || sentinel === undefined) continue;
      result.push({ matcher, sentinel });
    }
  }
  return result;
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
 *
 * Slice #013 (`--no-progress` flag): when `skipProgress` is true, the
 * progress-start entry is omitted from the returned list. Install with this
 * flag will (a) NOT emit the progress hook entry, and (b) will idempotently
 * remove any previously-installed progress entry (sentinel-based merge).
 *
 * Slice #014 (refactor — full removal): only the gate-enforce entry is
 * ever emitted. The `skipProgress` parameter is kept for API stability
 * but is a no-op — the returned list is always single-entry. The progress
 * entry's sentinel is included in the legacy sentinel set so uninstall
 * can find + remove any stale progress-start entry that an older
 * `peaks hooks install` may have written before this slice.
 */
function resolveHookEntries(ide: IdeId, _skipProgress = false): PeaksHookEntry[] {
  const spec = resolveHookSpec(ide);
  return [
    { sentinel: spec.hookEnforceSentinel, matcher: spec.hookEnforceMatcher, command: spec.hookEnforceCommand, event: spec.hookEnforceEvent }
  ];
}

/**
 * Legacy sentinel set used by uninstall + status to find and remove stale
 * progress-start entries written by pre-#014 installs. The progress-start
 * sentinel is the literal substring that older installs emitted.
 */
const LEGACY_PROGRESS_START_SENTINEL = 'peaks progress start';

function resolveLegacySentinels(ide: IdeId): ReadonlyArray<string> {
 if (ide === 'trae') {
 return ['peaks hook handle', LEGACY_PROGRESS_START_SENTINEL];
 }
 return [HOOK_ENFORCE_SENTINEL, LEGACY_PROGRESS_START_SENTINEL];
}



/** Default (claude-code) peaks-managed hook entries — kept as a stable export for tests. Slice #014: only the gate-enforce entry. */
export const PEAKS_HOOK_ENTRIES: ReadonlyArray<PeaksHookEntry> = (() => {
  const spec = resolveHookSpec('claude-code');
  return [
    { sentinel: spec.hookEnforceSentinel, matcher: spec.hookEnforceMatcher, command: spec.hookEnforceCommand, event: spec.hookEnforceEvent }
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

/**
 * Slice #014: detect the "stale progress entry after pre-#014 install"
 * case. The desired shape is gate-enforce-only. If the file currently
 * has a peaks-managed progress-start entry (left behind by a pre-#014
 * install), the install is NOT a no-op — it must strip the stale
 * entry. This helper returns true exactly when the desired shape is
 * fully reflected on disk: gate-enforce present AND no legacy
 * progress-start present.
 */
function shapeMatchesDesired(settings: Record<string, unknown>, ide: IdeId): boolean {
  const desiredEntries = resolveHookEntries(ide);
  const desiredSentinels = new Set(desiredEntries.map((e) => e.sentinel));
  const allPeaksSentinels = resolveLegacySentinels(ide);
  const eventKeys = new Set(resolveHookEntries(ide).map((e) => e.event));
  for (const eventKey of eventKeys) {
    const present = readHookEventEntries(settings, eventKey);
    const peaksPresent = present.filter((e) => entryIsPeaksManaged(e, allPeaksSentinels));
    // (a) every peaks-managed entry currently on disk must match the
    //     desired sentinel set (no stale entries the caller wants removed).
    for (const entry of peaksPresent) {
      const entrySentinels = (entry.hooks ?? []).map((h) => allPeaksSentinels.find((s) => String(h.command ?? '').includes(s))).filter((s): s is string => Boolean(s));
      if (entrySentinels.some((s) => !desiredSentinels.has(s))) {
        return false;
      }
    }
    // (b) every desired entry must be on disk.
    for (const sentinel of desiredSentinels) {
      const has = peaksPresent.some((entry) => (entry.hooks ?? []).some((h) => String(h.command ?? '').includes(sentinel)));
      if (!has) return false;
    }
  }
  return true;
}

export function planHookInstall(scope: HookScope, projectRoot?: string, options?: HookInstallOptions): HookInstallPlan {
  const ide = resolveIde(options);
  const _skipProgress = resolveSkipProgress(options);
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
function withHooksInstalledForIde(settings: Record<string, unknown>, ide: IdeId, _skipProgress = false): Record<string, unknown> {
  const existingHooks = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks))
    ? (settings.hooks as Record<string, unknown>)
    : {};

  // Per-IDE entries may map to different events (Trae: gate-enforce on
  // beforeToolCall; Claude: gate-enforce on PreToolUse). Group by event
  // so each event array is independently merged.
  const ourByEvent = new Map<string, PeaksHookEntry[]>();
  for (const spec of resolveHookEntries(ide)) {
    const list = ourByEvent.get(spec.event) ?? [];
    list.push(spec);
    ourByEvent.set(spec.event, list);
  }

  // Slice #014: the legacy sentinel set includes the progress-start
  // sentinel so a pre-#014 install's stale progress-start entry is
  // stripped by the filter (the file converges on the new
  // gate-enforce-only shape, idempotently). The desired set (passed
  // in below) only contains the gate-enforce sentinel.
  const allSentinels = resolveLegacySentinels(ide);
  const nextHooks: Record<string, unknown> = { ...existingHooks };

  for (const [eventKey, ourEntries] of ourByEvent) {
    const existing = readHookEntriesFromHooks(nextHooks, eventKey);
    const nonPeaks = existing.filter((entry) => !entryIsPeaksManaged(entry, allSentinels));
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
  const _skipProgress = resolveSkipProgress(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readJsonObjectFile(settingsPath) : {};
  const spec = resolveHookSpec(ide);
  // Slice #014: `alreadyInstalled` reflects the FULL desired shape
  // (gate-enforce-only + no stale progress-start entry). Pre-#014
  // installs that left a progress-start entry behind will be treated
  // as not-yet-installed, so the merge strips the stale entry on the
  // next install call. This is the only path that converges the file
  // on the new shape; pure presence-checks are insufficient.
  const alreadyInstalled = shapeMatchesDesired(settings, ide);
  const baseResult: HookInstallPlan = {
    scope,
    settingsPath,
    exists,
    alreadyInstalled,
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
  // Slice #014: uninstall must remove the gate-enforce entry AND any
  // legacy progress-start entry that a pre-#014 install left behind.
  // The legacy sentinel set covers both shapes so the uninstall
  // converges the file on "no peaks-managed entries", regardless of
  // what shape the file was in when the user ran uninstall.
  const sentinels = resolveLegacySentinels(ide);
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
