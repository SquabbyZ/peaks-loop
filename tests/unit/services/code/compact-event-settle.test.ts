/**
 * rid `2026-09-13-compact-event-settle` — the settlement semantics.
 *
 * The subject here is a single change of PREDICATE. The probe path settles a
 * compact because a MEASUREMENT says one landed; this path settles one because
 * the HARNESS says one completed. Those two statements disagree in exactly the
 * cases this file pins:
 *
 *   - the ruler returns nothing at all → the probe path refuses, this one must
 *     not;
 *   - the ruler returns a number that has not dropped → the probe path refuses,
 *     this one must not;
 *   - there is no open run → BOTH must refuse, because that is a question of
 *     attribution rather than of evidence.
 *
 * And one case that is new rather than a disagreement: a ruler that reports the
 * PRE-compact value. Immediately after a compaction the probe prefers the
 * statusline file, which may not have been rewritten yet. Recording that number
 * as `afterRatio` would publish "the context did not shrink" as a measurement,
 * so it must be dropped — omitted, not corrected into something plausible.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  measurePostCompact,
  readSessionIdFromHookPayload,
  readTriggerFromHookPayload,
  settleCompactFromHarnessEvent,
  type PostCompactMeasurement
} from '~/src/services/code/compact-event-settle';
import {
  fillEventSettledMeasurement,
  settleOpenLifecycleRunOnCompactEvent
} from '~/src/services/code/auto-compact-lifecycle';
import { runAutoCompact } from '~/src/services/code/auto-compact-orchestrator';
import { readCompactLifecycle, writeCompactLifecycle } from '~/src/services/compact-statusline/compact-lifecycle-store';
import {
  computeWindowCalibration,
  summarizeCompactHistory,
  type CompactHistoryEvent
} from '~/src/services/compact-history/compact-history-service';

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
  const root = mkdtempSync(join(tmpdir(), 'peaks-compact-settle-'));
  tmpRoots.push(root);
  return root;
}

/** Open a `compacting` run at `ratio`, which is what a dispatch leaves behind. */
function openRun(projectRoot: string, sessionId: string, ratio: number, runId = 'compact-test-run'): void {
  writeCompactLifecycle({
    projectRoot,
    sessionId,
    record: {
      schemaVersion: 1,
      runId,
      stage: 'compacting',
      updatedAt: new Date().toISOString(),
      triggerRatio: ratio,
      redLine: false
    }
  });
}

function historyPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, 'compact-history.jsonl');
}

function readHistory(projectRoot: string, sessionId: string): CompactHistoryEvent[] {
  const path = historyPath(projectRoot, sessionId);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CompactHistoryEvent);
}

/** A ruler that answers with `measurement`, or throws when that is the point. */
const ruler = (measurement: PostCompactMeasurement | null) => () => measurement;

describe('settling on the harness event rather than on a measurement', () => {
  it('when the ruler measures nothing, should still settle and say so', () => {
    // This is the case the probe path CANNOT serve: `settleOpenLifecycleRun`
    // returns null on a `conservative-fallback` source, so a machine whose
    // probe never resolves leaves the run open forever even though the harness
    // said the compaction completed.
    // given: an open run and a ruler that reports no ratio
    const root = makeProject();
    const sid = '2026-09-13-session-settle1';
    openRun(root, sid, 0.92);
    // when: the settle runs off the event alone
    const settled = settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: null });
    // then: the run is closed, with no fabricated after-ratio
    expect(settled).not.toBeNull();
    expect(settled?.triggerRatio).toBe(0.92);
    expect(settled?.afterRatio).toBeNull();
    const read = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    expect(read.kind).toBe('valid');
    if (read.kind !== 'valid') return;
    expect(read.record.stage).toBe('completed');
    expect(read.record.afterRatio).toBeUndefined();
    expect(read.record.runId).toBe('compact-test-run');
  });

  it('when the ruler measures a rise, should settle without recording it', () => {
    // The stale-statusline case. The number is real and it is the wrong
    // number; `afterRatio` means "after", and a value above the dispatch ratio
    // is not after anything. Omitting it leaves the calibration pair to be
    // filled by a later, honest reading — recording it would close the pair on
    // a measurement that says the opposite of what happened.
    // given: an open run and a ruler reporting the PRE-compact value
    const root = makeProject();
    const sid = '2026-09-13-session-settle2';
    openRun(root, sid, 0.55);
    // when: the event settles it
    const settled = settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: 0.9 });
    // then: the run is completed and the misleading number is not on it
    expect(settled?.afterRatio).toBeNull();
    const read = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (read.kind !== 'valid') throw new Error(`expected a valid record, got ${read.kind}`);
    expect(read.record.stage).toBe('completed');
    expect(read.record.afterRatio).toBeUndefined();
  });

  it('when the ruler measures a drop, should record it', () => {
    // given: an open run and a post-compact reading genuinely below it
    const root = makeProject();
    const sid = '2026-09-13-session-settle3';
    openRun(root, sid, 0.92);
    // when: the event settles it
    const settled = settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: 0.04 });
    // then: the drop is recorded, which is what makes the row useful
    expect(settled?.afterRatio).toBe(0.04);
    const read = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (read.kind !== 'valid') throw new Error(`expected a valid record, got ${read.kind}`);
    expect(read.record.afterRatio).toBe(0.04);
  });

  it('when no run is open, should refuse — that is attribution, not evidence', () => {
    // The one rule the event path keeps. `PostCompact` fires for a session
    // peaks-loop may never have dispatched for; there is no run to complete and
    // no honest `beforeRatio` to write, so there is no row.
    // given: a session directory with no lifecycle record
    const root = makeProject();
    const sid = '2026-09-13-session-settle4';
    mkdirSync(join(root, '.peaks', '_runtime', sid), { recursive: true });
    // when: the event arrives
    const settled = settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: 0.02 });
    // then: nothing settled and nothing was written
    expect(settled).toBeNull();
    const read = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    expect(read.kind).toBe('missing');
  });

  it('when the run had already completed, should not settle it twice', () => {
    // The de-duplication that keeps the hook and the probe from writing two
    // rows for one compaction. A terminal run is not readable as open, so the
    // second arrival of the same news finds nothing to attribute.
    // given: a run settled once already
    const root = makeProject();
    const sid = '2026-09-13-session-settle5';
    openRun(root, sid, 0.92);
    expect(settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: 0.04 })).not.toBeNull();
    // when: the news arrives again — from the hook, then from a later probe
    const second = settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: 0.03 });
    // then: the second arrival is a no-op
    expect(second).toBeNull();
  });
});

/** The env a real probe reads its ratio from — copied from QA's measurement. */
function envAtRatio(ratio: number): NodeJS.ProcessEnv {
  return { CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CONTEXT_USAGE_PERCENT: String(ratio) };
}

describe('R1 — a harness-settled compaction still closes its calibration pair', () => {
  it('when the event settles on a stale reading, should let the next probe fill the pair', async () => {
    // The QA measurement this repair exists for, reproduced end to end: a REAL
    // dispatch through the orchestrator, the harness event firing while the
    // ruler still holds the PRE-compact value (the reading the event path
    // deliberately drops), then a REAL probe holding the honest number.
    //
    // Before the repair the probe appended nothing — it found no OPEN run — and
    // `computeWindowCalibration` skips an `observed` row with no number, so the
    // pair stayed unmeasured forever. `rowsAfterProbe === rowsAfterEvent` was
    // the exact symptom.
    // given: a dispatch at 0.93, which opens a run and writes the dispatch row
    const root = makeProject();
    const sid = '2026-09-13-session-settle-r1';
    const dispatched = await runAutoCompact({ projectRoot: root, sessionId: sid, env: envAtRatio(0.93) });
    expect(dispatched.code).toBe('AUTO_COMPACT_DISPATCHED');
    // when: the event settles it on the still-stale pre-compact reading
    const event = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      measure: ruler({ ratio: 0.93, ide: 'claude-code', windowTokens: 200_000, windowSource: 'qa-ruler' })
    });
    // then: it settles, and drops the number rather than laundering it
    expect(event.settled).toBe(true);
    if (!event.settled) return;
    expect(event.afterRatio).toBeNull();
    // when: the honest post-compact number reaches a later real probe
    const probe = await runAutoCompact({ projectRoot: root, sessionId: sid, env: envAtRatio(0.04) });
    expect(probe.code).toBe('AUTO_COMPACT_SKIP');
    // then: the pair closes — one pair, measured, reading the honest number
    const calibration = computeWindowCalibration(readHistory(root, sid));
    expect(calibration.pairs).toHaveLength(1);
    expect(calibration.pairs[0]?.measured).toBe(true);
    expect(calibration.pairs[0]?.observedRatio).toBe(0.04);
    expect(calibration.unmeasured).toBe(0);
  });

  it('when a later probe measures a drop, should fill once and only once', () => {
    // The lifecycle record IS the idempotence token: the fill writes the number
    // onto it, so every later probe finds it present and stays silent. Without
    // that, a context that stays low would append a row per probe.
    // given: a run the event closed with no honest number
    const root = makeProject();
    const sid = '2026-09-13-session-settle-r2';
    openRun(root, sid, 0.92);
    expect(settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: null })).not.toBeNull();
    // when: two successive probes each measure a genuine drop
    const first = fillEventSettledMeasurement({ projectRoot: root, sessionId: sid, measuredRatio: 0.04, source: 'statusline' });
    const second = fillEventSettledMeasurement({ projectRoot: root, sessionId: sid, measuredRatio: 0.03, source: 'statusline' });
    // then: the first fills, the second is silent — one compaction, one number
    expect(first?.afterRatio).toBe(0.04);
    expect(second).toBeNull();
  });

  it('when the late reading is not a drop, should refuse to fill', () => {
    // `afterRatio` means "below the ratio this run was dispatched at" — the rule
    // the event path already enforces. A later number that is NOT below it would
    // push a non-drop through the one path that can still write a `completed`
    // record. The run here is dispatched at 0.60, under the auto-fire threshold,
    // which is exactly where the probe path's own threshold gate would not help.
    // given: a run the event closed with no honest number
    const root = makeProject();
    const sid = '2026-09-13-session-settle-r3';
    openRun(root, sid, 0.6);
    expect(settleOpenLifecycleRunOnCompactEvent({ projectRoot: root, sessionId: sid, measuredRatio: null })).not.toBeNull();
    // when: a later probe offers a ratio at or above the dispatch ratio
    const filled = fillEventSettledMeasurement({ projectRoot: root, sessionId: sid, measuredRatio: 0.7, source: 'statusline' });
    // then: nothing is recorded, and the record still claims no after-ratio
    expect(filled).toBeNull();
    const read = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (read.kind !== 'valid') throw new Error(`expected a valid record, got ${read.kind}`);
    expect(read.record.afterRatio).toBeUndefined();
  });
});

describe('the harness-reported trigger', () => {
  it('when the payload carries a documented value, should read it', () => {
    expect(readTriggerFromHookPayload({ trigger: 'manual' })).toBe('manual');
    expect(readTriggerFromHookPayload({ trigger: 'auto' })).toBe('auto');
  });

  it('when the payload does not carry one, should say so rather than guess', () => {
    // `PostCompact`'s schema is truncated in the retrievable docs, so every one
    // of these is an EXPECTED input. The one thing none of them may do is
    // resolve to a value: "has this machine ever auto-compacted?" is the
    // question the column exists for, and a default answers it falsely.
    expect(readTriggerFromHookPayload({})).toBeUndefined();
    expect(readTriggerFromHookPayload({ trigger: 'AUTO' })).toBeUndefined();
    expect(readTriggerFromHookPayload({ trigger: null })).toBeUndefined();
    expect(readTriggerFromHookPayload({ trigger: 1 })).toBeUndefined();
    expect(readTriggerFromHookPayload({ trigger: ['auto'] })).toBeUndefined();
    expect(readTriggerFromHookPayload(null)).toBeUndefined();
    expect(readTriggerFromHookPayload('auto')).toBeUndefined();
    expect(readTriggerFromHookPayload(undefined)).toBeUndefined();
  });
});

describe('the observed row the hook appends', () => {
  it('when the harness reports a trigger, should persist it on the row', () => {
    // given: an open run
    const root = makeProject();
    const sid = '2026-09-13-session-settle6';
    openRun(root, sid, 0.92);
    // when: the event settles it
    const result = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'manual',
      measure: ruler({ ratio: 0.04, ide: 'claude-code', windowTokens: 123_456, windowSource: 'harness-env' })
    });
    // then: the settlement is reported...
    expect(result.settled).toBe(true);
    if (!result.settled) return;
    expect(result.afterRatio).toBe(0.04);
    // ...and the row carries the harness's own word, on a pathway that
    //    identifies it as a NOTIFICATION rather than an inference
    const rows = readHistory(root, sid);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('observed');
    expect(row.trigger).toBe('manual');
    expect(row.pathway).toBe('post-compact-hook');
    expect(row.beforeRatio).toBe(0.92);
    expect(row.afterRatio).toBe(0.04);
    expect(row.windowTokens).toBe(123_456);
    expect(row.windowSource).toBe('harness-env');
    expect(row.ok).toBe(true);
    expect(row.target).toBe('main');
  });

  it('when the harness reports a different trigger, should persist a different row', () => {
    // AC2 stated as an inequality, which is the form that catches a hardcoded
    // literal: two runs, two triggers, two rows that differ in that field.
    // given: two identical projects, each with an open run
    const root = makeProject();
    const sidA = '2026-09-13-session-settle7';
    const sidB = '2026-09-13-session-settle8';
    const measurement: PostCompactMeasurement = { ratio: 0.04, ide: 'claude-code', windowTokens: null, windowSource: null };
    openRun(root, sidA, 0.92);
    openRun(root, sidB, 0.92);
    // when: the harness reports `auto` on one and `manual` on the other
    settleCompactFromHarnessEvent({ projectRoot: root, sessionId: sidA, trigger: 'auto', measure: ruler(measurement) });
    settleCompactFromHarnessEvent({ projectRoot: root, sessionId: sidB, trigger: 'manual', measure: ruler(measurement) });
    // then: the two persisted rows differ in exactly that field
    expect(readHistory(root, sidA)[0]?.trigger).toBe('auto');
    expect(readHistory(root, sidB)[0]?.trigger).toBe('manual');
    expect(readHistory(root, sidA)[0]?.trigger).not.toBe(readHistory(root, sidB)[0]?.trigger);
  });

  it('when the harness reports nothing, should omit the field instead of defaulting it', () => {
    // given: an open run
    const root = makeProject();
    const sid = '2026-09-13-session-settle9';
    openRun(root, sid, 0.92);
    // when: the payload carried no trigger at all
    settleCompactFromHarnessEvent({ projectRoot: root, sessionId: sid, measure: ruler(null) });
    // then: the row exists and does NOT claim a cause
    const row = readHistory(root, sid)[0]!;
    expect(row.kind).toBe('observed');
    expect(row.trigger).toBeUndefined();
    expect('trigger' in row).toBe(false);
    // ...and with no honest measurement there is no after-ratio either
    expect('afterRatio' in row).toBe(false);
    expect('windowTokens' in row).toBe(false);
  });

  it('when there is no run to settle, should append nothing', () => {
    // given: a session directory with no lifecycle record
    const root = makeProject();
    const sid = '2026-09-13-session-settle10';
    mkdirSync(join(root, '.peaks', '_runtime', sid), { recursive: true });
    // when: the event arrives
    const result = settleCompactFromHarnessEvent({ projectRoot: root, sessionId: sid, trigger: 'auto' });
    // then: no settlement, and no row that would need a fabricated before-ratio
    expect(result.settled).toBe(false);
    expect(readHistory(root, sid)).toEqual([]);
  });

  it('when the ruler throws, should still settle on the event', () => {
    // The hook runs on the harness's compaction path: a ruler that broke is a
    // telemetry problem, and refusing the harness's statement because of it
    // would resurrect exactly the inference this slice deletes.
    // given: an open run and a ruler that throws
    const root = makeProject();
    const sid = '2026-09-13-session-settle11';
    openRun(root, sid, 0.92);
    // when: the event arrives
    const result = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      measure: () => {
        throw new Error('statusline unavailable');
      }
    });
    // then: the run is settled, the row is written, the trigger is kept
    expect(result.settled).toBe(true);
    const row = readHistory(root, sid)[0]!;
    expect(row.trigger).toBe('auto');
    expect('afterRatio' in row).toBe(false);
  });
});

describe('the production ruler distinguishes "unknown" from "zero"', () => {
  it('when nothing is readable, should report null rather than a fabricated ratio', () => {
    // given: a project with no transcript, no statusline state and no bound
    //        outer session — the machine the suite actually runs on
    const root = makeProject();
    // when: the real probe is asked
    const measurement = measurePostCompact({ projectRoot: root, sessionId: '2026-09-13-session-settle12', env: {} });
    // then: no ratio is claimed — but an adapter is, because which adapter
    //       could not measure is itself diagnostic
    expect(measurement.ratio).toBeNull();
    expect(typeof measurement.ide).toBe('string');
    expect(measurement.ratio).not.toBe(0);
  });
});

describe('A — a lifecycle write that failed is not "nothing to settle"', () => {
  it('when the lifecycle record cannot be written, should report the failure rather than an empty session', () => {
    // The defect this pins: `settleOpenLifecycleRunOnCompactEvent` returned the
    // SAME `null` for "there is no open run" and for "the write threw", so the
    // caller rendered the second case as "No compact run was open" — a
    // falsehood, and the repo's own lint names the conflation at that line.
    // given: an open run whose record cannot be rewritten
    const root = makeProject();
    const sid = '2026-09-13-session-settle-a1';
    openRun(root, sid, 0.92);
    // when: the harness event arrives and the lifecycle write fails
    const outcome = settleOpenLifecycleRunOnCompactEvent({
      projectRoot: root,
      sessionId: sid,
      measuredRatio: 0.04,
      failLifecycleWrite: true
    });
    // then: the run's own facts are still reported, because the run WAS there...
    expect(outcome).not.toBeNull();
    expect(outcome?.runId).toBe('compact-test-run');
    expect(outcome?.triggerRatio).toBe(0.92);
    // ...and the failed write is reported as exactly that
    expect(outcome?.lifecycleWritten).toBe(false);
    // ...so the run is still open on disk, which is what the CLI now says
    const read = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (read.kind !== 'valid') throw new Error(`expected a valid record, got ${read.kind}`);
    expect(read.record.stage).toBe('compacting');
  });

  it('when the lifecycle record cannot be written, should DEFER the observation rather than assert it', () => {
    // REVERSED BY REPAIR R9, and the reversal is the point. Read alone, the
    // harness's statement is evidence independent of the lifecycle write — which
    // is why this row used to be appended anyway. Read against the sibling
    // path, it is not: R6 made the probe caller defer its row on exactly this
    // failure, and the row this path appended claimed `kind: 'observed'`,
    // `ok: true` and `afterRatio` for a run the store still holds at
    // `compacting` — a settled measurement the store never made, one row per
    // arrival, and a SECOND row for the same compaction once the store
    // recovered. `compact-event-settle.ts` and `auto-compact-orchestrator.ts`
    // are two answers to one question and must not disagree.
    //
    // Nothing is lost by deferring: the run stays open, so the retry that does
    // land settles it and owns the row, measuring the ratio at that moment.
    // given: an open run
    const root = makeProject();
    const sid = '2026-09-13-session-settle-a2';
    openRun(root, sid, 0.92);
    // when: the lifecycle write fails
    const result = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      failLifecycleWrite: true,
      measure: ruler({ ratio: 0.04, ide: 'claude-code', windowTokens: null, windowSource: null })
    });
    // then: both halves are reported, and neither is reported as the other
    expect(result.settled).toBe(true);
    if (!result.settled) return;
    expect(result.lifecycleWritten).toBe(false);
    expect(result.historyWritten).toBe(false);
    // ...nothing asserting a settlement is on disk...
    expect(readHistory(root, sid)).toEqual([]);
    // ...the run is demonstrably still where it was...
    const still = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (still.kind !== 'valid') throw new Error(`expected a valid record, got ${still.kind}`);
    expect(still.record.stage).toBe('compacting');
    // ...and the retry, once the write lands, appends exactly one row — at the
    // ratio IT measured, which is the settlement the row is about
    const retry = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      measure: ruler({ ratio: 0.05, ide: 'claude-code', windowTokens: null, windowSource: null })
    });
    expect(retry.settled).toBe(true);
    if (!retry.settled) return;
    expect(retry.historyWritten).toBe(true);
    const rows = readHistory(root, sid);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pathway).toBe('post-compact-hook');
    expect(rows[0]?.trigger).toBe('auto');
    expect(rows[0]?.afterRatio).toBe(0.05);
  });
});

describe('C — the sibling settle path, aligned (repair R9)', () => {
  /** The measurement both tests below are taken at: the same drop, three times. */
  const drop: PostCompactMeasurement = { ratio: 0.04, ide: 'claude-code', windowTokens: null, windowSource: null };

  /**
   * Force the lifecycle write to fail, portably, and OBSERVE that it did.
   *
   * The forcing used to be `chmodSync(recordPath, 0o444)`, which was a property
   * of the OS that ran the test rather than of the fixture. `rename(2)` replaces
   * an existing target according to the CONTAINING DIRECTORY's write permission
   * and ignores the target's own mode, so on POSIX the rename SUCCEEDS, the
   * write is never forced to fail and the cases below read the success path —
   * green here three times, red on CI's ubuntu. Only Windows turns the
   * read-only attribute into a refusal (measured on Windows: `renameSync` onto a
   * `0o444` target throws EPERM).
   *
   * No file mode replaces it portably. `0o555` on the session directory blocks
   * the rename on POSIX but is a no-op on Windows, whose directory read-only
   * attribute does not gate creation (measured: `writeFileSync` into a `0o555`
   * directory succeeds). A directory in the record's place refuses the rename on
   * both platforms by syscall semantics, but it also makes the record UNREADABLE
   * (measured: `readFileSync` on a directory throws EISDIR) — and the settle
   * reads the open run BEFORE it writes, so `readOpenCompactLifecycle` would
   * collapse to `unresolvable`, return null, and the injection would destroy the
   * premise it exists to hold fixed.
   *
   * The portable mechanism is the seam the production code already carries for
   * this — the same `failLifecycleWrite` describe A uses. It is not OS-scoped by
   * construction. What it costs is the independence file modes had: a seam that
   * stops firing reads exactly like a passing guard. So the canary is NOT a
   * restatement of the flag it just passed — it reads the STORE, which a write
   * that landed would have advanced to `completed`.
   */
  function forceWriteRefusal(root: string, sid: string): void {
    const before = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    expect(before.kind).toBe('valid');
    if (before.kind !== 'valid') return;

    const canary = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      failLifecycleWrite: true,
      measure: ruler(drop)
    });
    expect(canary.settled).toBe(true);
    if (!canary.settled) return;
    expect(canary.lifecycleWritten).toBe(false);

    const after = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    expect(after.kind).toBe('valid');
    if (after.kind !== 'valid') return;
    expect(after.record.stage).toBe(before.record.stage);
    expect(after.record.stage).not.toBe('completed');
  }

  it('when the lifecycle record cannot be written, should append no row for a compaction the store never recorded', () => {
    // AC1 + AC2. The PROBE caller defers its `observed` row when the lifecycle
    // write fails (repair R6, `auto-compact-orchestrator.ts`); this path did not,
    // so ONE failure produced a row here and nothing there.
    //
    // THE FAILURE IS GENUINE, and the injection is proved to fire before either
    // direction is believed. It is deliberately not a file mode any more: the
    // objection a seam fixture once met here — that an injection which never
    // fires reads exactly like a passing guard — is answered by
    // `forceWriteRefusal` reading the refusal off the store, and the reason the
    // seam is used now is that it is the only forcing here whose effect does not
    // depend on which OS runs the test (see that helper). The seam is live on the
    // path under test — `settleCompactFromHarnessEvent` →
    // `settleOpenLifecycleRunOnCompactEvent` carries it, and a seam fixture on it
    // goes RED against the defect with 3 rows, the reverse of repair R9 (that
    // test is red pre-fix for the same reason, measured). It was inoperative on
    // the SIBLING path only, whose pre-fix signature did not carry it: the flag
    // was ignored and the record advanced to `completed` anyway, which is why
    // R6's measurement of that path could not have expressed this defect.
    // given: an open run whose record cannot be rewritten
    const root = makeProject();
    const sid = '2026-09-13-session-settle-r9a';
    openRun(root, sid, 0.92);

    // when: the injection is confirmed live — the write really does refuse
    forceWriteRefusal(root, sid);

    // when: the harness reports the SAME compaction three times
    const results = [0, 1, 2].map(() =>
      settleCompactFromHarnessEvent({
        projectRoot: root,
        sessionId: sid,
        trigger: 'auto',
        failLifecycleWrite: true,
        measure: ruler(drop)
      })
    );

    // then: every arrival reports the run still unsettled — the three facts are
    // read off the OPEN run, so they stay true; the SETTLE is what is refused
    for (const result of results) {
      expect(result.settled).toBe(true);
      if (!result.settled) continue;
      expect(result.lifecycleWritten).toBe(false);
      expect(result.historyWritten).toBe(false);
    }

    // ...and NOT ONE row was appended. PRE-FIX this was 3 rows, each carrying
    // `afterRatio: 0.04` — a settled measurement asserted for a run the store
    // still holds at `compacting`, one per arrival, bounded only by how often
    // the harness fires.
    expect(readHistory(root, sid)).toEqual([]);
    const still = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (still.kind !== 'valid') throw new Error(`expected a valid record, got ${still.kind}`);
    expect(still.record.stage).toBe('compacting');

    // and the control that falsifies "this path never appends anything": with
    // the write restored, the SAME event appends exactly one row
    const recovered = settleCompactFromHarnessEvent({ projectRoot: root, sessionId: sid, trigger: 'auto', measure: ruler(drop) });
    expect(recovered.settled).toBe(true);
    if (!recovered.settled) return;
    expect(recovered.lifecycleWritten).toBe(true);
    expect(recovered.historyWritten).toBe(true);
    expect(readHistory(root, sid)).toHaveLength(1);
  });

  it('when the row is deferred, should leave the calibration pair open for the retry that lands it', async () => {
    // AC3, readers 1 and 2 of 3, measured rather than argued.
    //
    // The justification for deferring is that the row is DEFERRED, not lost: the
    // pair `computeWindowCalibration` builds is still owed a measurement, and the
    // retry — the settlement this row is about — pays it. That only holds if
    // neither reader reads an ABSENT row as "a compact landed". It does not:
    // `computeWindowCalibration` skips an `observed` row carrying no number and
    // `summarizeCompactHistory` reports counts and the last row, never a
    // conclusion. What would close a pair on nothing is a row that is there but
    // describes a settlement the store never made — which is what was removed.
    // given: a real dispatch, so there is a pair to close
    const root = makeProject();
    const sid = '2026-09-13-session-settle-r9c';
    const dispatched = await runAutoCompact({ projectRoot: root, sessionId: sid, env: envAtRatio(0.93) });
    expect(dispatched.code).toBe('AUTO_COMPACT_DISPATCHED');

    // when: the harness event arrives while the lifecycle record cannot be written
    forceWriteRefusal(root, sid);
    const deferred = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      failLifecycleWrite: true,
      measure: ruler(drop)
    });
    expect(deferred.settled).toBe(true);
    if (!deferred.settled) return;
    expect(deferred.historyWritten).toBe(false);

    // then: the pair is OPEN — an unmeasured dispatch, not a measurement attached
    // to nothing — and the bar's total is the dispatch row alone
    let calibration = computeWindowCalibration(readHistory(root, sid));
    expect(calibration.pairs).toHaveLength(1);
    expect(calibration.unmeasured).toBe(1);
    expect(calibration.pairs[0]?.observedRatio).toBeNull();
    expect(summarizeCompactHistory(readHistory(root, sid)).totalCompacts).toBe(1);

    // when: the retry lands — the same run, still open
    const retry = settleCompactFromHarnessEvent({ projectRoot: root, sessionId: sid, trigger: 'auto', measure: ruler(drop) });
    expect(retry.settled).toBe(true);
    if (!retry.settled) return;
    expect(retry.historyWritten).toBe(true);

    // then: exactly ONE observed row, and the pair closes on it
    calibration = computeWindowCalibration(readHistory(root, sid));
    expect(calibration.unmeasured).toBe(0);
    expect(calibration.pairs).toHaveLength(1);
    expect(calibration.pairs[0]?.observedRatio).toBe(0.04);
    expect(readHistory(root, sid).filter((e) => e.kind === 'observed')).toHaveLength(1);
  });

  it('when the lifecycle record cannot be written, should still report the harness trigger it was told', () => {
    // The deferred/deferred asymmetry, pinned: what the row loses is the
    // SETTLEMENT claim, not the harness's own word. A caller told "unsettled"
    // still learns which compaction this was.
    // given: an open run whose record cannot be rewritten
    const root = makeProject();
    const sid = '2026-09-13-session-settle-r9b';
    openRun(root, sid, 0.92);
    // when: the injection is confirmed live — the write really does refuse
    forceWriteRefusal(root, sid);
    // when: the event arrives with the harness's trigger
    const result = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'manual',
      failLifecycleWrite: true,
      measure: ruler(drop)
    });
    // then: the outcome is reported, the row is not written, and the two are
    // separate fields rather than one collapsed value
    expect(result.settled).toBe(true);
    if (!result.settled) return;
    expect(result.trigger).toBe('manual');
    expect(result.runId).toBe('compact-test-run');
    expect(result.beforeRatio).toBe(0.92);
    expect(result.lifecycleWritten).toBe(false);
    expect(result.historyWritten).toBe(false);
    expect(readHistory(root, sid)).toEqual([]);
  });
});

describe('B — attribution to the session the payload names', () => {
  /** The harness session id this project's own binding resolves to. */
  const OWN_ENV: NodeJS.ProcessEnv = { PEAKS_OUTER_SESSION_ID: 'harness-session-ours' };
  const drop = (): PostCompactMeasurement => ({
    ratio: 0.04,
    ide: 'claude-code',
    windowTokens: null,
    windowSource: null
  });

  it('when the payload names a different harness session, should leave this run alone', () => {
    // A `PostCompact` for another session is not evidence about this project's
    // run; settling it would close a run the event says nothing about, and file
    // the row as `main` — the attribution the schema has a `'sub-agent'` value
    // for precisely because the distinction is real.
    // given: an open run and a payload naming someone else
    const root = makeProject();
    const sid = '2026-09-13-session-settle-b1';
    openRun(root, sid, 0.92);
    // when: the event arrives
    const result = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      env: OWN_ENV,
      hookSessionId: 'harness-session-theirs',
      measure: drop
    });
    // then: it is refused as an attribution problem, not reported as an absence
    expect(result).toEqual({ settled: false, reason: 'different-session' });
    expect(readHistory(root, sid)).toEqual([]);
    const read = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (read.kind !== 'valid') throw new Error(`expected a valid record, got ${read.kind}`);
    expect(read.record.stage).toBe('compacting');
  });

  it('when the payload names this session, should settle it — the control', () => {
    // The falsification of the case above: the SAME setup with the payload
    // naming our own session must settle, so "nothing happened" there is the
    // guard talking rather than a path that never settles anything.
    // given: an open run and a payload naming this project's session
    const root = makeProject();
    const sid = '2026-09-13-session-settle-b2';
    openRun(root, sid, 0.92);
    // when: the event arrives
    const result = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      env: OWN_ENV,
      hookSessionId: 'harness-session-ours',
      measure: drop
    });
    // then: it settles and the row is written, as it is with no field at all
    expect(result.settled).toBe(true);
    expect(readHistory(root, sid)).toHaveLength(1);
  });

  it('when this project has no harness session id to compare against, should not refuse', () => {
    // The asymmetry that keeps the guard from becoming the very thing this
    // slice exists to delete — a hook that silently never settles anything. An
    // id we cannot resolve on our own side is not a mismatch.
    // given: an open run, a payload that names a session, and nothing on our
    //        side to check the name against
    const root = makeProject();
    const sid = '2026-09-13-session-settle-b3';
    openRun(root, sid, 0.92);
    // when: the event arrives
    const result = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      env: {},
      hookSessionId: 'harness-session-theirs',
      measure: drop
    });
    // then: it settles — an uncheckable name is not evidence of a mismatch
    expect(result.settled).toBe(true);
    expect(readHistory(root, sid)).toHaveLength(1);
  });
});

describe('the harness-reported session id', () => {
  it('when the payload carries one, should read it; otherwise say nothing', () => {
    // Same contract as the trigger reader: a payload without the field is an
    // EXPECTED input (the schema is truncated in the retrievable docs), and
    // every non-string shape resolves to "not reported" rather than to a value.
    expect(readSessionIdFromHookPayload({ session_id: 'abc' })).toBe('abc');
    expect(readSessionIdFromHookPayload({})).toBeUndefined();
    expect(readSessionIdFromHookPayload({ session_id: '' })).toBeUndefined();
    expect(readSessionIdFromHookPayload({ session_id: 7 })).toBeUndefined();
    expect(readSessionIdFromHookPayload({ session_id: null })).toBeUndefined();
    expect(readSessionIdFromHookPayload({ session_id: ['abc'] })).toBeUndefined();
    expect(readSessionIdFromHookPayload(['abc'])).toBeUndefined();
    expect(readSessionIdFromHookPayload(null)).toBeUndefined();
    expect(readSessionIdFromHookPayload('abc')).toBeUndefined();
  });
});

describe('D — the one probe that cannot close the pair (the R1 doc block, measured)', () => {
  it('when the next probe commits to compacting, should leave the pair unmeasured', async () => {
    // R1's repair closes the pair on the next BELOW-THRESHOLD probe, and the
    // doc block used to claim every probe reaches it. This pins the exception
    // rather than the claim: a probe that commits to compacting never reaches
    // `fillEventSettledMeasurement` (`auto-compact-orchestrator.ts:567` guards
    // it), and it does not defer the measurement — `advance('queued')` writes a
    // fresh run to the one-record-per-session store, so the record the pair was
    // owed is gone for good.
    // given: a dispatch whose event-settled record is still owed a number
    const root = makeProject();
    const sid = '2026-09-13-session-settle-d1';
    const dispatched = await runAutoCompact({ projectRoot: root, sessionId: sid, env: envAtRatio(0.93) });
    expect(dispatched.code).toBe('AUTO_COMPACT_DISPATCHED');
    const event = settleCompactFromHarnessEvent({
      projectRoot: root,
      sessionId: sid,
      trigger: 'auto',
      measure: ruler({ ratio: 0.93, ide: 'claude-code', windowTokens: 200_000, windowSource: 'qa-ruler' })
    });
    expect(event.settled).toBe(true);
    const owed = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (owed.kind !== 'valid') throw new Error(`expected a valid record, got ${owed.kind}`);
    expect(owed.record.stage).toBe('completed');
    expect(owed.record.afterRatio).toBeUndefined();
    // when: the next probe crosses the threshold and dispatches again
    const recommitted = await runAutoCompact({ projectRoot: root, sessionId: sid, env: envAtRatio(0.93) });
    expect(recommitted.code).toBe('AUTO_COMPACT_DISPATCHED');
    // then: the record the pair was owed is overwritten, not deferred
    const after = readCompactLifecycle({ projectRoot: root, sessionId: sid, nowMs: Date.now(), staleAfterMs: 60_000 });
    if (after.kind !== 'valid') throw new Error(`expected a valid record, got ${after.kind}`);
    expect(after.record.runId).not.toBe(owed.record.runId);
    expect(after.record.afterRatio).toBeUndefined();
    // ...so the first dispatch's pair stays unmeasured, which is where the loss
    //    is visible to a reader of `peaks compact history`
    const calibration = computeWindowCalibration(readHistory(root, sid));
    expect(calibration.pairs[0]?.measured).toBe(false);
    expect(calibration.pairs[0]?.observedRatio).toBeNull();
  });
});
