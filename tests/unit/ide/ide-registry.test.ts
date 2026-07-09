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
  test('registers seven adapters in slice #2 + #0.7 + #12 + #13 + 2026-07-09-zcode (claude-code + trae + cursor + codex + hermes + openclaw + zcode) in insertion order', () => {
    // 2.4.0: slice #12 (cursor) and slice #13 (codex) add two more built-in
    // adapters to the slice #0.7 baseline.
    // 2026-07-09-zcode: slice B (add-zcode-adapter) adds the 7th built-in
    // adapter (zcode — VS Code-style desktop app, Anthropic-compatible).
    // Insertion order is preserved.
    expect(listAdapterIds()).toEqual(['claude-code', 'trae', 'cursor', 'codex', 'hermes', 'openclaw', 'zcode']);
  });

  test('listAdapters returns all seven adapter instances', () => {
    const adapters = listAdapters();
    expect(adapters).toHaveLength(7);
    expect(adapters[0]?.id).toBe('claude-code');
    expect(adapters[1]?.id).toBe('trae');
    expect(adapters[2]?.id).toBe('cursor');
    expect(adapters[3]?.id).toBe('codex');
    expect(adapters[4]?.id).toBe('hermes');
    expect(adapters[5]?.id).toBe('openclaw');
    expect(adapters[6]?.id).toBe('zcode');
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

  test('getAdapter returns the Cursor adapter for the registered id (slice #12, 2.4.0)', () => {
    const adapter = getAdapter('cursor');
    expect(adapter.id).toBe('cursor');
    expect(adapter.envVar).toBe('CURSOR_PROJECT_DIR');
  });

  test('getAdapter returns the Codex adapter for the registered id (slice #13, 2.4.0)', () => {
    const adapter = getAdapter('codex');
    expect(adapter.id).toBe('codex');
    expect(adapter.envVar).toBe('CODEX_PROJECT_DIR');
  });

  test('getAdapter throws for an unregistered IDE (e.g. qoder, deferred to slice #3+)', () => {
    // slice #2 + #0.7 + #12 + #13 ship with 6 adapters. qoder / tongyi-lingma
    // are post-2.4.0 adapters. Throwing is the expected behavior.
    expect(() => getAdapter('qoder' as IdeId)).toThrow(/Unsupported IDE: qoder/);
  });
});

describe('ide-registry — test seams', () => {
  beforeEach(() => {
    _resetAdaptersForTesting();
  });

  test('_setAdapterForTesting registers a new adapter; getAdapter returns it', () => {
    const fakeAdapter: IdeAdapter = {
      id: 'qoder',
      displayName: 'Qoder (test fixture)',
      settings: {
        dirName: '.qoder',
        settingsFileName: 'settings.json',
        resolveSettingsFile: (scope, projectRoot) => {
          const root = scope === 'global' ? 'C:/home' : (projectRoot ?? 'C:/home');
          return `${root}/.qoder/settings.json`;
        },
        supportsScope: () => true
      },
      envVar: 'QODER_PROJECT_DIR',
      hookEvent: 'beforeShellCommand',
      toolMatcher: 'terminal',
      subAgentDispatcher: { label: 'qoder', supportsRole: () => false, buildToolCall: () => ({ name: 'subagent', args: {} }) },
      promptSizeAware: false,
       capabilities: { gateEnforce: true, statusline: true },

      installHints: [],
    };
    _setAdapterForTesting('qoder', fakeAdapter);
    expect(listAdapterIds()).toEqual(['claude-code', 'trae', 'cursor', 'codex', 'hermes', 'openclaw', 'zcode', 'qoder']);
    const got = getAdapter('qoder');
    expect(got.envVar).toBe('QODER_PROJECT_DIR');
    expect(got.toolMatcher).toBe('terminal');
  });

  test('_resetAdaptersForTesting restores the 2026-07-09 default (7 built-in adapters)', () => {
    _setAdapterForTesting('qoder', {
      id: 'qoder',
      displayName: 'Qoder (test fixture)',
      settings: {
        dirName: '.qoder',
        settingsFileName: 'mcp.json',
        resolveSettingsFile: () => '/tmp/.qoder/mcp.json',
        supportsScope: () => true
      },
      envVar: 'QODER_PROJECT_DIR',
      hookEvent: 'beforeShellCommand',
      toolMatcher: 'terminal',
      subAgentDispatcher: { label: 'qoder', supportsRole: () => false, buildToolCall: () => ({ name: 'subagent', args: {} }) },
      promptSizeAware: false,
       capabilities: { gateEnforce: true, statusline: true },

      installHints: [],
    });
    expect(listAdapterIds()).toContain('qoder');
    _resetAdaptersForTesting();
    expect(listAdapterIds()).toEqual(['claude-code', 'trae', 'cursor', 'codex', 'hermes', 'openclaw', 'zcode']);
  });
});
