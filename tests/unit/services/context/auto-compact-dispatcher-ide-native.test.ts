/**
 * Slice 2026-07-02-auto-compact-zero-pause — AC-1 test.
 *
 * Pins the contract that `dispatchIdeCompact` (target='main' +
 * claude-code) routes through the `ide-native` pathway: writes
 * the auto-compact PreToolUse hook into `.claude/settings.local.json`,
 * returns `ok: true, pathway: 'ide-native'`, and is idempotent.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchIdeCompact } from '../../../../src/services/context/auto-compact-dispatcher.js';
import {
  AUTO_COMPACT_HOOK_COMMAND,
  AUTO_COMPACT_HOOK_MARKER,
  AUTO_COMPACT_HOOK_MATCHER,
  AUTO_COMPACT_HOOK_SETTINGS_PATH,
  installAutoCompactHook,
  removeAutoCompactHook
} from '../../../../src/services/hooks/auto-compact-hook-install.js';

let projectRoot: string;
let settingsPath: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-ide-native-'));
  settingsPath = join(projectRoot, AUTO_COMPACT_HOOK_SETTINGS_PATH);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const CLAUDE_CODE_ENV = { CLAUDE_CODE_ENTRYPOINT: 'cli' } as NodeJS.ProcessEnv;

describe('dispatchIdeCompact — ide-native pathway (AC-1)', () => {
  it('target=main + claude-code returns ok=true pathway=ide-native', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(result.ok).toBe(true);
    expect(result.pathway).toBe('ide-native');
    expect(result.ide).toBe('claude-code');
    expect(result.message).toContain('installed');
  });

  it('writes the auto-compact PreToolUse hook to .claude/settings.local.json', async () => {
    await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(existsSync(settingsPath)).toBe(true);
    const payload = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
    };
    const entry = payload.hooks.PreToolUse.find((e) => e.matcher === AUTO_COMPACT_HOOK_MATCHER);
    expect(entry).toBeDefined();
    expect(entry!.hooks[0]!.type).toBe('command');
    expect(entry!.hooks[0]!.command).toBe(AUTO_COMPACT_HOOK_COMMAND);
  });

  it('re-running on the same project is idempotent (single hook entry)', async () => {
    const first = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(first.message).toContain('installed');
    const second = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(second.message).toContain('already installed');
    const payload = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    const matches = payload.hooks.PreToolUse.filter((e) => e.matcher === AUTO_COMPACT_HOOK_MATCHER);
    expect(matches.length).toBe(1);
  });

  it('creates .claude/ and settings.local.json when missing (mkdir -p)', async () => {
    expect(existsSync(settingsPath)).toBe(false);
    await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(existsSync(settingsPath)).toBe(true);
  });

  it('target=sub-agent bypasses ide-native (keeps shell-exec for sub-agent shells)', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'sub-agent'
    });
    expect(result.pathway).toBe('shell-exec');
    // Shell-exec pathway does NOT touch settings.local.json.
    expect(existsSync(settingsPath)).toBe(false);
  });
});

describe('removeAutoCompactHook — symmetric removal', () => {
  it('removes the installed hook and preserves other PreToolUse entries', async () => {
    // Seed settings.local.json with the auto-compact hook PLUS a
    // separate user-installed hook. After remove, only the user hook
    // should remain.
    const otherMatcher = 'Write|Edit';
    const otherCommand = 'echo user-installed-hook';
    const seed = {
      hooks: {
        PreToolUse: [
          { matcher: otherMatcher, hooks: [{ type: 'command', command: otherCommand }] },
          { matcher: AUTO_COMPACT_HOOK_MATCHER, hooks: [{ type: 'command', command: AUTO_COMPACT_HOOK_COMMAND }] }
        ]
      }
    };
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(seed, null, 2));
    const result = removeAutoCompactHook({ projectRoot });
    expect(result.action).toBe('removed');
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
    };
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.PreToolUse[0]!.matcher).toBe(otherMatcher);
    expect(after.hooks.PreToolUse[0]!.hooks[0]!.command).toBe(otherCommand);
  });

  it('absent hook returns action=absent without re-writing the file', async () => {
    const result = removeAutoCompactHook({ projectRoot });
    expect(result.action).toBe('absent');
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('install + remove + install round-trip leaves exactly one entry', async () => {
    installAutoCompactHook({ projectRoot });
    removeAutoCompactHook({ projectRoot });
    installAutoCompactHook({ projectRoot });
    const payload = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    expect(payload.hooks.PreToolUse.filter((e) => e.matcher === AUTO_COMPACT_HOOK_MATCHER)).toHaveLength(1);
  });
});

describe('magic comment marker — documented contract', () => {
  it('AUTO_COMPACT_HOOK_MARKER is exported as a stable string', () => {
    expect(AUTO_COMPACT_HOOK_MARKER).toBe('peaks:auto-compact-hook-do-not-edit');
  });
});