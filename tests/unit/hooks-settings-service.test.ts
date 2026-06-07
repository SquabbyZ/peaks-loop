import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  applyHookInstall,
  HOOK_ENFORCE_SENTINEL,
   PEAKS_HOOK_ENTRIES,
  planHookInstall,
  readHookStatus,
  readInstalledEntriesFromSettings,
  removeHookInstall
} from '../../src/services/skills/hooks-settings-service.js';
import {
  _resetAdaptersForTesting,
  _setAdapterForTesting
} from '../../src/services/ide/ide-registry.js';
import type { IdeAdapter } from '../../src/services/ide/ide-types.js';

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
  test('installs ONLY the gate-enforce (Bash) entry into an empty/absent settings file (slice #014)', async () => {
    // Slice #014: the install no longer emits a progress-start entry.
    // Only the gate-enforce entry is written.
    const result = applyHookInstall('project', project);
    expect(result.applied).toBe(true);
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(PEAKS_HOOK_ENTRIES.length);
    expect(PEAKS_HOOK_ENTRIES).toHaveLength(1);
    expect(pre[0]?.matcher).toBe('Bash');
    expect(pre[0]?.hooks[0]?.command).toContain(HOOK_ENFORCE_SENTINEL);
  });

  test('is idempotent — a second install does not duplicate', async () => {
    applyHookInstall('project', project);
    const second = applyHookInstall('project', project);
    expect(second.applied).toBe(false);
    const pre = (await readSettings()).hooks as { PreToolUse: unknown[] };
    expect(pre.PreToolUse).toHaveLength(PEAKS_HOOK_ENTRIES.length);
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
    // existing Write + our 1 peaks-managed entry (Bash gate-enforce)
    expect(hooks.PreToolUse).toHaveLength(1 + PEAKS_HOOK_ENTRIES.length);
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

  test('uninstall strips a legacy progress-start entry (pre-#014 install leftover) (slice #014)', async () => {
    // Seed a settings.json that has BOTH the gate-enforce entry (added
    // by this slice) AND a stale progress-start entry (added by a
    // pre-#014 install). The uninstall must strip both.
    await writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] },
          { matcher: 'Task', hooks: [{ type: 'command', command: 'peaks progress start --project "${CLAUDE_PROJECT_DIR}" --reason "auto-spawn for sub-agent Task" --quiet' }] }
        ]
      }
    });
    const removed = removeHookInstall('project', project);
    expect(removed.removed).toBe(true);
    const settings = await readSettings();
    expect(settings.hooks).toBeUndefined();
  });
});

/**
 * Slice #014 (refactor — full removal of legacy progress-start
 * surface): the only emitted entry is the gate-enforce entry. The
 * `subAgentToolMatcher` field is gone from `IdeAdapter`. These
 * tests guard the install shape per IDE.
 */
describe('slice 014: install shape is gate-enforce only (legacy progress-start surface deleted)', () => {
  test('claude-code install writes ONLY the Bash gate-enforce entry (no Task / progress-start entry)', async () => {
    applyHookInstall('project', project, { ide: 'claude-code' });
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]?.matcher).toBe('Bash');
    expect(pre[0]?.hooks[0]?.command).toContain(HOOK_ENFORCE_SENTINEL);
    // The Task progress-start entry must NOT be in the file.
    expect(pre.some((e) => e.matcher === 'Task')).toBe(false);
  });

  test('trae install writes ONLY the terminal hook-handle entry (no Task / progress-start entry)', async () => {
    await mkdir(join(project, '.trae'), { recursive: true });
    applyHookInstall('project', project, { ide: 'trae' });
    const settings = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as Record<string, unknown>;
    const before = (settings.hooks as { beforeToolCall: { matcher: string; hooks: { command: string }[] }[] }).beforeToolCall;
    expect(before).toBeDefined();
    expect(before).toHaveLength(1);
    expect(before[0]?.matcher).toBe('terminal');
    // The Task progress-start entry must NOT be in the file.
    expect(before.some((e) => e.matcher === 'Task')).toBe(false);
  });
});

/**
 * Slice #014: pre-#014 installs that left a progress-start entry
 * behind must be stripped by the next install (idempotent converge
 * on the new shape). The `shapeMatchesDesired` check is the only
 * path that catches this.
 */
describe('slice 014: pre-#014 install converges on the new shape', () => {
  test('install over a settings.json that has a legacy progress-start entry STRIPS it', async () => {
    // Seed a pre-#014-shaped settings.json: both gate-enforce AND progress-start.
    await writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] },
          { matcher: 'Task', hooks: [{ type: 'command', command: 'peaks progress start --project "${CLAUDE_PROJECT_DIR}" --reason "auto-spawn for sub-agent Task" --quiet' }] }
        ]
      }
    });
    const result = applyHookInstall('project', project, { ide: 'claude-code' });
    // The install is NOT a no-op: the file had a stale progress-start
    // entry, the desired shape is gate-enforce-only.
    expect(result.applied).toBe(true);
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]?.matcher).toBe('Bash');
    expect(pre[0]?.hooks[0]?.command).toContain(HOOK_ENFORCE_SENTINEL);
  });
});

/**
 * Slice #014 (Part A — status command fix): the new
 * `readInstalledEntriesFromSettings` helper reads the ACTUAL
 * settings.json and returns the on-disk peaks-managed entries. The
 * pre-#014 `listInstalledEntriesForIde` returned the IDE-EXPECTED
 * list and was a silent misreport on every status invocation that
 * ran against a `--no-progress` install (or, post-#014, against
 * the default install).
 */
describe('slice 014: readInstalledEntriesFromSettings reads actual on-disk entries', () => {
  test('returns the gate-enforce entry when it is the only peaks-managed entry', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] }
        ]
      }
    };
    const entries = readInstalledEntriesFromSettings(settings, 'claude-code');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ matcher: 'Bash', sentinel: 'peaks gate enforce' });
  });

  test('returns BOTH the gate-enforce AND a stale legacy progress-start entry (pre-#014 install leftover)', () => {
    // The pre-#014 shape had both entries. The status command must
    // report the actual on-disk shape (so the user can see the stale
    // entry and run `peaks hooks install` to strip it).
    const settings: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] },
          { matcher: 'Task', hooks: [{ type: 'command', command: 'peaks progress start --project "${CLAUDE_PROJECT_DIR}" --reason "auto-spawn for sub-agent Task" --quiet' }] }
        ]
      }
    };
    const entries = readInstalledEntriesFromSettings(settings, 'claude-code');
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.sentinel === 'peaks gate enforce')).toBeDefined();
    expect(entries.find((e) => e.sentinel === 'peaks progress start')).toBeDefined();
  });

  test('returns empty when the file has no peaks-managed entries', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }
        ]
      }
    };
    const entries = readInstalledEntriesFromSettings(settings, 'claude-code');
    expect(entries).toHaveLength(0);
  });

  test('returns empty when the file has no `hooks` key at all', () => {
    const entries = readInstalledEntriesFromSettings({}, 'claude-code');
    expect(entries).toHaveLength(0);
  });
});
