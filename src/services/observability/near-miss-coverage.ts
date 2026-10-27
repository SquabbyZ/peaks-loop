/**
 * `src/services/observability/near-miss-coverage.ts`
 *
 * What the near-miss metric could and could not OBSERVE.
 *
 * WHY THIS EXISTS. The near-miss rule has three classes, and each class is
 * read from a different kind of event. A scope that holds none of a class's
 * events cannot produce a finding in that class — and a rate that reads as
 * "0 near-misses" when the class was never observable is exactly the failure
 * mode this whole programme exists to close: an ABSENCE read as a RESULT.
 *
 * So the report carries, per class: whether the class had events to observe,
 * how many there were, how many slices they reached, and the rate the class
 * supports. A class with no events has a `null` rate, not a zero. A consumer
 * that reads the rate alone can still be misled, so the coverage travels with
 * it in the same envelope.
 *
 * WHY THE CLASS RATE'S DENOMINATOR IS THE OBSERVED SLICES. A class rate over
 * ALL the passing slices would divide a finding by a population the class
 * could not judge — a gate class that saw five slices out of a hundred would
 * report a rate of one in a hundred, which reads as "rare" when it is "one in
 * the five we could look at". The observed population is the one the finding
 * was drawn from, and it is reported alongside, so a consumer can compute the
 * other reading if it wants it.
 *
 * WHY THE SCOPE COUNT AND THE SLICE COUNT ARE BOTH HERE. The scope count says
 * how much evidence the class had at all; the slice count says how much of
 * the passing population it reached. A class with a hundred events on one
 * slice is observable and reaches one slice — a very different fact from a
 * class with a hundred events spread over a hundred slices.
 */

import type { NearMissReason, SliceFacts } from './near-miss-facts.js';

/** What one reason class could and could not be observed for. */
export type NearMissClassCoverage = {
  readonly reason: NearMissReason;
  /**
   * Whether the class had any evidence at all.
   *
   * `false` means the class was NOT OBSERVABLE in this scope, so its zero is
   * an absence of data and not a result.
   */
  readonly observable: boolean;
  /** How many events of this class's kind the scope held. */
  readonly scopeEventCount: number;
  /** How many of the passing slices the class reached. */
  readonly observedSliceCount: number;
  /** How many slices this class flagged. */
  readonly nearMissSliceCount: number;
  /**
   * The rate this class supports over the slices it reached, or `null` when
   * the class reached none.
   */
  readonly rate: number | null;
};

/** The classes the metric knows, in a fixed order. */
export const NEAR_MISS_REASONS: readonly NearMissReason[] = [
  'gate-never-evaluated',
  'prereq-skipped',
  'tool-blocked'
];

/** One class's evidence, as the scope and the passing slices hold it. */
type ClassEvidence = {
  readonly reason: NearMissReason;
  readonly scopeEventCount: number;
  readonly reached: (facts: SliceFacts) => boolean;
};

/** The evidence each class is read from. */
function evidenceOf(events: readonly { category: string }[]): readonly ClassEvidence[] {
  const gateEvents = events.filter((event) => event.category === 'gate').length;
  const toolTraces = events.filter((event) => event.category === 'tool-trace').length;
  const prereqAttempts = events.filter((event) => {
    if (event.category !== 'slice-transition') return false;
    const detail = (event as { detail?: { prereqOk?: unknown } }).detail;
    return typeof detail?.prereqOk === 'boolean';
  }).length;
  return [
    {
      reason: 'gate-never-evaluated',
      scopeEventCount: gateEvents,
      reached: (facts) => facts.observed.gateEvents > 0
    },
    {
      reason: 'prereq-skipped',
      scopeEventCount: prereqAttempts,
      reached: (facts) => facts.observed.prereqAttempts > 0
    },
    {
      reason: 'tool-blocked',
      scopeEventCount: toolTraces,
      reached: (facts) => facts.observed.toolTraces > 0
    }
  ];
}

/** The inputs the coverage is computed over. */
export type CoverageInput = {
  /** Every event in the scope. */
  readonly events: readonly { category: string }[];
  /** The facts of every PASSING slice — the metric's denominator. */
  readonly passingFacts: readonly SliceFacts[];
  /** The reasons each near-miss slice carries. */
  readonly reasonsBySlice: ReadonlyMap<string, readonly NearMissReason[]>;
};

/**
 * The coverage of each reason class over the scope.
 *
 * A class with no evidence in the scope is reported as NOT OBSERVABLE with a
 * `null` rate, so a zero can never be read as a result the class did not
 * produce.
 */
export function computeCoverage(input: CoverageInput): readonly NearMissClassCoverage[] {
  const evidence = evidenceOf(input.events);
  return evidence.map((item) => {
    const observedSliceCount = input.passingFacts.filter((facts) => item.reached(facts)).length;
    const nearMissSliceCount = [...input.reasonsBySlice.values()].filter((reasons) =>
      reasons.includes(item.reason)
    ).length;
    const observable = item.scopeEventCount > 0;
    return {
      reason: item.reason,
      observable,
      scopeEventCount: item.scopeEventCount,
      observedSliceCount,
      nearMissSliceCount,
      rate: observedSliceCount === 0 ? null : nearMissSliceCount / observedSliceCount
    };
  });
}

/** The classes that could not be observed, as the phrases a reader needs. */
export function unobservableReasons(
  coverage: readonly NearMissClassCoverage[]
): readonly NearMissReason[] {
  return coverage.filter((item) => !item.observable).map((item) => item.reason);
}
