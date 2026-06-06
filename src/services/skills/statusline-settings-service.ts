import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { assertSafeSettingsFile, isInsidePath } from '../ide/shared/safe-path.js';
import { getAdapter } from '../ide/ide-registry.js';

/**
 * Installs (and removes) the Peaks statusLine entry in an IDE's settings
 * file. The settings file location is adapter-driven
 * (`getAdapter(ide).settings.dirName` + `settingsFileName`) so a future slice
 * adding a Trae / Cursor / Codex adapter does not need to touch this file.
 *
 * Slice #1 only registers claude-code, so the resolved path is still
 * `<root>/.claude/settings.json` — the same as before the refactor. The
 * statusLine entry is rendered as `{ type: 'command', command: 'peaks
 * statusline' }` because that is the shape Claude Code expects; future
 * adapters may need a different entry shape (e.g. Cursor's `statusBar`
 * field) and would override this in their adapter.
 *
 * Writes preserve all other settings keys, reject symlinked targets, and use an
 * atomic rename so a partial write can never corrupt an existing settings file.
 */

export type StatusLineScope = 'project' | 'global';

export type StatusLineSettingsPlan = {
  scope: StatusLineScope;
  settingsPath: string;
  exists: boolean;
  alreadyInstalled: boolean;
  conflict: boolean;
  conflictCommand: string | null;
  desiredCommand: string;
};

export type StatusLineSettingsResult = StatusLineSettingsPlan & {
  applied: boolean;
};

export const STATUSLINE_COMMAND = 'peaks statusline';

type StatusLineEntry = { type: string; command: string; padding?: number };

// Re-export the shared helper so existing consumers that imported
// `isInsidePath` from this module keep compiling.
export { isInsidePath };

function resolveSettingsRoot(scope: StatusLineScope, projectRoot: string | undefined): string {
  if (scope === 'global') return resolve(homedir());
  if (!projectRoot) {
    throw new Error('Project scope requires a project root');
  }
  return resolve(projectRoot);
}

/**
 * Resolve + safety-check the settings path for the given scope. The
 * `dirName` and `settingsFileName` come from the registered Claude adapter
 * (`getAdapter('claude-code')`) so the hardcoded `.claude/settings.json` is
 * gone — future adapters swap by changing the registry, not this file.
 */
function resolveAndAssertSettingsPath(
  scope: StatusLineScope,
  projectRoot: string | undefined
): { root: string; settingsPath: string } {
  const root = resolveSettingsRoot(scope, projectRoot);
  const adapter = getAdapter('claude-code');
  const { settingsPath } = assertSafeSettingsFile(
    scope,
    root,
    adapter.settings.dirName,
    adapter.settings.settingsFileName
  );
  return { root, settingsPath };
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

function extractExistingCommand(settings: Record<string, unknown>): string | null {
  const statusLine = settings.statusLine;
  if (statusLine && typeof statusLine === 'object' && !Array.isArray(statusLine)) {
    const command = (statusLine as Record<string, unknown>).command;
    if (typeof command === 'string') return command;
  }
  return null;
}

function buildPlan(scope: StatusLineScope, settingsPath: string, settings: Record<string, unknown>, exists: boolean): StatusLineSettingsPlan {
  const existingCommand = extractExistingCommand(settings);
  const alreadyInstalled = existingCommand !== null && existingCommand.includes(STATUSLINE_COMMAND);
  const conflict = existingCommand !== null && !alreadyInstalled;
  return {
    scope,
    settingsPath,
    exists,
    alreadyInstalled,
    conflict,
    conflictCommand: conflict ? existingCommand : null,
    desiredCommand: STATUSLINE_COMMAND
  };
}

export function planStatusLineInstall(scope: StatusLineScope, projectRoot?: string): StatusLineSettingsPlan {
  const { settingsPath } = resolveAndAssertSettingsPath(scope, projectRoot);
  const exists = existsSync(settingsPath);
  const settings = readSettings(settingsPath);
  return buildPlan(scope, settingsPath, settings, exists);
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

export function applyStatusLineInstall(scope: StatusLineScope, projectRoot?: string, options: { force?: boolean } = {}): StatusLineSettingsResult {
  const { settingsPath } = resolveAndAssertSettingsPath(scope, projectRoot);
  const exists = existsSync(settingsPath);
  const settings = readSettings(settingsPath);
  const plan = buildPlan(scope, settingsPath, settings, exists);

  if (plan.alreadyInstalled) {
    return { ...plan, applied: false };
  }
  if (plan.conflict && !options.force) {
    return { ...plan, applied: false };
  }

  const entry: StatusLineEntry = { type: 'command', command: STATUSLINE_COMMAND, padding: 0 };
  const nextSettings: Record<string, unknown> = { ...settings, statusLine: entry };
  atomicWriteJson(settingsPath, nextSettings);
  return { ...plan, applied: true };
}

export function removeStatusLineInstall(scope: StatusLineScope, projectRoot?: string): { scope: StatusLineScope; settingsPath: string; removed: boolean } {
  const { settingsPath } = resolveAndAssertSettingsPath(scope, projectRoot);
  if (!existsSync(settingsPath)) {
    return { scope, settingsPath, removed: false };
  }
  const settings = readSettings(settingsPath);
  const existingCommand = extractExistingCommand(settings);
  if (existingCommand === null || !existingCommand.includes(STATUSLINE_COMMAND)) {
    return { scope, settingsPath, removed: false };
  }
  const { statusLine: _removed, ...rest } = settings;
  atomicWriteJson(settingsPath, rest);
  return { scope, settingsPath, removed: true };
}

// Suppress unused-import warning for `isAbsolute` if it becomes unused in
// future refactors. The pre-refactor file used it in the local isInsidePath;
// the shared helper owns that logic now.
void isAbsolute;
