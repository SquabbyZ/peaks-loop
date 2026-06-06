import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { TRAE_ADAPTER } from '../../../src/services/ide/adapters/trae-adapter.js';
import { _resetAdaptersForTesting, getAdapter, listAdapterIds } from '../../../src/services/ide/ide-registry.js';
import {
  applyHookInstall,
  planHookInstall,
  readHookStatus,
  removeHookInstall
} from '../../../src/services/skills/hooks-settings-service.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('TRAE_ADAPTER — identity fields', () => {
  test('id is "trae"', () => {
    expect(TRAE_ADAPTER.id).toBe('trae');
  });

  test('displayName is "Trae"', () => {
    expect(TRAE_ADAPTER.displayName).toBe('Trae');
  });

  test('envVar is TRAE_PROJECT_DIR (used for ${...} placeholder substitution)', () => {
    expect(TRAE_ADAPTER.envVar).toBe('TRAE_PROJECT_DIR');
  });

  test('hookEvent is beforeToolCall (Trae uses Cursor-style pre-tool events)', () => {
    expect(TRAE_ADAPTER.hookEvent).toBe('beforeToolCall');
  });

  test('toolMatcher is "terminal" (Trae\'s shell command matcher)', () => {
    expect(TRAE_ADAPTER.toolMatcher).toBe('terminal');
  });

  test('installHints mention restarting Trae so hooks take effect', () => {
    expect(TRAE_ADAPTER.installHints.length).toBeGreaterThan(0);
    expect(TRAE_ADAPTER.installHints.join(' ')).toMatch(/restart|reload/i);
  });
});

describe('TRAE_ADAPTER — capabilities', () => {
  test('gateEnforce is true (per the PRD R-2 hard rule — every adapter enforces gates)', () => {
    expect(TRAE_ADAPTER.capabilities.gateEnforce).toBe(true);
  });

  test('progressStart and statusline are enabled in slice #2', () => {
    expect(TRAE_ADAPTER.capabilities.progressStart).toBe(true);
    expect(TRAE_ADAPTER.capabilities.statusline).toBe(true);
  });

  test('mcpInstall is disabled for Trae (Trae MCP integration is unverified at slice time)', () => {
    // This is the safe default until a Trae user dogfoodes the MCP apply path.
    // Slice #1 RD marked MCP as a future slice; the Trae adapter is conservative.
    expect(TRAE_ADAPTER.capabilities.mcpInstall).toBe(false);
  });
});

describe('TRAE_ADAPTER — settings location', () => {
  test('dirName is ".trae"', () => {
    expect(TRAE_ADAPTER.settings.dirName).toBe('.trae');
  });

  test('settingsFileName is "settings.json" (Trae follows Claude-style file naming; verify when Trae docs land)', () => {
    expect(TRAE_ADAPTER.settings.settingsFileName).toBe('settings.json');
  });

  test('supportsScope returns true for both project and global', () => {
    expect(TRAE_ADAPTER.settings.supportsScope('project')).toBe(true);
    expect(TRAE_ADAPTER.settings.supportsScope('global')).toBe(true);
  });

  test('resolveSettingsFile("global", _) returns <homedir>/.trae/settings.json', () => {
    const resolved = TRAE_ADAPTER.settings.resolveSettingsFile('global', undefined);
    const expected = join(resolve(homedir()), '.trae', 'settings.json');
    expect(resolved).toBe(expected);
  });

  test('resolveSettingsFile("project", root) returns <root>/.trae/settings.json', () => {
    const root = resolve('C:/Users/me/projects/foo');
    const resolved = TRAE_ADAPTER.settings.resolveSettingsFile('project', root);
    expect(resolved).toBe(join(root, '.trae', 'settings.json'));
  });
});

describe('TRAE_ADAPTER — registry integration', () => {
  test('production registry lists trae alongside claude-code in insertion order', () => {
    expect(listAdapterIds()).toEqual(['claude-code', 'trae']);
  });

  test('getAdapter("trae") returns the Trae adapter instance', () => {
    const got = getAdapter('trae');
    expect(got.id).toBe('trae');
    expect(got.envVar).toBe('TRAE_PROJECT_DIR');
    expect(got.toolMatcher).toBe('terminal');
  });

  test('getAdapter("trae") and getAdapter("claude-code") return different instances', () => {
    const trae = getAdapter('trae');
    const claude = getAdapter('claude-code');
    expect(trae).not.toBe(claude);
    expect(trae.id).toBe('trae');
    expect(claude.id).toBe('claude-code');
  });
});

/**
 * Slice #3 closeout: prove the per-IDE install dispatch actually writes a
 * Trae-shaped settings.json (not a Claude-shaped one) when the user passes
 * `{ ide: 'trae' }`. This is the test that fails-fast if a future refactor
 * regresses the slice #2 architectural promise that "fill the table =
 * new IDE" actually means "new IDE gets its own settings.json layout".
 */
describe('peaks hooks install — Trae integration (slice #3 closeout)', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-trae-install-'));
  });
  afterEach(() => {
    _resetAdaptersForTesting();
  });

  test('applyHookInstall with { ide: "trae" } writes to <root>/.trae/settings.json, not .claude', async () => {
    const result = applyHookInstall('project', project, { ide: 'trae' });
    expect(result.applied).toBe(true);
    expect(result.settingsPath).toBe(join(project, '.trae', 'settings.json'));
    // The Claude path must NOT have been written.
    const claudePath = join(project, '.claude', 'settings.json');
    const { existsSync } = await import('node:fs');
    expect(existsSync(claudePath)).toBe(false);
  });

  test('Trae install uses "beforeToolCall" event key, not "PreToolUse"', async () => {
    applyHookInstall('project', project, { ide: 'trae' });
    const settings = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as { hooks: Record<string, unknown[]> };
    // The Trae install should use beforeToolCall (not PreToolUse / UserPromptSubmit).
    expect(settings.hooks).toHaveProperty('beforeToolCall');
    const beforeToolCall = settings.hooks.beforeToolCall ?? [];
    expect(beforeToolCall.length).toBeGreaterThan(0);
    // The Claude event key must NOT be present.
    expect(settings.hooks).not.toHaveProperty('PreToolUse');
  });

  test('Trae install uses "terminal" matcher (not "Bash") and TRAE_PROJECT_DIR env var', async () => {
    applyHookInstall('project', project, { ide: 'trae' });
    const settings = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as { hooks: { beforeToolCall: { matcher: string; hooks: { command: string }[] }[] } };
    const entries = settings.hooks.beforeToolCall ?? [];
    const matchers = entries.map((entry) => entry.matcher);
    expect(matchers).toContain('terminal');
    expect(matchers).not.toContain('Bash');
    // Every command must reference ${TRAE_PROJECT_DIR}, not ${CLAUDE_PROJECT_DIR}.
    for (const entry of entries) {
      for (const handler of entry.hooks) {
        expect(handler.command).toContain('${TRAE_PROJECT_DIR}');
        expect(handler.command).not.toContain('${CLAUDE_PROJECT_DIR}');
      }
    }
  });

  test('Trae install preserves a pre-existing settings.json (third-party fields untouched)', async () => {
    // Pre-populate a third-party field to verify preservation.
    await mkdir(join(project, '.trae'), { recursive: true });
    await writeFile(
      join(project, '.trae', 'settings.json'),
      JSON.stringify({ model: 'sonnet', existingField: 'preserved' }, null, 2),
      'utf8'
    );
    applyHookInstall('project', project, { ide: 'trae' });
    const settings = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as { model: string; existingField: string; hooks: unknown };
    expect(settings.model).toBe('sonnet');
    expect(settings.existingField).toBe('preserved');
    expect(settings.hooks).toBeDefined();
  });

  test('readHookStatus with { ide: "trae" } reports installed=true after a Trae install', async () => {
    applyHookInstall('project', project, { ide: 'trae' });
    const status = readHookStatus('project', project, { ide: 'trae' });
    expect(status.installed).toBe(true);
    expect(status.exists).toBe(true);
  });

  test('removeHookInstall with { ide: "trae" } removes only Trae entries (preserves the file if other keys exist)', async () => {
    applyHookInstall('project', project, { ide: 'trae' });
    const before = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as { hooks: Record<string, unknown> };
    expect(before.hooks.beforeToolCall).toBeDefined();
    const result = removeHookInstall('project', project, { ide: 'trae' });
    expect(result.removed).toBe(true);
    const after = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as { hooks?: Record<string, unknown> };
    expect(after.hooks).toBeUndefined();
  });

  test('Trae install plan reports the Trae-shaped desiredCommand and matcher', () => {
    const plan = planHookInstall('project', project, { ide: 'trae' });
    expect(plan.desiredCommand).toContain('peaks hook handle');
    expect(plan.desiredCommand).toContain('${TRAE_PROJECT_DIR}');
    expect(plan.matcher).toBe('terminal');
  });
});
