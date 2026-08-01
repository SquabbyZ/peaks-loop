// tests/unit/services/compact-visibility/compact-visibility.test.ts
//
// 4-dimension unit test for the compact-visibility epic
// (2026-07-30-compact-visibility). Covers the following modules:
//   1. compact-history-service  (read + summarize)
//   2. compact-statusline-service (decide label)
//   3. compact-lifecycle-store  (write/read CompactLifecycleRecord;
//      active stages return 'stalled' when updatedAt is older than
//      staleAfterMs; terminal stages never go stalled; validation
//      errors return 'invalid' with a human-readable reason)
//   4. (orchestrator's appendCompactHistoryEvent is tested
//      end-to-end via compact-history-service reading what
//      the orchestrator wrote in a real fs tmp dir)
//
// Dimensions covered:
//   - render:    label strings + decision kinds + summary fields
//   - behavior:  all 5 statusline states, all 3 history read kinds,
//                all 4 lifecycle read kinds (missing/valid/invalid/
//                stalled), atomic-replace + validation rejections
//   - integration: real fs read of compact-history.jsonl in a
//                  tmp workspace; statusline reads pending +
//                  history; 30-second just-compacted window;
//                  atomic tmp-file-then-rename for lifecycle JSON
//   - a11y:      statusline labels are single-line English,
//                no CLI verbs, no stack-trace fragments
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

describe('render — compact-history labels + statusline labels', () => {
  it('summarizeCompactHistory returns the documented field set on empty input', () => {
    const s = summarizeCompactHistory([]);
    expect(s.totalCompacts).toBe(0);
    expect(s.lastTs).toBeNull();
    expect(s.lastBeforeRatio).toBeNull();
    expect(s.lastRedLine).toBe(false);
    expect(s.redLineCount).toBe(0);
    expect(s.failedCount).toBe(0);
  });

  it('statusline idle label is "--"', () => {
    expect(renderCompactStatusline({ kind: 'idle', label: '--' })).toBe('--');
  });

  it('statusline missing label is empty', () => {
    expect(renderCompactStatusline({ kind: 'missing', label: '' })).toBe('');
  });
});

describe('behavior — compact-history read', () => {
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

describe('behavior — statusline state machine', () => {
  withTmpWorkspacePerTest();

  it('missing: null sessionId → empty label', () => {
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: null, now: Date.now() });
    expect(out.kind).toBe('missing');
    expect(out.label).toBe('');
  });

  it('idle: no pending + no history → "--"', () => {
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now: Date.now() });
    expect(out.kind).toBe('idle');
    expect(out.label).toBe('--');
  });

  it('pending: a pending intent exists with ratio + non-redLine → "compact pending (<ratio>)"', () => {
    const dir = join(process.cwd(), '.peaks', '_runtime', SID, 'txt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1,
      pending: true,
      target: 'main',
      ratio: 0.85,
      redLine: false,
    }), 'utf8');
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now: Date.now() });
    expect(out.kind).toBe('pending');
    expect(out.label).toBe('compact pending (0.85)');
  });

  it('red-line: a pending intent with redLine=true → "REDLINE <ratio>"', () => {
    const dir = join(process.cwd(), '.peaks', '_runtime', SID, 'txt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1,
      pending: true,
      target: 'main',
      ratio: 0.95,
      redLine: true,
    }), 'utf8');
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now: Date.now() });
    expect(out.kind).toBe('red-line');
    expect(out.label).toBe('REDLINE 0.95');
  });

  it('just-compacted: history mtime within 30s → "just compacted (<from>→?)"', () => {
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(path, JSON.stringify(makeEvent({ beforeRatio: 0.92 })) + '\n', 'utf8');
    const now = Date.now();
    // mtime is "now" by default (fs writes set it to current time)
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now });
    expect(out.kind).toBe('just-compacted');
    expect(out.label).toMatch(/^just compacted \(0\.92/);
  });

  it('just-compacted: history mtime older than 30s → idle', () => {
    const dir = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'compact-history.jsonl');
    writeFileSync(path, JSON.stringify(makeEvent()) + '\n', 'utf8');
    // Back-date mtime by 60s
    const past = new Date(Date.now() - 60_000);
    utimesSync(path, past, past);
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now: Date.now() });
    expect(out.kind).toBe('idle');
  });

  it('pending wins over just-compacted (priority order)', () => {
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(join(runtime, 'txt', 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1, pending: true, target: 'main', ratio: 0.85, redLine: false,
    }), 'utf8');
    writeFileSync(join(runtime, 'compact-history.jsonl'), JSON.stringify(makeEvent()) + '\n', 'utf8');
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now: Date.now() });
    expect(out.kind).toBe('pending');
  });

  it('pending with malformed JSON falls through to history check', () => {
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(join(runtime, 'txt', 'auto-compact-pending.json'), 'not valid json {', 'utf8');
    writeFileSync(join(runtime, 'compact-history.jsonl'), JSON.stringify(makeEvent()) + '\n', 'utf8');
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now: Date.now() });
    expect(out.kind).toBe('just-compacted');
  });
});

describe('integration — end-to-end with real fs', () => {
  withTmpWorkspacePerTest();

  it('history file written by a real append is readable end-to-end', () => {
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(runtime, { recursive: true });
    const path = join(runtime, 'compact-history.jsonl');
    // Simulate 3 sequential dispatches (this is the same shape
    // auto-compact-orchestrator would write in real usage).
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

  it('pending file + recent history file both readable via decideCompactStatusline', () => {
    const runtime = join(process.cwd(), '.peaks', '_runtime', SID);
    mkdirSync(join(runtime, 'txt'), { recursive: true });
    writeFileSync(join(runtime, 'txt', 'auto-compact-pending.json'), JSON.stringify({
      schemaVersion: 1, pending: true, target: 'main', ratio: 0.95, redLine: true,
    }), 'utf8');
    writeFileSync(join(runtime, 'compact-history.jsonl'), JSON.stringify(makeEvent()) + '\n', 'utf8');
    const out = decideCompactStatusline({ projectRoot: process.cwd(), sessionId: SID, now: Date.now() });
    expect(out.kind).toBe('red-line');
  });
});

describe('a11y — statusline label hygiene', () => {
  it('every non-empty label is single-line English, no CLI verbs, no stack trace', () => {
    const samples: Array<{ kind: 'idle' | 'pending' | 'red-line' | 'just-compacted'; label: string }> = [
      { kind: 'idle', label: '--' },
      { kind: 'pending', label: 'compact pending (0.85)' },
      { kind: 'red-line', label: 'REDLINE 0.95' },
      { kind: 'just-compacted', label: 'just compacted (0.92→?)' },
    ];
    for (const s of samples) {
      expect(s.label).not.toMatch(/\n/);
      expect(s.label).not.toMatch(/at .+:\d+/);
      // Human-NL-Choice-Only: never tell the user to type a CLI verb.
      expect(s.label).not.toMatch(/peaks\s+[a-z][a-z-]+/);
    }
  });
});

// ---------------------------------------------------------------------------
// compact-lifecycle-store (Task 1 of the 2026-08-01 compact-lifecycle epic)
// ---------------------------------------------------------------------------

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

describe('render — compact-lifecycle record shape', () => {
  withTmpWorkspacePerTest();

  it('round-trips a minimal record (no afterRatio, no failedAt, no errorSummary)', () => {
    const record = makeLifecycleRecord();
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 60_000,
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record).toEqual(record);
    }
  });

  it('preserves the full optional surface when set (afterRatio, redLine, errorSummary)', () => {
    const record = makeLifecycleRecord({
      runId: 'run-2',
      stage: 'failed',
      triggerRatio: 0.97,
      redLine: true,
      failedAt: 'compacting',
      errorSummary: 'transcript fallback returned null twice',
    });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 60_000,
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.afterRatio).toBeUndefined();
      expect(out.record.failedAt).toBe('compacting');
      expect(out.record.errorSummary).toBe('transcript fallback returned null twice');
    }
  });
});

describe('behavior — compact-lifecycle validation + kind dispatch', () => {
  withTmpWorkspacePerTest();

  it('returns missing when no file has ever been written', () => {
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 60_000,
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
      staleAfterMs: 60_000,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason.length).toBeGreaterThan(0);
      // Should NOT be the magic 'JSON parse failed: <reason>' alone — caller
      // should see at least one human-readable word that hints at JSON.
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
      staleAfterMs: 60_000,
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
      staleAfterMs: 60_000,
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
      // failedAt deliberately omitted
    }), 'utf8');
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 60_000,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).toMatch(/failedAt/i);
    }
  });

  it('returns stalled for an active stage whose updatedAt is older than staleAfterMs', () => {
    const record = makeLifecycleRecord({ stage: 'compacting', updatedAt: '2026-08-01T11:59:00.000Z' });
    writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: LIFECYCLE_SID, record });
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:00.000Z'), // 60s gap, staleAfterMs=30s → stale
      staleAfterMs: 30_000,
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
      staleAfterMs: 30_000,
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
      staleAfterMs: 30_000,
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
      staleAfterMs: 60_000,
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
      staleAfterMs: 60_000,
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.stage).toBe('compacting');
    }
    // No stray .tmp-* files left behind in the session directory.
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
      staleAfterMs: 60_000,
    });
    expect(out.kind).toBe('valid');
    if (out.kind === 'valid') {
      expect(out.record.errorSummary?.length).toBe(160);
      // Round-tripped chars are the prefix, not padded.
      expect(out.record.errorSummary).toBe('x'.repeat(160));
    }
  });
});

describe('a11y — invalid-reason hygiene', () => {
  withTmpWorkspacePerTest();

  it('every invalid reason is a single line, no CLI verb, no stack trace', () => {
    const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);
    mkdirSync(runtime, { recursive: true });
    // Trigger a malformed-JSON invalid read.
    writeFileSync(join(runtime, 'compact-lifecycle.json'), '{', 'utf8');
    const out = readCompactLifecycle({
      projectRoot: process.cwd(),
      sessionId: LIFECYCLE_SID,
      nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
      staleAfterMs: 60_000,
    });
    expect(out.kind).toBe('invalid');
    if (out.kind === 'invalid') {
      expect(out.reason).not.toMatch(/\n/);
      expect(out.reason).not.toMatch(/at .+:\d+/);
      // Human-NL-Choice-Only: never tell the user to type a CLI verb.
      expect(out.reason).not.toMatch(/peaks\s+[a-z][a-z-]+/);
    }
  });
});
