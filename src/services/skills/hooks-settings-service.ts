import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Installs (and removes) the Peaks gate-enforcement PreToolUse hook in a Claude
 * Code settings.json. The hook runs `peaks gate enforce` before every Bash call;
 * when a SOP guard's gates fail it returns `permissionDecision: "deny"`, which
 * blocks the tool call BEFORE Claude Code's permission checks — making the gate
 * un-bypassable by the agent (it holds even under --dangerously-skip-permissions).
 *
 * Installation is an EXPLICIT user command (never postinstall): skills describe,
 * the CLI performs side effects. Writes preserve all other settings keys and any
 * other hooks, reject symlinked targets, and use an atomic rename so a partial
 * write can never corrupt the settings file. Our entry is merged into (not
 * replacing) the existing `hooks.PreToolUse` array and is identified by a
 * sentinel substring in its command, so install is idempotent and uninstall
 * removes only our own entry.
 */

export type HookScope = 'project' | 'global';

/** The hook command written into settings. `${CLAUDE_PROJECT_DIR}` is injected by Claude Code. */
export const HOOK_ENFORCE_COMMAND = 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"';
/** Substring that identifies a Peaks-managed PreToolUse hook entry. */
export const HOOK_SENTINEL = 'peaks gate enforce';
const HOOK_MATCHER = 'Bash';

export type HookInstallPlan = {
  scope: HookScope;
  settingsPath: string;
  exists: boolean;
  alreadyInstalled: boolean;
  desiredCommand: string;
};

export type HookInstallResult = HookInstallPlan & { applied: boolean };
export type HookRemoveResult = { scope: HookScope; settingsPath: string; removed: boolean };
export type HookStatus = { scope: HookScope; settingsPath: string; exists: boolean; installed: boolean };

type HookHandler = { type?: string; command?: string };
type HookMatcherEntry = { matcher?: string; hooks?: HookHandler[] };

function isInsidePath(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveSettingsRoot(scope: HookScope, projectRoot: string | undefined): string {
  if (scope === 'global') return resolve(homedir());
  if (!projectRoot) {
    throw new Error('Project scope requires a project root');
  }
  return resolve(projectRoot);
}

function resolveSettingsPath(scope: HookScope, projectRoot: string | undefined): string {
  return join(resolveSettingsRoot(scope, projectRoot), '.claude', 'settings.json');
}

function assertSafeSettingsPath(scope: HookScope, root: string, settingsPath: string): void {
  const claudeDir = join(root, '.claude');
  if (existsSync(claudeDir) && lstatSync(claudeDir).isSymbolicLink()) {
    throw new Error('.claude directory must not be a symlink');
  }
  if (existsSync(settingsPath)) {
    if (lstatSync(settingsPath).isSymbolicLink()) {
      throw new Error('settings.json must not be a symlink');
    }
    const realRoot = realpathSync(root);
    if (!isInsidePath(realpathSync(settingsPath), realRoot)) {
      throw new Error(`settings.json must stay inside the ${scope} root`);
    }
  }
}

function readSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  const fd = openSync(settingsPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const raw = readFileSync(fd, 'utf8').trim();
    if (raw.length === 0) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings.json must contain a JSON object');
    }
    return parsed as Record<string, unknown>;
  } finally {
    closeSync(fd);
  }
}

function atomicWriteJson(settingsPath: string, settings: Record<string, unknown>): void {
  const dir = dirname(settingsPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.settings.${randomUUID()}.tmp`);
  const fd = openSync(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tempPath, settingsPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // best effort cleanup
    }
    throw error;
  }
}

/** Read the existing PreToolUse matcher entries (tolerant of any prior shape). */
function readPreToolUse(settings: Record<string, unknown>): HookMatcherEntry[] {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const pre = (hooks as Record<string, unknown>).PreToolUse;
  return Array.isArray(pre) ? (pre as HookMatcherEntry[]) : [];
}

function entryIsPeaksManaged(entry: HookMatcherEntry): boolean {
  const handlers = Array.isArray(entry?.hooks) ? entry.hooks : [];
  return handlers.length > 0 && handlers.every((h) => typeof h?.command === 'string' && h.command.includes(HOOK_SENTINEL));
}

function isInstalled(settings: Record<string, unknown>): boolean {
  return readPreToolUse(settings).some(entryIsPeaksManaged);
}

export function planHookInstall(scope: HookScope, projectRoot?: string): HookInstallPlan {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPath(scope, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = readSettings(settingsPath);
  return { scope, settingsPath, exists, alreadyInstalled: isInstalled(settings), desiredCommand: HOOK_ENFORCE_COMMAND };
}

/** Merge our PreToolUse entry into settings, preserving all other keys and hooks. */
function withHookInstalled(settings: Record<string, unknown>): Record<string, unknown> {
  const existingHooks = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks))
    ? (settings.hooks as Record<string, unknown>)
    : {};
  const preToolUse = readPreToolUse(settings);
  const ourEntry: HookMatcherEntry = { matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: HOOK_ENFORCE_COMMAND }] };
  return {
    ...settings,
    hooks: { ...existingHooks, PreToolUse: [...preToolUse, ourEntry] }
  };
}

export function applyHookInstall(scope: HookScope, projectRoot?: string): HookInstallResult {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPath(scope, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = readSettings(settingsPath);
  if (isInstalled(settings)) {
    return { scope, settingsPath, exists, alreadyInstalled: true, desiredCommand: HOOK_ENFORCE_COMMAND, applied: false };
  }
  atomicWriteJson(settingsPath, withHookInstalled(settings));
  return { scope, settingsPath, exists, alreadyInstalled: false, desiredCommand: HOOK_ENFORCE_COMMAND, applied: true };
}

export function removeHookInstall(scope: HookScope, projectRoot?: string): HookRemoveResult {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPath(scope, root, settingsPath);
  if (!existsSync(settingsPath)) {
    return { scope, settingsPath, removed: false };
  }
  const settings = readSettings(settingsPath);
  const preToolUse = readPreToolUse(settings);
  const kept = preToolUse.filter((entry) => !entryIsPeaksManaged(entry));
  if (kept.length === preToolUse.length) {
    return { scope, settingsPath, removed: false };
  }
  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const nextHooks: Record<string, unknown> = { ...existingHooks };
  if (kept.length > 0) {
    nextHooks.PreToolUse = kept;
  } else {
    delete nextHooks.PreToolUse;
  }
  const nextSettings: Record<string, unknown> = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }
  atomicWriteJson(settingsPath, nextSettings);
  return { scope, settingsPath, removed: true };
}

export function readHookStatus(scope: HookScope, projectRoot?: string): HookStatus {
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPath(scope, root, settingsPath);
  const exists = existsSync(settingsPath);
  const settings = exists ? readSettings(settingsPath) : {};
  return { scope, settingsPath, exists, installed: isInstalled(settings) };
}
