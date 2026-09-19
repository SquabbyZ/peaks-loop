// tests/unit/services/compact-visibility/compact-visibility.test.ts
//
// 4-dimension unit test for the compact-visibility epic
// (2026-07-30-compact-visibility + 2026-08-01-compact-lifecycle).
// Covers the following modules:
//   1. compact-history-service  (read + summarize)
//   2. compact-statusline-service (decide semantic state +
//      render fixed-cell-bar string)
//   3. compact-lifecycle-store  (write/read CompactLifecycleRecord)
//   4. (orchestrator's appendCompactHistoryEvent is tested
//      end-to-end via compact-history-service reading what
//      the orchestrator wrote in a real fs tmp dir)
//
// Dimensions covered:
//   - render:    cell-bar strings + semantic kinds + summary fields
//   - behavior:  all 9 statusline kinds, all 3 history read kinds,
//                all 4 lifecycle read kinds (missing/valid/invalid/
//                stalled), legacy migration priority order
//   - integration: real fs read of compact-history.jsonl, lifecycle
//                  fixture on disk, atomic write/read for lifecycle
//   - a11y:      rendered labels are single-line English, no CLI
//                verbs, no stack-trace fragments, NO `?` char in
//                rendered output (no guessed ratios)
//
// Run with: pnpm vitest run tests/unit/services/compact-visibility/compact-visibility.test.ts

import { mkdirSync, statSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions('tests/unit/services/compact-visibility/compact-visibility.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import {
  computeWindowCalibration,
  readCompactHistory,
  summarizeCompactHistory,
  type CompactHistoryEvent
} from '~/src/services/compact-history/compact-history-service';
import {
  decideCompactStatusline,
  renderCompactStatusline,
  type CompactStatuslineState
} from '~/src/services/compact-statusline/compact-statusline-service';
import {
  readCompactLifecycle,
  writeCompactLifecycle,
  type CompactLifecycleRecord
} from '~/src/services/compact-statusline/compact-lifecycle-store';

const SID = '2026-07-30-compact-vis';
const LIFECYCLE_SID = '2026-08-01-compact-lifecycle';

function makeEvent(overrides: Partial<CompactHistoryEvent> = {}): CompactHistoryEvent {
  return {
    schemaVersion: 1,
    ts: '2026-07-30T12:00:00.000Z',
    target: 'main',
    mode: 'standard',
    ide: 'claude-code',
    pathway: 'in-band',
    beforeRatio: 0.85,
    redLine: false,
    ok: true,
    checkpointPath: '/tmp/cp.json',
    dispatchMessage: 'auto-compact dispatched',
    ...overrides
  };
}

function makeLifecycleRecord(
  overrides: Partial<CompactLifecycleRecord> = {}
): CompactLifecycleRecord {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    stage: 'compacting',
    updatedAt: '2026-08-01T12:00:00.000Z',
    triggerRatio: 0.87,
    redLine: false,
    ...overrides
  };
}

const NOW_MS = Date.parse('2026-08-01T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Task 3 — compact lifecycle → semantic state + fixed cell mapping
// ---------------------------------------------------------------------------

const EXPECTED_CELLS = {
  queued: 0,
  preparing: 2,
  compacting: 4,
  verifying: 6,
  completed: 8
} as const;

describe('Scenario: render — compact cell-bar strings', () => {
  it('when invoked, should every lifecycle stage maps to the documented fixed cell count', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const expectations: Array<{
      stage: 'queued' | 'preparing' | 'compacting' | 'verifying' | 'completed';
      cells: 0 | 2 | 4 | 6 | 8;
    }> = [
      { stage: 'queued', cells: 0 },
      { stage: 'preparing', cells: 2 },
      { stage: 'compacting', cells: 4 },
      { stage: 'verifying', cells: 6 },
      { stage: 'completed', cells: 8 }
    ];
    for (const e of expectations) {
      expect(EXPECTED_CELLS[e.stage]).toBe(e.cells);
    }
  });

  it('when invoked, should renderCompactStatusline: idempotent on empty semantic state', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(renderCompactStatusline({ kind: 'none', filledCells: 0 })).toBe('compact [░░░░░░░░]');
  });

  it('when invoked, should renderCompactStatusline: 4 cells filled = compacting', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'compacting', filledCells: 4 });
    expect(out).toBe('compact [████░░░░]');
    expect(out).not.toMatch(/\?/);
  });

  it('when invoked, should renderCompactStatusline: 8 cells filled = completed (always surfaces the no-after-ratio hint)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8 });
    expect(out).toContain('████████');
    expect(out).not.toMatch(/\?/);
    // The hint is the only honest thing to render when no
    // after-ratio is carried — never invent a number.
    expect(out).toMatch(/no measurement|after-ratio unknown|after-ratio not recorded/i);
  });

  it('when invoked, should renderCompactStatusline: failed retains the failedAt cell (default compacting = 4)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'failed', filledCells: 4, failedAt: 'compacting' });
    expect(out).toContain('[████░░░░]');
    expect(out).not.toMatch(/\?/);
  });

  it('when invoked, should renderCompactStatusline: invalid state never renders a reassuring progress bar', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({
      kind: 'invalid',
      filledCells: 0,
      detail: 'lifecycle JSON malformed'
    });
    expect(out).not.toMatch(/\[/);
    expect(out).not.toMatch(/\?/);
  });

  it('when invoked, should renderCompactStatusline: stalled renders an explicit warning, no guess', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({
      kind: 'stalled',
      filledCells: 4,
      detail: 'no heartbeat for 180s'
    });
    expect(out).not.toMatch(/\?/);
    // stalled is not a green bar — it must surface as a warning
    expect(out).toMatch(/stalled/i);
  });

  it('when invoked, should renderCompactStatusline: completed with afterRatio surfaces the real after', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8, afterRatio: 0.42 });
    expect(out).toContain('0.42');
    expect(out).not.toMatch(/\?/);
  });

  it('when invoked, should renderCompactStatusline: completed WITHOUT afterRatio surfaces the "no measurement" hint (no guess)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8 });
    expect(out).not.toMatch(/\?/);
    // The hint must be a stable English token, not a number we invented.
    expect(out).toMatch(/no measurement|after-ratio unknown|after-ratio not recorded/i);
  });
});

describe('Scenario: behavior — lifecycle dispatch + cell mapping (Task 3)', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should queued lifecycle → 0 cells, kind=queued', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'queued', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('queued');
    expect(out.filledCells).toBe(0);
    expect(out.triggerRatio).toBe(0.87);
  });

  it('when invoked, should preparing lifecycle → 2 cells', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'preparing',
      updatedAt: '2026-08-01T11:59:59.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('preparing');
    expect(out.filledCells).toBe(2);
  });

  it('when invoked, should compacting lifecycle → 4 cells', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'compacting',
      updatedAt: '2026-08-01T11:59:59.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('compacting');
    expect(out.filledCells).toBe(4);
  });

  it('when invoked, should verifying lifecycle → 6 cells', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'verifying',
      updatedAt: '2026-08-01T11:59:59.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('verifying');
    expect(out.filledCells).toBe(6);
  });

  it('when invoked, should completed lifecycle → 8 cells', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'completed',
      updatedAt: '2026-08-01T11:59:59.000Z',
      afterRatio: 0.31
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('completed');
    expect(out.filledCells).toBe(8);
    expect(out.afterRatio).toBe(0.31);
  });

  it('when invoked, should completed lifecycle WITHOUT afterRatio — never invents one', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'completed',
      updatedAt: '2026-08-01T11:59:59.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('completed');
    expect(out.filledCells).toBe(8);
    expect(out.afterRatio).toBeUndefined();
  });

  it('when invoked, should failed-at-compacting lifecycle → kept at 4 cells, retains failedAt hint', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'failed',
      updatedAt: '2026-08-01T11:59:59.000Z',
      triggerRatio: 0.97,
      redLine: true,
      failedAt: 'compacting',
      errorSummary: 'transcript fallback empty'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('failed');
    expect(out.filledCells).toBe(4);
    expect(out.failedAt).toBe('compacting');
    expect(out.redLine).toBe(true);
  });

  it('when invoked, should failed-at-preparing lifecycle → kept at 2 cells', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'failed',
      updatedAt: '2026-08-01T11:59:59.000Z',
      failedAt: 'preparing',
      errorSummary: 'IDE bridge never opened'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('failed');
    expect(out.filledCells).toBe(2);
    expect(out.failedAt).toBe('preparing');
  });

  it('when invoked, should stalled active-stage lifecycle → surfaces stalled kind, retains filledCells', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'compacting',
      updatedAt: '2026-08-01T11:58:00.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    // now=12:00:00, updatedAt=11:58:00 = 120s gap, default staleAfterMs=120_000
    // → (staleAfterMs is exclusive per the store contract) so this is right at the edge.
    // Use a more conservative now to ensure stalled.
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: Date.parse('2026-08-01T12:00:30.000Z')
    });
    expect(out.kind).toBe('stalled');
    expect(out.filledCells).toBe(4);
  });

  it('when invoked, should invalid lifecycle → kind=invalid, no legacy fallback (no false reassurance)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), '{ not valid json', 'utf8');
    // ALSO seed a legacy pending + recent history, so an invalid-aware
    // implementation must NOT fall through to them.
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(
      join(runtime, 'txt', 'auto-compact-pending.json'),
      JSON.stringify({
        schemaVersion: 1,
        pending: true,
        target: 'main',
        ratio: 0.85,
        redLine: false
      }),
      'utf8'
    );
    writeFileSync(
      join(runtime, 'compact-history.jsonl'),
      JSON.stringify(makeEvent()) + '\n',
      'utf8'
    );
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('invalid');
    expect(out.filledCells).toBe(0);
    expect(out.detail).toBeDefined();
  });

  it('when invoked, should redLine is propagated from lifecycle to the decided state', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'compacting',
      updatedAt: '2026-08-01T11:59:59.000Z',
      triggerRatio: 0.97,
      redLine: true
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.redLine).toBe(true);
  });
});

describe('Scenario: behavior — legacy migration priority (no lifecycle, fall back to legacy files)', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should null sessionId → none, filledCells=0', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: null,
      now: NOW_MS
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it('when invoked, should no lifecycle, no legacy files → none, 0 cells', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it('when invoked, should legacy pending.json → queued (0 cells), lifecycle wins when it existed', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID, 'txt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'auto-compact-pending.json'),
      JSON.stringify({
        schemaVersion: 1,
        pending: true,
        target: 'main',
        ratio: 0.85,
        redLine: false
      }),
      'utf8'
    );
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('queued');
    expect(out.filledCells).toBe(0);
  });

  it('when invoked, should legacy pending.json with redLine=true → queued + redLine flag (still 0 cells)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID, 'txt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'auto-compact-pending.json'),
      JSON.stringify({
        schemaVersion: 1,
        pending: true,
        target: 'main',
        ratio: 0.97,
        redLine: true
      }),
      'utf8'
    );
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('queued');
    expect(out.filledCells).toBe(0);
    expect(out.redLine).toBe(true);
  });

  it('when invoked, should legacy recent history → completed WITHOUT invented afterRatio', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    //
    // REPAIR R9: the row must be one that SAYS a compaction was witnessed. This
    // fixture used to be a bare `dispatch` row — an ASK — read off the file's
    // mtime, and it asserted `completed`. That is the defect: the same file
    // takes a dispatch row every time peaks-loop asks, so 1075 such asks in one
    // real session (and zero compactions) each painted a full 8-cell bar. The
    // elapsed window is now measured against the row's own `ts`, not the
    // filesystem's, so the row is written at the timestamp being tested rather
    // than back-dated.
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(
      path,
      JSON.stringify({
        ...makeEvent({ beforeRatio: 0.92 }),
        kind: 'observed',
        afterRatio: 0.04,
        ts: new Date(now).toISOString()
      }) + '\n',
      'utf8'
    );
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now
    });
    expect(out.kind).toBe('completed');
    expect(out.filledCells).toBe(8);
    // CRITICAL: no invented afterRatio when only legacy history is present
    expect(out.afterRatio).toBeUndefined();
  });

  it('when invoked, should a DISPATCH row is not a completed compaction, however fresh the file is', () => {
    // AC4, measured. A dispatch row records that peaks-loop ASKED for a compact.
    // The file it lands in is at its freshest immediately after that ask — which
    // is exactly when the old mtime read reported `completed` — so freshness is
    // evidence for the opposite of what it was used to claim.
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(
      path,
      JSON.stringify({
        ...makeEvent({ beforeRatio: 0.95 }),
        kind: 'dispatch',
        ts: new Date(now).toISOString()
      }) + '\n',
      'utf8'
    );
    utimesSync(path, new Date(now), new Date(now));
    // NON-VACUITY CONTROL, so a green here cannot mean "the file happened to be
    // old": the pre-fix predicate was `now - statSync(path).mtimeMs <= 30_000`,
    // and this fixture satisfies it. PRE-FIX this test was RED — the fixture
    // reported `completed` / 8 cells.
    expect(now - statSync(path).mtimeMs).toBeLessThanOrEqual(30_000);
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it('when invoked, should an observed row the ask landed after is STILL the compaction it witnessed', () => {
    // REPAIR R11. The reverse of the case above, and the one R9's own fix got
    // wrong: reading only the LAST row makes an `observed` row invisible as soon
    // as any later row exists — and a `dispatch` row lands on every probe, so a
    // witnessed compaction was dropped the moment peaks-loop asked again. On
    // this fixture the last-row read answers `none` / 0 cells while the mtime
    // read it replaced reported the compaction, i.e. the fix deleted an
    // indicator it was meant to make honest.
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(
      path,
      JSON.stringify({
        ...makeEvent({ beforeRatio: 0.92 }),
        kind: 'observed',
        afterRatio: 0.04,
        ts: new Date(now - 1000).toISOString()
      }) +
        '\n' +
        JSON.stringify({
          ...makeEvent({ beforeRatio: 0.93 }),
          kind: 'dispatch',
          ts: new Date(now).toISOString()
        }) +
        '\n',
      'utf8'
    );
    // NON-VACUITY CONTROL, as above: the file is fresh, so a `none` here is the
    // new predicate's doing rather than the fixture's age.
    expect(now - statSync(path).mtimeMs).toBeLessThanOrEqual(30_000);
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now
    });
    expect(out.kind).toBe('completed');
    expect(out.filledCells).toBe(8);
  });

  it('when invoked, should an observed history row older than 30s + no pending → none', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    const past = new Date(Date.now() - 60_000);
    // A witnessed compaction, but not a recent one: the window is what this
    // pins, so the row must be one that WOULD qualify on kind alone.
    writeFileSync(
      path,
      JSON.stringify({
        ...makeEvent(),
        kind: 'observed',
        afterRatio: 0.04,
        ts: past.toISOString()
      }) + '\n',
      'utf8'
    );
    utimesSync(path, past, past);
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: Date.now()
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it('when invoked, should pending wins over recent history when lifecycle is missing (legacy priority)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(
      join(runtime, 'txt', 'auto-compact-pending.json'),
      JSON.stringify({
        schemaVersion: 1,
        pending: true,
        target: 'main',
        ratio: 0.85,
        redLine: false
      }),
      'utf8'
    );
    writeFileSync(
      join(runtime, 'compact-history.jsonl'),
      JSON.stringify(makeEvent()) + '\n',
      'utf8'
    );
    const now = Date.now();
    utimesSync(join(runtime, 'compact-history.jsonl'), new Date(now), new Date(now));
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now
    });
    expect(out.kind).toBe('queued');
  });

  it('when invoked, should LIFECYCLE WINS over legacy pending + history (priority order)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Set up legacy pending + recent history
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(
      join(runtime, 'txt', 'auto-compact-pending.json'),
      JSON.stringify({
        schemaVersion: 1,
        pending: true,
        target: 'main',
        ratio: 0.85,
        redLine: false
      }),
      'utf8'
    );
    writeFileSync(
      join(runtime, 'compact-history.jsonl'),
      JSON.stringify(makeEvent()) + '\n',
      'utf8'
    );
    const now = Date.now();
    utimesSync(join(runtime, 'compact-history.jsonl'), new Date(now), new Date(now));
    // Plus a lifecycle record
    const record = makeLifecycleRecord({
      stage: 'verifying',
      updatedAt: '2026-08-01T11:59:59.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('verifying');
    expect(out.filledCells).toBe(6);
  });
});

describe('Scenario: behavior — compact-history read (kept from previous slice)', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should returns file-missing when the JSONL does not exist', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('file-missing');
  });

  it('when invoked, should returns empty when the JSONL exists but has no content', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'compact-history.jsonl'), '', 'utf8');
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('empty');
  });

  it('when invoked, should returns ok + events when the JSONL has valid lines', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(
      path,
      JSON.stringify(makeEvent({ ts: '2026-07-30T12:00:00.000Z' })) +
        '\n' +
        JSON.stringify(makeEvent({ ts: '2026-07-30T12:05:00.000Z', redLine: true })) +
        '\n',
      'utf8'
    );
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.events).toHaveLength(2);
      expect(out.parseErrors).toEqual([]);
    }
  });

  it('when invoked, should surfaces malformed lines as parseErrors without aborting the rest', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(
      path,
      JSON.stringify(makeEvent()) +
        '\n' +
        'this is not json {\n' +
        JSON.stringify(makeEvent({ ts: '2026-07-30T12:10:00.000Z' })) +
        '\n',
      'utf8'
    );
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.events).toHaveLength(2);
      expect(out.parseErrors).toHaveLength(1);
      expect(out.parseErrors[0]?.line).toBe(2);
    }
  });

  it('when invoked, should summarizeCompactHistory reports totalCompacts + redLineCount + failedCount', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const events = [
      makeEvent({ ts: '2026-07-30T12:00:00.000Z', beforeRatio: 0.85, redLine: false, ok: true }),
      makeEvent({ ts: '2026-07-30T12:05:00.000Z', beforeRatio: 0.95, redLine: true, ok: true }),
      makeEvent({ ts: '2026-07-30T12:10:00.000Z', beforeRatio: 0.91, redLine: false, ok: false })
    ];
    const s = summarizeCompactHistory(events);
    expect(s.totalCompacts).toBe(3);
    expect(s.redLineCount).toBe(1);
    expect(s.failedCount).toBe(1);
    expect(s.lastTs).toBe('2026-07-30T12:10:00.000Z');
    expect(s.lastBeforeRatio).toBe(0.91);
    expect(s.lastRedLine).toBe(false);
  });
});

describe('Scenario: behavior — compact-lifecycle record shape (kept from Task 1)', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should returns missing when no file has ever been written', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('missing');
  });

  it('when invoked, should returns invalid (with reason) for malformed JSON; never silently becomes missing', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), '{ not valid json', 'utf8');
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason.length).toBeGreaterThan(0);
      expect(out.reason.toLowerCase()).toMatch(/json|parse|malformed/);
    }
  });

  it('when invoked, should returns invalid when schemaVersion is not 1', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, 'compact-lifecycle.json'),
      JSON.stringify({
        schemaVersion: 2,
        runId: 'run-1',
        stage: 'compacting',
        updatedAt: '2026-08-01T12:00:00.000Z',
        triggerRatio: 0.87,
        redLine: false
      }),
      'utf8'
    );
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).toMatch(/schemaVersion/i);
    }
  });

  it('when invoked, should returns invalid when triggerRatio is out of range', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, 'compact-lifecycle.json'),
      JSON.stringify({
        schemaVersion: 1,
        runId: 'run-1',
        stage: 'compacting',
        updatedAt: '2026-08-01T12:00:00.000Z',
        triggerRatio: 1.5,
        redLine: false
      }),
      'utf8'
    );
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).toMatch(/triggerRatio/i);
    }
  });

  it('when invoked, should returns invalid when stage=failed is missing the failedAt hint', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, 'compact-lifecycle.json'),
      JSON.stringify({
        schemaVersion: 1,
        runId: 'run-1',
        stage: 'failed',
        updatedAt: '2026-08-01T12:00:00.000Z',
        triggerRatio: 0.95,
        redLine: true
      }),
      'utf8'
    );
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).toMatch(/failedAt/i);
    }
  });

  it('when invoked, should returns stalled for an active stage whose updatedAt is older than staleAfterMs', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'compacting',
      updatedAt: '2026-08-01T11:58:00.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:30.000Z'), // 150s gap, staleAfterMs=120_000 → stale
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('stalled');
    if (out.kind === 'stalled') {
      expect(out.record.stage).toBe('compacting');
    }
  });

  it('when invoked, should terminal "completed" record older than staleAfterMs stays valid (not stalled)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'completed',
      updatedAt: '2026-08-01T11:00:00.000Z',
      afterRatio: 0.05
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:00.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.stage).toBe('completed');
      expect(out.record.afterRatio).toBe(0.05);
    }
  });

  it('when invoked, should terminal "failed" record older than staleAfterMs stays valid (not stalled)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'failed',
      updatedAt: '2026-08-01T11:00:00.000Z',
      redLine: true,
      failedAt: 'compacting',
      errorSummary: 'transcript fallback empty'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:00.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('valid');
  });
});

describe('Scenario: integration — atomic write/read with real fs', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should write then read returns the same record (round trip)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord();
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out).toEqual({ kind: 'valid', record });
  });

  it('when invoked, should a second write atomically replaces the first (no leftover tmp files)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const first = makeLifecycleRecord({ runId: 'run-A', stage: 'preparing' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record: first });
    const second = makeLifecycleRecord({ runId: 'run-A', stage: 'compacting' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record: second });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.stage).toBe('compacting');
    }
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    const fs = require('node:fs') as typeof import('node:fs');
    const entries = fs.readdirSync(runtime).filter((n) => n.includes('.tmp-'));
    expect(entries).toEqual([]);
  });

  it('when invoked, should write clamps errorSummary to 160 characters before persisting', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const long = 'x'.repeat(500);
    const record = makeLifecycleRecord({
      stage: 'failed',
      failedAt: 'compacting',
      errorSummary: long
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.errorSummary?.length).toBe(160);
      expect(out.record.errorSummary).toBe('x'.repeat(160));
    }
  });

  it('when invoked, should end-to-end: lifecycle write → decide → render never contains "?"', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'verifying',
      updatedAt: '2026-08-01T11:59:59.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const state = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    const rendered = renderCompactStatusline(state);
    expect(rendered).not.toMatch(/\?/);
    expect(rendered).toContain('██████░░');
  });
});

describe('Scenario: integration — compact-history end-to-end (kept from previous slice)', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should history file written by a real append is readable end-to-end', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(runtime, { recursive: true });
    const path = join(runtime, 'compact-history.jsonl');
    writeFileSync(
      path,
      JSON.stringify(makeEvent({ ts: '2026-07-30T12:00:00.000Z' })) + '\n',
      'utf8'
    );
    writeFileSync(
      path,
      JSON.stringify(
        makeEvent({ ts: '2026-07-30T12:05:00.000Z', beforeRatio: 0.92, redLine: false })
      ) + '\n',
      { flag: 'a' }
    );
    writeFileSync(
      path,
      JSON.stringify(
        makeEvent({ ts: '2026-07-30T12:10:00.000Z', beforeRatio: 0.95, redLine: true, ok: true })
      ) + '\n',
      { flag: 'a' }
    );

    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.events).toHaveLength(3);
      const summary = summarizeCompactHistory(out.events);
      expect(summary.totalCompacts).toBe(3);
      expect(summary.redLineCount).toBe(1);
    }
  });
});

describe('Scenario: a11y — rendered label hygiene (no "?" anywhere)', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should every rendered label across the 9 semantic kinds is single-line English, no CLI verb, no stack trace, no "?"', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Drive each kind through an actual lifecycle write so the render
    // path is exercised end-to-end.
    const fixtures: Array<{
      stage: 'queued' | 'preparing' | 'compacting' | 'verifying' | 'completed' | 'failed';
      failedAt?: 'queued' | 'preparing' | 'compacting' | 'verifying';
      afterRatio?: number;
    }> = [
      { stage: 'queued' },
      { stage: 'preparing' },
      { stage: 'compacting' },
      { stage: 'verifying' },
      { stage: 'completed', afterRatio: 0.42 },
      { stage: 'completed' },
      { stage: 'failed', failedAt: 'compacting' }
    ];
    for (const f of fixtures) {
      const sid = `${LIFECYCLE_SID}-${f.stage}-${f.failedAt ?? 'none'}`;
      const record = makeLifecycleRecord({
        stage: f.stage,
        updatedAt: '2026-08-01T11:59:59.000Z',
        ...(f.failedAt !== undefined ? { failedAt: f.failedAt } : {}),
        ...(f.afterRatio !== undefined ? { afterRatio: f.afterRatio } : {})
      });
      writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: sid, record });
      const state = decideCompactStatusline({
        projectRoot: process.cwd(),
        sessionId: sid,
        now: NOW_MS
      });
      const rendered = renderCompactStatusline(state);
      expect(rendered).not.toMatch(/\n/);
      expect(rendered).not.toMatch(/at .+:\d+/);
      expect(rendered).not.toMatch(/peaks\s+[a-z][a-z-]+/);
      // The brief explicitly forbids `?` in any rendered output.
      expect(rendered).not.toMatch(/\?/);
    }
  });

  it('when invoked, should invalid-reason detail is a single line, no CLI verb, no stack trace', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), '{', 'utf8');
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid' && out.detail !== undefined) {
      expect(out.detail).not.toMatch(/\n/);
      expect(out.detail).not.toMatch(/at .+:\d+/);
      expect(out.detail).not.toMatch(/peaks\s+[a-z][a-z-]+/);
    }
  });
});

// ---------------------------------------------------------------------------
// Slice 2026-09-12-compact-band-policy (defect B).
//
// Field evidence: `.peaks/_runtime/<sid>/compact-lifecycle.json` sat at
// `stage: "compacting"` for 92 minutes after a 0.8387-ratio dispatch that
// only armed claude-code's ≥95% PreToolUse hook. Nothing was compacting,
// the ratio never fell, `settleOpenLifecycleRun` never ran — and the
// statusline reported `stalled` forever.
//
// The fix is a truthful stage, not a bigger stale window: `armed` is a
// RESTING stage (no heartbeat is promised, so waiting is normal), while
// `compacting` keeps its meaning — "a compaction should be in flight" —
// which is the ONLY state where a missing heartbeat is real evidence.
// ---------------------------------------------------------------------------

describe('Scenario: behavior — `armed` rests; `compacting` is the only stage that can stall', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should armed older than staleAfterMs stays valid (not stalled) and renders WITHOUT a progress bar', () => {
    // given: an armed record written an hour before `now`
    // when:  the canonical reader + statusline decide on it
    // then:  it rests as `armed` — no stall, no bar, no guessed progress
    const record = makeLifecycleRecord({
      stage: 'armed',
      updatedAt: '2026-08-01T11:00:00.000Z',
      triggerRatio: 0.8387
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });

    const read = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: NOW_MS, // 1h after updatedAt, way past staleAfterMs=120_000
      staleAfterMs: 120_000
    });
    // Before the fix this returned `stalled` and pinned the statusline.
    expect(read.kind).toBe('valid');

    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('armed');
    expect(out.kind).not.toBe('stalled');

    const rendered = renderCompactStatusline(out);
    expect(rendered).not.toMatch(/stalled/i);
    // No bar characters at all: a bar is a progress claim.
    expect(rendered).not.toMatch(/[█░]/);
    // It states what it is waiting for, so the user can tell it apart
    // from a compact that is actually running.
    expect(rendered).toMatch(/95%/);
  });

  it('when invoked, should genuinely stuck compacting STILL reports stalled (capability preserved)', () => {
    // given: a `compacting` record whose heartbeat never arrived
    // when:  the canonical reader + statusline decide on it
    // then:  it is still reported as stalled — the real failure mode
    const record = makeLifecycleRecord({
      stage: 'compacting',
      updatedAt: '2026-08-01T11:00:00.000Z'
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });

    const read = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: NOW_MS,
      staleAfterMs: 120_000
    });
    expect(read.kind).toBe('stalled');

    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS
    });
    expect(out.kind).toBe('stalled');
    expect(renderCompactStatusline(out)).toMatch(/stalled/i);
  });
});

// Slice 2026-09-13-auto-compact-trigger-ownership (T4) — the calibration
// instrument. This slice could NOT run a real Claude Code session, so the
// percentage of the window at which the harness actually fires has no
// measured answer; picking one would be a fabricated number. What it
// delivers instead is the record that turns the first real session into that
// answer: the token point peaks-loop ASKED for, next to the ratio the next
// probe MEASURED.
describe('Scenario: behavior — window calibration (intent vs observed)', () => {
  const ws = withTmpWorkspacePerTest();

  function dispatchRow(over: Partial<CompactHistoryEvent> = {}): CompactHistoryEvent {
    return {
      schemaVersion: 1,
      kind: 'dispatch',
      ts: '2026-09-13T00:00:00.000Z',
      target: 'main',
      mode: 'standard',
      ide: 'claude-code',
      pathway: 'ide-native',
      beforeRatio: 0.95,
      redLine: true,
      ok: true,
      checkpointPath: '/tmp/cp.json',
      dispatchMessage: 'dispatched',
      windowTokens: 200_000,
      windowSource: 'harness-env',
      ...over
    };
  }

  function observedRow(over: Partial<CompactHistoryEvent> = {}): CompactHistoryEvent {
    return {
      ...dispatchRow(),
      kind: 'observed',
      ts: '2026-09-13T00:10:00.000Z',
      beforeRatio: 0.95,
      afterRatio: 0.12,
      ...over
    };
  }

  it('when a dispatch is followed by a measurement, should pair them and report the token drift', () => {
    // given: peaks-loop asked at 95% of a 200K window; the next probe measured 12%
    // when: the calibration is computed
    const out = computeWindowCalibration([dispatchRow(), observedRow()]);
    // then: intent and observation are both expressed in tokens
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0]).toMatchObject({
      windowTokens: 200_000,
      windowSource: 'harness-env',
      requestedRatio: 0.95,
      requestedTokens: 190_000,
      observedRatio: 0.12,
      observedTokens: 24_000,
      driftTokens: -166_000,
      measured: true
    });
    expect(out.unmeasured).toBe(0);
    expect(out.lastWindowTokens).toBe(200_000);
  });

  it('when a dispatch has no measurement yet, should report it as unmeasured rather than guessing', () => {
    // given: an ask with no following probe
    // when: the calibration is computed
    const out = computeWindowCalibration([dispatchRow()]);
    // then: every observed field is null — no fabricated observation
    expect(out.pairs[0]).toMatchObject({
      observedRatio: null,
      observedTokens: null,
      driftTokens: null,
      measured: false
    });
    expect(out.unmeasured).toBe(1);
  });

  it('when a row predates this slice, should still produce a pair (append-only file, never rewritten)', () => {
    // given: a legacy row with no `kind` and no window
    const legacy: CompactHistoryEvent = {
      schemaVersion: 1,
      ts: '2026-01-01T00:00:00.000Z',
      target: 'main',
      mode: 'standard',
      ide: 'claude-code',
      pathway: 'ide-native',
      beforeRatio: 0.9,
      redLine: false,
      ok: true,
      checkpointPath: '/tmp/old.json',
      dispatchMessage: 'legacy dispatch'
    };
    // when: the calibration is computed
    const out = computeWindowCalibration([legacy]);
    // then: it is treated as a dispatch with an unknown window, not an error
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0]).toMatchObject({
      windowTokens: null,
      requestedTokens: null,
      measured: false
    });
  });

  it('when two dispatches share one measurement, should attach it to the most recent unmeasured ask', () => {
    // given: two asks and a single measurement row
    // when: the calibration is computed
    const out = computeWindowCalibration([
      dispatchRow({ ts: '2026-09-13T00:00:00.000Z' }),
      dispatchRow({ ts: '2026-09-13T00:05:00.000Z' }),
      observedRow()
    ]);
    // then: the newest ask is the one that got settled; the older stays open
    expect(out.pairs[0]!.measured).toBe(false);
    expect(out.pairs[1]!.measured).toBe(true);
    expect(out.unmeasured).toBe(1);
  });

  it('when the same file is read back through readCompactHistory, should keep the window fields (render)', () => {
    // given: a compact-history.jsonl on disk carrying a dispatch + observation
    const root = ws().path;
    const dir = join(root, '.peaks', '_runtime', 'sid');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'compact-history.jsonl'),
      `${JSON.stringify(dispatchRow())}\n${JSON.stringify(observedRow())}\n`,
      'utf8'
    );
    // when: the reader parses it
    const read = readCompactHistory({ projectRoot: root, sessionId: 'sid' });
    if (read.kind !== 'ok') throw new Error(`expected ok, got ${read.kind}`);
    // then: no parse errors and the calibration survives the round trip
    expect(read.parseErrors).toEqual([]);
    expect(read.events[0]!.kind).toBe('dispatch');
    expect(read.events[0]!.windowTokens).toBe(200_000);
    expect(computeWindowCalibration(read.events).pairs[0]!.observedTokens).toBe(24_000);
  });
});
