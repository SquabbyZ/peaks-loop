import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { CURSOR_ADAPTER } from '../../../src/services/ide/adapters/cursor-adapter.js';
import { CLAUDE_CODE_ADAPTER } from '../../../src/services/ide/adapters/claude-code-adapter.js';
import { cursorSubAgentDispatcher } from '../../../src/services/dispatch/sub-agent-dispatcher.js';
import { _resetAdaptersForTesting, getAdapter, listAdapterIds } from '../../../src/services/ide/ide-registry.js';
import { applyHookInstall, readHookStatus } from '../../../src/services/skills/hooks-settings-service.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('CURSOR_ADAPTER — identity fields (slice #12, 2.4.0)', () => {
  test('id is "cursor"', () => {
    expect(CURSOR_ADAPTER.id).toBe('cursor');
  });

  test('displayName is "Cursor"', () => {
    expect(CURSOR_ADAPTER.displayName).toBe('Cursor');
  });

  test('envVar is CURSOR_PROJECT_DIR (used for ${...} placeholder substitution; UNVERIFIED — see PRD R-2)', () => {
    expect(CURSOR_ADAPTER.envVar).toBe('CURSOR_PROJECT_DIR');
  });

  test('hookEvent is "beforeShellExecution" (Cursor shell hook event; UNVERIFIED — see PRD R-1)', () => {
    expect(CURSOR_ADAPTER.hookEvent).toBe('beforeShellExecution');
  });

  test('toolMatcher is "Bash" (Cursor shell execution tool matcher)', () => {
    expect(CURSOR_ADAPTER.toolMatcher).toBe('Bash');
  });

  test('installHints mention restarting Cursor so hooks take effect', () => {
    expect(CURSOR_ADAPTER.installHints.length).toBeGreaterThan(0);
    expect(CURSOR_ADAPTER.installHints.join(' ')).toMatch(/restart|reload/i);
  });
});

describe('CURSOR_ADAPTER — capabilities', () => {
  test('gateEnforce is true (per the PRD R-2 hard rule — every adapter enforces gates)', () => {
    expect(CURSOR_ADAPTER.capabilities.gateEnforce).toBe(true);
  });

  test('statusline is true (Cursor has a statusline UI surface)', () => {
    expect(CURSOR_ADAPTER.capabilities.statusline).toBe(true);
  });
});

describe('CURSOR_ADAPTER — settings location', () => {
  test('dirName is ".cursor"', () => {
    expect(CURSOR_ADAPTER.settings.dirName).toBe('.cursor');
  });

  test('settingsFileName is "settings.json"', () => {
    expect(CURSOR_ADAPTER.settings.settingsFileName).toBe('settings.json');
  });

  test('supportsScope returns true for both project and global', () => {
    expect(CURSOR_ADAPTER.settings.supportsScope('project')).toBe(true);
    expect(CURSOR_ADAPTER.settings.supportsScope('global')).toBe(true);
  });

  test('resolveSettingsFile("global", _) returns <homedir>/.cursor/settings.json (AC7)', () => {
    const resolved = CURSOR_ADAPTER.settings.resolveSettingsFile('global', undefined);
    const expected = join(resolve(homedir()), '.cursor', 'settings.json');
    expect(resolved).toBe(expected);
  });

  test('resolveSettingsFile("project", root) returns <root>/.cursor/settings.json (L1 default, AC6)', () => {
    const root = resolve('/p');
    const resolved = CURSOR_ADAPTER.settings.resolveSettingsFile('project', root);
    // AC6: assert path is rooted at /p, NOT at homedir().
    expect(resolved).toBe(join(root, '.cursor', 'settings.json'));
    expect(resolved.startsWith(root)).toBe(true);
    expect(resolved.startsWith(resolve(homedir()))).toBe(false);
  });
});

describe('CURSOR_ADAPTER — registry integration', () => {
  test('production registry lists cursor alongside claude-code and trae in insertion order', () => {
    const ids = listAdapterIds();
    expect(ids).toContain('claude-code');
    expect(ids).toContain('trae');
    expect(ids).toContain('cursor');
    // Insertion order: claude-code, trae, cursor, codex, hermes, openclaw
    expect(ids.indexOf('claude-code')).toBeLessThan(ids.indexOf('trae'));
    expect(ids.indexOf('trae')).toBeLessThan(ids.indexOf('cursor'));
  });

  test('getAdapter("cursor") returns the Cursor adapter instance', () => {
    const got = getAdapter('cursor');
    expect(got.id).toBe('cursor');
    expect(got.envVar).toBe('CURSOR_PROJECT_DIR');
    expect(got.hookEvent).toBe('beforeShellExecution');
    expect(got.toolMatcher).toBe('Bash');
  });

  test('getAdapter("cursor") returns a different instance from claude-code and trae', () => {
    const cursor = getAdapter('cursor');
    const claude = getAdapter('claude-code');
    const trae = getAdapter('trae');
    expect(cursor).not.toBe(claude);
    expect(cursor).not.toBe(trae);
    expect(cursor.id).toBe('cursor');
    expect(claude.id).toBe('claude-code');
    expect(trae.id).toBe('trae');
  });
});

describe('CURSOR_ADAPTER — subAgentDispatcher per-IDE attribution (slice 1.3 AC-3.c)', () => {
  test('subAgentDispatcher reference is the cursor dispatcher (real awaitBatch, 30s default)', () => {
    // Slice 1.3 AC-3.c: Cursor promotes off `claudeCodeSubAgentDispatcher`
    // placeholder to its own `cursorSubAgentDispatcher` (real file-polling
    // awaitBatch, 30s default). The `buildToolCall` shape remains
    // byte-identical to claude-code; only the awaitBatch wiring diverges.
    expect(CURSOR_ADAPTER.subAgentDispatcher).toBe(cursorSubAgentDispatcher);
    expect(CURSOR_ADAPTER.subAgentDispatcher).not.toBe(CLAUDE_CODE_ADAPTER.subAgentDispatcher);
  });
});

describe('CURSOR_ADAPTER — UNVERIFIED standardsProfile + skillInstall (NG6 / AC16)', () => {
  test('standardsProfile is undefined (UNVERIFIED — slice #012+ dogfood required)', () => {
    // The dispatch layer falls back to the legacy Claude Code path
    // (CLAUDE.md + .claude/rules/**) with a stderr warning when this is
    // undefined. See ide-adapter-resource-profile-framework.md.
    expect(CURSOR_ADAPTER.standardsProfile).toBeUndefined();
  });

  test('skillInstall is undefined (UNVERIFIED — slice #012+ dogfood required)', () => {
    // The postinstall script writes bundled skills to `~/.claude/skills/`
    // (legacy Claude Code fallback) with a stderr warning, NOT to
    // `~/.cursor/skills/`. See AC16.
    expect(CURSOR_ADAPTER.skillInstall).toBeUndefined();
  });
});

/**
 * Slice #12 (2.4.0) closeout: prove the per-IDE install dispatch actually
 * writes a Cursor-shaped settings.json (not a Claude-shaped one) when the
 * user passes `{ ide: 'cursor' }`. The test asserts:
 *
 *   - AC6: install writes to <projectRoot>/.cursor/settings.json
 *     (project scope, the L1 default) — NOT to ~/.cursor/settings.json.
 *   - AC7: install --scope global writes to ~/.cursor/settings.json.
 *   - Cursor's `beforeShellExecution` event key is used (not PreToolUse).
 *   - Cursor's `Bash` matcher is used (not "terminal").
 *   - ${CURSOR_PROJECT_DIR} env var is referenced in hook commands
 *     (not ${CLAUDE_PROJECT_DIR} or ${TRAE_PROJECT_DIR}).
 */
describe('peaks hooks install — Cursor integration (slice #12 closeout, AC6 / AC7)', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-cursor-install-'));
  });

  test('applyHookInstall with { ide: "cursor" } writes to <root>/.cursor/settings.json (AC6, L1 default project scope)', async () => {
    const result = applyHookInstall('project', project, { ide: 'cursor' });
    expect(result.applied).toBe(true);
    expect(result.settingsPath).toBe(join(project, '.cursor', 'settings.json'));
    // The Claude path must NOT have been written.
    const claudePath = join(project, '.claude', 'settings.json');
    const { existsSync } = await import('node:fs');
    expect(existsSync(claudePath)).toBe(false);
  });

  test('Cursor install uses "beforeShellExecution" event key, not "PreToolUse"', async () => {
    applyHookInstall('project', project, { ide: 'cursor' });
    const settings = JSON.parse(
      await readFile(join(project, '.cursor', 'settings.json'), 'utf8')
    ) as { hooks: Record<string, unknown[]> };
    // The Cursor install should use beforeShellExecution.
    expect(settings.hooks).toHaveProperty('beforeShellExecution');
    const beforeShell = settings.hooks.beforeShellExecution ?? [];
    expect(beforeShell.length).toBeGreaterThan(0);
    // The Claude event key must NOT be present.
    expect(settings.hooks).not.toHaveProperty('PreToolUse');
  });

  test('Cursor install uses "Bash" matcher (not "terminal") and CURSOR_PROJECT_DIR env var', async () => {
    applyHookInstall('project', project, { ide: 'cursor' });
    const settings = JSON.parse(
      await readFile(join(project, '.cursor', 'settings.json'), 'utf8')
    ) as { hooks: { beforeShellExecution: { matcher: string; hooks: { command: string }[] }[] } };
    const entries = settings.hooks.beforeShellExecution ?? [];
    const matchers = entries.map((entry) => entry.matcher);
    expect(matchers).toContain('Bash');
    expect(matchers).not.toContain('terminal');
    // Every command must reference ${CURSOR_PROJECT_DIR}, not Claude or Trae.
    for (const entry of entries) {
      for (const handler of entry.hooks) {
        expect(handler.command).toContain('${CURSOR_PROJECT_DIR}');
        expect(handler.command).not.toContain('${CLAUDE_PROJECT_DIR}');
        expect(handler.command).not.toContain('${TRAE_PROJECT_DIR}');
      }
    }
  });

  test('readHookStatus with { ide: "cursor" } reports installed=true after a Cursor install', async () => {
    applyHookInstall('project', project, { ide: 'cursor' });
    const status = readHookStatus('project', project, { ide: 'cursor' });
    expect(status.installed).toBe(true);
    expect(status.exists).toBe(true);
  });

  test('Cursor install --scope global writes to <homedir>/.cursor/settings.json (AC7)', () => {
    // Use a synthetic projectRoot to confirm the L1 project default is NOT used.
    const syntheticRoot = resolve('/p');
    const result = applyHookInstall('global', syntheticRoot, { ide: 'cursor' });
    expect(result.applied).toBe(true);
    const expected = join(resolve(homedir()), '.cursor', 'settings.json');
    expect(result.settingsPath).toBe(expected);
    // Critically: the path is NOT rooted at the projectRoot when --scope global.
    expect(result.settingsPath?.startsWith(syntheticRoot)).toBe(false);
  });
});
