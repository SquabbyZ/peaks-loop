import { describe, expect, test } from 'vitest';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CLAUDE_CODE_ADAPTER } from '../../../src/services/ide/adapters/claude-code-adapter.js';
import { formatDecisionResponse } from '../../../src/services/ide/hook-protocol.js';
import { PEAKS_HOOK_SCHEMA } from '../../../src/services/ide/ide-types.js';

describe('CLAUDE_CODE_ADAPTER — identity fields', () => {
  test('id is "claude-code"', () => {
    expect(CLAUDE_CODE_ADAPTER.id).toBe('claude-code');
  });

  test('displayName is "Claude Code"', () => {
    expect(CLAUDE_CODE_ADAPTER.displayName).toBe('Claude Code');
  });

  test('envVar is CLAUDE_PROJECT_DIR', () => {
    expect(CLAUDE_CODE_ADAPTER.envVar).toBe('CLAUDE_PROJECT_DIR');
  });

  test('hookEvent is PreToolUse (Claude Code uses PreToolUse arrays)', () => {
    expect(CLAUDE_CODE_ADAPTER.hookEvent).toBe('PreToolUse');
  });

  test('toolMatcher is Bash (Claude Code bash command matcher)', () => {
    expect(CLAUDE_CODE_ADAPTER.toolMatcher).toBe('Bash');
  });

  test('installHints mention restarting Claude Code so hooks take effect', () => {
    expect(CLAUDE_CODE_ADAPTER.installHints.length).toBeGreaterThan(0);
    expect(CLAUDE_CODE_ADAPTER.installHints.join(' ')).toMatch(/restart|reload/i);
  });
});

describe('CLAUDE_CODE_ADAPTER — capabilities', () => {
  test('gateEnforce is true (per the PRD R-2 hard rule)', () => {
    expect(CLAUDE_CODE_ADAPTER.capabilities.gateEnforce).toBe(true);
  });

  test('progressStart, statusline, mcpInstall are all enabled in slice #1', () => {
    expect(CLAUDE_CODE_ADAPTER.capabilities.progressStart).toBe(true);
    expect(CLAUDE_CODE_ADAPTER.capabilities.statusline).toBe(true);
    expect(CLAUDE_CODE_ADAPTER.capabilities.mcpInstall).toBe(true);
  });
});

describe('CLAUDE_CODE_ADAPTER — settings location', () => {
  test('dirName is ".claude"', () => {
    expect(CLAUDE_CODE_ADAPTER.settings.dirName).toBe('.claude');
  });

  test('settingsFileName is "settings.json"', () => {
    expect(CLAUDE_CODE_ADAPTER.settings.settingsFileName).toBe('settings.json');
  });

  test('supportsScope returns true for both project and global', () => {
    expect(CLAUDE_CODE_ADAPTER.settings.supportsScope('project')).toBe(true);
    expect(CLAUDE_CODE_ADAPTER.settings.supportsScope('global')).toBe(true);
  });

  test('resolveSettingsFile("global", _) returns <homedir>/.claude/settings.json', () => {
    const resolved = CLAUDE_CODE_ADAPTER.settings.resolveSettingsFile('global', undefined);
    const expected = join(resolve(homedir()), '.claude', 'settings.json');
    expect(resolved).toBe(expected);
  });

  test('resolveSettingsFile("project", root) returns <root>/.claude/settings.json', () => {
    const root = resolve('C:/Users/me/projects/foo');
    const resolved = CLAUDE_CODE_ADAPTER.settings.resolveSettingsFile('project', root);
    expect(resolved).toBe(join(root, '.claude', 'settings.json'));
  });

  test('PEAKS_HOOK_SCHEMA is "peaks-hook/v1" (canonical hook schema version)', () => {
    expect(PEAKS_HOOK_SCHEMA).toBe('peaks-hook/v1');
  });
});

describe('CLAUDE_CODE_ADAPTER — formatDecisionResponse integration', () => {
  test('returns empty stdout for an allow (Claude allow shape is empty)', () => {
    const result = formatDecisionResponse('claude-code', 'allow');
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });

  test('returns Claude deny JSON shape on stdout for a deny with a reason', () => {
    const result = formatDecisionResponse('claude-code', 'deny', 'gate no-todo failed');
    const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('gate no-todo failed');
  });

  test('throws when called with an unsupported IDE (slice #1 only registers Claude)', () => {
    expect(() => formatDecisionResponse('trae', 'deny', 'x')).toThrow(/unsupported IDE trae/);
  });
});
