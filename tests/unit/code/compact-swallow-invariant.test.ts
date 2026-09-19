// tests/unit/code/compact-swallow-invariant.test.ts
//
// Repair slice R6 — the substitute for an invariant TypeScript cannot supply.
//
// THE FINDING THIS FILE ANSWERS. R4's re-run of the enumeration found that
// R3's "new" third site had been on the previous list all along
// (`auto-compact-lifecycle.ts:342`, frame 3). Four passes each found what the
// prior rule could not express, *or nobody acted on*. So this file does not
// add a row to a report. Each of the three sites gets a test that goes RED if
// the swallow comes back — measured, not asserted from reading.
//
// THE INVARIANT THAT DOES NOT EXIST. TS has no checked exceptions, so nothing
// here can make a swallow unwriteable. What is available is a weaker, real
// property: **the axis has a total entry, and every frame that degrades says
// so by calling it.** `getSessionDir` throws (a caller cannot forget to
// handle a throw) and `tryGetSessionDir` returns a tagged answer (a caller
// that must not throw has a short, correct way to ask). The swallow is then
// unnecessary at a named place instead of hidden in a `catch`.
//
// PRE-FIX BYTES, MEASURED — the sensitivity control for every test below.
// `git checkout HEAD -- <file>` and re-running the same probe gave:
//
//   site 2  readOpenDispatchRun(LEGAL)      -> the open `armed` run
//           readOpenDispatchRun('./'+LEGAL) -> null                    (ADMIT)
//           runAutoCompact('./'+LEGAL)      -> AUTO_COMPACT_DISPATCHED,
//                                              1 compact-history row
//   site 3  emitObservabilityEvent('./'+LEGAL) -> THREW
//           readObservabilityEvents('./'+LEGAL)-> THREW
//   site 1  settleOpenLifecycleRun(...) -> returned the full success
//           envelope whether or not the write landed
//
// Non-vacuity controls in the same runs: `runAutoCompact(LEGAL)` returned
// AUTO_COMPACT_ALREADY_ARMED both before and after (the backoff itself is not
// what changed), and the legal leg of every site-3 call returned
// `{written: true}` both before and after.
//
// Dimensions:
//   - render:      the two envelope shapes the new answers have
//   - behavior:    the differential, the totality, the settle's honesty
//   - integration: real files — a planted lifecycle record, a real store
//   - a11y:        the sentence the human reads when the gate refuses

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { runAutoCompact } from '~/src/services/code/auto-compact-orchestrator';
import {
  readOpenDispatchRun,
  settleOpenLifecycleRun
} from '~/src/services/code/auto-compact-lifecycle';
import {
  readCompactLifecycle,
  writeCompactLifecycle
} from '~/src/services/compact-statusline/compact-lifecycle-store';
import { getSessionDir, tryGetSessionDir } from '~/src/services/session/getSessionDir';
import {
  emitObservabilityEvent,
  readObservabilityEvents
} from '~/src/services/observability/observability-service';

declareDimensions('tests/unit/code/compact-swallow-invariant.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SID = '2026-09-15-session-r6-invariant';
/** The same directory as `SID`; only the string differs. Refused by the guard. */
const EQUIV = `./${SID}`;
const UNSAFE = '../../../../R6-PWNED';

function envAtRatio(ratio: number): NodeJS.ProcessEnv {
  return { CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONTEXT_USAGE_PERCENT: String(ratio) };
}

/** Absolute path to a session's compact-history file, built without the guard. */
function historyPath(root: string, sid: string): string {
  return join(root, '.peaks', '_runtime', sid, 'compact-history.jsonl');
}

function historyRows(root: string, sid: string): number {
  const path = historyPath(root, sid);
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0).length;
}

let projectRoot = '';

/** Plant a real, open `armed` run — the attempt the backoff exists to protect. */
function plantArmedRun(root: string): void {
  writeCompactLifecycle({
    projectRoot: root,
    sessionId: SID,
    record: {
      schemaVersion: 1,
      runId: 'r6-armed-1',
      stage: 'armed',
      updatedAt: new Date().toISOString(),
      triggerRatio: 0.86,
      redLine: false
    }
  });
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-r6-'));
  mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
});

afterEach(() => {
  try {
    rmSync(projectRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  projectRoot = '';
});

describe('Scenario: integration — site 2, the same directory reached by two id strings', () => {
  it('when invoked, should find the open run for the legal id and NOT answer "none" for the equivalent that names the same directory', () => {
    // given: a real open run, and two ids that join to the identical path
    plantArmedRun(projectRoot);
    expect(getSessionDir(projectRoot, SID)).toBe(join(projectRoot, '.peaks', '_runtime', EQUIV));

    // when / then: the control leg still finds it — the backoff itself is intact
    expect(readOpenDispatchRun({ projectRoot, sessionId: SID })).toMatchObject({
      kind: 'open',
      runId: 'r6-armed-1',
      stage: 'armed'
    });

    // and the equivalent id must NOT collapse to "nothing is outstanding".
    // PRE-FIX this was `null`, which `runAutoCompact` reads as the ADMIT
    // branch — the fail-open this test exists to keep closed.
    const equiv = readOpenDispatchRun({ projectRoot, sessionId: EQUIV });
    expect(equiv.kind).not.toBe('none');
    expect(equiv).toMatchObject({ kind: 'unresolvable' });
  });

  it('when invoked, should write NO dispatch row for the equivalent id, and still suppress the legal one', async () => {
    // given: a real open run and a ratio above the auto-fire threshold
    plantArmedRun(projectRoot);

    // when: the probe runs once under each id
    const legal = await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.88) });
    const equiv = await runAutoCompact({ projectRoot, sessionId: EQUIV, env: envAtRatio(0.88) });

    // then: neither admits a dispatch. PRE-FIX the second returned
    // AUTO_COMPACT_DISPATCHED and left one compact-history row on disk.
    expect(legal.code).toBe('AUTO_COMPACT_ALREADY_ARMED');
    expect(equiv.code).toBe('AUTO_COMPACT_UNRESOLVED_SESSION');
    expect(historyRows(projectRoot, SID)).toBe(0);
  });

  it('when invoked, should refuse the traversal id the same way, so no id outside the axis admits a dispatch', () => {
    plantArmedRun(projectRoot);
    expect(readOpenDispatchRun({ projectRoot, sessionId: UNSAFE })).toMatchObject({
      kind: 'unresolvable'
    });
  });
});

describe('Scenario: behavior — site 3, the never-throws contract on the observability entry points', () => {
  const event = () =>
    ({
      schemaVersion: 1 as const,
      ts: new Date().toISOString(),
      sessionId: '',
      category: 'checkpoint' as const,
      detail: {}
    }) as const;

  it('when invoked, should report an unresolvable session id as a reason instead of throwing', () => {
    // given / when: an id the axis guard refuses — PRE-FIX both calls THREW
    const emitted = emitObservabilityEvent({ ...event(), sessionId: UNSAFE }, { projectRoot });
    const read = readObservabilityEvents(projectRoot, UNSAFE);

    // then: the contract at the top of that file ("MUST NEVER throw") holds
    expect(emitted).toEqual({ written: false, path: '', reason: 'invalid-session-id' });
    expect(read).toEqual([]);
  });

  it('when invoked, should still WRITE for a legal id — the refusal is not a blanket degradation', () => {
    const emitted = emitObservabilityEvent({ ...event(), sessionId: SID }, { projectRoot });
    expect(emitted.written).toBe(true);
    expect(readObservabilityEvents(projectRoot, SID)).toHaveLength(1);
  });

  it('when invoked, should not throw for an id that is unsafe on a different axis either', () => {
    // `\0` is admitted by the segment predicate and fails at the OS instead —
    // the other failure mode this entry point has to absorb rather than raise.
    const emitted = emitObservabilityEvent({ ...event(), sessionId: 'a b' }, { projectRoot });
    expect(emitted.written).toBe(false);
    expect(emitted.reason).toBe('write-failed');
  });
});

describe('Scenario: behavior — site 1 (AC3), a settle that could not write is not a success', () => {
  it('when invoked, should report lifecycleWritten=false and leave the run in the stage it was in', () => {
    // given: an open run and a store that refuses every write
    plantArmedRun(projectRoot);

    // when: a post-compact measurement settles it
    const settled = settleOpenLifecycleRun({
      projectRoot,
      sessionId: SID,
      measuredRatio: 0.4,
      source: 'statusline',
      autoFireThreshold: 0.85,
      failLifecycleWrite: true
    });

    // then: the facts are real and returned, and the settle is NOT claimed
    expect(settled).not.toBeNull();
    expect(settled?.lifecycleWritten).toBe(false);
    expect(settled?.afterRatio).toBeCloseTo(0.4, 5);

    // and the run is demonstrably still where it was — this is why a caller
    // must not read the returned record as "settled".
    const record = readCompactLifecycle({
      projectRoot,
      sessionId: SID,
      nowMs: Date.now(),
      staleAfterMs: 60_000
    });
    expect(record.kind).toBe('valid');
    expect(record.kind === 'valid' ? record.record.stage : null).toBe('armed');
  });

  it('when invoked, should report lifecycleWritten=true when the store works — the control', () => {
    plantArmedRun(projectRoot);
    const settled = settleOpenLifecycleRun({
      projectRoot,
      sessionId: SID,
      measuredRatio: 0.4,
      source: 'statusline',
      autoFireThreshold: 0.85
    });
    expect(settled?.lifecycleWritten).toBe(true);
    const record = readCompactLifecycle({
      projectRoot,
      sessionId: SID,
      nowMs: Date.now(),
      staleAfterMs: 60_000
    });
    expect(record.kind === 'valid' ? record.record.stage : null).toBe('completed');
  });

  it('when invoked, should write no "observed compaction point" row for a settle the store never recorded', async () => {
    // given: an open run, a failing lifecycle store, and a ratio that has fallen
    plantArmedRun(projectRoot);
    const input = {
      projectRoot,
      sessionId: SID,
      env: envAtRatio(0.4),
      testHooks: { failLifecycleWrite: true }
    };

    // when: three consecutive probes all measure the drop
    await runAutoCompact(input);
    await runAutoCompact(input);
    await runAutoCompact(input);

    // then: no row is invented per probe. PRE-FIX each probe appended one, for
    // a compaction the lifecycle store had not recorded — the run stayed
    // `armed`, so the next probe settled it again, unbounded.
    expect(historyRows(projectRoot, SID)).toBe(0);
  });

  it('when invoked, should write exactly one such row when the store works', async () => {
    plantArmedRun(projectRoot);
    // when: the probe measures the drop with a healthy store
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.4) });
    // then: one observed row, and a second probe does not add another — the
    // run has left the open set
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.4) });
    const rows = readFileSync(historyPath(projectRoot, SID), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { kind?: string });
    expect(rows.filter((r) => r.kind === 'observed')).toHaveLength(1);
  });
});

describe('Scenario: render — the totality split on the axis', () => {
  it('when invoked, should agree with getSessionDir on accept and on refuse', () => {
    for (const sid of [SID, 'sid-1', EQUIV, UNSAFE, '../x']) {
      const total = tryGetSessionDir(projectRoot, sid);
      let partial: string | null = null;
      try {
        partial = getSessionDir(projectRoot, sid);
      } catch {
        partial = null;
      }
      if (total.ok) {
        expect(partial).toBe(total.dir);
      } else {
        expect(partial).toBeNull();
        expect(total.reason).toContain('must be a single path segment');
      }
    }
  });

  it('when invoked, should keep getSessionDir throwing — the partial entry is unchanged (AC4 direction 1)', () => {
    expect(() => getSessionDir(projectRoot, UNSAFE)).toThrow(/Invalid session id/);
    expect(getSessionDir(projectRoot, SID)).toBe(join(projectRoot, '.peaks', '_runtime', SID));
  });
});

describe('Scenario: a11y — the sentence a human reads at the new refusal', () => {
  it('when invoked, should say why the dispatch was not made, and ask for no CLI verb the reader must type', async () => {
    plantArmedRun(projectRoot);
    const result = await runAutoCompact({ projectRoot, sessionId: EQUIV, env: envAtRatio(0.88) });
    // then: the reader is told the question could not be asked, not that a
    // compact is already armed — the two are different facts
    expect(result.ok).toBe(true);
    expect(result.message).toContain('could not be resolved');
    // It must not CLAIM the armed state: "resting at '<stage>'" only appears in
    // the already-armed sentence, where an actual open run was read.
    expect(result.message).not.toContain('resting at');
    // and no bare `peaks <verb>` the human would have to run themselves
    expect(/\bpeaks \w/.test(result.message)).toBe(false);
  });
});
