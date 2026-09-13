/**
 * `peaks workspace init` is the SECOND writer of `.claude/settings.local.json`,
 * and it rewrote the file from the template rather than merging into it. Any
 * top-level key the user owns — `permissions.allow` above all — was gone after
 * an init that had nothing to do with it.
 *
 * Observed by QA: a project carrying `permissions.allow` rules lost them on the
 * next `peaks workspace init`. The user's permission rules are not peaks-loop's
 * to delete, and the deletion is silent (the envelope only reports
 * `refreshed`).
 *
 * The two key namespaces this function DOES own are pinned here as well, so the
 * fix cannot be "merge disk over template" flat: `hooks` is the tree this
 * function exists to keep in sync (`templateContentMatches` is the drift
 * detector, and it compares exactly this tree), and `env` is jointly written
 * with `peaks hooks install`. Both must keep their current precedence or the
 * drift refresh stops converging.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { materializeClaudeSettingsLocal } from '~/src/services/workspace/workspace-claude-settings-materializer';
import { buildClaudeSettingsLocalJson } from '~/src/services/workspace/claude-settings-template';

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) {
    try {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tmpRoots.length = 0;
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-settings-local-keys-'));
  tmpRoots.push(root);
  return root;
}

function settingsPath(projectRoot: string): string {
  return join(projectRoot, '.claude', 'settings.local.json');
}

function seed(projectRoot: string, value: unknown): void {
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(settingsPath(projectRoot), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function read(projectRoot: string): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(projectRoot), 'utf8')) as Record<string, unknown>;
}

describe('workspace init keeps the settings.local.json keys it does not own', () => {
  it('when a project already carries permissions.allow, should survive a materialization', async () => {
    // given: a project whose local settings file holds ONLY a user-authored
    //        permissions block (no template content at all yet)
    const root = makeProject();
    seed(root, { permissions: { allow: ['Bash(git status)', 'Read'] } });
    // when: `peaks workspace init` materializes the template
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: the write happened, the template landed, and the user's rules are
    //       still there
    expect(result.action).toBe('refreshed');
    const written = read(root);
    expect(written.permissions).toEqual({ allow: ['Bash(git status)', 'Read'] });
    expect(written.hooks).toBeDefined();
  });

  it('when a project carries keys peaks has no concept of, should keep them all', async () => {
    // given: keys peaks-loop never emits — the point being that a preserved-key
    //        whitelist would drop whichever one the next release adds
    const root = makeProject();
    seed(root, {
      model: 'opusplan',
      statusLine: { type: 'command', command: 'node statusline.js' },
      includeCoAuthoredBy: false,
      permissions: { allow: ['Bash(ls:*)'], deny: ['Bash(rm -rf /)'] }
    });
    // when: the materializer rewrites the file
    await materializeClaudeSettingsLocal(root, false);
    // then: every user key survives verbatim
    const written = read(root);
    expect(written.model).toBe('opusplan');
    expect(written.statusLine).toEqual({ type: 'command', command: 'node statusline.js' });
    expect(written.includeCoAuthoredBy).toBe(false);
    expect(written.permissions).toEqual({ allow: ['Bash(ls:*)'], deny: ['Bash(rm -rf /)'] });
  });

  it('when a template-declared entry has drifted, should refresh it and keep the rest', async () => {
    // given: a file whose TEMPLATE-DECLARED entry was hand-edited — which is
    //        what drift means now — alongside an entry the template does not
    //        declare and a key the user owns
    const root = makeProject();
    const drifted = buildClaudeSettingsLocalJson();
    drifted.hooks.PreToolUse[0]!.hooks[0]!.command = 'echo hand-edited-by-a-user';
    drifted.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo user-added' }]
    });
    seed(root, { ...drifted, permissions: { allow: ['Bash(git diff:*)'] } });
    // when: the materializer refreshes
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: the entry the template declares is repaired and the hand-edited
    //       command is gone — while the surplus `Bash` entry (the template
    //       declares two, this is a third) and the user's own key are carried
    //       across. `hooks` is templated per ENTRY, not per key.
    expect(result.action).toBe('refreshed');
    const written = read(root);
    expect(JSON.stringify(written.hooks)).not.toContain('hand-edited-by-a-user');
    const writtenPreToolUse = (written.hooks as { PreToolUse: unknown[] }).PreToolUse;
    expect(writtenPreToolUse).toEqual([
      ...buildClaudeSettingsLocalJson().hooks.PreToolUse,
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-added' }] }
    ]);
    expect(written.permissions).toEqual({ allow: ['Bash(git diff:*)'] });
  });

  it('when the file is already current, should still be a no-op', async () => {
    // given: a fully materialized project that also carries a user key
    const root = makeProject();
    seed(root, { ...buildClaudeSettingsLocalJson(), permissions: { allow: ['Read'] } });
    // when: the materializer runs
    const first = await materializeClaudeSettingsLocal(root, false);
    const second = await materializeClaudeSettingsLocal(root, false);
    // then: no churn, and the user key is still intact afterwards
    expect(first.action).toBe('already-current');
    expect(second.action).toBe('already-current');
    expect(read(root).permissions).toEqual({ allow: ['Read'] });
  });
});
