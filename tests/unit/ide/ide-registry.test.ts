import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  _resetAdaptersForTesting,
  _setAdapterForTesting,
  getAdapter,
  listAdapterIds,
  listAdapters
} from '../../../src/services/ide/ide-registry.js';
import type { IdeAdapter, IdeId } from '../../../src/services/ide/ide-types.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('ide-registry — built-in defaults', () => {
  test('registers two adapters in slice #2 (claude-code + trae) in insertion order', () => {
    expect(listAdapterIds()).toEqual(['claude-code', 'trae']);
  });

  test('listAdapters returns both adapter instances', () => {
    const adapters = listAdapters();
    expect(adapters).toHaveLength(2);
    expect(adapters[0]?.id).toBe('claude-code');
    expect(adapters[1]?.id).toBe('trae');
  });

  test('getAdapter returns the Claude adapter for the registered id', () => {
    const adapter = getAdapter('claude-code');
    expect(adapter.id).toBe('claude-code');
    expect(adapter.settings.dirName).toBe('.claude');
    expect(adapter.settings.settingsFileName).toBe('settings.json');
  });

  test('getAdapter returns the Trae adapter for the registered id (slice #2)', () => {
    const adapter = getAdapter('trae');
    expect(adapter.id).toBe('trae');
    expect(adapter.envVar).toBe('TRAE_PROJECT_DIR');
  });

  test('getAdapter throws for an unregistered IDE (e.g. cursor in slice #2)', () => {
    // slice #2 ships with claude-code + trae. cursor / codex / qoder / tongyi-lingma
    // are post-#2 adapters. Throwing is the expected behavior.
    expect(() => getAdapter('cursor' as IdeId)).toThrow(/Unsupported IDE: cursor/);
  });
});

describe('ide-registry — test seams', () => {
  beforeEach(() => {
    _resetAdaptersForTesting();
  });

  test('_setAdapterForTesting registers a new adapter; getAdapter returns it', () => {
    const fakeAdapter: IdeAdapter = {
      id: 'cursor',
      displayName: 'Cursor (test fixture)',
      settings: {
        dirName: '.cursor',
        settingsFileName: 'settings.json',
        resolveSettingsFile: (scope, projectRoot) => {
          const root = scope === 'global' ? 'C:/home' : (projectRoot ?? 'C:/home');
          return `${root}/.cursor/settings.json`;
        },
        supportsScope: () => true
      },
      envVar: 'CURSOR_PROJECT_DIR',
      hookEvent: 'beforeShellCommand',
      toolMatcher: 'terminal',
      installHints: [],
      capabilities: { gateEnforce: true, progressStart: false, statusline: true, mcpInstall: false }
    };
    _setAdapterForTesting('cursor', fakeAdapter);
    expect(listAdapterIds()).toEqual(['claude-code', 'trae', 'cursor']);
    const got = getAdapter('cursor');
    expect(got.envVar).toBe('CURSOR_PROJECT_DIR');
    expect(got.toolMatcher).toBe('terminal');
  });

  test('_resetAdaptersForTesting restores the slice #2 default (claude-code + trae)', () => {
    _setAdapterForTesting('cursor', {
      id: 'cursor',
      displayName: 'Cursor (test fixture)',
      settings: {
        dirName: '.cursor',
        settingsFileName: 'mcp.json',
        resolveSettingsFile: () => '/tmp/.cursor/mcp.json',
        supportsScope: () => true
      },
      envVar: 'CURSOR_PROJECT_DIR',
      hookEvent: 'beforeShellCommand',
      toolMatcher: 'terminal',
      installHints: [],
      capabilities: { gateEnforce: true, progressStart: false, statusline: false, mcpInstall: true }
    });
    expect(listAdapterIds()).toContain('cursor');
    _resetAdaptersForTesting();
    expect(listAdapterIds()).toEqual(['claude-code', 'trae']);
  });
});
