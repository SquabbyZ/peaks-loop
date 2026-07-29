import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  applyHookInstall,
  HOOK_ENFORCE_SENTINEL,
   PEAKS_HOOK_ENTRIES,
  planHookInstall,
  readHookStatus,
  readInstalledEntriesFromSettings,
  removeHookInstall,
  SUPERPOWERS_DENIED_SKILLS,
  withSuperpowersSkillDenylist,
  withTriggeredDenyList,
  withoutTriggeredDenyList,
  TRIGGER_PHRASES,
  withoutSuperpowersSkillDenylist,
  listSuperpowersDenyEntries
} from '../../src/services/skills/hooks-settings-service.js';
import {
  _resetAdaptersForTesting,
  _setAdapterForTesting
} from '../../src/services/ide/ide-registry.js';
import type { IdeAdapter } from '../../src/services/ide/ide-types.js';

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'peaks-hooks-'));
});

afterEach(() => { /* tmp dirs are disposable */ });

function settingsPath(): string {
  return join(project, '.claude', 'settings.json');
}
async function writeSettings(value: unknown): Promise<void> {
  await mkdir(join(project, '.claude'), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(value, null, 2), 'utf8');
}
async function readSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>;
}

describe('applyHookInstall', () => {
  test('installs ONLY the gate-enforce (Bash) entry into an empty/absent settings file (slice #014)', async () => {
    // Slice #014: the install no longer emits a progress-start entry.
    // Only the gate-enforce entry is written.
    const result = applyHookInstall('project', project);
    expect(result.applied).toBe(true);
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(PEAKS_HOOK_ENTRIES.length);
    expect(PEAKS_HOOK_ENTRIES).toHaveLength(1);
    expect(pre[0]?.matcher).toBe('Bash');
    expect(pre[0]?.hooks[0]?.command).toContain(HOOK_ENFORCE_SENTINEL);
  });

  test('is idempotent — a second install does not duplicate', async () => {
    applyHookInstall('project', project);
    const second = applyHookInstall('project', project);
    expect(second.applied).toBe(false);
    const pre = (await readSettings()).hooks as { PreToolUse: unknown[] };
    expect(pre.PreToolUse).toHaveLength(PEAKS_HOOK_ENTRIES.length);
  });

  test('preserves other settings keys and other PreToolUse hooks', async () => {
    await writeSettings({
      model: 'sonnet',
      hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }], PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo post' }] }] }
    });
    applyHookInstall('project', project);
    const settings = await readSettings();
    expect(settings.model).toBe('sonnet');
    const hooks = settings.hooks as { PreToolUse: { matcher: string }[]; PostToolUse: unknown[] };
    // existing Write + our 1 peaks-managed entry (Bash gate-enforce)
    expect(hooks.PreToolUse).toHaveLength(1 + PEAKS_HOOK_ENTRIES.length);
    expect(hooks.PreToolUse.some((e) => e.matcher === 'Write')).toBe(true);
    expect(hooks.PreToolUse.some((e) => e.matcher === 'Bash')).toBe(true);
    expect(hooks.PostToolUse).toHaveLength(1); // untouched
  });

  test('rejects a symlinked settings.json', async () => {
    const real = await mkdtemp(join(tmpdir(), 'peaks-hooks-real-'));
    await mkdir(join(real, '.claude'), { recursive: true });
    await writeFile(join(real, '.claude', 'settings.json'), '{}', 'utf8');
    await mkdir(join(project, '.claude'), { recursive: true });
    try {
      await symlink(join(real, '.claude', 'settings.json'), settingsPath());
    } catch {
      return; // symlink not permitted on this platform (Windows w/o privilege) — skip
    }
    expect(() => applyHookInstall('project', project)).toThrow(/symlink/);
  });
});

describe('planHookInstall / readHookStatus', () => {
  test('dry-run reports not-yet-installed without writing', async () => {
    const plan = planHookInstall('project', project);
    expect(plan.alreadyInstalled).toBe(false);
    expect(existsSync(settingsPath())).toBe(false);
  });

  test('status reflects install state', async () => {
    expect(readHookStatus('project', project).installed).toBe(false);
    applyHookInstall('project', project);
    expect(readHookStatus('project', project).installed).toBe(true);
  });
});

describe('removeHookInstall', () => {
  test('removes only the peaks hook, keeping other hooks and keys', async () => {
    await writeSettings({ model: 'sonnet', hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }] } });
    applyHookInstall('project', project);
    const removed = removeHookInstall('project', project);
    expect(removed.removed).toBe(true);
    const settings = await readSettings();
    expect(settings.model).toBe('sonnet');
    const hooks = settings.hooks as { PreToolUse: { matcher: string }[] };
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse[0]!.matcher).toBe('Write');
  });

  test('drops the hooks key entirely when the peaks hook was the only content', async () => {
    applyHookInstall('project', project);
    removeHookInstall('project', project);
    const settings = await readSettings();
    expect(settings.hooks).toBeUndefined();
  });

  test('removing when not installed is a no-op', async () => {
    await writeSettings({ model: 'sonnet' });
    const removed = removeHookInstall('project', project);
    expect(removed.removed).toBe(false);
  });

  test('uninstall strips a legacy progress-start entry (pre-#014 install leftover) (slice #014)', async () => {
    // Seed a settings.json that has BOTH the gate-enforce entry (added
    // by this slice) AND a stale progress-start entry (added by a
    // pre-#014 install). The uninstall must strip both.
    await writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] },
          { matcher: 'Task', hooks: [{ type: 'command', command: 'peaks progress start --project "${CLAUDE_PROJECT_DIR}" --reason "auto-spawn for sub-agent Task" --quiet' }] }
        ]
      }
    });
    const removed = removeHookInstall('project', project);
    expect(removed.removed).toBe(true);
    const settings = await readSettings();
    expect(settings.hooks).toBeUndefined();
  });
});

/**
 * Slice #014 (refactor — full removal of legacy progress-start
 * surface): the only emitted entry is the gate-enforce entry. The
 * `subAgentToolMatcher` field is gone from `IdeAdapter`. These
 * tests guard the install shape per IDE.
 */
describe('slice 014: install shape is gate-enforce only (legacy progress-start surface deleted)', () => {
  test('claude-code install writes ONLY the Bash gate-enforce entry (no Task / progress-start entry)', async () => {
    applyHookInstall('project', project, { ide: 'claude-code' });
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]?.matcher).toBe('Bash');
    expect(pre[0]?.hooks[0]?.command).toContain(HOOK_ENFORCE_SENTINEL);
    // The Task progress-start entry must NOT be in the file.
    expect(pre.some((e) => e.matcher === 'Task')).toBe(false);
  });

  test('trae install writes ONLY the terminal hook-handle entry (no Task / progress-start entry)', async () => {
    await mkdir(join(project, '.trae'), { recursive: true });
    applyHookInstall('project', project, { ide: 'trae' });
    const settings = JSON.parse(
      await readFile(join(project, '.trae', 'settings.json'), 'utf8')
    ) as Record<string, unknown>;
    const before = (settings.hooks as { beforeToolCall: { matcher: string; hooks: { command: string }[] }[] }).beforeToolCall;
    expect(before).toBeDefined();
    expect(before).toHaveLength(1);
    expect(before[0]?.matcher).toBe('terminal');
    // The Task progress-start entry must NOT be in the file.
    expect(before.some((e) => e.matcher === 'Task')).toBe(false);
  });
});

/**
 * Slice #014: pre-#014 installs that left a progress-start entry
 * behind must be stripped by the next install (idempotent converge
 * on the new shape). The `shapeMatchesDesired` check is the only
 * path that catches this.
 */
describe('slice 014: pre-#014 install converges on the new shape', () => {
  test('install over a settings.json that has a legacy progress-start entry STRIPS it', async () => {
    // Seed a pre-#014-shaped settings.json: both gate-enforce AND progress-start.
    await writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] },
          { matcher: 'Task', hooks: [{ type: 'command', command: 'peaks progress start --project "${CLAUDE_PROJECT_DIR}" --reason "auto-spawn for sub-agent Task" --quiet' }] }
        ]
      }
    });
    const result = applyHookInstall('project', project, { ide: 'claude-code' });
    // The install is NOT a no-op: the file had a stale progress-start
    // entry, the desired shape is gate-enforce-only.
    expect(result.applied).toBe(true);
    const settings = await readSettings();
    const pre = (settings.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]?.matcher).toBe('Bash');
    expect(pre[0]?.hooks[0]?.command).toContain(HOOK_ENFORCE_SENTINEL);
  });
});

/**
 * Slice #014 (Part A — status command fix): the new
 * `readInstalledEntriesFromSettings` helper reads the ACTUAL
 * settings.json and returns the on-disk peaks-managed entries. The
 * pre-#014 `listInstalledEntriesForIde` returned the IDE-EXPECTED
 * list and was a silent misreport on every status invocation that
 * ran against a `--no-progress` install (or, post-#014, against
 * the default install).
 */
describe('slice 014: readInstalledEntriesFromSettings reads actual on-disk entries', () => {
  test('returns the gate-enforce entry when it is the only peaks-managed entry', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] }
        ]
      }
    };
    const entries = readInstalledEntriesFromSettings(settings, 'claude-code');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ matcher: 'Bash', sentinel: 'peaks gate enforce' });
  });

  test('returns BOTH the gate-enforce AND a stale legacy progress-start entry (pre-#014 install leftover)', () => {
    // The pre-#014 shape had both entries. The status command must
    // report the actual on-disk shape (so the user can see the stale
    // entry and run `peaks hooks install` to strip it).
    const settings: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"' }] },
          { matcher: 'Task', hooks: [{ type: 'command', command: 'peaks progress start --project "${CLAUDE_PROJECT_DIR}" --reason "auto-spawn for sub-agent Task" --quiet' }] }
        ]
      }
    };
    const entries = readInstalledEntriesFromSettings(settings, 'claude-code');
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.sentinel === 'peaks gate enforce')).toBeDefined();
    expect(entries.find((e) => e.sentinel === 'peaks progress start')).toBeDefined();
  });

  test('returns empty when the file has no peaks-managed entries', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }
        ]
      }
    };
    const entries = readInstalledEntriesFromSettings(settings, 'claude-code');
    expect(entries).toHaveLength(0);
  });

  test('returns empty when the file has no `hooks` key at all', () => {
    const entries = readInstalledEntriesFromSettings({}, 'claude-code');
    expect(entries).toHaveLength(0);
  });
});

/**
 * Slice 2026-07-29-worktree-layer3-deny: Layer 3 governance writes a
 * `permissions.deny: ["UseSkill(superpowers:using-git-worktrees)", ...]`
 * block into the same settings.json the gate-enforce hook is installed
 * into. The pure helpers `withSuperpowersSkillDenylist` /
 * `withoutSuperpowersSkillDenylist` / `listSuperpowersDenyEntries` are
 * the only public API; `applyHookInstall` / `removeHookInstall` invoke
 * them as part of their atomic write.
 *
 * These tests cover the pure helpers AND the end-to-end install/uninstall
 * round-trip on a real settings.json file. They do NOT exercise
 * `hooks-commands.ts` (that lives in hooks-commands tests).
 */
describe('slice 2026-07-29-worktree-layer3-deny: pure helpers', () => {
  test('listSuperpowersDenyEntries returns the documented sentinel set', () => {
    const entries = listSuperpowersDenyEntries();
    // Single source of truth — the slice must lock this list down.
    expect(entries).toEqual(['UseSkill(superpowers:using-git-worktrees)']);
    // Cross-check the upstream constant is non-empty (otherwise the list
    // would be misleading).
    expect(SUPERPOWERS_DENIED_SKILLS.length).toBeGreaterThan(0);
  });

  test('withSuperpowersSkillDenylist adds the deny entry to an empty settings', () => {
    const out = withSuperpowersSkillDenylist({});
    const deny = (out.permissions as { deny: string[] }).deny;
    expect(deny).toContain('UseSkill(superpowers:using-git-worktrees)');
  });

  test('withSuperpowersSkillDenylist preserves user-written deny entries', () => {
    const settings = {
      permissions: { deny: ['UseSkill(foo:bar)', 'Bash(rm:*)'] }
    };
    const out = withSuperpowersSkillDenylist(settings);
    const deny = (out.permissions as { deny: string[] }).deny;
    expect(deny).toContain('UseSkill(foo:bar)');
    expect(deny).toContain('Bash(rm:*)');
    expect(deny).toContain('UseSkill(superpowers:using-git-worktrees)');
  });

  test('withSuperpowersSkillDenylist is idempotent — re-running does not duplicate', () => {
    const once = withSuperpowersSkillDenylist({});
    const twice = withSuperpowersSkillDenylist(once);
    const deny = (twice.permissions as { deny: string[] }).deny;
    const count = deny.filter((d) => d === 'UseSkill(superpowers:using-git-worktrees)').length;
    expect(count).toBe(1);
  });

  test('withSuperpowersSkillDenylist replaces a non-array permissions.deny with a fresh array', () => {
    // Defensive: if the user wrote `deny: "UseSkill(foo:bar)"` (string
    // instead of array), the install must not propagate the malformed
    // shape — it replaces with a fresh array containing only our entries.
    const settings = { permissions: { deny: 'UseSkill(foo:bar)' as unknown as string[] } };
    const out = withSuperpowersSkillDenylist(settings);
    const deny = (out.permissions as { deny: string[] }).deny;
    expect(Array.isArray(deny)).toBe(true);
    expect(deny).toContain('UseSkill(superpowers:using-git-worktrees)');
    // The malformed string entry is NOT carried over (replace, not merge).
    expect(deny).not.toContain('UseSkill(foo:bar)');
  });

  test('withSuperpowersSkillDenylist does not mutate the input', () => {
    const settings = { permissions: { deny: ['Bash(rm:*)'] } };
    const before = JSON.stringify(settings);
    withSuperpowersSkillDenylist(settings);
    expect(JSON.stringify(settings)).toBe(before);
  });

  test('withoutSuperpowersSkillDenylist strips the entry and preserves user-written ones', () => {
    const settings = {
      permissions: {
        deny: ['UseSkill(foo:bar)', 'UseSkill(superpowers:using-git-worktrees)', 'Bash(rm:*)']
      }
    };
    const out = withoutSuperpowersSkillDenylist(settings);
    const deny = (out.permissions as { deny: string[] }).deny;
    expect(deny).not.toContain('UseSkill(superpowers:using-git-worktrees)');
    expect(deny).toContain('UseSkill(foo:bar)');
    expect(deny).toContain('Bash(rm:*)');
  });

  test('withoutSuperpowersSkillDenylist drops an empty permissions object entirely', () => {
    const settings = {
      model: 'sonnet',
      permissions: { deny: ['UseSkill(superpowers:using-git-worktrees)'] }
    };
    const out = withoutSuperpowersSkillDenylist(settings);
    expect(out.permissions).toBeUndefined();
    expect(out.model).toBe('sonnet');
  });

  test('withoutSuperpowersSkillDenylist is a no-op when deny is absent', () => {
    const settings = { model: 'sonnet' };
    const out = withoutSuperpowersSkillDenylist(settings);
    expect(out).toEqual(settings);
  });
});

describe('slice 2026-07-29-worktree-layer3-deny: install / uninstall round-trip on settings.json', () => {
  test('install writes the deny entry alongside the gate-enforce hook', async () => {
    applyHookInstall('project', project);
    const settings = await readSettings();
    const deny = (settings.permissions as { deny: string[] }).deny;
    expect(deny).toContain('UseSkill(superpowers:using-git-worktrees)');
    // Gate hook is also installed (single atomic write).
    expect(settings.hooks).toBeDefined();
  });

  test('install is idempotent — second call does not duplicate deny entry', async () => {
    applyHookInstall('project', project);
    applyHookInstall('project', project);
    const settings = await readSettings();
    const deny = (settings.permissions as { deny: string[] }).deny;
    const count = deny.filter((d) => d === 'UseSkill(superpowers:using-git-worktrees)').length;
    expect(count).toBe(1);
  });

  test('install preserves user-written deny entries (additive, not destructive)', async () => {
    await writeSettings({
      permissions: { deny: ['UseSkill(foo:bar)', 'Bash(rm:*)'] }
    });
    applyHookInstall('project', project);
    const settings = await readSettings();
    const deny = (settings.permissions as { deny: string[] }).deny;
    expect(deny).toContain('UseSkill(foo:bar)');
    expect(deny).toContain('Bash(rm:*)');
    expect(deny).toContain('UseSkill(superpowers:using-git-worktrees)');
  });

  test('uninstall strips the deny entry but keeps user-written ones', async () => {
    await writeSettings({
      permissions: { deny: ['UseSkill(foo:bar)'] }
    });
    applyHookInstall('project', project);
    // Sanity: deny now has both.
    const afterInstall = await readSettings();
    const installedDeny = (afterInstall.permissions as { deny: string[] }).deny;
    expect(installedDeny).toContain('UseSkill(foo:bar)');
    expect(installedDeny).toContain('UseSkill(superpowers:using-git-worktrees)');
    removeHookInstall('project', project);
    const afterUninstall = await readSettings();
    const deny = (afterUninstall.permissions as { deny: string[] }).deny;
    expect(deny).toContain('UseSkill(foo:bar)');
    expect(deny).not.toContain('UseSkill(superpowers:using-git-worktrees)');
  });

  test('uninstall drops an empty permissions object (no leftover {})', async () => {
    applyHookInstall('project', project);
    removeHookInstall('project', project);
    const settings = await readSettings();
    expect(settings.permissions).toBeUndefined();
  });

  test('install + uninstall round-trip preserves all non-hook non-permissions keys', async () => {
    await writeSettings({
      model: 'sonnet',
      env: { SOMETHING: '1' },
      hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo other' }] }] }
    });
    applyHookInstall('project', project);
    removeHookInstall('project', project);
    const settings = await readSettings();
    expect(settings.model).toBe('sonnet');
    expect(settings.env).toEqual({ SOMETHING: '1' });
    // The user-written Write hook survives.
    const pre = (settings.hooks as { PreToolUse: { matcher: string }[] }).PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0]!.matcher).toBe('Write');
  });

  test('install works when settings.json is completely absent (creates permissions from scratch)', async () => {
    // No pre-existing settings.json — applyHookInstall creates it.
    const result = applyHookInstall('project', project);
    expect(result.applied).toBe(true);
    const settings = await readSettings();
    const deny = (settings.permissions as { deny: string[] }).deny;
    expect(deny).toContain('UseSkill(superpowers:using-git-worktrees)');
  });
});

/**
 * Slice 2026-07-29-worktree-l2-extended Part 27 — trigger-style
 * deny. When the existing settings file has a superpowers or
 * raw-git-worktree entry, peaks appends a defensive `Edit`
 * deny so the chain cannot run without an explicit
 * `peaks hooks uninstall` first.
 */
describe('slice Part 27: trigger-style deny (withTriggeredDenyList)', () => {
  test('does not modify settings when no trigger phrase is present', () => {
    const out = withTriggeredDenyList({
      permissions: { deny: ['UseSkill(other:thing)'] }
    });
    const deny = (out.permissions as { deny: string[] }).deny;
    expect(deny).toEqual(['UseSkill(other:thing)']);
    expect(deny.some((d) => d.startsWith('Edit(deny-trigger:'))).toBe(false);
  });

  test('appends a trigger deny when superpowers:using-git-worktrees appears in deny', () => {
    const out = withTriggeredDenyList({
      permissions: { deny: ['UseSkill(superpowers:using-git-worktrees)'] }
    });
    const deny = (out.permissions as { deny: string[] }).deny;
    expect(deny).toContain('Edit(deny-trigger:superpowers:using-git-worktrees)');
  });

  test('appends a trigger deny when the trigger phrase is in the allow list', () => {
    const out = withTriggeredDenyList({
      permissions: { allow: ['Bash(git worktree add:*)'] }
    });
    const deny = (out.permissions as { deny: string[] }).deny;
    // Trigger is `Bash(git worktree add` (no closing paren) so the
    // deny entry is exactly that prefix. We assert the prefix so
    // the test does not depend on the trigger-phrase terminator.
    expect(deny.some((d) => d.startsWith('Edit(deny-trigger:Bash(git worktree add'))).toBe(true);
  });

  test('is idempotent — running twice yields the same output', () => {
    const input = { permissions: { deny: ['UseSkill(superpowers:using-git-worktrees)'] } };
    const once = withTriggeredDenyList(input);
    const twice = withTriggeredDenyList(once);
    expect(twice).toEqual(once);
  });

  test('withoutTriggeredDenyList strips the trigger entries but keeps user entries', () => {
    const input = {
      permissions: {
        deny: [
          'UseSkill(other:thing)',
          'Edit(deny-trigger:superpowers:using-git-worktrees)',
          'Edit(deny-trigger:Bash(git worktree add'
        ]
      }
    };
    const out = withoutTriggeredDenyList(input);
    const deny = (out.permissions as { deny: string[] }).deny;
    expect(deny).toEqual(['UseSkill(other:thing)']);
  });

  test('TRIGGER_PHRASES is the source of truth (locked at 6 entries)', () => {
    expect(TRIGGER_PHRASES.length).toBe(6);
    expect(TRIGGER_PHRASES).toContain('superpowers:using-git-worktrees');
    expect(TRIGGER_PHRASES).toContain('Bash(git worktree add');
    expect(TRIGGER_PHRASES).toContain('Bash(podman run');
  });
});
