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
  test('registers exactly one adapter (claude-code) in slice #1', () => {
    expect(listAdapterIds()).toEqual(['claude-code']);
  });

  test('listAdapters returns the Claude adapter instance', () => {
    const adapters = listAdapters();
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.id).toBe('claude-code');
  });

  test('getAdapter returns the Claude adapter for the registered id', () => {
    const adapter = getAdapter('claude-code');
    expect(adapter.id).toBe('claude-code');
    expect(adapter.settings.dirName).toBe('.claude');
    expect(adapter.settings.settingsFileName).toBe('settings.json');
  });

  test('getAdapter throws for an unregistered IDE', () => {
    expect(() => getAdapter('trae' as IdeId)).toThrow(/Unsupported IDE: trae/);
  });
});

describe('ide-registry — test seams', () => {
  beforeEach(() => {
    _resetAdaptersForTesting();
  });

  test('_setAdapterForTesting registers a new adapter; getAdapter returns it', () => {
    const fakeAdapter: IdeAdapter = {
      id: 'trae',
      displayName: 'Trae (test fixture)',
      settings: {
        dirName: '.trae',
        settingsFileName: 'settings.json',
        resolveSettingsFile: (scope, projectRoot) => {
          const root = scope === 'global' ? 'C:/home' : (projectRoot ?? 'C:/home');
          return `${root}/.trae/settings.json`;
        },
        supportsScope: () => true
      },
      envVar: 'TRAE_PROJECT_DIR',
      hookEvent: 'beforeToolCall',
      toolMatcher: 'terminal',
      installHints: ['Restart Trae.'],
      capabilities: {
        gateEnforce: true,
        progressStart: false,
        statusline: true,
        mcpInstall: false
      }
    };
    _setAdapterForTesting('trae', fakeAdapter);
    expect(listAdapterIds()).toEqual(['claude-code', 'trae']);
    const got = getAdapter('trae');
    expect(got.envVar).toBe('TRAE_PROJECT_DIR');
    expect(got.toolMatcher).toBe('terminal');
  });

  test('_resetAdaptersForTesting restores the slice #1 default (claude-code only)', () => {
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
    expect(listAdapterIds()).toEqual(['claude-code']);
  });
});
