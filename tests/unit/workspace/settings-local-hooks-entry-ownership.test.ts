/**
 * rid 2026-09-13-two-decisions item ② — the local `hooks` list is owned PER
 * ENTRY, not per key.
 *
 * `.claude/settings.local.json` has two writers of peaks' own hooks: `peaks
 * workspace init` (this materializer) and `installAutoCompactHook` (reached
 * from `peaks code auto-compact`, which appends a `Bash|Task` entry). While the
 * template owned the whole `hooks` key, the second writer's entry was deleted
 * by the next init and nothing re-installed it — the auto-compact contract
 * stopped silently.
 *
 * The fix has two halves that only work together, and both are pinned here:
 *
 *   1. the MERGE keeps every on-disk entry the template does not declare
 *      (`mergeTemplateOwnedHooks`);
 *   2. the COMPARATOR asks "is every entry the generated tree declares present
 *      on disk?" instead of "are the two trees identical" — without which the
 *      merged 4-entry file would look drifted against a 3-entry generated tree
 *      on every init, reporting `refreshed` forever.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installAutoCompactHook } from '~/src/services/hooks/auto-compact-hook-install';
import {
  buildClaudeSettingsLocalJson,
  mergeTemplateOwnedHooks,
  templateContentMatches
} from '~/src/services/workspace/claude-settings-template';
import { materializeClaudeSettingsLocal } from '~/src/services/workspace/workspace-claude-settings-materializer';

type PreToolUseEntry = { matcher: string; hooks: Array<{ type?: string; command?: string; shell?: string }> };

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
  const root = mkdtempSync(join(tmpdir(), 'peaks-hooks-entry-ownership-'));
  tmpRoots.push(root);
  return root;
}

function localSettingsPath(projectRoot: string): string {
  return join(projectRoot, '.claude', 'settings.local.json');
}

function offlineCopyPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', '.claude-settings-template.json');
}

function seedLocalSettings(projectRoot: string, value: unknown): void {
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(localSettingsPath(projectRoot), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readLocalSettings(projectRoot: string): Record<string, unknown> {
  return JSON.parse(readFileSync(localSettingsPath(projectRoot), 'utf8')) as Record<string, unknown>;
}

function readPreToolUse(projectRoot: string): PreToolUseEntry[] {
  return (readLocalSettings(projectRoot).hooks as { PreToolUse: PreToolUseEntry[] }).PreToolUse;
}

function matchers(projectRoot: string): string[] {
  return readPreToolUse(projectRoot).map((entry) => entry.matcher);
}

/** Hand-break the FIRST template-declared entry: the one real drift signal. */
function breakFirstDeclaredEntry(projectRoot: string, command = 'echo hand-edited-by-a-user'): void {
  const settings = readLocalSettings(projectRoot) as {
    hooks: { PreToolUse: PreToolUseEntry[] };
    [key: string]: unknown;
  };
  settings.hooks.PreToolUse[0]!.hooks[0]!.command = command;
  writeFileSync(localSettingsPath(projectRoot), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

describe('the local hooks list is owned per entry, not per key', () => {
  it('when a second writer installs its hook, should survive the next init', async () => {
    // given: a project initialized by the template, then handed to the OTHER
    //        writer of this file (the auto-compact installer)
    const root = makeProject();
    await materializeClaudeSettingsLocal(root, false);
    expect(matchers(root)).toEqual(['Bash', 'Bash']);
    installAutoCompactHook({ projectRoot: root });
    expect(matchers(root)).toEqual(['Bash', 'Bash', 'Bash|Task']);
    // when: `peaks workspace init` runs again — twice, since one init only
    //       proves the entry was not deleted once
    const second = await materializeClaudeSettingsLocal(root, false);
    const third = await materializeClaudeSettingsLocal(root, false);
    // then: the entry is still there at 3, both times
    expect(matchers(root)).toEqual(['Bash', 'Bash', 'Bash|Task']);
    expect(readPreToolUse(root).length).toBe(3);
    // and: neither init reported drift — a merge without the matching
    //      comparator change would report `refreshed` here on EVERY init
    expect(second.action).toBe('already-current');
    expect(third.action).toBe('already-current');
    expect(second.offlineTemplate.action).toBe('already-current');
    expect(third.offlineTemplate.action).toBe('already-current');
  });

  it('when a template-declared entry is hand-edited, should refresh and repair it', async () => {
    // given: a file whose declared entry was hand-edited, plus an extra entry
    //        from the second writer
    const root = makeProject();
    await materializeClaudeSettingsLocal(root, false);
    installAutoCompactHook({ projectRoot: root });
    breakFirstDeclaredEntry(root);
    // when: the materializer runs
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: the template's entry is restored, the broken command is gone, and
    //       the second writer's entry is untouched — a whole-key rewrite would
    //       have deleted it, an equality-only comparator would have missed the
    //       drift entirely
    expect(result.action).toBe('refreshed');
    expect(readFileSync(localSettingsPath(root), 'utf8')).not.toContain('hand-edited-by-a-user');
    expect(readPreToolUse(root)[0]).toEqual({ matcher: 'Bash', hooks: [buildClaudeSettingsLocalJson().hooks.PreToolUse[0]!.hooks[0]] });
    expect(matchers(root)).toEqual(['Bash', 'Bash', 'Bash|Task']);
  });

  it('when an undeclared event sits beside a drifted entry, should keep the event', async () => {
    // given: a hand-added `SessionStart` entry (the latent half of the same
    //        hazard — the template declares `PreToolUse` only) plus a drifted
    //        declared entry, so the rewrite path really runs
    const root = makeProject();
    await materializeClaudeSettingsLocal(root, false);
    const settings = readLocalSettings(root) as { hooks: Record<string, unknown>; [key: string]: unknown };
    const entry = { matcher: 'compact', hooks: [{ type: 'command', command: 'echo keep-me' }] };
    settings.hooks.SessionStart = [entry];
    writeFileSync(localSettingsPath(root), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    breakFirstDeclaredEntry(root);
    // when: the materializer runs
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: the rewrite repaired the declared entry and preserved the event
    expect(result.action).toBe('refreshed');
    expect((readLocalSettings(root).hooks as { SessionStart?: unknown }).SessionStart).toEqual([entry]);
    expect(readFileSync(localSettingsPath(root), 'utf8')).not.toContain('hand-edited-by-a-user');
  });

  it('when a surplus entry shares a declared matcher, should keep it', async () => {
    // given: the template declares TWO `Bash` entries; this file carries a
    //        third, the user's own
    const root = makeProject();
    const seeded = buildClaudeSettingsLocalJson();
    seeded.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-added' }] });
    seedLocalSettings(root, seeded);
    // when: the materializer runs
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: a file that already declares every template entry is current, and
    //       the surplus entry is not a reason to rewrite
    expect(result.action).toBe('already-current');
    // and: the moment a rewrite IS needed, the surplus entry comes through it
    breakFirstDeclaredEntry(root);
    const refreshed = await materializeClaudeSettingsLocal(root, false);
    expect(refreshed.action).toBe('refreshed');
    expect(readPreToolUse(root).at(-1)).toEqual({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo user-added' }]
    });
  });

  it('when the offline copy is stale, should self-heal it', async () => {
    // given: an installed project whose offline copy is an OLDER release's
    //        template — the env block (1.7.0) is missing, and the first
    //        declared handler still carries an older command
    const root = makeProject();
    await materializeClaudeSettingsLocal(root, false);
    const stale = JSON.parse(readFileSync(offlineCopyPath(root), 'utf8')) as {
      hooks: { PreToolUse: PreToolUseEntry[] };
      env?: unknown;
    };
    stale.hooks.PreToolUse[0]!.hooks[0]!.command = 'node -e "process.exit(0)"';
    delete stale.env;
    writeFileSync(offlineCopyPath(root), `${JSON.stringify(stale, null, 2)}\n`, 'utf8');
    // when: the materializer runs
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: the drift-driven self-heal fired, and the repaired copy is current
    expect(result.offlineTemplate.action).toBe('refreshed');
    expect(readFileSync(offlineCopyPath(root), 'utf8')).not.toContain('process.exit(0)');
    const settled = await materializeClaudeSettingsLocal(root, false);
    expect(settled.offlineTemplate.action).toBe('already-current');
  });

  it('when the two trees are compared, should require every generated entry and ignore extras', () => {
    // given: the generated tree, and a file carrying it plus one more entry
    const generated = JSON.stringify(buildClaudeSettingsLocalJson());
    const superset = buildClaudeSettingsLocalJson();
    superset.hooks.PreToolUse.push({ matcher: 'Bash|Task', hooks: [{ type: 'command', command: 'echo extra' }] });
    // when/then: extras neither break the match nor excuse a missing entry
    expect(templateContentMatches(generated, JSON.stringify(superset))).toBe(true);
    const truncated = buildClaudeSettingsLocalJson();
    truncated.hooks.PreToolUse.pop();
    expect(templateContentMatches(generated, JSON.stringify(truncated))).toBe(false);
    // and: a surplus entry on a DECLARED matcher is just another extra — the
    //      template declares two `Bash` entries, this file carries three
    const extraBash = buildClaudeSettingsLocalJson();
    extraBash.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-added' }] });
    expect(templateContentMatches(generated, JSON.stringify(extraBash))).toBe(true);
    // and: matching is per entry, not per slot — replacing one declared `Bash`
    //      handler with a copy of its sibling leaves the count intact and is
    //      still drift
    const swapped = buildClaudeSettingsLocalJson();
    swapped.hooks.PreToolUse[1] = { matcher: 'Bash', hooks: [swapped.hooks.PreToolUse[0]!.hooks[0]!] };
    expect(templateContentMatches(generated, JSON.stringify(swapped))).toBe(false);
  });

  it('when the merge runs twice, should be a fixed point', () => {
    // given: an on-disk tree with extras and a drifted declared entry
    const template = buildClaudeSettingsLocalJson().hooks.PreToolUse;
    const break0 = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo broken' }] };
    const onDisk = [break0, ...template.slice(1), { matcher: 'Bash|Task', hooks: [{ type: 'command', command: 'echo extra' }] }];
    // when: the merge is applied, then applied again to its own output
    const once = mergeTemplateOwnedHooks(onDisk, template);
    const twice = mergeTemplateOwnedHooks(once, template);
    // then: the declared entries win, the extras are kept, and the second pass
    //       changes nothing
    expect(once).toEqual([...template, { matcher: 'Bash|Task', hooks: [{ type: 'command', command: 'echo extra' }] }]);
    expect(twice).toEqual(once);
  });

  it('when a pre-1.8.0 file still carries the retired write-gate entry, should drop it', () => {
    // given: the entry TEMPLATE_VERSION 1.8.0 retired, exactly as an earlier
    //        release emitted it — a `node "<abs>/services/hooks/write-gate.js"`
    //        handler on the legacy matcher spelling
    const template = buildClaudeSettingsLocalJson().hooks.PreToolUse;
    const retired = {
      matcher: 'Write|Edit|MultiEdit',
      hooks: [
        {
          type: 'command',
          command: 'node "C:/Users/x/AppData/Local/nvm/v24.14.0/node_modules/peaks-loop/dist/services/hooks/write-gate.js"',
          shell: 'powershell'
        }
      ]
    };
    // when: the merge runs over a file that still holds it
    const merged = mergeTemplateOwnedHooks([retired, ...template], template);
    // then: it is gone — declaring less does not retire it, because preserving
    //       undeclared entries is what the merge does
    expect(merged).toEqual([...template]);
    expect(JSON.stringify(merged)).not.toContain('write-gate.js');
  });

  it('when a pre-1.8.0 file is compared, should report drift so the retirement can reach it', async () => {
    // Given: a file that declares every entry the template declares AND the
    // env exemptions, plus the retired entry. Containment alone calls this
    // "current" — measured against the real CLI, which then never rewrote and
    // left the retired handler in place verbatim.
    const root = makeProject();
    const retired = {
      matcher: 'Write|Edit|MultiEdit',
      hooks: [
        {
          type: 'command',
          command: 'node "C:/Users/x/AppData/Local/nvm/v24.14.0/node_modules/peaks-loop/dist/services/hooks/write-gate.js"',
          shell: 'powershell'
        }
      ]
    };
    // Built as a new tree rather than `unshift`-ed into the generated one: the
    // generated entry type pins the literal `type: 'command'`, and a widened
    // fixture would not typecheck against it. (A cast here would work too and
    // would be worse — it would hide a real mismatch in a future fixture.)
    const generated = buildClaudeSettingsLocalJson();
    const seeded = {
      ...generated,
      hooks: { PreToolUse: [retired, ...generated.hooks.PreToolUse] }
    };
    seedLocalSettings(root, seeded);
    expect(
      templateContentMatches(JSON.stringify(buildClaudeSettingsLocalJson()), JSON.stringify(seeded)),
      'a file carrying a retired entry must not compare as current'
    ).toBe(false);

    // when: the materializer runs
    const first = await materializeClaudeSettingsLocal(root, false);
    // then: it rewrites, and the retired entry is gone…
    expect(first.action).toBe('refreshed');
    expect(readFileSync(localSettingsPath(root), 'utf8')).not.toContain('write-gate');
    expect(matchers(root)).toEqual(['Bash', 'Bash']);
    // …and the next run is the fixed point, not a rewrite loop
    const second = await materializeClaudeSettingsLocal(root, false);
    expect(second.action).toBe('already-current');
  });

  it('when a user owns a Write|Edit|MultiEdit entry, should keep it', () => {
    // given: the same matcher with a command that is NOT the retired handler —
    //        a user's own hook, or another tool's
    const template = buildClaudeSettingsLocalJson().hooks.PreToolUse;
    const userOwned = { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: 'echo mine' }] };
    // when: the merge runs
    const merged = mergeTemplateOwnedHooks([userOwned, ...template], template);
    // then: the retirement predicate did not reach it — a looser "drop anything
    //       on this matcher" rule would have deleted a user's hook
    expect(merged).toEqual([...template, userOwned]);
  });
});
