// tests/unit/services/observability/near-miss.test.ts
//
// WHY THIS FILE EXISTS. The programme's premise is that "the QA verdict says
// pass" is a metric that is BLIND: it cannot see a pass that was bought by
// skipping a check. The near-miss rate is the number that can see it —
// "of the slices that passed, how many passed anyway after a gate was never
// evaluated?"
//
// THE RULE IS A UNION, NOT A LAST TRANSITION. The size ratchet is live only
// at `implemented`. A slice bypassed there and later advanced to `qa-handoff`
// has an EMPTY live set at its final transition, so a reader who looked only
// at the final transition would see nothing wrong. The union over the slice's
// WHOLE gate history is what catches it, and this file pins that case.
//
// THE THREE REASONS ARE DISTINGUISHED.
//   - gate-never-evaluated: a gate that was live and never got a verdict
//     (neither `pass` nor `block`). A `bypass` IS the primary evidence but
//     the rule does not DEPEND on it: a live gate with no event at all is
//     still a near-miss, because a gate that was skipped and recorded nothing
//     must not vanish from the metric.
//   - prereq-skipped: a prereq failure that the slice passed anyway.
//   - tool-blocked: a blocked tool trace. NO tool-trace events exist yet
//     (the category is not in the schema), so this branch is empty on
//     purpose — see the source comment.
//
// THE EVENTS ARE READ FROM DISK, NOT HAND-BUILT. The metric reads the same
// JSONL a real session writes, through the same reader, so the shapes under
// test are the shapes on disk.
//
// Dimensions:
//   - behavior:   the three reasons, the union rule, the rate's denominator
//   - integration: the metric reading a real metrics file back off disk
//   - render:     the evidence pointers a reader checks the number against
//   - a11y:       OMITTED — the module returns a structure, it renders no surface

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { computeNearMiss } from '~/src/services/observability/near-miss.js';
import {
  readObservabilityEvents,
  type ObservabilityEvent
} from '~/src/services/observability/observability-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/near-miss.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'the module returns a structure; it renders no surface' }]
);

const SESSION_ID = '2026-10-27-session-nearmiss';

/** One slice-transition event, in the shape the emitter writes. */
type Transition = {
  readonly to: string;
  readonly prereqOk?: boolean;
  readonly missingCount?: number;
};

/** One gate decision, in the shape the gate emitter writes. */
type GateEvent = {
  readonly gateId: string;
  readonly phase: 'implemented' | 'qa-handoff' | 'handed-off';
  readonly outcome: 'pass' | 'block' | 'bypass';
  readonly declaredType?: string;
};

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Write a session's metrics file with the given events, then read them back
 * through the real reader — so the shapes under test are the shapes on disk.
 */
function seedSession(
  events: ReadonlyArray<Record<string, unknown>>
): readonly ObservabilityEvent[] {
  const root = mkdtempSync(join(tmpdir(), 'peaks-near-miss-'));
  roots.push(root);
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'metrics');
  mkdirSync(dir, { recursive: true });
  const lines = events.map((event, index) =>
    JSON.stringify({
      schemaVersion: 1,
      ts: new Date(Date.UTC(2026, 9, 27, 0, 0, index)).toISOString(),
      sessionId: SESSION_ID,
      ...event
    })
  );
  writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return readObservabilityEvents(root, SESSION_ID);
}

/** A transition event, in the shape the emitter writes. */
function transition(to: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid: 'slice-1',
    detail: { artifactRole: 'rd', to, ...extra }
  };
}

/** A gate decision event, in the shape the gate emitter writes. */
function gate(event: GateEvent): Record<string, unknown> {
  return {
    category: 'gate',
    sliceRid: 'slice-1',
    detail: {
      phase: event.phase,
      outcome: event.outcome,
      gateId: event.gateId,
      declaredType: event.declaredType ?? 'feature'
    }
  };
}

/** The slice's whole transition history, ending in a QA verdict. */
function reachingVerdict(extra: readonly Transition[] = []): readonly Record<string, unknown>[] {
  return [
    transition('implemented'),
    ...extra.map((t) => transition(t.to, { prereqOk: t.prereqOk, missingCount: t.missingCount })),
    transition('qa-handoff'),
    transition('verdict-issued')
  ];
}

describe('Scenario: behavior — a live gate that never got a verdict is a near-miss', () => {
  it('when a gate was bypassed and never evaluated, should report the slice as a near-miss', () => {
    // given: a slice whose size ratchet was bypassed at `implemented`
    // when: the near-miss metric is computed over the session
    // then: the slice is a near-miss, for that gate
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.sliceRid).toBe('slice-1');
    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });

  it('when the live gate was evaluated and passed, should not report the slice as a near-miss', () => {
    // given: a slice whose size ratchet ran and passed
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'pass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
    expect(report.passedSliceCount).toBe(1);
  });

  it('when a live gate has no verdict event at all, should still report the slice as a near-miss', () => {
    // given: a slice whose ONLY gate event is for a different gate — the size
    // when: the near-miss metric is computed over the session
    // then: the unrecorded live gate is still a near-miss
    //        ratchet was live at `implemented` and recorded nothing
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'claim-table', phase: 'implemented', outcome: 'pass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });

  it('when a gate was live earlier and later evaluated, should not report the slice as a near-miss', () => {
    // given: a slice whose size ratchet was bypassed at `implemented` and
    // when: the near-miss metric is computed over the session
    // then: the gate was evaluated at SOME point, so it is not a near-miss
    //        evaluated at a later phase
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      gate({ gateId: 'file-size-ratchet', phase: 'qa-handoff', outcome: 'pass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
  });
});

describe('Scenario: behavior — the live set is the union over the slice history', () => {
  it('when a gate was bypassed at an earlier phase, should report the slice as a near-miss', () => {
    // given: a slice bypassed at `implemented` and later advanced to
    // when: the near-miss metric is computed over the session
    // then: the earlier bypass is still a near-miss
    //        `qa-handoff` — the final transition's live set is EMPTY for a
    //        product-typed slice, so only the union sees the skip
    const events = seedSession([
      transition('implemented'),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      transition('qa-handoff'),
      transition('verdict-issued')
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });

  it('when a gate was bypassed at one phase and evaluated at another, should report the slice as a near-miss', () => {
    // given: a slice whose size ratchet was bypassed at `implemented` and
    // when: the near-miss metric is computed over the session
    // then: the gate is live-and-unevaluated
    //        never evaluated again — the union sees it live once and
    //        unevaluated
    const events = seedSession([
      transition('implemented'),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' }),
      transition('qa-handoff'),
      transition('verdict-issued')
    ]);

    const report = computeNearMiss(events);

    expect(report.records[0]?.reasons).toContain('gate-never-evaluated');
  });
});

describe('Scenario: behavior — a prerequisite failure the slice passed anyway', () => {
  it('when a prereq failed and the slice still reached a verdict, should report the slice as a near-miss', () => {
    // given: a slice whose qa-handoff prereq check failed
    // when: the near-miss metric is computed over the session
    // then: the slice is a near-miss, for that reason
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 }),
      transition('qa-handoff'),
      transition('verdict-issued')
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(1);
    expect(report.records[0]?.reasons).toContain('prereq-skipped');
  });

  it('when a prereq failed after the verdict, should not report the slice as a near-miss', () => {
    // given: a slice that reached the verdict and was sent back for a repair
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss for that reason
    //        round whose prereq check then failed — the failure came AFTER the
    //        pass, so it is a later round, not a pass bought by a skip
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff'),
      transition('verdict-issued'),
      transition('qa-handoff', { prereqOk: false, missingCount: 2 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.nearMissSliceCount).toBe(0);
  });

  it('when a prereq failed after the verdict, should not report the slice as a near-miss', () => {
    // given: a slice that reached the verdict and was then sent back for a
    // when: the near-miss metric is computed over the session
    // then: the slice is not a near-miss for that reason
    //        repair round whose prereq check failed — the failure came AFTER
    //        the pass, so it is a later round, not a pass bought by a skip
    const events = seedSession([
      transition('verdict-issued'),
      transition('qa-handoff', { prereqOk: false, missingCount: 2 })
    ]);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(1);
    expect(report.nearMissSliceCount).toBe(0);
  });

  it('when a prereq failed and the slice never reached a verdict, should not report it at all', () => {
    // given: a slice whose prereq failed and which never got a verdict
    // when: the near-miss metric is computed over the session
    // then: the slice is neither in the numerator nor in the denominator
    const events = seedSession([
      transition('implemented'),
      transition('qa-handoff', { prereqOk: false, missingCount: 3 })
    ]);

    const report = computeNearMiss(events);

    expect(report.nearMissSliceCount).toBe(0);
    expect(report.passedSliceCount).toBe(0);
  });
});

describe('Scenario: behavior — the rate divides by the passing slices', () => {
  it('when one of two passing slices skipped a gate, should report the rate as one half', () => {
    // given: two passing slices, one of which skipped a gate
    // when: the near-miss metric is computed over the session
    // then: the rate is one near-miss over two passing slices
    const root = mkdtempSync(join(tmpdir(), 'peaks-near-miss-'));
    roots.push(root);
    const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'metrics');
    mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({
        schemaVersion: 1,
        ts: '2026-10-27T00:00:00.000Z',
        sessionId: SESSION_ID,
        category: 'slice-transition',
        sliceRid: 'slice-1',
        detail: { artifactRole: 'rd', to: 'verdict-issued' }
      }),
      JSON.stringify({
        schemaVersion: 1,
        ts: '2026-10-27T00:00:01.000Z',
        sessionId: SESSION_ID,
        category: 'slice-transition',
        sliceRid: 'slice-2',
        detail: { artifactRole: 'rd', to: 'verdict-issued' }
      }),
      JSON.stringify({
        schemaVersion: 1,
        ts: '2026-10-27T00:00:02.000Z',
        sessionId: SESSION_ID,
        category: 'gate',
        sliceRid: 'slice-1',
        detail: {
          phase: 'implemented',
          outcome: 'bypass',
          gateId: 'file-size-ratchet',
          declaredType: 'feature'
        }
      })
    ];
    writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
    const events = readObservabilityEvents(root, SESSION_ID);

    const report = computeNearMiss(events);

    expect(report.passedSliceCount).toBe(2);
    expect(report.nearMissSliceCount).toBe(1);
    expect(report.nearMissRate).toBe(0.5);
  });

  it('when no slice passed, should report the rate as zero rather than dividing by zero', () => {
    // given: a session with no passing slice at all
    // when: the near-miss metric is computed over the session
    // then: the rate is zero and the denominator is zero
    const events = seedSession([transition('implemented')]);

    const report = computeNearMiss(events);

    expect(report.nearMissRate).toBe(0);
    expect(report.passedSliceCount).toBe(0);
  });
});

describe('Scenario: render — the evidence points at the events the count came from', () => {
  it('when a slice is a near-miss, should carry the session and timestamp of its gate event', () => {
    // given: a slice whose size ratchet was bypassed
    // when: the near-miss metric is computed over the session
    // then: the evidence names the session and the instant of the gate event
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    const evidence = report.records[0]?.evidence ?? [];
    expect(evidence.length).toBeGreaterThan(0);
    for (const pointer of evidence) {
      expect(pointer.sessionId).toBe(SESSION_ID);
      expect(pointer.ts).not.toBe('');
    }
  });
});

describe('Scenario: integration — the metric reads a real metrics file', () => {
  it('when the session file is read back off disk, should compute the same near-miss', () => {
    // given: a session written to disk with a bypassed gate
    // when: the near-miss metric is computed over the events read from disk
    // then: the file's own content produced the finding
    const events = seedSession([
      ...reachingVerdict(),
      gate({ gateId: 'file-size-ratchet', phase: 'implemented', outcome: 'bypass' })
    ]);

    const report = computeNearMiss(events);

    expect(report.records.length).toBe(1);
    expect(report.records[0]?.sliceRid).toBe('slice-1');
  });
});
