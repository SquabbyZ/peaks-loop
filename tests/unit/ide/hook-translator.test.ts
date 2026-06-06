import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetAdaptersForTesting,
  _setAdapterForTesting
} from '../../../src/services/ide/ide-registry.js';
import {
  detectIdeFromContext,
  parseClaudeShapeStdin,
  pluckObject,
  pluckString
} from '../../../src/services/ide/hook-translator.js';
import type { IdeAdapter } from '../../../src/services/ide/ide-types.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-hook-translator-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  _resetAdaptersForTesting();
});

describe('pluckString', () => {
  test('returns the value at a flat path', () => {
    expect(pluckString({ a: 'hello' }, ['a'])).toBe('hello');
  });

  test('returns the value at a nested path', () => {
    expect(pluckString({ a: { b: { c: 'deep' } } }, ['a', 'b', 'c'])).toBe('deep');
  });

  test('returns undefined when a segment is missing', () => {
    expect(pluckString({ a: {} }, ['a', 'b'])).toBeUndefined();
  });

  test('returns undefined when the final value is not a string', () => {
    expect(pluckString({ a: 42 }, ['a'])).toBeUndefined();
  });

  test('returns undefined for null and primitive inputs', () => {
    expect(pluckString(null, ['a'])).toBeUndefined();
    expect(pluckString('string', ['a'])).toBeUndefined();
    expect(pluckString(42, ['a'])).toBeUndefined();
  });
});

describe('pluckObject', () => {
  test('returns the nested object at a path', () => {
    expect(pluckObject({ a: { b: { c: 'x' } } }, ['a', 'b'])).toEqual({ c: 'x' });
  });

  test('returns undefined when the final value is not an object', () => {
    expect(pluckObject({ a: 'string' }, ['a'])).toBeUndefined();
  });

  test('returns undefined for null input', () => {
    expect(pluckObject(null, ['a'])).toBeUndefined();
  });
});

describe('parseClaudeShapeStdin', () => {
  test('extracts toolName and command from a Claude-shaped payload', () => {
    expect(parseClaudeShapeStdin({ tool_name: 'Bash', tool_input: { command: 'ls' } })).toEqual({
      toolName: 'Bash',
      command: 'ls'
    });
  });

  test('returns partial results when only one field is present', () => {
    expect(parseClaudeShapeStdin({ tool_name: 'Edit' })).toEqual({ toolName: 'Edit' });
    expect(parseClaudeShapeStdin({ tool_input: { command: 'echo hi' } })).toEqual({ command: 'echo hi' });
  });

  test('returns an empty object for non-object input', () => {
    expect(parseClaudeShapeStdin(null)).toEqual({});
    expect(parseClaudeShapeStdin('string')).toEqual({});
    expect(parseClaudeShapeStdin(42)).toEqual({});
  });

  test('ignores non-string values at tool_name or tool_input.command', () => {
    expect(parseClaudeShapeStdin({ tool_name: 42, tool_input: { command: 99 } })).toEqual({});
  });
});

describe('detectIdeFromContext — env var priority', () => {
  test('returns the adapter whose env var is defined', () => {
    _setAdapterForTesting('trae', makeAdapter('trae', '.trae', 'TRAE_PROJECT_DIR'));
    const ide = detectIdeFromContext({
      env: { TRAE_PROJECT_DIR: '/some/path' },
      cwd: tmpRoot,
      parsedStdin: null
    });
    expect(ide).toBe('trae');
  });

  test('first-registered env var wins when multiple match (insertion order)', () => {
    _setAdapterForTesting('trae', makeAdapter('trae', '.trae', 'TRAE_PROJECT_DIR'));
    _setAdapterForTesting('cursor', makeAdapter('cursor', '.cursor', 'CURSOR_PROJECT_DIR'));
    const ide = detectIdeFromContext({
      env: { TRAE_PROJECT_DIR: '/a', CURSOR_PROJECT_DIR: '/b' },
      cwd: tmpRoot,
      parsedStdin: null
    });
    expect(ide).toBe('trae');
  });

  test('skips unregistered IDEs (the slice #1 latent-bug fix)', () => {
    // Only claude-code is registered. No env var is set, so we fall through
    // to stdin shape → cwd heuristic → fallback. The function must NOT
    // throw on the unregistered IDEs in the (now-removed) hardcoded list.
    expect(() =>
      detectIdeFromContext({ env: {}, cwd: tmpRoot, parsedStdin: null })
    ).not.toThrow();
  });
});

describe('detectIdeFromContext — stdin shape', () => {
  test('matches claude-code shape via tool_name/tool_input keys', () => {
    expect(
      detectIdeFromContext({ env: {}, cwd: tmpRoot, parsedStdin: { tool_name: 'Bash', tool_input: {} } })
    ).toBe('claude-code');
  });

  test('matches claude-code shape even when only one of the two keys is present', () => {
    expect(
      detectIdeFromContext({ env: {}, cwd: tmpRoot, parsedStdin: { tool_name: 'Bash' } })
    ).toBe('claude-code');
  });

  test('falls through to cwd heuristic when stdin shape does not match', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    expect(
      detectIdeFromContext({ env: {}, cwd: tmpRoot, parsedStdin: { unrelated: 'shape' } })
    ).toBe('claude-code');
  });
});

describe('detectIdeFromContext — fallback', () => {
  test('falls back to claude-code when nothing matches', () => {
    expect(detectIdeFromContext({ env: {}, cwd: tmpRoot, parsedStdin: null })).toBe('claude-code');
  });
});

function makeAdapter(id: string, dirName: string, envVar: string): IdeAdapter {
  return {
    id: id as IdeAdapter['id'],
    displayName: `${id} (test fixture)`,
    settings: {
      dirName,
      settingsFileName: 'settings.json',
      resolveSettingsFile: (scope, projectRoot) => {
        const root = scope === 'global' ? 'C:/home' : (projectRoot ?? 'C:/home');
        return `${root}/${dirName}/settings.json`;
      },
      supportsScope: () => true
    },
    envVar,
    hookEvent: 'PreToolUse',
    toolMatcher: 'Bash',
    subAgentToolMatcher: 'Task',
    subAgentDispatcher: { label: id, supportsRole: () => false, buildToolCall: () => ({ name: 'subagent', args: {} }) },
    installHints: [],
    capabilities: { gateEnforce: true, progressStart: false, statusline: true, mcpInstall: false }
  };
}
