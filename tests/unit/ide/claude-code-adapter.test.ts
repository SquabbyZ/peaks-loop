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
    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('gate no-todo failed');
  });

  test('throws when called with an IDE that has no registered adapter (future slices will add support)', () => {
    // codex / cursor / qoder / tongyi-lingma are reserved IdeIds in slice #1
    // but not yet registered in the adapter registry. The function should
    // throw a clear "unsupported IDE" error so the hook runtime fail-opens
    // (rather than silently producing a Claude-shaped response).
    expect(() => formatDecisionResponse('codex', 'deny', 'x')).toThrow(/unsupported IDE codex/);
  });

  test('Trae deny response uses the beforeToolCall event name (slice #3 hook-protocol Trae branch)', () => {
    // Slice #3 added Trae to formatDecisionResponse. The Trae deny shape is
    // a 1.x assumption (see hook-protocol.ts TRAE_DENY_SHAPE doc) — Cursor-
    // style with `hookEventName: 'beforeToolCall'`. This test pins the
    // shape so a future slice that confirms the real Trae 1.x envelope can
    // diff against it.
    const out = formatDecisionResponse('trae', 'deny', 'gate no-rm failed');
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout) as {
      hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('beforeToolCall');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('gate no-rm failed');
  });
});
