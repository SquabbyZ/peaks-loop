// tests/unit/workflow/workflow-inflight-probe.test.ts
//
// The in-flight probe over the DISPATCH LEDGER's facts. The probe is the pure
// half of the auto-compact deferral: the reader gathers the facts, the probe
// decides. This file pins the decision — including the direction every
// unknown answers in.
//
// TC coverage: TC-IF-01..09 (re-pointed at the ledger contract; the ids and
// their intent are unchanged, the input is the ledger's facts now).
//
// Omitted render: this probe returns graph-derived state, not UI output.

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/workflow/workflow-inflight-probe.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'in-flight is a typed decision, not rendered output' },
    {
      dim: 'integration',
      reason: 'the ledger facts are passed as pure inputs in this unit boundary'
    }
  ]
);

type AnyRecord = Record<string, unknown>;
type ProbeApi = AnyRecord & { probeInFlightBatch: (input: AnyRecord) => AnyRecord };

async function loadProbe(): Promise<ProbeApi> {
  const module =
    (await import('~/src/services/workflow/workflow-inflight-probe.js')) as unknown as AnyRecord;
  expect(typeof module.probeInFlightBatch).toBe('function');
  return module as ProbeApi;
}

const fresh = '2026-08-03T09:40:01.000Z';
const now = '2026-08-03T10:00:00.000Z';
const created = '2026-08-03T09:55:00.000Z';

/** One dispatch's ledger facts, as the reader would report them. */
const dispatch = (over: AnyRecord = {}): AnyRecord => ({
  kind: 'record',
  recordPath: '.peaks/_sub_agents/sid/dispatch-rid-1.json',
  status: 'running',
  outcome: 'no-execution',
  lastBeatAt: fresh,
  createdAt: created,
  disposed: false,
  ...over
});

const ledger = (dispatches: AnyRecord[], state = 'readable'): AnyRecord => ({
  ledgerState: state,
  dispatches
});

function resultOf(out: AnyRecord): boolean {
  return out.inFlightBatch === true;
}

describe('Scenario: behavior — ledger-backed inFlightBatch truth', () => {
  it('when invoked, should TC-IF-01: one fresh live dispatch returns true. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => {
    // given: a dispatch that beat inside the freshness window
    // when:  the probe is invoked with the ledger's facts
    // then:  the dispatch counts as in flight
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch()])
    });
    expect(resultOf(out)).toBe(true);
  });
  it('when invoked, should TC-IF-02: several dispatches are true when any one of them is fresh. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => {
    // given: one terminal dispatch and one fresh one
    // when:  the probe is invoked with the ledger's facts
    // then:  the fresh one is enough
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([
        dispatch({ status: 'done', outcome: 'success' }),
        dispatch({ recordPath: '.peaks/_sub_agents/sid/dispatch-rid-2.json' })
      ])
    });
    expect(resultOf(out)).toBe(true);
  });
  it('when invoked, should TC-IF-03: terminal statuses never report in-flight. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => {
    // given: the statuses that mean the dispatch is over
    // when:  the probe is invoked with the ledger's facts
    // then:  none of them reports a dispatch in flight
    const terminal = ['done', 'failed', 'cancelled', 'no-execution', 'never-started'];
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger(terminal.map((status) => dispatch({ status })))
    });
    expect(resultOf(out)).toBe(false);
  });
  it('when invoked, should TC-IF-04: a beat at 29:59 is fresh. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => {
    // given: a dispatch that beat 29 minutes 59 seconds ago
    // when:  the probe is invoked with the ledger's facts
    // then:  it is still fresh
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ lastBeatAt: '2026-08-03T09:30:01.000Z' })])
    });
    expect(resultOf(out)).toBe(true);
  });
  it('when invoked, should TC-IF-05: a beat at 30:00 is stale. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => {
    // given: a dispatch that beat exactly at the threshold
    // when:  the probe is invoked with the ledger's facts
    // then:  it is no longer in flight
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ lastBeatAt: '2026-08-03T09:30:00.000Z' })])
    });
    expect(resultOf(out)).toBe(false);
  });
  it('when invoked, should TC-IF-06: a dispatch whose freshness signal cannot be read defers, with a typed warning. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true) and assert.equal(result.warnings[0].code, "PEAKS_HEARTBEAT_MISSING").', async () => {
    // given: a live dispatch whose freshness signal cannot be parsed
    // when:  the probe is invoked with the ledger's facts
    // then:  the answer is unknown, so the compaction defers
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ lastBeatAt: 'not-a-timestamp' })])
    });
    expect(resultOf(out)).toBe(true);
    expect((out.warnings as AnyRecord[])[0]?.code).toBe('PEAKS_HEARTBEAT_MISSING');
  });
  it('when invoked, should TC-IF-07: a dispatch that has never beaten is fresh on its createdAt floor while it is inside the threshold. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true).', async () => {
    // given: a dispatch that was issued 5 minutes ago and has not beaten yet
    // when:  the probe is invoked with the ledger's facts
    // then:  it is in flight, because it is a live member of its batch
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ status: 'queued', lastBeatAt: null })])
    });
    expect(resultOf(out)).toBe(true);
  });
  it('when invoked, should TC-IF-08: a dispatch record that cannot be read defers, with a typed error. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true) and assert.equal(result.errors[0].code, "PEAKS_DISPATCH_LEDGER_UNREADABLE").', async () => {
    // given: a ledger row whose record exists but cannot be believed
    // when:  the probe is invoked with the ledger's facts
    // then:  the answer is unknown, so the compaction defers
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([
        { kind: 'unreadable', recordPath: '.peaks/_sub_agents/sid/dispatch-rid-1.json' }
      ])
    });
    expect(resultOf(out)).toBe(true);
    expect((out.errors as AnyRecord[])[0]?.code).toBe('PEAKS_DISPATCH_LEDGER_UNREADABLE');
  });
  it('when invoked, should TC-IF-09: red-line compaction remains an override over in-flight deferral. RD §8. Pass criterion: assert.equal(result.shouldCompact, true).', async () => {
    // given: a fresh dispatch AND the red line
    // when:  the probe is invoked with the ledger's facts
    // then:  the red line still compacts
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch()]),
      redLine: true
    });
    expect(out.shouldCompact).toBe(true);
    expect(out.inFlightBatch).toBe(true);
  });
  it('when invoked, should a dispatch that never beat stops counting once it is past the threshold. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => {
    // given: a dispatch issued 31 minutes ago that has never beaten
    // when:  the probe is invoked with the ledger's facts
    // then:  it cannot defer forever
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([
        dispatch({ status: 'queued', lastBeatAt: null, createdAt: '2026-08-03T09:29:00.000Z' })
      ])
    });
    expect(resultOf(out)).toBe(false);
  });
  it('when invoked, should a record whose status is not recognised defers, with a typed warning. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true) and assert.equal(result.warnings[0].code, "PEAKS_DISPATCH_STATUS_UNKNOWN").', async () => {
    // given: a live-looking record carrying a status the probe does not know
    // when:  the probe is invoked with the ledger's facts
    // then:  the answer is unknown, so the compaction defers
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ status: 'hibernating' })])
    });
    expect(resultOf(out)).toBe(true);
    expect((out.warnings as AnyRecord[])[0]?.code).toBe('PEAKS_DISPATCH_STATUS_UNKNOWN');
  });
  it('when invoked, should a session with no ledger reports no dispatch in flight. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => {
    // given: a session that never registered a dispatch
    // when:  the probe is invoked with the ledger's facts
    // then:  there is nothing to defer for
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([], 'absent')
    });
    expect(resultOf(out)).toBe(false);
  });
  it('when invoked, should a ledger that cannot be enumerated defers, with a typed error. RD §8. Pass criterion: assert.equal(result.inFlightBatch, true) and assert.equal(result.errors[0].code, "PEAKS_DISPATCH_LEDGER_UNREADABLE").', async () => {
    // given: a ledger index that could not be read
    // when:  the probe is invoked with the ledger's facts
    // then:  the answer is unknown, so the compaction defers
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([], 'unreadable')
    });
    expect(resultOf(out)).toBe(true);
    expect((out.errors as AnyRecord[])[0]?.code).toBe('PEAKS_DISPATCH_LEDGER_UNREADABLE');
  });
  it('when invoked, should a dispatched and disposed record reports no dispatch in flight. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => {
    // given: a record the reducer disposed of
    // when:  the probe is invoked with the ledger's facts
    // then:  a disposed dispatch is over
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ disposed: true })])
    });
    expect(resultOf(out)).toBe(false);
  });
  it('when invoked, should a terminal outcome reports no dispatch in flight even when the status still reads live. RD §8. Pass criterion: assert.equal(result.inFlightBatch, false).', async () => {
    // given: a record whose outcome says it finished
    // when:  the probe is invoked with the ledger's facts
    // then:  the outcome is terminal
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ outcome: 'success' })])
    });
    expect(resultOf(out)).toBe(false);
  });
});

describe('Scenario: a11y — probe diagnostics are inspectable', () => {
  it('when invoked, should uses a typed warning for a missing freshness signal rather than silent false. RD §8. Pass criterion: assert.equal(result.warnings[0].code, "PEAKS_HEARTBEAT_MISSING").', async () => {
    // given: a live dispatch whose freshness signal cannot be read
    // when:  the probe is invoked with the ledger's facts
    // then:  the diagnostic names the code a consumer can act on
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([dispatch({ lastBeatAt: 'not-a-timestamp' })])
    });
    expect((out.warnings as AnyRecord[])[0]?.code).toBe('PEAKS_HEARTBEAT_MISSING');
  });
  it('when invoked, should names the record a diagnostic belongs to. RD §8. Pass criterion: assert.equal(result.warnings[0].recordPath, path).', async () => {
    // given: a record that cannot be read
    // when:  the probe is invoked with the ledger's facts
    // then:  the diagnostic says WHICH record it is about
    const path = '.peaks/_sub_agents/sid/dispatch-rid-9.json';
    const out = (await loadProbe()).probeInFlightBatch({
      now,
      ledger: ledger([{ kind: 'unreadable', recordPath: path }])
    });
    expect((out.errors as AnyRecord[])[0]?.recordPath).toBe(path);
  });
});
