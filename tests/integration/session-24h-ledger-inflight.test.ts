// The 24h in-flight matrix over the DISPATCH LEDGER's facts, exercised through
// the production ESM import path. TC coverage: TC-IF-01..09 (the graph-backed
// matrix this file replaces read graphs; the source of truth is the ledger now).
// Omitted render: in-flight mode is a typed compaction decision.

import { describe, expect, it } from 'vitest';

type AnyRecord = Record<string, unknown>;
async function probe(): Promise<(input: AnyRecord) => AnyRecord> {
  const module =
    (await import('../../src/services/workflow/workflow-inflight-probe.js')) as unknown as AnyRecord;
  expect(typeof module.probeInFlightBatch).toBe('function');
  return module.probeInFlightBatch as (input: AnyRecord) => AnyRecord;
}
const now = '2026-08-03T10:00:00.000Z';

/** One dispatch's ledger facts, as the reader would report them. */
const dispatch = (over: AnyRecord = {}): AnyRecord => ({
  kind: 'record',
  recordPath: '.peaks/_sub_agents/sid/dispatch-rid-1.json',
  status: 'running',
  outcome: 'no-execution',
  lastBeatAt: '2026-08-03T09:40:01.000Z',
  createdAt: '2026-08-03T09:30:01.000Z',
  disposed: false,
  ...over
});
const ledger = (dispatches: AnyRecord[], state = 'readable'): AnyRecord => ({
  ledgerState: state,
  dispatches
});

describe('session 24h ledger in-flight matrix', () => {
  it('TC-IF-01: when one fresh dispatch is in the ledger, should report inFlightBatch true (RD §8)', async () => {
    // given: a ledger holding one dispatch whose last beat is twenty minutes old
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as in flight
    expect((await probe())({ now, ledger: ledger([dispatch()]) }).inFlightBatch).toBe(true);
  });
  it('TC-IF-02: when any dispatch in the ledger is fresh, should report inFlightBatch true (RD §8)', async () => {
    // given: a ledger holding one finished dispatch and one fresh one
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as in flight
    expect(
      (await probe())({
        now,
        ledger: ledger([
          dispatch({ status: 'done', outcome: 'success' }),
          dispatch({ recordPath: '.peaks/_sub_agents/sid/dispatch-rid-2.json' })
        ])
      }).inFlightBatch
    ).toBe(true);
  });
  it('TC-IF-03: when every dispatch holds a terminal status, should report inFlightBatch false (RD §8)', async () => {
    // given: a ledger holding one dispatch per terminal status
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as not in flight
    const statuses = ['done', 'failed', 'cancelled', 'no-execution', 'never-started'];
    expect(
      (await probe())({ now, ledger: ledger(statuses.map((status) => dispatch({ status }))) })
        .inFlightBatch
    ).toBe(false);
  });
  it('TC-IF-04: when the last beat is 29:59 old, should report inFlightBatch true (RD §8)', async () => {
    // given: a ledger holding one dispatch whose last beat is 29:59 old
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as in flight — the window has not closed
    expect(
      (await probe())({
        now,
        ledger: ledger([dispatch({ lastBeatAt: '2026-08-03T09:30:01.000Z' })])
      }).inFlightBatch
    ).toBe(true);
  });
  it('TC-IF-05: when the last beat is 30:00 old, should report inFlightBatch false (RD §8)', async () => {
    // given: a ledger holding one dispatch whose last beat is exactly 30:00 old
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as not in flight — the window has closed
    expect(
      (await probe())({
        now,
        ledger: ledger([dispatch({ lastBeatAt: '2026-08-03T09:30:00.000Z' })])
      }).inFlightBatch
    ).toBe(false);
  });
  it('TC-IF-06: when the freshness signal cannot be read, should defer with a typed PEAKS_HEARTBEAT_MISSING warning (RD §8)', async () => {
    // given: a dispatch whose last beat cannot be read as a timestamp
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as in flight, with the typed warning
    const out = (await probe())({
      now,
      ledger: ledger([dispatch({ lastBeatAt: 'not-a-timestamp' })])
    });
    expect(out.inFlightBatch).toBe(true);
    expect((out.warnings as AnyRecord[])[0]?.code).toBe('PEAKS_HEARTBEAT_MISSING');
  });
  it('TC-IF-07: when a dispatch has never beaten, should be fresh on its createdAt floor (RD §8)', async () => {
    // given: a queued dispatch that has never beaten
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as in flight on the createdAt floor
    expect(
      (await probe())({
        now,
        ledger: ledger([dispatch({ status: 'queued', lastBeatAt: null })])
      }).inFlightBatch
    ).toBe(true);
  });
  it('TC-IF-08: when a record cannot be read, should defer with a typed PEAKS_DISPATCH_LEDGER_UNREADABLE error (RD §8)', async () => {
    // given: a ledger entry whose dispatch record cannot be read
    // when:  the production ESM probe reads the ledger
    // then:  the batch is reported as in flight, with the typed error
    const out = (await probe())({
      now,
      ledger: ledger([
        { kind: 'unreadable', recordPath: '.peaks/_sub_agents/sid/dispatch-rid-1.json' }
      ])
    });
    expect(out.inFlightBatch).toBe(true);
    expect((out.errors as AnyRecord[])[0]?.code).toBe('PEAKS_DISPATCH_LEDGER_UNREADABLE');
  });
  it('TC-AG-06: when the production ESM auto-compact probe meets a fresh dispatch, should defer the compaction (RD §7)', async () => {
    // given: a ledger holding one fresh dispatch
    // when:  the production ESM auto-compact probe reads the ledger
    // then:  the batch is in flight, and the compaction is deferred
    const out = (await probe())({ now, ledger: ledger([dispatch()]) });
    expect(out.inFlightBatch).toBe(true);
    expect(out.deferPreCompact).toBe(true);
  });
  it('TC-AG-07: when the production ESM auto-compact probe meets a 30-minute-stale dispatch, should not defer (RD §7)', async () => {
    // given: a ledger holding one dispatch whose last beat is 30 minutes old
    // when:  the production ESM auto-compact probe reads the ledger
    // then:  the batch is not in flight, and the compaction is not deferred
    const out = (await probe())({
      now,
      ledger: ledger([dispatch({ lastBeatAt: '2026-08-03T09:30:00.000Z' })])
    });
    expect(out.inFlightBatch).toBe(false);
    expect(out.deferPreCompact).toBe(false);
  });
  it('TC-IF-09: when the red line is reached, should compact even with a dispatch in flight (RD §8)', async () => {
    // given: a ledger holding one fresh dispatch, and a red-line ratio
    // when:  the production ESM probe reads the ledger
    // then:  the compaction is due — the red line overrides the deferral
    const out = (await probe())({ now, ledger: ledger([dispatch()]), redLine: true });
    expect(out.shouldCompact).toBe(true);
  });
});
