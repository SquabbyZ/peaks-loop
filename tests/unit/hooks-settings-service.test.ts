import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  applyHookInstall,
  planHookInstall,
  readHookStatus,
  removeHookInstall,
  HOOK_SENTINEL
} from '../../src/services/skills/hooks-settings-service.js';

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'peaks-hooks-'));
});

afterEach(() => { /* tmp dirs are disposable */ });

function settingsPath(): string {
  return join(project, '.claude', 'settings.json');
}
async function writeSettings(value: unknown): Promise<void> {
  await mkdir(join(project, '.claude'), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(value, null, 2), 'utf8');
}
async function readSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>;
}

describe('applyHookInstall', () => {
  test('installs into an empty/absent settings file', async () => {
    const result = applyHookInstall('project', project);
    expect(result.applied).toBe(true);
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]!.matcher).toBe('Bash');
    expect(pre[0]!.hooks[0]!.command).toContain(HOOK_SENTINEL);
  });

  test('is idempotent — a second install does not duplicate', async () => {
    applyHookInstall('project', project);
    const second = applyHookInstall('project', project);
    expect(second.applied).toBe(false);
    const pre = (await readSettings()).hooks as { PreToolUse: unknown[] };
    expect(pre.PreToolUse).toHaveLength(1);
  });

  test('preserves other settings keys and other PreToolUse hooks', async () => {
    await writeSettings({
      model: 'sonnet',
      hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }], PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo post' }] }] }
    });
    applyHookInstall('project', project);
    const settings = await readSettings();
    expect(settings.model).toBe('sonnet');
    const hooks = settings.hooks as { PreToolUse: { matcher: string }[]; PostToolUse: unknown[] };
    expect(hooks.PreToolUse).toHaveLength(2); // existing Write + our Bash
    expect(hooks.PreToolUse.some((e) => e.matcher === 'Write')).toBe(true);
    expect(hooks.PreToolUse.some((e) => e.matcher === 'Bash')).toBe(true);
    expect(hooks.PostToolUse).toHaveLength(1); // untouched
  });

  test('rejects a symlinked settings.json', async () => {
    const real = await mkdtemp(join(tmpdir(), 'peaks-hooks-real-'));
    await mkdir(join(real, '.claude'), { recursive: true });
    await writeFile(join(real, '.claude', 'settings.json'), '{}', 'utf8');
    await mkdir(join(project, '.claude'), { recursive: true });
    try {
      await symlink(join(real, '.claude', 'settings.json'), settingsPath());
    } catch {
      return; // symlink not permitted on this platform (Windows w/o privilege) — skip
    }
    expect(() => applyHookInstall('project', project)).toThrow(/symlink/);
  });
});

describe('planHookInstall / readHookStatus', () => {
  test('dry-run reports not-yet-installed without writing', async () => {
    const plan = planHookInstall('project', project);
    expect(plan.alreadyInstalled).toBe(false);
    expect(existsSync(settingsPath())).toBe(false);
  });

  test('status reflects install state', async () => {
    expect(readHookStatus('project', project).installed).toBe(false);
    applyHookInstall('project', project);
    expect(readHookStatus('project', project).installed).toBe(true);
  });
});

describe('removeHookInstall', () => {
  test('removes only the peaks hook, keeping other hooks and keys', async () => {
    await writeSettings({ model: 'sonnet', hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }] } });
    applyHookInstall('project', project);
    const removed = removeHookInstall('project', project);
    expect(removed.removed).toBe(true);
    const settings = await readSettings();
    expect(settings.model).toBe('sonnet');
    const hooks = settings.hooks as { PreToolUse: { matcher: string }[] };
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse[0]!.matcher).toBe('Write');
  });

  test('drops the hooks key entirely when the peaks hook was the only content', async () => {
    applyHookInstall('project', project);
    removeHookInstall('project', project);
    const settings = await readSettings();
    expect(settings.hooks).toBeUndefined();
  });

  test('removing when not installed is a no-op', async () => {
    await writeSettings({ model: 'sonnet' });
    const removed = removeHookInstall('project', project);
    expect(removed.removed).toBe(false);
  });
});
