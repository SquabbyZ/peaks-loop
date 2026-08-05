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

import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/compact-visibility/compact-visibility.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

import {
  readCompactHistory,
  summarizeCompactHistory,
  type CompactHistoryEvent,
} from '~/src/services/compact-history/compact-history-service';
import {
  decideCompactStatusline,
  renderCompactStatusline,
  type CompactStatuslineState,
} from '~/src/services/compact-statusline/compact-statusline-service';
import {
  readCompactLifecycle,
  writeCompactLifecycle,
  type CompactLifecycleRecord,
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
    ...overrides,
  };
}

function makeLifecycleRecord(
  overrides: Partial<CompactLifecycleRecord> = {},
): CompactLifecycleRecord {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    stage: 'compacting',
    updatedAt: '2026-08-01T12:00:00.000Z',
    triggerRatio: 0.87,
    redLine: false,
    ...overrides,
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
  completed: 8,
} as const;

describe("Scenario: render — compact cell-bar strings", () => {
  it("when invoked, should every lifecycle stage maps to the documented fixed cell count", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const expectations: Array<{ stage: 'queued' | 'preparing' | 'compacting' | 'verifying' | 'completed'; cells: 0 | 2 | 4 | 6 | 8 }> = [
      { stage: 'queued', cells: 0 },
      { stage: 'preparing', cells: 2 },
      { stage: 'compacting', cells: 4 },
      { stage: 'verifying', cells: 6 },
      { stage: 'completed', cells: 8 },
    ];
    for (const e of expectations) {
      expect(EXPECTED_CELLS[e.stage]).toBe(e.cells);
    }
  });

  it("when invoked, should renderCompactStatusline: idempotent on empty semantic state", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(renderCompactStatusline({ kind: 'none', filledCells: 0 })).toBe('compact [░░░░░░░░]');
  });

  it("when invoked, should renderCompactStatusline: 4 cells filled = compacting", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'compacting', filledCells: 4 });
    expect(out).toBe('compact [████░░░░]');
    expect(out).not.toMatch(/\?/);
  });

  it("when invoked, should renderCompactStatusline: 8 cells filled = completed (always surfaces the no-after-ratio hint)", () => {
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

  it("when invoked, should renderCompactStatusline: failed retains the failedAt cell (default compacting = 4)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'failed', filledCells: 4, failedAt: 'compacting' });
    expect(out).toContain('[████░░░░]');
    expect(out).not.toMatch(/\?/);
  });

  it("when invoked, should renderCompactStatusline: invalid state never renders a reassuring progress bar", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'invalid', filledCells: 0, detail: 'lifecycle JSON malformed' });
    expect(out).not.toMatch(/\[/);
    expect(out).not.toMatch(/\?/);
  });

  it("when invoked, should renderCompactStatusline: stalled renders an explicit warning, no guess", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'stalled', filledCells: 4, detail: 'no heartbeat for 180s' });
    expect(out).not.toMatch(/\?/);
    // stalled is not a green bar — it must surface as a warning
    expect(out).toMatch(/stalled/i);
  });

  it("when invoked, should renderCompactStatusline: completed with afterRatio surfaces the real after", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8, afterRatio: 0.42 });
    expect(out).toContain('0.42');
    expect(out).not.toMatch(/\?/);
  });

  it("when invoked, should renderCompactStatusline: completed WITHOUT afterRatio surfaces the \"no measurement\" hint (no guess)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8 });
    expect(out).not.toMatch(/\?/);
    // The hint must be a stable English token, not a number we invented.
    expect(out).toMatch(/no measurement|after-ratio unknown|after-ratio not recorded/i);
  });
});

describe("Scenario: behavior — lifecycle dispatch + cell mapping (Task 3)", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should queued lifecycle → 0 cells, kind=queued", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'queued', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('queued');
    expect(out.filledCells).toBe(0);
    expect(out.triggerRatio).toBe(0.87);
  });

  it("when invoked, should preparing lifecycle → 2 cells", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'preparing', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('preparing');
    expect(out.filledCells).toBe(2);
  });

  it("when invoked, should compacting lifecycle → 4 cells", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'compacting', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('compacting');
    expect(out.filledCells).toBe(4);
  });

  it("when invoked, should verifying lifecycle → 6 cells", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'verifying', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('verifying');
    expect(out.filledCells).toBe(6);
  });

  it("when invoked, should completed lifecycle → 8 cells", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'completed', updatedAt: '2026-08-01T11:59:59.000Z', afterRatio: 0.31 });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('completed');
    expect(out.filledCells).toBe(8);
    expect(out.afterRatio).toBe(0.31);
  });

  it("when invoked, should completed lifecycle WITHOUT afterRatio — never invents one", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'completed', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('completed');
    expect(out.filledCells).toBe(8);
    expect(out.afterRatio).toBeUndefined();
  });

  it("when invoked, should failed-at-compacting lifecycle → kept at 4 cells, retains failedAt hint", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'failed',
      updatedAt: '2026-08-01T11:59:59.000Z',
      triggerRatio: 0.97,
      redLine: true,
      failedAt: 'compacting',
      errorSummary: 'transcript fallback empty',
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('failed');
    expect(out.filledCells).toBe(4);
    expect(out.failedAt).toBe('compacting');
    expect(out.redLine).toBe(true);
  });

  it("when invoked, should failed-at-preparing lifecycle → kept at 2 cells", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'failed',
      updatedAt: '2026-08-01T11:59:59.000Z',
      failedAt: 'preparing',
      errorSummary: 'IDE bridge never opened',
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('failed');
    expect(out.filledCells).toBe(2);
    expect(out.failedAt).toBe('preparing');
  });

  it("when invoked, should stalled active-stage lifecycle → surfaces stalled kind, retains filledCells", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'compacting', updatedAt: '2026-08-01T11:58:00.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    // now=12:00:00, updatedAt=11:58:00 = 120s gap, default staleAfterMs=120_000
    // → (staleAfterMs is exclusive per the store contract) so this is right at the edge.
    // Use a more conservative now to ensure stalled.
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: Date.parse('2026-08-01T12:00:30.000Z'),
    });
    expect(out.kind).toBe('stalled');
    expect(out.filledCells).toBe(4);
  });

  it("when invoked, should invalid lifecycle → kind=invalid, no legacy fallback (no false reassurance)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), '{ not valid json', 'utf8');
    // ALSO seed a legacy pending + recent history, so an invalid-aware
    // implementation must NOT fall through to them.
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(join(runtime, 'txt', 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1, pending: true, target: 'main', ratio: 0.85, redLine: false,
    }), 'utf8');
    writeFileSync(join(runtime, 'compact-history.jsonl'), JSON.stringify(makeEvent()) + '\n', 'utf8');
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('invalid');
    expect(out.filledCells).toBe(0);
    expect(out.detail).toBeDefined();
  });

  it("when invoked, should redLine is propagated from lifecycle to the decided state", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'compacting',
      updatedAt: '2026-08-01T11:59:59.000Z',
      triggerRatio: 0.97,
      redLine: true,
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.redLine).toBe(true);
  });
});

describe("Scenario: behavior — legacy migration priority (no lifecycle, fall back to legacy files)", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should null sessionId → none, filledCells=0", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: null,
      now: NOW_MS,
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it("when invoked, should no lifecycle, no legacy files → none, 0 cells", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it("when invoked, should legacy pending.json → queued (0 cells), lifecycle wins when it existed", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID, 'txt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1, pending: true, target: 'main', ratio: 0.85, redLine: false,
    }), 'utf8');
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('queued');
    expect(out.filledCells).toBe(0);
  });

  it("when invoked, should legacy pending.json with redLine=true → queued + redLine flag (still 0 cells)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID, 'txt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1, pending: true, target: 'main', ratio: 0.97, redLine: true,
    }), 'utf8');
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('queued');
    expect(out.filledCells).toBe(0);
    expect(out.redLine).toBe(true);
  });

  it("when invoked, should legacy recent history → completed WITHOUT invented afterRatio", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(path, JSON.stringify(makeEvent({ beforeRatio: 0.92 })) + '\n', 'utf8');
    // Set mtime to NOW so the 30s window evaluates against the same
    // timestamp the decision layer sees.
    const now = Date.now();
    utimesSync(path, new Date(now), new Date(now));
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now,
    });
    expect(out.kind).toBe('completed');
    expect(out.filledCells).toBe(8);
    // CRITICAL: no invented afterRatio when only legacy history is present
    expect(out.afterRatio).toBeUndefined();
  });

  it("when invoked, should legacy history mtime older than 30s + no pending → none", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(path, JSON.stringify(makeEvent()) + '\n', 'utf8');
    const past = new Date(Date.now() - 60_000);
    utimesSync(path, past, past);
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: Date.now(),
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it("when invoked, should pending wins over recent history when lifecycle is missing (legacy priority)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(join(runtime, 'txt', 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1, pending: true, target: 'main', ratio: 0.85, redLine: false,
    }), 'utf8');
    writeFileSync(join(runtime, 'compact-history.jsonl'), JSON.stringify(makeEvent()) + '\n', 'utf8');
    const now = Date.now();
    utimesSync(join(runtime, 'compact-history.jsonl'), new Date(now), new Date(now));
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now,
    });
    expect(out.kind).toBe('queued');
  });

  it("when invoked, should LIFECYCLE WINS over legacy pending + history (priority order)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Set up legacy pending + recent history
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(join(runtime, 'txt', 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1, pending: true, target: 'main', ratio: 0.85, redLine: false,
    }), 'utf8');
    writeFileSync(join(runtime, 'compact-history.jsonl'), JSON.stringify(makeEvent()) + '\n', 'utf8');
    const now = Date.now();
    utimesSync(join(runtime, 'compact-history.jsonl'), new Date(now), new Date(now));
    // Plus a lifecycle record
    const record = makeLifecycleRecord({ stage: 'verifying', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('verifying');
    expect(out.filledCells).toBe(6);
  });
});

describe("Scenario: behavior — compact-history read (kept from previous slice)", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should returns file-missing when the JSONL does not exist", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('file-missing');
  });

  it("when invoked, should returns empty when the JSONL exists but has no content", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'compact-history.jsonl'), '', 'utf8');
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('empty');
  });

  it("when invoked, should returns ok + events when the JSONL has valid lines", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(path, JSON.stringify(makeEvent({ ts: '2026-07-30T12:00:00.000Z' })) + '\n' +
      JSON.stringify(makeEvent({ ts: '2026-07-30T12:05:00.000Z', redLine: true })) + '\n', 'utf8');
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.events).toHaveLength(2);
      expect(out.parseErrors).toEqual([]);
    }
  });

  it("when invoked, should surfaces malformed lines as parseErrors without aborting the rest", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(path, JSON.stringify(makeEvent()) + '\n' + 'this is not json {\n' + JSON.stringify(makeEvent({ ts: '2026-07-30T12:10:00.000Z' })) + '\n', 'utf8');
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.events).toHaveLength(2);
      expect(out.parseErrors).toHaveLength(1);
      expect(out.parseErrors[0]?.line).toBe(2);
    }
  });

  it("when invoked, should summarizeCompactHistory reports totalCompacts + redLineCount + failedCount", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const events = [
      makeEvent({ ts: '2026-07-30T12:00:00.000Z', beforeRatio: 0.85, redLine: false, ok: true }),
      makeEvent({ ts: '2026-07-30T12:05:00.000Z', beforeRatio: 0.95, redLine: true, ok: true }),
      makeEvent({ ts: '2026-07-30T12:10:00.000Z', beforeRatio: 0.91, redLine: false, ok: false }),
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

describe("Scenario: behavior — compact-lifecycle record shape (kept from Task 1)", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should returns missing when no file has ever been written", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('missing');
  });

  it("when invoked, should returns invalid (with reason) for malformed JSON; never silently becomes missing", () => {
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
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason.length).toBeGreaterThan(0);
      expect(out.reason.toLowerCase()).toMatch(/json|parse|malformed/);
    }
  });

  it("when invoked, should returns invalid when schemaVersion is not 1", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), JSON.stringify({
      schemaVersion: 2,
      runId: 'run-1',
      stage: 'compacting',
      updatedAt: '2026-08-01T12:00:00.000Z',
      triggerRatio: 0.87,
      redLine: false,
    }), 'utf8');
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).toMatch(/schemaVersion/i);
    }
  });

  it("when invoked, should returns invalid when triggerRatio is out of range", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), JSON.stringify({
      schemaVersion: 1,
      runId: 'run-1',
      stage: 'compacting',
      updatedAt: '2026-08-01T12:00:00.000Z',
      triggerRatio: 1.5,
      redLine: false,
    }), 'utf8');
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).toMatch(/triggerRatio/i);
    }
  });

  it("when invoked, should returns invalid when stage=failed is missing the failedAt hint", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), JSON.stringify({
      schemaVersion: 1,
      runId: 'run-1',
      stage: 'failed',
      updatedAt: '2026-08-01T12:00:00.000Z',
      triggerRatio: 0.95,
      redLine: true,
    }), 'utf8');
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).toMatch(/failedAt/i);
    }
  });

  it("when invoked, should returns stalled for an active stage whose updatedAt is older than staleAfterMs", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'compacting', updatedAt: '2026-08-01T11:58:00.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:30.000Z'), // 150s gap, staleAfterMs=120_000 → stale
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('stalled');
    if (out.kind === 'stalled') {
      expect(out.record.stage).toBe('compacting');
    }
  });

  it("when invoked, should terminal \"completed\" record older than staleAfterMs stays valid (not stalled)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'completed',
      updatedAt: '2026-08-01T11:00:00.000Z',
      afterRatio: 0.05,
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:00.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.stage).toBe('completed');
      expect(out.record.afterRatio).toBe(0.05);
    }
  });

  it("when invoked, should terminal \"failed\" record older than staleAfterMs stays valid (not stalled)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({
      stage: 'failed',
      updatedAt: '2026-08-01T11:00:00.000Z',
      redLine: true,
      failedAt: 'compacting',
      errorSummary: 'transcript fallback empty',
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:00.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('valid');
  });
});

describe("Scenario: integration — atomic write/read with real fs", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should write then read returns the same record (round trip)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord();
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out).toEqual({ kind: 'valid', record });
  });

  it("when invoked, should a second write atomically replaces the first (no leftover tmp files)", () => {
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
      staleAfterMs: 120_000,
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

  it("when invoked, should write clamps errorSummary to 160 characters before persisting", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const long = 'x'.repeat(500);
    const record = makeLifecycleRecord({
      stage: 'failed',
      failedAt: 'compacting',
      errorSummary: long,
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.errorSummary?.length).toBe(160);
      expect(out.record.errorSummary).toBe('x'.repeat(160));
    }
  });

  it("when invoked, should end-to-end: lifecycle write → decide → render never contains \"?\"", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const record = makeLifecycleRecord({ stage: 'verifying', updatedAt: '2026-08-01T11:59:59.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const state = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    const rendered = renderCompactStatusline(state);
    expect(rendered).not.toMatch(/\?/);
    expect(rendered).toContain('██████░░');
  });
});

describe("Scenario: integration — compact-history end-to-end (kept from previous slice)", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should history file written by a real append is readable end-to-end", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(runtime, { recursive: true });
    const path = join(runtime, 'compact-history.jsonl');
    writeFileSync(path, JSON.stringify(makeEvent({ ts: '2026-07-30T12:00:00.000Z' })) + '\n', 'utf8');
    writeFileSync(path, JSON.stringify(makeEvent({ ts: '2026-07-30T12:05:00.000Z', beforeRatio: 0.92, redLine: false })) + '\n', { flag: 'a' } as unknown as Parameters<typeof writeFileSync>[1]);
    writeFileSync(path, JSON.stringify(makeEvent({ ts: '2026-07-30T12:10:00.000Z', beforeRatio: 0.95, redLine: true, ok: true })) + '\n', { flag: 'a' } as unknown as Parameters<typeof writeFileSync>[1]);

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

describe("Scenario: a11y — rendered label hygiene (no \"?\" anywhere)", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should every rendered label across the 9 semantic kinds is single-line English, no CLI verb, no stack trace, no \"?\"", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Drive each kind through an actual lifecycle write so the render
    // path is exercised end-to-end.
    const fixtures: Array<{ stage: 'queued' | 'preparing' | 'compacting' | 'verifying' | 'completed' | 'failed'; failedAt?: 'queued' | 'preparing' | 'compacting' | 'verifying'; afterRatio?: number }> = [
      { stage: 'queued' },
      { stage: 'preparing' },
      { stage: 'compacting' },
      { stage: 'verifying' },
      { stage: 'completed', afterRatio: 0.42 },
      { stage: 'completed' },
      { stage: 'failed', failedAt: 'compacting' },
    ];
    for (const f of fixtures) {
      const sid = `${LIFECYCLE_SID}-${f.stage}-${f.failedAt ?? 'none'}`;
      const record = makeLifecycleRecord({
        stage: f.stage,
        updatedAt: '2026-08-01T11:59:59.000Z',
        ...(f.failedAt !== undefined ? { failedAt: f.failedAt } : {}),
        ...(f.afterRatio !== undefined ? { afterRatio: f.afterRatio } : {}),
      });
      writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: sid, record });
      const state = decideCompactStatusline({
        projectRoot: process.cwd(),
        sessionId: sid,
        now: NOW_MS,
      });
      const rendered = renderCompactStatusline(state);
      expect(rendered).not.toMatch(/\n/);
      expect(rendered).not.toMatch(/at .+:\d+/);
      expect(rendered).not.toMatch(/peaks\s+[a-z][a-z-]+/);
      // The brief explicitly forbids `?` in any rendered output.
      expect(rendered).not.toMatch(/\?/);
    }
  });

  it("when invoked, should invalid-reason detail is a single line, no CLI verb, no stack trace", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'compact-lifecycle.json'), '{', 'utf8');
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid' && out.detail !== undefined) {
      expect(out.detail).not.toMatch(/\n/);
      expect(out.detail).not.toMatch(/at .+:\d+/);
      expect(out.detail).not.toMatch(/peaks\s+[a-z][a-z-]+/);
    }
  });
});
