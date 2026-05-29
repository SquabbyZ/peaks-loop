import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Installs (and removes) the Peaks statusLine entry in a Claude Code
 * settings.json. The statusLine renders `peaks statusline` on every turn, giving
 * users an out-of-band, harness-painted signal of which Peaks skill is active —
 * independent of LLM tokens and immune to context compaction.
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

function isInsidePath(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveSettingsRoot(scope: StatusLineScope, projectRoot: string | undefined): string {
  if (scope === 'global') return resolve(homedir());
  if (!projectRoot) {
    throw new Error('Project scope requires a project root');
  }
  return resolve(projectRoot);
}

function resolveSettingsPath(scope: StatusLineScope, projectRoot: string | undefined): string {
  const root = resolveSettingsRoot(scope, projectRoot);
  return join(root, '.claude', 'settings.json');
}

/** Reject symlinked .claude dir or settings file to prevent escape. */
function assertSafeSettingsPath(scope: StatusLineScope, root: string, settingsPath: string): void {
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
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPath(scope, root, settingsPath);
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
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPath(scope, root, settingsPath);
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
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, projectRoot);
  assertSafeSettingsPath(scope, root, settingsPath);
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
