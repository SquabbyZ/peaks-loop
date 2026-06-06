import { afterEach, describe, expect, test } from 'vitest';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { TRAE_ADAPTER } from '../../../src/services/ide/adapters/trae-adapter.js';
import { _resetAdaptersForTesting, getAdapter, listAdapterIds } from '../../../src/services/ide/ide-registry.js';

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
