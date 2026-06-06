import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { assertSafeSettingsFile } from '../ide/shared/safe-path.js';
import { atomicWriteJson, readJsonObjectFile } from '../ide/shared/atomic-json.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { HookScope } from '../ide/shared/safe-path.js';

/**
 * Install (and remove) the Peaks gate-enforcement hook in a Claude Code
 * settings.json. The hook runs `peaks gate enforce` before every Bash call;
 * when a SOP guard's gates fail it returns `permissionDecision: "deny"`, which
 * blocks the tool call BEFORE Claude Code's permission checks — making the gate
 * un-bypassable by the agent (it holds even under --dangerously-skip-permissions).
 *
 * Slice #1 refactor: this service now delegates to the `IdeAdapter` for
 * `claude-code` (the only registered adapter in slice #1). Adapter provides
 * `dirName` / `settingsFileName` / `envVar` / `hookEvent` / `toolMatcher`. The
 * byte-level output is preserved (AC-1).
 *
 * Installation is an EXPLICIT user command (never postinstall): skills describe,
 * the CLI performs side effects. Writes preserve all other settings keys and
 * any other hooks, reject symlinked targets, and use an atomic rename so a
 * partial write can never corrupt the settings file. Our entry is merged into
 * (not replacing) the existing `hooks.PreToolUse` array and is identified by a
 * sentinel substring in its command, so install is idempotent and uninstall
 * removes only our own entry.
 */

export type { HookScope } from '../ide/shared/safe-path.js';

/** The hook command written into settings for the gate-enforce PreToolUse hook. `${CLAUDE_PROJECT_DIR}` is injected by Claude Code. */
const claudeAdapter = () => getAdapter('claude-code');
export const HOOK_ENFORCE_COMMAND = `peaks gate enforce --project "\${${claudeAdapter().envVar}}"`;
/**
 * Hook command for the sub-agent progress auto-spawn. Fires on every Task
 * tool call (the harness-enforced mechanism for "sub-agent dispatch"). The
 * command itself is non-blocking: `peaks progress start` is idempotent
 * (5-minute TTL on the spawn record) so the LLM does not see a fresh
 * terminal per Task. The `--quiet` flag keeps the LLM context clean — the
 * hook output otherwise adds ~500 tokens per Task call.
 */
export const HOOK_PROGRESS_COMMAND = `peaks progress start --project "\${${claudeAdapter().envVar}}" --reason "auto-spawn for sub-agent Task" --quiet`;
/** Substring that identifies a Peaks-managed PreToolUse gate-enforce hook entry. */
export const HOOK_ENFORCE_SENTINEL = 'peaks gate enforce';
/** Substring that identifies a Peaks-managed PreToolUse sub-agent-progress hook entry. */
export const HOOK_PROGRESS_SENTINEL = 'peaks progress start';

const HOOK_GATE_MATCHER = claudeAdapter().toolMatcher;
const HOOK_GATE_EVENT = claudeAdapter().hookEvent;
const HOOK_PROGRESS_MATCHER = 'Task';
const HOOK_PROGRESS_EVENT = 'PreToolUse';

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

function resolveSettingsPath(scope: HookScope, projectRoot: string | undefined): string {
  const root = resolveSettingsRoot(scope, projectRoot);
  const adapter = claudeAdapter();
  return adapter.settings.resolveSettingsFile(scope, scope === 'global' ? homedir() : projectRoot);
}

function assertSafeSettingsPathCompat(scope: HookScope, root: string, settingsPath: string): void {
  const adapter = claudeAdapter();
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

/** True when every command handler in the entry matches a known peaks sentinel. */
function entryIsPeaksManaged(entry: HookMatcherEntry): boolean {
  const handlers = Array.isArray(entry?.hooks) ? entry.hooks : [];
  if (handlers.length === 0) return false;
  return handlers.every((h) => {
    if (typeof h?.command !== 'string') return false;
    const cmd = h.command;
    return PEAKS_HOOK_SENTINELS.some((sentinel) => cmd.includes(sentinel));
  });
}

/** The substring sentinels that identify a Peaks-managed hook entry. */
const PEAKS_HOOK_SENTINELS: ReadonlyArray<string> = [HOOK_ENFORCE_SENTINEL, HOOK_PROGRESS_SENTINEL];

/** A typed descriptor for a single peaks-managed hook entry. */
export type PeaksHookEntry = {
  sentinel: string;
  matcher: string;
  command: string;
};

export const PEAKS_HOOK_ENTRIES: ReadonlyArray<PeaksHookEntry> = [
  { sentinel: HOOK_ENFORCE_SENTINEL, matcher: HOOK_GATE_MATCHER, command: HOOK_ENFORCE_COMMAND },
  { sentinel: HOOK_PROGRESS_SENTINEL, matcher: HOOK_PROGRESS_MATCHER, command: HOOK_PROGRESS_COMMAND }
];

function isInstalled(settings: Record<string, unknown>): boolean {
  // For Claude Code, both entries live in the same PreToolUse array. Check
  // both event keys for safety (matches the prior implementation).
  for (const eventKey of [HOOK_GATE_EVENT, HOOK_PROGRESS_EVENT]) {
    if (readHookEventEntries(settings, eventKey).some(entryIsPeaksManaged)) {
      return true;
    }
  }
  return false;
}

export function planHookInstall(scope: HookScope, projectRoot?: string): HookInstallPlan {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPathCompat(scope, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readJsonObjectFile(settingsPath) : {};
  return {
    scope,
    settingsPath,
    exists,
    alreadyInstalled: isInstalled(settings),
    desiredCommand: HOOK_ENFORCE_COMMAND,
    sentinel: HOOK_ENFORCE_SENTINEL,
    matcher: HOOK_GATE_MATCHER
  };
}

/** Merge all peaks-managed hook entries into settings, preserving all other keys and hooks. */
function withHooksInstalled(settings: Record<string, unknown>): Record<string, unknown> {
  const existingHooks = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks))
    ? (settings.hooks as Record<string, unknown>)
    : {};

  // Determine the eventKey for each of our entries. For Claude, both Bash and
  // Task entries live in PreToolUse (the same array). For future adapters
  // that split events (e.g. Trae might use beforeToolCall + subAgentStart),
  // each entry may map to a different eventKey.
  //
  // Strategy: group PEAKS_HOOK_ENTRIES by eventKey, then for each eventKey,
  // preserve non-peaks entries and append our entries.
  const nextHooks: Record<string, unknown> = { ...existingHooks };

  // Group our entries by eventKey. Default: every entry uses the adapter's
  // primary hookEvent (HOOK_GATE_EVENT). The second entry (progress) reuses
  // the same eventKey for Claude; future adapters may set a separate event.
  const ourByEvent = new Map<string, PeaksHookEntry[]>();
  for (const spec of PEAKS_HOOK_ENTRIES) {
    const eventKey = spec.matcher === HOOK_PROGRESS_MATCHER ? HOOK_PROGRESS_EVENT : HOOK_GATE_EVENT;
    const list = ourByEvent.get(eventKey) ?? [];
    list.push(spec);
    ourByEvent.set(eventKey, list);
  }

  for (const [eventKey, ourEntries] of ourByEvent) {
    const existing = readHookEntriesFromHooks(nextHooks, eventKey);
    const nonPeaks = existing.filter((entry) => !entryIsPeaksManaged(entry));
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

export function applyHookInstall(scope: HookScope, projectRoot?: string): HookInstallResult {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPathCompat(scope, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readJsonObjectFile(settingsPath) : {};
  if (isInstalled(settings)) {
    return { scope, settingsPath, exists, alreadyInstalled: true, desiredCommand: HOOK_ENFORCE_COMMAND, applied: false, sentinel: HOOK_ENFORCE_SENTINEL, matcher: HOOK_GATE_MATCHER };
  }
  atomicWriteJson(settingsPath, withHooksInstalled(settings));
  return { scope, settingsPath, exists, alreadyInstalled: false, desiredCommand: HOOK_ENFORCE_COMMAND, applied: true, sentinel: HOOK_ENFORCE_SENTINEL, matcher: HOOK_GATE_MATCHER };
}

export function removeHookInstall(scope: HookScope, projectRoot?: string): HookRemoveResult {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPathCompat(scope, root, settingsPath);
  if (!existsSync(settingsPath)) {
    return { scope, settingsPath, removed: false };
  }
  const settings = readJsonObjectFile(settingsPath);

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  let removedAny = false;
  const nextHooks: Record<string, unknown> = { ...existingHooks };
  for (const eventKey of [HOOK_GATE_EVENT, HOOK_PROGRESS_EVENT]) {
    const entries = readHookEntriesFromHooks(nextHooks, eventKey);
    const kept = entries.filter((entry) => !entryIsPeaksManaged(entry));
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

export function readHookStatus(scope: HookScope, projectRoot?: string): HookStatus {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPathCompat(scope, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readJsonObjectFile(settingsPath) : {};
  return { scope, settingsPath, exists, installed: isInstalled(settings) };
}
