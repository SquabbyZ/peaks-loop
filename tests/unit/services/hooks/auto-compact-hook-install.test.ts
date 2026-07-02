/**
 * Slice 2026-07-02-auto-compact-zero-pause — AC-2 test.
 *
 * Pins the contract that `installAutoCompactHook` and
 * `removeAutoCompactHook` are idempotent + reversible:
 *
 *   - install on a fresh project creates the file with one matcher entry
 *   - re-install is a no-op (returns already-installed)
 *   - remove on a populated file strips ONLY the auto-compact matcher
 *   - remove on a missing file is a no-op (returns absent)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_COMPACT_HOOK_COMMAND,
  AUTO_COMPACT_HOOK_MATCHER,
  AUTO_COMPACT_HOOK_SETTINGS_PATH,
  installAutoCompactHook,
  removeAutoCompactHook
} from '../../../../src/services/hooks/auto-compact-hook-install.js';

let projectRoot: string;
let settingsPath: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-hook-install-'));
  settingsPath = join(projectRoot, AUTO_COMPACT_HOOK_SETTINGS_PATH);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('installAutoCompactHook — fresh install (AC-2)', () => {
  it('writes .claude/settings.local.json with one Bash|Task PreToolUse entry', () => {
    const result = installAutoCompactHook({ projectRoot });
    expect(result.action).toBe('installed');
    expect(existsSync(settingsPath)).toBe(true);
    const payload = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
    };
    expect(payload.hooks.PreToolUse).toHaveLength(1);
    expect(payload.hooks.PreToolUse[0]!.matcher).toBe(AUTO_COMPACT_HOOK_MATCHER);
    expect(payload.hooks.PreToolUse[0]!.hooks[0]!.type).toBe('command');
    expect(payload.hooks.PreToolUse[0]!.hooks[0]!.command).toBe(AUTO_COMPACT_HOOK_COMMAND);
  });

  it('creates the .claude/ directory if missing', () => {
    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    installAutoCompactHook({ projectRoot });
    expect(existsSync(join(projectRoot, '.claude'))).toBe(true);
  });
});

describe('installAutoCompactHook — idempotent re-install', () => {
  it('re-running on the same project returns already-installed', () => {
    const first = installAutoCompactHook({ projectRoot });
    expect(first.action).toBe('installed');
    const second = installAutoCompactHook({ projectRoot });
    expect(second.action).toBe('already-installed');
  });

  it('preserves unrelated PreToolUse entries on re-install', () => {
    // Seed an unrelated matcher.
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'echo user-hook' }] }
          ]
        }
      })
    );
    installAutoCompactHook({ projectRoot });
    installAutoCompactHook({ projectRoot });
    const payload = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    expect(payload.hooks.PreToolUse).toHaveLength(2);
    expect(payload.hooks.PreToolUse.find((e) => e.matcher === 'Write|Edit')).toBeDefined();
    expect(payload.hooks.PreToolUse.find((e) => e.matcher === AUTO_COMPACT_HOOK_MATCHER)).toBeDefined();
  });
});

describe('removeAutoCompactHook — reversible', () => {
  it('strips the auto-compact matcher; other hooks untouched', () => {
    installAutoCompactHook({ projectRoot });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'echo user-hook' }] },
            { matcher: AUTO_COMPACT_HOOK_MATCHER, hooks: [{ type: 'command', command: AUTO_COMPACT_HOOK_COMMAND }] }
          ]
        }
      })
    );
    const result = removeAutoCompactHook({ projectRoot });
    expect(result.action).toBe('removed');
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string }> };
    };
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.PreToolUse[0]!.matcher).toBe('Write|Edit');
  });

  it('returns absent without re-writing the file when nothing to remove', () => {
    const result = removeAutoCompactHook({ projectRoot });
    expect(result.action).toBe('absent');
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('preserves top-level settings keys (permissions, etc.)', () => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: { allow: ['Bash(npm:*)'] },
        hooks: {
          PreToolUse: [
            { matcher: AUTO_COMPACT_HOOK_MATCHER, hooks: [{ type: 'command', command: AUTO_COMPACT_HOOK_COMMAND }] }
          ]
        }
      })
    );
    removeAutoCompactHook({ projectRoot });
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      permissions?: unknown;
      hooks: { PreToolUse: unknown[] };
    };
    expect(after.permissions).toEqual({ allow: ['Bash(npm:*)'] });
    expect(after.hooks.PreToolUse).toHaveLength(0);
  });
});