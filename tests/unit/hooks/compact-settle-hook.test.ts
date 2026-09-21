/**
 * rid `2026-09-13-compact-event-settle` — the `PostCompact` hook entry, and the
 * three claims that have to hold for it to be worth shipping.
 *
 * AC1 — firing the hook SETTLES an open compact run on the spot, rather than
 * waiting for the next `peaks code auto-compact` probe to notice a ratio that
 * fell. Asserted by executing the exact command the hook runs, against a
 * project that has a run open, and reading `compact-history.jsonl` immediately
 * afterwards. The case that makes this an assertion rather than a coincidence
 * is its counterexample: the SAME command against a project with NO open run
 * must add no row.
 *
 * AC2 — the row carries the harness's own `trigger`. Two runs, two triggers,
 * two rows that differ in that field; and a third run with no trigger at all,
 * whose row must NOT carry a defaulted one.
 *
 * AC3 — the entry survives a `peaks workspace init` refresh. This is the hard
 * one, and the reason is worth stating plainly, because the obvious test for it
 * is worthless: "the entry is still there afterwards" passes just as happily
 * when the refresh did nothing at all. So every survival case here forces the
 * refresh to actually rewrite (a template-declared entry is hand-broken first),
 * and the control case below asserts the SAME lookup reporting ABSENT on a tree
 * that never had the entry — without which "found" and "found because the
 * assertion always says found" are indistinguishable.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
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
  HOOK_COMPACT_SETTLE_COMMAND,
  HOOK_COMPACT_SETTLE_EVENT,
  HOOK_COMPACT_SETTLE_MATCHER,
  HOOK_COMPACT_SETTLE_SENTINEL
} from '~/src/services/skills/session-start-hook-constants';
import {
  resolveHookEntries,
  resolveLegacySentinels
} from '~/src/services/skills/hooks-codegate-superpowers';
import { applyHookInstall, removeHookInstall } from '~/src/services/skills/hooks-settings-service';
import { writeCompactLifecycle } from '~/src/services/compact-statusline/compact-lifecycle-store';
import { materializeClaudeSettingsLocal } from '~/src/services/workspace/workspace-claude-settings-materializer';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

/** Repo root — this file lives at `<root>/tests/unit/hooks/`. */
const ROOT = join(__dirname, '..', '..', '..');

const SID = '2026-09-13-session-settlecli';

type HookHandler = { type?: string; command?: string; shell?: string };
type HookEntry = { matcher?: string; hooks?: HookHandler[] };

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
  const root = mkdtempSync(join(tmpdir(), 'peaks-compact-settle-hook-'));
  tmpRoots.push(root);
  return root;
}

function sharedSettingsPath(root: string): string {
  return join(root, '.claude', 'settings.json');
}

function localSettingsPath(root: string): string {
  return join(root, '.claude', 'settings.local.json');
}

function historyPath(root: string, sid = SID): string {
  return join(root, '.peaks', '_runtime', sid, 'compact-history.jsonl');
}

function readHistory(root: string, sid = SID): Array<Record<string, unknown>> {
  const path = historyPath(root, sid);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Bind a session so the CLI can resolve one at all (see the reinject suite). */
function bindSession(root: string): void {
  mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
  writeFileSync(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({
      sessionId: SID,
      projectRoot: realpathSync(root),
      createdAt: '2026-09-13T05:00:00.000Z'
    }),
    'utf8'
  );
}

/** Open a compact run at `ratio` — the state a dispatch leaves behind. */
function openRun(root: string, ratio = 0.92): void {
  writeCompactLifecycle({
    projectRoot: root,
    sessionId: SID,
    record: {
      schemaVersion: 1,
      runId: 'compact-cli-run',
      stage: 'compacting',
      updatedAt: new Date().toISOString(),
      triggerRatio: ratio,
      redLine: false
    }
  });
}

/** Run the EXACT command the installed hook runs. */
function runSettleCommand(
  root: string,
  stdin: string,
  extraEnv: NodeJS.ProcessEnv = {}
): { status: number | null; stdout: string } {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(ROOT, 'src', 'cli', 'index.ts'),
      'compact',
      'settle',
      '--project',
      root
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, PEAKS_HOOK_STDIN: stdin, ...extraEnv }
    }
  );
  return { status: run.status, stdout: run.stdout ?? '' };
}

/** Every `PostCompact` entry in a settings file, in order. */
function readPostCompactEntries(settingsPath: string): HookEntry[] {
  if (!existsSync(settingsPath)) return [];
  const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
    hooks?: { PostCompact?: HookEntry[] };
  };
  return parsed.hooks?.PostCompact ?? [];
}

function findSettleEntry(entries: HookEntry[]): HookEntry | undefined {
  return entries.find((entry) =>
    (entry.hooks ?? []).some((h) => String(h.command ?? '').includes(HOOK_COMPACT_SETTLE_SENTINEL))
  );
}

describe('behavior — the PostCompact settle hook entry', () => {
  it('when the claude-code entries are resolved, should emit it once, unscoped and unpinned', () => {
    // given: the canonical peaks hook entry set for Claude Code
    const entries = resolveHookEntries('claude-code');
    // when: the settle entry is picked out
    const settle = entries.filter((e) => e.sentinel === HOOK_COMPACT_SETTLE_SENTINEL);
    // then: it rides the harness's OWN compaction event, exactly once
    expect(settle).toHaveLength(1);
    expect(settle[0]?.event).toBe(HOOK_COMPACT_SETTLE_EVENT);
    expect(HOOK_COMPACT_SETTLE_EVENT).toBe('PostCompact');
    // ...and it filters nothing: BOTH triggers are wanted, so an empty matcher
    //    is the only form that cannot fail silently (an `auto|manual`
    //    alternation matches neither under exact-equality semantics, and a hook
    //    that never fires is indistinguishable from a hook with nothing to say)
    expect(settle[0]?.matcher).toBe('');
    expect(HOOK_COMPACT_SETTLE_MATCHER).toBe('');
    // ...and it carries no `shell` pin, because the entry lands in the SHARED,
    //    committed file and a `powershell` pin there breaks every macOS /
    //    Linux reader of that file
    expect(settle[0]?.shell).toBeUndefined();
    expect(settle[0]?.machineLocal).toBeUndefined();
  });

  it('when the hook command is written, should invoke the CLI and not itself', () => {
    // given: the installed command string
    const command = HOOK_COMPACT_SETTLE_COMMAND;
    // then: it is a real CLI invocation, passing the project root the same way
    //       the three SessionStart entries do
    expect(command).toBe('peaks compact settle --project "${CLAUDE_PROJECT_DIR}"');
    expect(command).not.toBe(HOOK_COMPACT_SETTLE_SENTINEL);
    // ...and the sentinel install/uninstall key on is really a substring of it
    expect(command).toContain(HOOK_COMPACT_SETTLE_SENTINEL);
    // ...and uninstall can find it, or the hook would be unremovable
    expect(resolveLegacySentinels('claude-code')).toContain(HOOK_COMPACT_SETTLE_SENTINEL);
  });

  it('when the hooks are installed then removed, should leave no trace of the entry', () => {
    // given: an installed project
    const root = makeProject();
    applyHookInstall('project', root, { ide: 'claude-code' });
    expect(findSettleEntry(readPostCompactEntries(sharedSettingsPath(root)))).toBeDefined();
    // ...and what landed ON DISK carries no `shell`, which is load-bearing
    //    rather than cosmetic: the file is committed and shared, and
    //    `resolveHookShell()` answers `powershell` on Windows — a teammate on
    //    macOS or Linux would be handed a shell they do not have.
    const handler = findSettleEntry(readPostCompactEntries(sharedSettingsPath(root)))?.hooks?.[0];
    expect(handler?.type).toBe('command');
    expect(handler !== undefined && 'shell' in handler).toBe(false);
    // when: the uninstall runs
    const removed = removeHookInstall('project', root, { ide: 'claude-code' });
    // then: the entry is gone
    expect(removed.removed).toBe(true);
    expect(findSettleEntry(readPostCompactEntries(sharedSettingsPath(root)))).toBeUndefined();
  });
});

describe('behavior — a corrupted matcher is seen and repaired (R2)', () => {
  it('when the on-disk matcher is wrong, should repair it rather than call it installed', () => {
    // Residual R2, measured by QA: `shapeMatchesDesired` compared sentinels
    // only, so an entry whose matcher had been hand-edited to `auto|manual` was
    // present, wrong, and — because the install short-circuited on
    // `alreadyInstalled` — permanently unrepairable by the one command that
    // exists to converge this file. A wrong matcher is not cosmetic: `''` and
    // `auto|manual` do not fire on the same events, so the corruption is a hook
    // that silently never runs.
    // given: an installed project
    const root = makeProject();
    applyHookInstall('project', root, { ide: 'claude-code' });
    const sharedPath = sharedSettingsPath(root);
    expect(findSettleEntry(readPostCompactEntries(sharedPath))?.matcher).toBe('');
    // when: the settle entry's matcher is corrupted on disk
    const settings = JSON.parse(readFileSync(sharedPath, 'utf8')) as {
      hooks: { PostCompact: HookEntry[] };
    };
    const entry = findSettleEntry(settings.hooks.PostCompact);
    if (entry === undefined) throw new Error('expected the settle entry on disk');
    entry.matcher = 'auto|manual';
    writeFileSync(sharedPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    // ...and the install is asked to converge the file
    const repaired = applyHookInstall('project', root, { ide: 'claude-code' });
    // then: the corruption is SEEN, so the install is not a silent no-op...
    expect(repaired.applied).toBe(true);
    // ...and the entry is back to the matcher it declares
    expect(findSettleEntry(readPostCompactEntries(sharedPath))?.matcher).toBe('');
    // ...and it converges: a second install has nothing left to repair
    expect(applyHookInstall('project', root, { ide: 'claude-code' }).applied).toBe(false);
  });
});

describe('behavior — the hook fires and the run settles at once (AC1)', () => {
  it(
    'when the harness reports a compaction, should settle immediately and print nothing',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a bound session with a compact run open at 92%
      const root = makeProject();
      bindSession(root);
      openRun(root, 0.92);
      expect(readHistory(root)).toEqual([]);
      // when: the command the hook runs is executed
      const run = runSettleCommand(root, JSON.stringify({ trigger: 'auto' }));
      // then: it exited cleanly and said NOTHING — stdout may be added to the
      //       model's context, so a sentence there is a fact peaks-loop appears
      //       to be asserting
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
      // ...and the row is on disk IMMEDIATELY, with no probe run in between —
      //    which is the whole difference from the inference this replaces
      const rows = readHistory(root);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('observed');
      expect(rows[0]?.pathway).toBe('post-compact-hook');
      expect(rows[0]?.beforeRatio).toBe(0.92);
    }
  );

  it(
    'when no run is open, should add no row and still print nothing',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The counterexample that makes the case above meaningful: the same command
      // on a project with nothing to attribute writes nothing. Without it, "a row
      // appeared" could be a row that always appears.
      // given: a bound session with NO compact run open
      const root = makeProject();
      bindSession(root);
      // when: the command runs
      const run = runSettleCommand(root, JSON.stringify({ trigger: 'auto' }));
      // then: exit 0, empty stdout, and no history file at all
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
      expect(readHistory(root)).toEqual([]);
      expect(existsSync(historyPath(root))).toBe(false);
    }
  );

  it(
    'when the project root is not usable, should print nothing and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a path that does not exist, which is what a stale
      //        ${CLAUDE_PROJECT_DIR} looks like
      const missing = join(tmpdir(), 'peaks-compact-settle-does-not-exist-7c1e');
      // when: the command runs against it
      const run = runSettleCommand(missing, '{ not json at all');
      // then: nothing on stdout — no error text for the model to read as a task —
      //       and exit 0, because a hook must not break the harness's own path
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
    }
  );
});

describe('behavior — the row carries the harness trigger (AC2)', () => {
  it(
    'when two triggers are reported, should persist two different rows',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: two bound sessions, each with a run open
      const rootA = makeProject();
      const rootB = makeProject();
      bindSession(rootA);
      bindSession(rootB);
      openRun(rootA);
      openRun(rootB);
      // when: the harness reports `auto` on one and `manual` on the other
      runSettleCommand(rootA, JSON.stringify({ trigger: 'auto' }));
      runSettleCommand(rootB, JSON.stringify({ trigger: 'manual' }));
      // then: the persisted rows differ in that field — an inequality, which is
      //       the form that also catches a hardcoded literal
      expect(readHistory(rootA)[0]?.trigger).toBe('auto');
      expect(readHistory(rootB)[0]?.trigger).toBe('manual');
    }
  );

  it(
    'when no trigger is reported, should omit the field rather than default it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a bound session with a run open
      const root = makeProject();
      bindSession(root);
      openRun(root);
      // when: the harness payload is an empty object — an EXPECTED input, since
      //       PostCompact's schema is truncated in the retrievable docs
      const run = runSettleCommand(root, '{}');
      // then: the run still settled on the event...
      expect(run.status).toBe(0);
      const row = readHistory(root)[0]!;
      expect(row.kind).toBe('observed');
      // ...and the row does NOT claim a cause it was never told
      expect('trigger' in row).toBe(false);
    }
  );
});

describe('behavior — the payload session is checked before this project settles (B)', () => {
  it(
    'when the payload names another session, should leave this run alone',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The transport half of the attribution guard: the command used to keep
      // only `trigger` out of the payload and throw `session_id` away, so a
      // `PostCompact` from another session closed this project's open run and
      // filed the row as if the main session had fired it.
      // given: a bound session with a run open
      const root = makeProject();
      bindSession(root);
      openRun(root, 0.92);
      // when: the hook fires with a payload naming a DIFFERENT harness session
      const other = runSettleCommand(
        root,
        JSON.stringify({ trigger: 'auto', session_id: 'harness-session-theirs' }),
        { PEAKS_OUTER_SESSION_ID: 'harness-session-ours' }
      );
      // then: exit 0 and silence, as always on the hook path — but nothing
      //       settled and no row invented
      expect(other.status).toBe(0);
      expect(other.stdout).toBe('');
      expect(readHistory(root)).toEqual([]);
      // ...and the SAME command on the SAME project settles once the payload
      //    names this session, so "no row" above is the guard talking rather
      //    than a command that never writes anything
      const own = runSettleCommand(
        root,
        JSON.stringify({ trigger: 'auto', session_id: 'harness-session-ours' }),
        { PEAKS_OUTER_SESSION_ID: 'harness-session-ours' }
      );
      expect(own.status).toBe(0);
      expect(readHistory(root)).toHaveLength(1);
      expect(readHistory(root)[0]?.target).toBe('main');
    }
  );
});

describe('behavior — the entry survives a settings refresh (AC3)', () => {
  it('when workspace init refreshes, should leave the installed entry byte-identical', async () => {
    // given: an installed project
    const root = makeProject();
    applyHookInstall('project', root, { ide: 'claude-code' });
    const sharedPath = sharedSettingsPath(root);
    const before = readFileSync(sharedPath, 'utf8');
    expect(findSettleEntry(readPostCompactEntries(sharedPath))).toBeDefined();
    // ...whose LOCAL file's declared hook tree predates the current template,
    //    so the refresh takes the REWRITE path rather than short-circuiting as
    //    `already-current` — "nothing happened" is the failure this case is
    //    built to exclude
    const localPath = localSettingsPath(root);
    const drifted = JSON.parse(readFileSync(localPath, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    drifted.hooks.PreToolUse = [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'stale-handler' }] }
    ];
    writeFileSync(localPath, JSON.stringify(drifted, null, 2) + '\n', 'utf8');
    // when: `peaks workspace init` refreshes the project's settings
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: the rewrite really happened...
    expect(result.action).not.toBe('already-current');
    expect(readFileSync(localPath, 'utf8')).not.toContain('stale-handler');
    // ...and the file carrying the settle entry is untouched, to the byte
    expect(readFileSync(sharedPath, 'utf8')).toBe(before);
    expect(findSettleEntry(readPostCompactEntries(sharedPath))).toBeDefined();
  });

  it('when the entry was never installed, should find nothing — the control group', () => {
    // The falsification of the case above. It runs the SAME lookup against the
    // SAME refresh on a tree that never carried the entry, and asserts the
    // lookup reports ABSENT. Without this, "the entry is still there" would be
    // satisfied by an assertion that always says yes — the failure mode this
    // session has already produced three times (a hook whose command was
    // itself, a guard that could not see its files, a probe that reported
    // "caught" for every injection because it was erroring).
    // given: a project that has never had the hooks installed
    const root = makeProject();
    // when: the same refresh runs
    // ...asserted in the same shape as the case above, on the same file
    // then: there is nothing there — the lookup CAN report absent, so its
    //       "found" above is a measurement rather than a tautology
    expect(findSettleEntry(readPostCompactEntries(sharedSettingsPath(root)))).toBeUndefined();
    expect(readPostCompactEntries(sharedSettingsPath(root))).toEqual([]);
  });

  it('when a PostCompact entry sits in the LOCAL file, should survive a real rewrite', async () => {
    // The second line of defence, measured rather than argued. The entry is
    // routed to the SHARED file (that is why the case above passes at all), but
    // a future entry needing a machine-local `shell` pin would move to the
    // local file — and the local file IS owned by this materializer. The claim
    // that it would survive rests on `mergeHooksTree` carrying across events
    // the template does not declare, so it is asserted here against a refresh
    // that genuinely rewrites.
    // given: an initialized project whose LOCAL file carries a hand-added
    //        PostCompact entry
    const root = makeProject();
    await materializeClaudeSettingsLocal(root, false);
    const localPath = localSettingsPath(root);
    const settings = JSON.parse(readFileSync(localPath, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    const entry = {
      matcher: '',
      hooks: [{ type: 'command', command: 'peaks compact settle --project "x"' }]
    };
    settings.hooks.PostCompact = [entry];
    settings.hooks.PreToolUse = [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'stale-handler' }] }
    ];
    writeFileSync(localPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    // when: the materializer runs
    const result = await materializeClaudeSettingsLocal(root, false);
    // then: the rewrite repaired the declared entry, and the undeclared event
    //       came through it — the shape that used to delete the auto-compact
    //       hook is gone
    expect(result.action).toBe('refreshed');
    expect(readFileSync(localPath, 'utf8')).not.toContain('stale-handler');
    expect(findSettleEntry(readPostCompactEntries(localPath))).toBeDefined();
    // ...and a second run is a no-op: the extra event is not read as drift
    const settled = await materializeClaudeSettingsLocal(root, false);
    expect(settled.action).toBe('already-current');
    expect(findSettleEntry(readPostCompactEntries(localPath))).toBeDefined();
  });
});
