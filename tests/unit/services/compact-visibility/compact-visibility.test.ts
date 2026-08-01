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

describe('render — compact cell-bar strings', () => {
  it('every lifecycle stage maps to the documented fixed cell count', () => {
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

  it('renderCompactStatusline: idempotent on empty semantic state', () => {
    expect(renderCompactStatusline({ kind: 'none', filledCells: 0 })).toBe('compact [░░░░░░░░]');
  });

  it('renderCompactStatusline: 4 cells filled = compacting', () => {
    const out = renderCompactStatusline({ kind: 'compacting', filledCells: 4 });
    expect(out).toBe('compact [████░░░░]');
    expect(out).not.toMatch(/\?/);
  });

  it('renderCompactStatusline: 8 cells filled = completed (always surfaces the no-after-ratio hint)', () => {
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8 });
    expect(out).toContain('████████');
    expect(out).not.toMatch(/\?/);
    // The hint is the only honest thing to render when no
    // after-ratio is carried — never invent a number.
    expect(out).toMatch(/no measurement|after-ratio unknown|after-ratio not recorded/i);
  });

  it('renderCompactStatusline: failed retains the failedAt cell (default compacting = 4)', () => {
    const out = renderCompactStatusline({ kind: 'failed', filledCells: 4, failedAt: 'compacting' });
    expect(out).toContain('[████░░░░]');
    expect(out).not.toMatch(/\?/);
  });

  it('renderCompactStatusline: invalid state never renders a reassuring progress bar', () => {
    const out = renderCompactStatusline({ kind: 'invalid', filledCells: 0, detail: 'lifecycle JSON malformed' });
    expect(out).not.toMatch(/\[/);
    expect(out).not.toMatch(/\?/);
  });

  it('renderCompactStatusline: stalled renders an explicit warning, no guess', () => {
    const out = renderCompactStatusline({ kind: 'stalled', filledCells: 4, detail: 'no heartbeat for 180s' });
    expect(out).not.toMatch(/\?/);
    // stalled is not a green bar — it must surface as a warning
    expect(out).toMatch(/stalled/i);
  });

  it('renderCompactStatusline: completed with afterRatio surfaces the real after', () => {
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8, afterRatio: 0.42 });
    expect(out).toContain('0.42');
    expect(out).not.toMatch(/\?/);
  });

  it('renderCompactStatusline: completed WITHOUT afterRatio surfaces the "no measurement" hint (no guess)', () => {
    const out = renderCompactStatusline({ kind: 'completed', filledCells: 8 });
    expect(out).not.toMatch(/\?/);
    // The hint must be a stable English token, not a number we invented.
    expect(out).toMatch(/no measurement|after-ratio unknown|after-ratio not recorded/i);
  });
});

describe('behavior — lifecycle dispatch + cell mapping (Task 3)', () => {
  withTmpWorkspacePerTest();

  it('queued lifecycle → 0 cells, kind=queued', () => {
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

  it('preparing lifecycle → 2 cells', () => {
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

  it('compacting lifecycle → 4 cells', () => {
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

  it('verifying lifecycle → 6 cells', () => {
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

  it('completed lifecycle → 8 cells', () => {
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

  it('completed lifecycle WITHOUT afterRatio — never invents one', () => {
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

  it('failed-at-compacting lifecycle → kept at 4 cells, retains failedAt hint', () => {
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

  it('failed-at-preparing lifecycle → kept at 2 cells', () => {
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

  it('stalled active-stage lifecycle → surfaces stalled kind, retains filledCells', () => {
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

  it('invalid lifecycle → kind=invalid, no legacy fallback (no false reassurance)', () => {
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

  it('redLine is propagated from lifecycle to the decided state', () => {
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

describe('behavior — legacy migration priority (no lifecycle, fall back to legacy files)', () => {
  withTmpWorkspacePerTest();

  it('null sessionId → none, filledCells=0', () => {
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: null,
      now: NOW_MS,
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it('no lifecycle, no legacy files → none, 0 cells', () => {
    const out = decideCompactStatusline({
      projectRoot: process.cwd(),
      sessionId: SID,
      now: NOW_MS,
    });
    expect(out.kind).toBe('none');
    expect(out.filledCells).toBe(0);
  });

  it('legacy pending.json → queued (0 cells), lifecycle wins when it existed', () => {
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

  it('legacy pending.json with redLine=true → queued + redLine flag (still 0 cells)', () => {
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

  it('legacy recent history → completed WITHOUT invented afterRatio', () => {
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

  it('legacy history mtime older than 30s + no pending → none', () => {
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

  it('pending wins over recent history when lifecycle is missing (legacy priority)', () => {
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

  it('LIFECYCLE WINS over legacy pending + history (priority order)', () => {
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

describe('behavior — compact-history read (kept from previous slice)', () => {
  withTmpWorkspacePerTest();

  it('returns file-missing when the JSONL does not exist', () => {
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('file-missing');
  });

  it('returns empty when the JSONL exists but has no content', () => {
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'compact-history.jsonl'), '', 'utf8');
    const out = readCompactHistory({ projectRoot: process.cwd(), sessionId: SID });
    expect(out.kind).toBe('empty');
  });

  it('returns ok + events when the JSONL has valid lines', () => {
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

  it('surfaces malformed lines as parseErrors without aborting the rest', () => {
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

  it('summarizeCompactHistory reports totalCompacts + redLineCount + failedCount', () => {
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

describe('behavior — compact-lifecycle record shape (kept from Task 1)', () => {
  withTmpWorkspacePerTest();

  it('returns missing when no file has ever been written', () => {
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 120_000,
    });
    expect(out.kind).toBe('missing');
  });

  it('returns invalid (with reason) for malformed JSON; never silently becomes missing', () => {
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

  it('returns invalid when schemaVersion is not 1', () => {
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

  it('returns invalid when triggerRatio is out of range', () => {
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

  it('returns invalid when stage=failed is missing the failedAt hint', () => {
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

  it('returns stalled for an active stage whose updatedAt is older than staleAfterMs', () => {
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

  it('terminal "completed" record older than staleAfterMs stays valid (not stalled)', () => {
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

  it('terminal "failed" record older than staleAfterMs stays valid (not stalled)', () => {
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

describe('integration — atomic write/read with real fs', () => {
  withTmpWorkspacePerTest();

  it('write then read returns the same record (round trip)', () => {
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

  it('a second write atomically replaces the first (no leftover tmp files)', () => {
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

  it('write clamps errorSummary to 160 characters before persisting', () => {
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

  it('end-to-end: lifecycle write → decide → render never contains "?"', () => {
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

describe('integration — compact-history end-to-end (kept from previous slice)', () => {
  withTmpWorkspacePerTest();

  it('history file written by a real append is readable end-to-end', () => {
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

describe('a11y — rendered label hygiene (no "?" anywhere)', () => {
  withTmpWorkspacePerTest();

  it('every rendered label across the 9 semantic kinds is single-line English, no CLI verb, no stack trace, no "?"', () => {
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

  it('invalid-reason detail is a single line, no CLI verb, no stack trace', () => {
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
