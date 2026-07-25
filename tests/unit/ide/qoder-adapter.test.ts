import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { QODER_ADAPTER } from '../../../src/services/ide/adapters/qoder-adapter.js';
import {
  _resetAdaptersForTesting,
  getAdapter,
  listAdapterIds
} from '../../../src/services/ide/ide-registry.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('QODER_ADAPTER — identity fields (slice 2026-07-25-qoder-adapter-ship)', () => {
  test('id matches "qoder"', () => {
    expect(QODER_ADAPTER.id).toBe('qoder');
  });

  test('displayName matches "Qoder"', () => {
    expect(QODER_ADAPTER.displayName).toBe('Qoder');
  });

  test('envVar is QODER_PROJECT_DIR (placeholder, UNVERIFIED — pending real Qoder 1.x dogfood)', () => {
    expect(QODER_ADAPTER.envVar).toBe('QODER_PROJECT_DIR');
  });

  test('hookEvent is "PreToolUse" (placeholder, UNVERIFIED — pending real Qoder 1.x dogfood)', () => {
    expect(QODER_ADAPTER.hookEvent).toBe('PreToolUse');
  });

  test('toolMatcher is "Bash" (placeholder, UNVERIFIED — pending real Qoder 1.x dogfood)', () => {
    expect(QODER_ADAPTER.toolMatcher).toBe('Bash');
  });
});

describe('QODER_ADAPTER — settings validation (slice 2026-07-25-qoder-adapter-ship)', () => {
  test('settings.dirName is ".qoder" (placeholder, UNVERIFIED)', () => {
    expect(QODER_ADAPTER.settings.dirName).toBe('.qoder');
  });

  test('settings.settingsFileName is "settings.json" (placeholder, UNVERIFIED)', () => {
    expect(QODER_ADAPTER.settings.settingsFileName).toBe('settings.json');
  });

  test('settings.supportsScope returns true for both project and global', () => {
    expect(QODER_ADAPTER.settings.supportsScope('project')).toBe(true);
    expect(QODER_ADAPTER.settings.supportsScope('global')).toBe(true);
  });

  test('settings.resolveSettingsFile("global", _) returns <homedir>/.qoder/settings.json', () => {
    const resolved = QODER_ADAPTER.settings.resolveSettingsFile('global', undefined);
    const expected = join(resolve(homedir()), '.qoder', 'settings.json');
    expect(resolved).toBe(expected);
  });

  test('settings.resolveSettingsFile("project", root) returns <root>/.qoder/settings.json', () => {
    const root = resolve('C:/Users/me/projects/foo');
    const resolved = QODER_ADAPTER.settings.resolveSettingsFile('project', root);
    expect(resolved).toBe(join(root, '.qoder', 'settings.json'));
  });
});

describe('QODER_ADAPTER — registry integration (slice 2026-07-25-qoder-adapter-ship)', () => {
  test('production registry lists qoder alongside the 7 prior built-in adapters in insertion order', () => {
    const ids = listAdapterIds();
    expect(ids).toContain('qoder');
    expect(ids).toContain('claude-code');
    expect(ids).toContain('hermes');
    // Insertion order: qoder slots in after openclaw, before zcode.
    // (Updated 2026-07-25: tongyi-lingma adapter also registered; this test now
    // only checks the qoder placement, not the absolute list length.)
    expect(ids.slice(0, 6)).toEqual([
      'claude-code',
      'trae',
      'cursor',
      'codex',
      'hermes',
      'openclaw'
    ]);
    expect(ids[6]).toBe('qoder');
  });

  test('getAdapter("qoder") returns the Qoder adapter instance (no longer throws)', () => {
    const got = getAdapter('qoder');
    expect(got.id).toBe('qoder');
    expect(got.envVar).toBe('QODER_PROJECT_DIR');
    expect(got.toolMatcher).toBe('Bash');
    expect(got.hookEvent).toBe('PreToolUse');
  });

  test('getAdapter("qoder") and getAdapter("claude-code") return different instances', () => {
    const qoder = getAdapter('qoder');
    const claude = getAdapter('claude-code');
    expect(qoder).not.toBe(claude);
    expect(qoder.id).toBe('qoder');
    expect(claude.id).toBe('claude-code');
  });
});

describe('QODER_ADAPTER — capabilities (slice 2026-07-25-qoder-adapter-ship)', () => {
  test('capabilities.gateEnforce is true (per PRD R-2 hard rule — every adapter enforces gates)', () => {
    expect(QODER_ADAPTER.capabilities.gateEnforce).toBe(true);
  });

  test('capabilities.statusline is true', () => {
    expect(QODER_ADAPTER.capabilities.statusline).toBe(true);
  });

  test('installHints mention restarting Qoder so hooks take effect', () => {
    expect(QODER_ADAPTER.installHints.length).toBeGreaterThan(0);
    expect(QODER_ADAPTER.installHints.join(' ')).toMatch(/restart|reload/i);
  });
});