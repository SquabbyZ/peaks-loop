// tests/unit/services/observability/repair-cycle-metric.test.ts
//
// WHY THIS FILE EXISTS. The repair-cycle counter that used to live in
// `aggregation-helpers.ts` counted every slice-transition event whose
// `detail.artifactRole === 'qa'` — QA's OWN internal state transitions, not
// repair loops — and it counted every transition twice, because
// `peaks request transition` writes one event without `detail.from` and a
// second one with it. Measured over this repo's own recorded history the old
// counter put 82 of 108 slices at or over the cap of 3 while exactly ONE
// slice ever really reworked. Each test below pins ONE measured defect, so
// the metric cannot drift back into counting QA's transitions.
//
// Dimensions:
//   - behavior:   the scoring rules — one test per measured defect
//   - render:     the report's shape: the metric version and the legacy field name
//   - a11y:       the human-facing strings that tell a reader which convention
//                 each number uses
//   - integration: OMITTED — the metric is a pure function over an event
//                 array; it touches no file, process, network or clock.

import { describe, expect, it } from 'vitest';

import type { ObservabilityEvent } from '~/src/services/observability/observability-service.js';
import {
  REPAIR_CYCLE_METRIC_VERSION,
  buildRepairCycleReport,
  computeSliceRepairMetrics
} from '~/src/services/observability/repair-cycle-metric.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/repair-cycle-metric.test.ts',
  ['behavior', 'render', 'a11y'],
  [{ dim: 'integration', reason: 'the metric is a pure function over an event array' }]
);

const SESSION_ID = '2026-01-01-session-metric';
const SLICE_RID = 'slice-under-test';

type StepSpec = { to: string; role: 'rd' | 'qa' };

function event(step: StepSpec, index: number, from?: string): ObservabilityEvent {
  const detail: Record<string, unknown> = { to: step.to, artifactRole: step.role };
  if (from !== undefined) detail['from'] = from;
  return {
    schemaVersion: 1,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    sessionId: SESSION_ID,
    category: 'slice-transition',
    sliceRid: SLICE_RID,
    detail
  };
}

/** One event per transition, in order. */
function seq(steps: readonly StepSpec[]): ObservabilityEvent[] {
  return steps.map((step, index) => event(step, index));
}

/**
 * The real emission shape: every transition is written TWICE — once without
 * `detail.from`, then once with it.
 */
function duplicated(steps: readonly StepSpec[]): ObservabilityEvent[] {
  const out: ObservabilityEvent[] = [];
  steps.forEach((step, index) => {
    const previous = index === 0 ? undefined : steps[index - 1]?.to;
    out.push(event(step, index * 2, undefined));
    out.push(event(step, index * 2 + 1, previous));
  });
  return out;
}

/**
 * The recorded `rid-t4-mut-doc-truthfulness` transition sequence: one blocked
 * start, then five `verdict-issued → implemented` reworks, and a sixth QA
 * phase that is still open when the recording ends.
 */
function t4Sequence(): StepSpec[] {
  const steps: StepSpec[] = [
    { to: 'blocked', role: 'rd' },
    { to: 'implemented', role: 'rd' },
    { to: 'qa-handoff', role: 'rd' }
  ];
  for (let round = 0; round < 5; round += 1) {
    steps.push({ to: 'running', role: 'qa' });
    steps.push({ to: 'verdict-issued', role: 'qa' });
    steps.push({ to: 'implemented', role: 'rd' });
    steps.push({ to: 'qa-handoff', role: 'rd' });
  }
  steps.push({ to: 'running', role: 'qa' });
  steps.push({ to: 'verdict-issued', role: 'qa' });
  return steps;
}

/** The recorded `rid-bdd-style-unit` transition sequence. */
function bddSequence(): StepSpec[] {
  return [
    { to: 'running', role: 'qa' },
    { to: 'verdict-issued', role: 'qa' },
    { to: 'spec-locked', role: 'rd' },
    { to: 'implemented', role: 'rd' },
    { to: 'qa-handoff', role: 'rd' },
    { to: 'handed-off', role: 'rd' }
  ];
}

function cyclesOf(events: readonly ObservabilityEvent[]): number {
  return computeSliceRepairMetrics(events).get(SLICE_RID)?.repairCycles ?? 0;
}

function roundsOf(events: readonly ObservabilityEvent[]): number {
  return computeSliceRepairMetrics(events).get(SLICE_RID)?.qaRounds ?? 0;
}

describe('behavior — the repair-cycle metric', () => {
  it('should score 0 repair cycles when the slice never returns to an RD work state after a QA phase', () => {
    // given: a slice that runs the happy path and still emits QA-role events
    // when:  the metric scores it
    // then:  no rework is counted, even though the legacy counter saw QA events
    const events = seq([
      { to: 'spec-locked', role: 'rd' },
      { to: 'implemented', role: 'rd' },
      { to: 'qa-handoff', role: 'rd' },
      { to: 'running', role: 'qa' },
      { to: 'verdict-issued', role: 'qa' },
      { to: 'handed-off', role: 'rd' }
    ]);
    const metrics = computeSliceRepairMetrics(events);
    expect(metrics.get(SLICE_RID)?.repairCycles).toBe(0);
    expect(metrics.get(SLICE_RID)?.legacyQaEventCount).toBe(2);
  });

  it('should score 0 repair cycles when the only qa hops are the happy-path closing ones', () => {
    // given: a slice that hands off, runs QA, gets a verdict and is handed off
    // when:  the metric scores it
    // then:  the closing hops are the happy path, not rework
    const events = seq([
      { to: 'implemented', role: 'rd' },
      { to: 'qa-handoff', role: 'rd' },
      { to: 'running', role: 'qa' },
      { to: 'verdict-issued', role: 'qa' },
      { to: 'handed-off', role: 'rd' }
    ]);
    expect(cyclesOf(events)).toBe(0);
    expect(roundsOf(events)).toBe(1);
  });

  it('should score the same repair cycles when every transition is emitted twice', () => {
    // given: the same slice written once, and written with the duplicate emission
    // when:  both are scored
    // then:  the duplicated pair counts once, so both score the same
    const steps = bddSequence();
    const singleCycles = cyclesOf(seq(steps));
    const twiceCycles = cyclesOf(duplicated(steps));
    expect(twiceCycles).toBe(singleCycles);
    expect(twiceCycles).toBe(1);
  });

  it('should score the slice correctly when detail.from contradicts the event order', () => {
    // given: the recorded sequence with every detail.from deliberately wrong
    // when:  the metric scores it
    // then:  the contradicting field is ignored, so the score is unchanged
    const events = bddSequence().map((step, index) => event(step, index, 'handed-off'));
    expect(cyclesOf(events)).toBe(1);
  });

  it('should score 1 repair cycle for the recorded rid-bdd-style-unit sequence', () => {
    // given: the recorded rid-bdd-style-unit transition sequence
    // when:  the metric scores it
    // then:  the single return to an RD work state after QA is one cycle
    const events = seq(bddSequence());
    expect(cyclesOf(events)).toBe(1);
    expect(roundsOf(events)).toBe(1);
  });

  it('should score 5 repair cycles for the recorded rid-t4-mut-doc-truthfulness sequence', () => {
    // given: the recorded rid-t4-mut-doc-truthfulness transition sequence
    // when:  the report scores it
    // then:  five real rework loops are counted and the cap of three is tripped
    const report = buildRepairCycleReport(seq(t4Sequence()));
    expect(report.totalCycles).toBe(5);
    expect(report.capHit).toBe(true);
    expect(report.capHitCount).toBe(1);
  });

  it('should score 0 repair cycles and 2 QA rounds for a QA-only ping-pong', () => {
    // given: QA bouncing between the verdict and the handoff without RD work
    // when:  the metric scores it
    // then:  it is a QA round, not an RD rework
    const events = seq([
      { to: 'qa-handoff', role: 'rd' },
      { to: 'verdict-issued', role: 'qa' },
      { to: 'qa-handoff', role: 'rd' },
      { to: 'verdict-issued', role: 'qa' }
    ]);
    const metrics = computeSliceRepairMetrics(events);
    expect(metrics.get(SLICE_RID)?.repairCycles).toBe(0);
    expect(metrics.get(SLICE_RID)?.qaRounds).toBe(2);
  });

  it('should skip transitions that carry no usable target state', () => {
    // given: an event whose detail has no `to` field, next to a real one
    // when:  the metric scores it
    // then:  the unusable event is skipped, not guessed at
    const events: ObservabilityEvent[] = [
      {
        schemaVersion: 1,
        ts: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(),
        sessionId: SESSION_ID,
        category: 'slice-transition',
        sliceRid: SLICE_RID,
        detail: { artifactRole: 'rd' }
      },
      event({ to: 'running', role: 'qa' }, 1),
      event({ to: 'verdict-issued', role: 'qa' }, 2)
    ];
    const metrics = computeSliceRepairMetrics(events);
    expect(metrics.get(SLICE_RID)?.repairCycles).toBe(0);
    expect(metrics.get(SLICE_RID)?.qaRounds).toBe(1);
  });

  it('should score 0 repair cycles and not throw when the event list is empty', () => {
    // given: no events at all
    // when:  the metric scores it
    // then:  nothing is counted and nothing throws
    const events: ObservabilityEvent[] = [];
    const metrics = computeSliceRepairMetrics(events);
    const report = buildRepairCycleReport(events);
    expect(metrics.size).toBe(0);
    expect(report.totalCycles).toBe(0);
    expect(report.capHitCount).toBe(0);
  });
});

describe('render — the repair-cycle report shape', () => {
  it('should carry the metric version and keep the legacy count under a different name', () => {
    // given: a slice with real rework
    // when:  the report is built
    // then:  the version marker is present and the old convention has its own name
    const report = buildRepairCycleReport(seq(t4Sequence()));
    expect(report.metric).toBe('repair-cycles');
    expect(report.metricVersion).toBe(REPAIR_CYCLE_METRIC_VERSION);
    expect(report.legacyQaEventCount.metric).toBe('qa-role-transition-event-count');
    expect(report.legacyQaEventCount.metricVersion).toBe(1);
  });

  it('should compute capHitCount from the corrected metric and not from the legacy count', () => {
    // given: a slice that never reworked but emitted four QA-role events
    // when:  the report is built
    // then:  the legacy count alarms and the corrected count does not
    const events = seq([
      { to: 'implemented', role: 'rd' },
      { to: 'qa-handoff', role: 'rd' },
      { to: 'running', role: 'qa' },
      { to: 'verdict-issued', role: 'qa' },
      { to: 'qa-handoff', role: 'rd' },
      { to: 'running', role: 'qa' },
      { to: 'verdict-issued', role: 'qa' },
      { to: 'handed-off', role: 'rd' }
    ]);
    const report = buildRepairCycleReport(events);
    expect(report.legacyQaEventCount.capHitCount).toBe(1);
    expect(report.capHitCount).toBe(0);
    expect(report.capHit).toBe(false);
  });
});

describe('a11y — the strings a reader sees', () => {
  it('should say what the metric counts when a reader compares it with the legacy count', () => {
    // given: a report over a slice with rework
    // when:  the human-facing strings are read
    // then:  each string names its own convention
    const report = buildRepairCycleReport(seq(t4Sequence()));
    expect(report.definition).toContain('RD work state');
    expect(report.definition).toContain('QA phase');
    expect(report.legacyQaEventCount.note).toContain('NOT repair loops');
  });
});
