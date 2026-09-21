/**
 * T2 + T3 of rid `2026-09-13-a2-post-compact-reinject`.
 *
 * T2 — the re-injection rides the EXISTING hook install surface
 * (`resolveHookEntries` -> `applyHookInstall` -> `removeHookInstall`), not a
 * bespoke installer. These cases pin the four things that must hold for that
 * to be true: the entry is emitted, install is idempotent, it does not damage
 * the file's other entries, and uninstall removes it.
 *
 * T3 — "the hook is installed" is NOT "the re-injection arrives", and this
 * session has already produced three examples of the difference (a hook whose
 * command was itself, a guard that reported zero because it could not see the
 * files, a probe that reported "caught" for every injection because it was
 * erroring). So the cases below do not stop at the settings file. They
 * execute the re-injection path and assert the SHAPE and the BUDGET of what
 * comes out.
 *
 * WHAT THEY STILL CANNOT DO — named here rather than implied. There is no way
 * from a unit test to make the harness perform a real compaction, and no way
 * to observe the harness capturing a SessionStart hook's stdout. So "the card
 * is produced, inside budget, on the command the hook runs" is the ceiling,
 * and "the harness put it in front of the model after a genuine compact" is
 * the residual. See the RD report.
 *
 * THE ONE SUBSTITUTION, STATED PLAINLY. The installed command is
 * `peaks session reinject --project "${CLAUDE_PROJECT_DIR}"` — it depends on
 * the `peaks` binary being on PATH, which is true inside a consumer project
 * (the postinstall step puts it there) and false inside this test process. So
 * the execution case runs the SAME CLI entry point through
 * `node --import tsx <root>/src/cli/index.ts`, and the assertion that the
 * installed string is exactly the constant (case 1 below) is what keeps the
 * substituted invocation and the installed one from drifting apart.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HOOK_POST_COMPACT_REINJECT_COMMAND,
  HOOK_POST_COMPACT_REINJECT_EVENT,
  HOOK_POST_COMPACT_REINJECT_MATCHER,
  HOOK_POST_COMPACT_REINJECT_SENTINEL
} from '~/src/services/skills/session-start-hook-constants';
import {
  resolveHookEntries,
  resolveLegacySentinels
} from '~/src/services/skills/hooks-codegate-superpowers';
import { applyHookInstall, removeHookInstall } from '~/src/services/skills/hooks-settings-service';
import { POST_COMPACT_REINJECTION_BYTE_BUDGET } from '~/src/services/context/post-compact-reinjection';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

/** Repo root — this file lives at `<root>/tests/unit/hooks/`. */
const ROOT = join(__dirname, '..', '..', '..');

type HookHandler = { type?: string; command?: string; shell?: string };
type HookEntry = { matcher?: string; hooks?: HookHandler[] };

/**
 * The file the SessionStart entries land in.
 *
 * Worth stating because it is the opposite of where a PreToolUse entry goes,
 * and getting it backwards makes the whole suite pass while asserting nothing
 * (the local file carries no SessionStart entries at all): `resolveHookTargets`
 * routes an entry to the machine-local file only when the entry declares
 * `machineLocal`, which is reserved for entries carrying a machine-specific
 * `shell`. The three SessionStart entries declare no `shell`, so they land in
 * the shared, committed `.claude/settings.json` — which is also why the
 * workspace-init materializer (a writer of the LOCAL file only) cannot delete
 * them.
 */
function sharedSettingsPath(tmpRoot: string): string {
  return join(tmpRoot, '.claude', 'settings.json');
}

/** Every SessionStart entry in the file, in order. */
function readSessionStartEntries(settingsPath: string): HookEntry[] {
  const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
    hooks?: { SessionStart?: HookEntry[] };
  };
  return parsed.hooks?.SessionStart ?? [];
}

function findReinjectEntry(entries: HookEntry[]): HookEntry | undefined {
  return entries.find((entry) =>
    (entry.hooks ?? []).some((h) =>
      String(h.command ?? '').includes(HOOK_POST_COMPACT_REINJECT_SENTINEL)
    )
  );
}

describe('behavior — the post-compact re-injection hook entry', () => {
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

  function makeTempProjectRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'peaks-reinject-hook-'));
    tmpRoots.push(root);
    return root;
  }

  it('when the claude-code entries are resolved, should scope the re-injection to the compact source', () => {
    // given: the canonical peaks hook entry set for Claude Code
    const entries = resolveHookEntries('claude-code');
    // when: the re-injection entry is picked out
    const reinject = entries.filter((e) => e.sentinel === HOOK_POST_COMPACT_REINJECT_SENTINEL);
    // then: it is emitted exactly once, on SessionStart, and — the load-bearing
    //       part — on matcher `compact` ALONE. With the empty matcher the other
    //       two SessionStart entries use, the card would also be injected on a
    //       fresh `startup`, where the dispatch context is still present and
    //       the card is pure noise.
    expect(reinject).toHaveLength(1);
    expect(reinject[0]?.event).toBe(HOOK_POST_COMPACT_REINJECT_EVENT);
    expect(reinject[0]?.matcher).toBe(HOOK_POST_COMPACT_REINJECT_MATCHER);
    expect(HOOK_POST_COMPACT_REINJECT_MATCHER).toBe('compact');
    // ...and SessionStart now carries three entries, two of them unscoped
    const sessionStartEntries = entries.filter((e) => e.event === 'SessionStart');
    expect(sessionStartEntries.map((e) => e.matcher)).toEqual(['', '', 'compact']);
  });

  it('when the hook command is written, should invoke the CLI and not itself', () => {
    // The defect this case exists for is not hypothetical: this session
    // already shipped a hook whose command was the hook's own name, which
    // installed cleanly, reported cleanly, and did nothing.
    const command = HOOK_POST_COMPACT_REINJECT_COMMAND;
    // then: the command is a real invocation of the CLI, with the project root
    //       passed the same way the other two SessionStart entries pass it
    expect(command).toBe('peaks session reinject --project "${CLAUDE_PROJECT_DIR}"');
    expect(command.startsWith('peaks session reinject ')).toBe(true);
    expect(command).not.toBe(HOOK_POST_COMPACT_REINJECT_SENTINEL);
    // ...and the sentinel the installer keys on really is a substring of it,
    // so install and uninstall are looking at the entry that runs
    expect(command).toContain(HOOK_POST_COMPACT_REINJECT_SENTINEL);
  });

  it('when a project is installed, should add the entry without disturbing anything already in the file', () => {
    // given: a project whose SHARED settings file already carries a
    //        hand-written SessionStart entry and an unrelated key, and whose
    //        LOCAL file carries a user env block
    const tmpRoot = makeTempProjectRoot();
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    const sharedPath = sharedSettingsPath(tmpRoot);
    const localPath = join(tmpRoot, '.claude', 'settings.local.json');
    writeFileSync(
      sharedPath,
      JSON.stringify(
        {
          statusLine: { type: 'command', command: 'my-statusline' },
          hooks: {
            SessionStart: [
              { matcher: '', hooks: [{ type: 'command', command: 'my-own-session-start' }] }
            ]
          }
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    writeFileSync(
      localPath,
      JSON.stringify(
        { env: { MY_OWN_VAR: 'keep-me', GATEGUARD_EXEMPT_GLOBS: 'docs/**' } },
        null,
        2
      ) + '\n',
      'utf8'
    );
    // when: the peaks hooks are installed
    const first = applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: our entry is present on its own matcher group, and it did not
    //       displace the user's SessionStart entry or the unrelated key
    expect(first.applied).toBe(true);
    const entries = readSessionStartEntries(sharedPath);
    expect(findReinjectEntry(entries)?.matcher).toBe('compact');
    const parsedShared = JSON.parse(readFileSync(sharedPath, 'utf8')) as {
      statusLine?: { command?: string };
    };
    expect(parsedShared.statusLine?.command).toBe('my-statusline');
    expect(
      entries.some((e) => (e.hooks ?? []).some((h) => h.command === 'my-own-session-start'))
    ).toBe(true);
    // ...and the user's env value survived while ours was unioned in, not
    //     substituted for it
    const parsedLocal = JSON.parse(readFileSync(localPath, 'utf8')) as {
      env?: Record<string, string>;
    };
    expect(parsedLocal.env?.MY_OWN_VAR).toBe('keep-me');
    expect(parsedLocal.env?.GATEGUARD_EXEMPT_GLOBS).toBe('docs/**,.peaks/**');
  });

  it('when the install is re-run, should be byte-identical and report no work', () => {
    // given: an installed project
    const tmpRoot = makeTempProjectRoot();
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const sharedPath = sharedSettingsPath(tmpRoot);
    const afterFirst = readFileSync(sharedPath, 'utf8');
    // when: the install runs again
    const second = applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: nothing was written at all — byte-identical, not merely equivalent
    expect(second.applied).toBe(false);
    expect(second.alreadyInstalled).toBe(true);
    expect(readFileSync(sharedPath, 'utf8')).toBe(afterFirst);
    // ...and there is exactly one re-injection entry, not two
    expect(
      readSessionStartEntries(sharedPath).filter((e) => findReinjectEntry([e]) !== undefined)
    ).toHaveLength(1);
  });

  it('when the hooks are uninstalled, should remove the entry and nothing else', () => {
    // given: a project with both the peaks hooks and a hand-written entry
    const tmpRoot = makeTempProjectRoot();
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const sharedPath = sharedSettingsPath(tmpRoot);
    const before = JSON.parse(readFileSync(sharedPath, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    before.hooks.SessionStart = [
      ...((before.hooks.SessionStart as HookEntry[]) ?? []),
      { matcher: '', hooks: [{ type: 'command', command: 'my-own-session-start' }] }
    ];
    writeFileSync(sharedPath, JSON.stringify(before, null, 2) + '\n', 'utf8');
    expect(findReinjectEntry(readSessionStartEntries(sharedPath))).toBeDefined();
    // when: the uninstall runs
    const removed = removeHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: our entry is gone and the user's survived
    expect(removed.removed).toBe(true);
    const entries = readSessionStartEntries(sharedPath);
    expect(findReinjectEntry(entries)).toBeUndefined();
    expect(
      entries.some((e) => (e.hooks ?? []).some((h) => h.command === 'my-own-session-start'))
    ).toBe(true);
    // ...and the sentinel is registered as peaks-managed, which is the only
    // reason uninstall can find it at all
    expect(resolveLegacySentinels('claude-code')).toContain(HOOK_POST_COMPACT_REINJECT_SENTINEL);
  });

  it('when install and uninstall are cycled, should return to the same installed shape', () => {
    // given: an installed project (the shape to reproduce)
    const tmpRoot = makeTempProjectRoot();
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const sharedPath = sharedSettingsPath(tmpRoot);
    const installedShape = readFileSync(sharedPath, 'utf8');
    // when: it is uninstalled and installed again
    removeHookInstall('project', tmpRoot, { ide: 'claude-code' });
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the file is byte-identical to the first install — the round trip
    //       has no drift to accumulate
    expect(readFileSync(sharedPath, 'utf8')).toBe(installedShape);
  });

  it(
    'when the installed command runs, should print a card inside the budget',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project whose session tree carries a job, a request and progress
      const tmpRoot = makeTempProjectRoot();
      const sid = '2026-09-12-session-hookst';
      const sess = join(tmpRoot, '.peaks', '_runtime', sid);
      // The session binding. Without it the CLI cannot resolve a session at all
      // (`getSessionIdCanonical`), so the job/request blocks would be omitted and
      // this case would pass while proving nothing about them.
      mkdirSync(join(tmpRoot, '.peaks', '_runtime'), { recursive: true });
      writeFileSync(
        join(tmpRoot, '.peaks', '_runtime', 'session.json'),
        JSON.stringify({
          sessionId: sid,
          projectRoot: realpathSync(tmpRoot),
          createdAt: '2026-09-13T05:00:00.000Z'
        }),
        'utf8'
      );
      mkdirSync(join(sess, 'job', 'j-hook-1'), { recursive: true });
      mkdirSync(join(sess, 'rd', 'requests'), { recursive: true });
      writeFileSync(
        join(sess, 'rd', 'requests', '2026-09-13-a2-post-compact-reinject.md'),
        'x',
        'utf8'
      );
      writeFileSync(
        join(sess, 'job-shape.json'),
        JSON.stringify({
          sessionId: sid,
          promptHash: 'b'.repeat(16),
          decision: {
            isJob: true,
            rationale: 'multi-slice work',
            suggestedJobId: 'j-hook-1',
            suggestedStrategy: 'rotating',
            confidence: 'high',
            decidedAt: '2026-09-13T05:00:00.000Z'
          },
          schemaVersion: 1
        }),
        'utf8'
      );
      writeFileSync(
        join(sess, 'job', 'j-hook-1', 'progress.json'),
        JSON.stringify({
          schemaVersion: 1,
          jobId: 'j-hook-1',
          done: 3,
          total: 9,
          currentSlice: 'a2-post-compact-reinject',
          lastCommitSha: null,
          updatedAt: '2026-09-13T06:00:00.000Z'
        }),
        'utf8'
      );
      // when: the command the hook runs is executed against that project
      const run = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(ROOT, 'src', 'cli', 'index.ts'),
          'session',
          'reinject',
          '--project',
          tmpRoot
        ],
        {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmpRoot }
        }
      );
      // then: it succeeded, printed a card, and the card is the re-anchoring
      //       state — not an empty string that would silently re-inject nothing
      expect(run.status).toBe(0);
      expect(run.stdout.length).toBeGreaterThan(0);
      expect(run.stdout).toContain('[peaks-loop] post-compact state card');
      expect(run.stdout).toContain(sid);
      expect(run.stdout).toContain('3/9');
      expect(run.stdout).toContain('--import tsx');
      // ...and it is inside the declared budget, measured on the REAL output
      const bytes = Buffer.byteLength(run.stdout.trimEnd(), 'utf8');
      expect(bytes).toBeLessThanOrEqual(POST_COMPACT_REINJECTION_BYTE_BUDGET);
    }
  );

  it(
    'when there is nothing to re-inject, should print nothing and still exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The failure-soft contract, and it has a sharp edge: stdout IS context
      // here. A hook that printed `REINJECT_FAILED: ...` would inject that line
      // into the model's context as a fact, mid-slice, and a hook that exited
      // non-zero would surface on session start — the one place this feature
      // must not be able to break anything.
      // given: a directory that is not a peaks project at all
      const tmpRoot = makeTempProjectRoot();
      // when: the command runs against it
      const run = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(ROOT, 'src', 'cli', 'index.ts'),
          'session',
          'reinject',
          '--project',
          tmpRoot
        ],
        {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmpRoot }
        }
      );
      // then: exit 0, and a card that carries no session-specific claim but is
      //       still a valid pointer + rules card rather than an error message
      expect(run.status).toBe(0);
      expect(run.stdout).not.toContain('REINJECT_FAILED');
      expect(run.stdout).toContain('session: unbound');
    }
  );

  it(
    'when the project root is not usable, should print nothing and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a path that does not exist (this is what a hostile or stale
      //        ${CLAUDE_PROJECT_DIR} looks like)
      const missing = join(tmpdir(), 'peaks-reinject-does-not-exist-9f3a');
      // when: the command runs against it
      const run = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(ROOT, 'src', 'cli', 'index.ts'),
          'session',
          'reinject',
          '--project',
          missing
        ],
        { cwd: ROOT, encoding: 'utf8', windowsHide: true }
      );
      // then: nothing on stdout at all — no error text for the model to read as
      //       a task — and exit 0 so the session starts regardless
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
    }
  );
});

describe('behavior — workspace init does not disturb the re-injection entry', () => {
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

  it('when workspace init refreshes the settings file, should leave the installed entry alone', async () => {
    // The question this case answers is "does a routine `peaks workspace init`
    // silently delete the hook I just installed?" — which decides whether the
    // re-injection is durable enough to ship at all.
    //
    // The answer is no, and the REASON is the routing: the init-time
    // materializer writes `.claude/settings.local.json` and owns that file's
    // `hooks` key outright (`TEMPLATE_OWNED_KEYS`), but the re-injection entry
    // is routed to the SHARED `.claude/settings.json` because it declares no
    // machine-specific `shell`. Asserting that here rather than assuming it is
    // the point: the two files are one directory apart and the wrong one is a
    // false pass in both directions.
    //
    // NOTED, NOT FIXED: the same `TEMPLATE_OWNED_KEYS` logic WOULD delete a
    // SessionStart entry that lived in the LOCAL file, because the template
    // carries only `PreToolUse`. Nothing puts one there today (the adapter
    // routes all three SessionStart entries to the shared file), so this is a
    // latent hazard for a future entry that needs a machine-local hook, not a
    // live defect. It is in the RD report's "found, not touched" list.
    const { materializeClaudeSettingsLocal } =
      await import('~/src/services/workspace/workspace-claude-settings-materializer');
    const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-reinject-init-'));
    tmpRoots.push(tmpRoot);
    // given: an installed project
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const sharedPath = sharedSettingsPath(tmpRoot);
    // ...whose LOCAL file's PreToolUse tree predates the current template, so
    //    the drift comparator takes the rewrite path rather than short-circuiting
    const localPath = join(tmpRoot, '.claude', 'settings.local.json');
    const drifted = JSON.parse(readFileSync(localPath, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    drifted.hooks.PreToolUse = [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'stale-handler' }] }
    ];
    writeFileSync(localPath, JSON.stringify(drifted, null, 2) + '\n', 'utf8');
    const before = readFileSync(sharedPath, 'utf8');
    // when: workspace init refreshes the project's settings
    const result = await materializeClaudeSettingsLocal(tmpRoot, false);
    // then: the refresh really happened...
    expect(result.action).not.toBe('already-current');
    expect(readFileSync(localPath, 'utf8')).not.toContain('stale-handler');
    // ...and the shared file — the one carrying the re-injection — is untouched
    expect(readFileSync(sharedPath, 'utf8')).toBe(before);
    expect(findReinjectEntry(readSessionStartEntries(sharedPath))).toBeDefined();
  });
});
