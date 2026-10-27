// tests/unit/services/observability/report-formatter-near-miss.test.ts
//
// WHY THIS FILE EXISTS. The markdown report is the artifact that LEAVES the
// terminal — it is pasted into a PR description, and once it is out there it
// is read as a fact. The near-miss rate is the one number in it that can be
// read two ways: "no near-misses happened" and "the classes that could show
// a near-miss were never observed".
//
// On this repository's recorded history that is not a hypothetical: the
// `gate` emitter postdates every session here, so two of the three reason
// classes have NO events at all, and the third one carries the near-misses.
// A report that printed the bare rate would read as a clean bill of health.
//
// WHAT IS ASSERTED HERE:
//   - the section carries the rate TOGETHER WITH what was and was not
//     observed, so a reader who sees ONLY the rate cannot conclude "there
//     were no near-misses" when two of the three reason classes were never
//     observable at all;
//   - the denominator travels with its definition;
//   - the flagged slices are named, so the count has a referent;
//   - the section sits between the status summary and the slice table, and
//     the hotspot section after it.
//
// THE EVENTS ARE READ FROM DISK. The fixture writes a real session's metrics
// file and reads it back through the repository's own reader, so the shapes
// under test are the shapes on disk.
//
// Dimensions:
//   - behavior:   the sections the report renders, and where they sit
//   - integration: the events read back off a real metrics file
//   - render:     the markdown a reader pastes into a PR
//   - a11y:       what the rate says about the classes it did not measure

import { afterEach, describe, expect, it } from 'vitest';

import {
  aggregateFanout,
  aggregateRepairCycles,
  aggregateSlices,
  aggregateStatus,
  type Period
} from '~/src/services/observability/aggregation.js';
import { computeNearMiss } from '~/src/services/observability/near-miss.js';
import type { ObservabilityEvent } from '~/src/services/observability/observability-service.js';
import { renderObservabilityReport } from '~/src/services/observability/report-formatter.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { cleanupRoots, seedSession, SESSION_ID } from './near-miss-fixture.js';

declareDimensions('tests/unit/services/observability/report-formatter-near-miss.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

afterEach(() => {
  cleanupRoots();
});

/** One slice-transition event, in the shape the emitter writes. */
function transition(sliceRid: string, to: string, prereqOk: boolean): Record<string, unknown> {
  return {
    category: 'slice-transition',
    sliceRid,
    detail: { artifactRole: 'rd', to, prereqOk, missingCount: 0 }
  };
}

/**
 * A session holding two slices that were both DECLARED PASSING.
 *
 *   - `slice-clean` reached a successful verdict on the first attempt;
 *   - `slice-skipped` had a REFUSED `qa-handoff` check and then reached a
 *     successful verdict, so the check was still unsatisfied when the slice
 *     was declared passing — a `prereq-skipped` near-miss.
 *
 * There is NO gate event and NO tool trace in it, so two of the three reason
 * classes had NOTHING TO OBSERVE. That is the shape the section has to render
 * faithfully: a rate over one observed class is not a rate over three.
 */
function nearMissEvents(): readonly ObservabilityEvent[] {
  return seedSession([
    transition('slice-clean', 'qa-handoff', true),
    transition('slice-clean', 'verdict-issued', true),
    transition('slice-skipped', 'qa-handoff', false),
    transition('slice-skipped', 'verdict-issued', true)
  ]);
}

/** The same session with the near-miss slice taken out — a rate of zero. */
function cleanOnlyEvents(): readonly ObservabilityEvent[] {
  return seedSession([
    transition('slice-clean', 'qa-handoff', true),
    transition('slice-clean', 'verdict-issued', true)
  ]);
}

/** The report of the given events, with the near-miss report computed from them. */
function renderWithNearMiss(events: readonly ObservabilityEvent[]): string {
  const period: Period = 'month';
  return renderObservabilityReport({
    scope: 'session',
    scopeId: SESSION_ID,
    period,
    generatedAt: '2026-10-27T00:00:00.000Z',
    status: aggregateStatus(events),
    slices: aggregateSlices(events),
    fanout: aggregateFanout(events),
    repairCycles: aggregateRepairCycles(events),
    nearMiss: computeNearMiss(events)
  });
}

/** The line that states the rate, as the reader sees it. */
function rateLineOf(markdown: string): string {
  const line = markdown.split('\n').find((text) => text.startsWith('- **rate**:'));
  if (line === undefined) throw new Error('the report has no rate line');
  return line;
}

/**
 * Where a section starts in the report.
 *
 * It THROWS when the section is absent, because `indexOf` answers `-1` for a
 * section that is not there — and `-1` compares as "before" every heading, so
 * an ordering assertion built on it passes against a report that has NEITHER
 * section. That is a false green, and this helper exists to refuse it.
 */
function sectionAt(markdown: string, heading: string): number {
  const index = markdown.indexOf(heading);
  if (index < 0) throw new Error(`the report has no ${heading} section`);
  return index;
}

describe('Scenario: render — the near-miss section carries the rate and its coverage', () => {
  it('when the near-miss report is supplied, should render the section with the rate', () => {
    // given: two passing slices, one of which passed with a check unsatisfied
    // when:  the report is rendered with the near-miss report
    // then:  the section carries the rate and the counts it came from
    const markdown = renderWithNearMiss(nearMissEvents());
    expect(markdown).toContain('## Near-misses');
    expect(rateLineOf(markdown)).toContain('0.5');
    expect(rateLineOf(markdown)).toContain('1 of 2 passed slice(s)');
  });

  it('when the near-miss report is supplied, should state the denominator with its definition', () => {
    // given: a near-miss report whose denominator has two definitions
    // when:  the report is rendered
    // then:  the denominator is stated, with the definition it counts by
    const markdown = renderWithNearMiss(nearMissEvents());
    expect(markdown).toContain('- **denominator**: 2 slice(s)');
    expect(markdown).toContain('a slice that recorded a SUCCESSFUL');
  });

  it('when a reason class had no events, should say it was not measured', () => {
    // given: a scope with no gate events and no tool traces
    // when:  the report is rendered
    // then:  the coverage table says the class was not observable, and its
    //         rate cell does not read as a zero
    const markdown = renderWithNearMiss(nearMissEvents());
    expect(markdown).toContain('| gate-never-evaluated | no | 0 | 0 | 0 | not measured |');
    expect(markdown).toContain('| tool-blocked | no | 0 | 0 | 0 | not measured |');
    expect(markdown).toContain('| prereq-skipped | yes | 4 | 2 | 1 | 50% |');
  });

  it('when the near-miss report is supplied, should name the classes it did not observe', () => {
    // given: a scope with no gate events and no tool traces
    // when:  the report is rendered
    // then:  the unobserved classes are named, so the reader can see which
    //         part of the rate is an absence of data
    const markdown = renderWithNearMiss(nearMissEvents());
    expect(markdown).toContain('- **unobserved classes**: `gate-never-evaluated`, `tool-blocked`');
  });

  it('when the near-miss report is supplied, should list the slices it flagged', () => {
    // given: two passing slices, one of which passed with a check unsatisfied
    // when:  the report is rendered
    // then:  the flagged slice is named, so the count has a referent, and
    //         each key carries its state at the pass moment
    const markdown = renderWithNearMiss(nearMissEvents());
    expect(markdown).toContain('### Flagged slices');
    expect(markdown).toContain('| slice-skipped | prereq-skipped |');
    expect(markdown).toContain('rd -> qa-handoff (refused)');
  });

  it('when a key had not been attempted at the pass, should say so', () => {
    // given: a slice that passed BEFORE its qa-handoff check was ever run
    // when:  the report is rendered
    // then:  the key's state reads `unattempted`, so a reader can tell it
    //         apart from a gate that was firing
    const events = seedSession([
      transition('slice-late', 'verdict-issued', true),
      transition('slice-late', 'qa-handoff', false)
    ]);
    const markdown = renderWithNearMiss(events);
    expect(markdown).toContain('rd -> qa-handoff (unattempted)');
  });
});

describe('Scenario: a11y — a rate alone must not read as "no near-misses"', () => {
  it('when the rate is zero and a class was never observed, should not claim there were none', () => {
    // given: one passing slice that passed cleanly, with two classes that were
    //        never observable
    // when:  the report is rendered
    // then:  the report does NOT say there were no near-misses — the rate is
    //         zero over the classes it could observe, and the two it could
    //         not are named as not observed
    const markdown = renderWithNearMiss(cleanOnlyEvents());
    expect(rateLineOf(markdown)).toContain('0 (0%)');
    expect(markdown).not.toContain('no near-misses');
    expect(markdown).not.toContain('0 near-misses');
  });

  it('when the rate is zero, should say which classes the rate did not cover', () => {
    // given: one passing slice that passed cleanly, with two classes that were
    //        never observable
    // when:  the report is rendered
    // then:  the rate line itself says how many classes were observable and
    //         that the rest are an absence of data — a reader who sees ONLY
    //         the rate cannot read it as "there were no near-misses"
    const line = rateLineOf(renderWithNearMiss(cleanOnlyEvents()));
    expect(line).toContain('1 of 3 reason classes');
    expect(line).toContain('the other 2 class(es) had no events to observe');
    expect(line).toContain('absence of data');
  });

  it('when the rate is non-zero, should still say which classes the rate did not cover', () => {
    // given: two passing slices, one of which passed with a check unsatisfied
    // when:  the report is rendered
    // then:  the rate line carries the same coverage qualifier, so a non-zero
    //         rate is not read as covering classes it never observed
    const line = rateLineOf(renderWithNearMiss(nearMissEvents()));
    expect(line).toContain('1 of 3 reason classes');
    expect(line).toContain('the other 2 class(es) had no events to observe');
  });
});

describe('Scenario: behavior — the sections sit where the reader expects them', () => {
  it('when the near-miss report is supplied, should place it before the slice table', () => {
    // given: a report with a near-miss report
    // when:  the report is rendered
    // then:  the near-miss section sits between the status summary and the
    //         slice table — the summary, then the near-misses, then the rows
    const markdown = renderWithNearMiss(nearMissEvents());
    expect(sectionAt(markdown, '## Status summary')).toBeLessThan(
      sectionAt(markdown, '## Near-misses')
    );
    expect(sectionAt(markdown, '## Near-misses')).toBeLessThan(sectionAt(markdown, '## Slices'));
  });

  it('when both measurements are supplied, should place the hotspot section after it', () => {
    // given: a report with a near-miss report and a hotspot ranking
    // when:  the report is rendered
    // then:  the hotspot section comes after the near-miss one
    const events = nearMissEvents();
    const period: Period = 'month';
    const markdown = renderObservabilityReport({
      scope: 'session',
      scopeId: SESSION_ID,
      period,
      generatedAt: '2026-10-27T00:00:00.000Z',
      status: aggregateStatus(events),
      slices: aggregateSlices(events),
      fanout: aggregateFanout(events),
      repairCycles: aggregateRepairCycles(events),
      nearMiss: computeNearMiss(events),
      hotspots: []
    });
    expect(sectionAt(markdown, '## Near-misses')).toBeLessThan(sectionAt(markdown, '## Hotspots'));
  });
});
