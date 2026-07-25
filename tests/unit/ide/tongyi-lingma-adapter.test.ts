import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { TONGYI_LINGMA_ADAPTER } from '../../../src/services/ide/adapters/tongyi-lingma-adapter.js';
import {
  _resetAdaptersForTesting,
  getAdapter,
  listAdapterIds
} from '../../../src/services/ide/ide-registry.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('TONGYI_LINGMA_ADAPTER — identity fields', () => {
  test('id matches "tongyi-lingma"', () => {
    expect(TONGYI_LINGMA_ADAPTER.id).toBe('tongyi-lingma');
  });

  test('displayName matches "Tongyi Lingma"', () => {
    expect(TONGYI_LINGMA_ADAPTER.displayName).toBe('Tongyi Lingma');
  });

  test('envVar is TONGYI_LINGMA_PROJECT_DIR (UNVERIFIED placeholder)', () => {
    expect(TONGYI_LINGMA_ADAPTER.envVar).toBe('TONGYI_LINGMA_PROJECT_DIR');
  });

  test('hookEvent is "PreToolUse" (UNVERIFIED placeholder)', () => {
    expect(TONGYI_LINGMA_ADAPTER.hookEvent).toBe('PreToolUse');
  });

  test('toolMatcher is "Bash" (UNVERIFIED placeholder)', () => {
    expect(TONGYI_LINGMA_ADAPTER.toolMatcher).toBe('Bash');
  });
});

describe('TONGYI_LINGMA_ADAPTER — settings validation', () => {
  test('settings.dirName is ".lingma" (UNVERIFIED placeholder)', () => {
    expect(TONGYI_LINGMA_ADAPTER.settings.dirName).toBe('.lingma');
  });

  test('settings.settingsFileName is "settings.json" (UNVERIFIED placeholder)', () => {
    expect(TONGYI_LINGMA_ADAPTER.settings.settingsFileName).toBe('settings.json');
  });

  test('settings.supportsScope returns true for both project and global', () => {
    expect(TONGYI_LINGMA_ADAPTER.settings.supportsScope('project')).toBe(true);
    expect(TONGYI_LINGMA_ADAPTER.settings.supportsScope('global')).toBe(true);
  });

  test('settings.resolveSettingsFile("global", _) returns <homedir>/.lingma/settings.json', () => {
    const resolved = TONGYI_LINGMA_ADAPTER.settings.resolveSettingsFile('global', undefined);
    const expected = join(resolve(homedir()), '.lingma', 'settings.json');
    expect(resolved).toBe(expected);
  });

  test('settings.resolveSettingsFile("project", root) returns <root>/.lingma/settings.json', () => {
    const root = resolve('C:/Users/me/projects/foo');
    const resolved = TONGYI_LINGMA_ADAPTER.settings.resolveSettingsFile('project', root);
    expect(resolved).toBe(join(root, '.lingma', 'settings.json'));
  });
});

describe('TONGYI_LINGMA_ADAPTER — registry integration', () => {
  test('production registry lists all nine built-in adapters in insertion order', () => {
    expect(listAdapterIds()).toEqual([
      'claude-code',
      'trae',
      'cursor',
      'codex',
      'hermes',
      'openclaw',
      'qoder',
      'tongyi-lingma',
      'zcode'
    ]);
  });

  test('getAdapter("tongyi-lingma") returns the Tongyi Lingma adapter instance', () => {
    const got = getAdapter('tongyi-lingma');
    expect(got.id).toBe('tongyi-lingma');
    expect(got.envVar).toBe('TONGYI_LINGMA_PROJECT_DIR');
    expect(got.toolMatcher).toBe('Bash');
    expect(got.hookEvent).toBe('PreToolUse');
  });

  test('Tongyi Lingma and Claude Code adapters are different instances', () => {
    const lingma = getAdapter('tongyi-lingma');
    const claude = getAdapter('claude-code');
    expect(lingma).not.toBe(claude);
    expect(lingma.id).toBe('tongyi-lingma');
    expect(claude.id).toBe('claude-code');
  });
});

describe('TONGYI_LINGMA_ADAPTER — capabilities', () => {
  test('capabilities.gateEnforce is true', () => {
    expect(TONGYI_LINGMA_ADAPTER.capabilities.gateEnforce).toBe(true);
  });

  test('capabilities.statusline is true', () => {
    expect(TONGYI_LINGMA_ADAPTER.capabilities.statusline).toBe(true);
  });

  test('installHints mention restarting or reloading so hooks take effect', () => {
    expect(TONGYI_LINGMA_ADAPTER.installHints.length).toBeGreaterThan(0);
    expect(TONGYI_LINGMA_ADAPTER.installHints.join(' ')).toMatch(/restart|reload/i);
  });
});
