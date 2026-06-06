import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  applyHookInstall,
  HOOK_ENFORCE_SENTINEL,
  HOOK_PROGRESS_SENTINEL,
  PEAKS_HOOK_ENTRIES,
  planHookInstall,
  readHookStatus,
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
  test('installs both gate-enforce (Bash) and progress-start (Task) entries into an empty/absent settings file', async () => {
    const result = applyHookInstall('project', project);
    expect(result.applied).toBe(true);
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(PEAKS_HOOK_ENTRIES.length);
    const matchers = pre.map((entry) => entry.matcher);
    expect(matchers).toContain('Bash');
    expect(matchers).toContain('Task');
    const bashEntry = pre.find((entry) => entry.matcher === 'Bash');
    expect(bashEntry?.hooks[0]?.command).toContain(HOOK_ENFORCE_SENTINEL);
    const taskEntry = pre.find((entry) => entry.matcher === 'Task');
    expect(taskEntry?.hooks[0]?.command).toContain(HOOK_PROGRESS_SENTINEL);
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
    // existing Write + our 2 peaks-managed entries (Bash gate-enforce + Task progress-start)
    expect(hooks.PreToolUse).toHaveLength(1 + PEAKS_HOOK_ENTRIES.length);
    expect(hooks.PreToolUse.some((e) => e.matcher === 'Write')).toBe(true);
    expect(hooks.PreToolUse.some((e) => e.matcher === 'Bash')).toBe(true);
    expect(hooks.PreToolUse.some((e) => e.matcher === 'Task')).toBe(true);
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

/**
 * Slice 2026-06-06-sub-agent-spawn-bug-and-decouple — sub-agent tool
 * matcher is no longer hardcoded to 'Task' in `resolveHookSpec`. Each
 * adapter self-reports its sub-agent tool name via `IdeAdapter.
 * subAgentToolMatcher`. The settings.json output is verified by reading
 * the file after a per-IDE install: the PreToolUse (Claude) or
 * beforeToolCall (Trae) entry's `matcher` must match the adapter's
 * declared sub-agent tool name.
 */
describe('slice 2026-06-06: per-IDE subAgentToolMatcher drives the progress hook matcher', () => {
  beforeEach(() => {
    _resetAdaptersForTesting();
  });
  afterEach(() => {
    _resetAdaptersForTesting();
  });

  test('claude-code adapter: progress hook entry uses matcher="Task" (from adapter.subAgentToolMatcher)', async () => {
    applyHookInstall('project', project, { ide: 'claude-code' });
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    const taskEntry = pre.find((e) => e.matcher === 'Task');
    expect(taskEntry).toBeDefined();
    expect(taskEntry?.hooks[0]?.command).toContain(HOOK_PROGRESS_SENTINEL);
    // Sanity: the Bash gate-enforce entry is still there (uses adapter.toolMatcher, not subAgentToolMatcher).
    const bashEntry = pre.find((e) => e.matcher === 'Bash');
    expect(bashEntry).toBeDefined();
  });

  test('trae adapter: progress hook entry uses matcher="Task" (UNVERIFIED but matches current byte-level output)', async () => {
    // Trae settings live at .trae/settings.json (not .claude/). Re-point
    // the helper at a .trae file by installing with ide="trae" and
    // pointing the readSettings at the new path.
    await mkdir(join(project, '.trae'), { recursive: true });
    applyHookInstall('project', project, { ide: 'trae' });
    const settings = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as Record<string, unknown>;
    const before = (settings.hooks as { beforeToolCall: { matcher: string; hooks: { command: string }[] }[] }).beforeToolCall;
    expect(before).toBeDefined();
    // Trae uses 'terminal' for the gate-enforce entry and 'Task' for the
    // progress entry. Both are adapter-driven (subAgentToolMatcher='Task').
    const progressEntry = before.find((e) => e.matcher === 'Task');
    expect(progressEntry).toBeDefined();
    expect(progressEntry?.hooks[0]?.command).toContain(HOOK_PROGRESS_SENTINEL);
    const enforceEntry = before.find((e) => e.matcher === 'terminal');
    expect(enforceEntry).toBeDefined();
  });

  test('fake adapter with subAgentToolMatcher: "SubAgent" produces matcher="SubAgent" (no hooks-settings-service change needed)', async () => {
    // This is the AC-14 contract: a future adapter (codex / cursor / qoder /
    // tongyi-lingma) registers a custom subAgentToolMatcher, and the
    // resolveHookSpec consumer picks it up without further code changes.
    const fakeAdapter: IdeAdapter = {
      id: 'claude-code', // re-use the registered id slot for the test seam
      displayName: 'fake-future-ide',
      settings: {
        dirName: '.claude',
        settingsFileName: 'settings.json',
        resolveSettingsFile: (scope, projectRoot) => {
          const root = scope === 'global' ? '/home/x' : (projectRoot ?? '/home/x');
          return join(root, '.claude', 'settings.json');
        },
        supportsScope: () => true
      },
      envVar: 'CLAUDE_PROJECT_DIR',
      hookEvent: 'PreToolUse',
      toolMatcher: 'Bash',
      subAgentToolMatcher: 'SubAgent', // <- the new field under test
      subAgentDispatcher: { label: 'fake', supportsRole: () => false, buildToolCall: () => ({ name: 'subagent', args: {} }) },
      installHints: [],
      capabilities: { gateEnforce: true, progressStart: true, statusline: false, mcpInstall: false }
    };
    _setAdapterForTesting('claude-code', fakeAdapter);
    applyHookInstall('project', project, { ide: 'claude-code' });
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string }[] }).PreToolUse;
    const subAgentEntry = pre.find((e) => e.matcher === 'SubAgent');
    expect(subAgentEntry).toBeDefined();
    // The legacy 'Task' matcher is no longer present.
    expect(pre.some((e) => e.matcher === 'Task')).toBe(false);
  });
});
