// tests/unit/services/observability/report-formatter.test.ts
//
// WHY THIS FILE EXISTS. The report is what a human reads: it is pasted into a
// PR description, and it is the only place the three outcome counts and the
// slice table appear side by side. Before this file existed, the summary
// printed `success count` and `fail count` and NOT the stalled ones, and the
// slice table drew a slice stuck at `qa-handoff` with the failure marker `✗`.
// The two halves of ONE report then disagreed about the same slices: the
// summary counted 0 failures while the table showed 8 crosses.
//
// WHAT IS ASSERTED HERE:
//   - the summary names the stalled count beside the other two, so the three
//     counts are visible together and reconcile with the slice table;
//   - the slice table marks a STALLED slice apart from a FAILED one — a
//     slice that advanced partway and stopped is not a failure, and drawing
//     it as one is the miscount this file exists to prevent.
//
// Dimensions:
//   - behavior:  which marker each outcome is drawn with
//   - render:    the markdown a reader pastes into a PR
//   - a11y:      what the marker and the legend SAY to that reader

import { describe, expect, it } from 'vitest';

import {
  aggregateFanout,
  aggregateRepairCycles,
  aggregateSlices,
  aggregateStatus,
  type Period
} from '~/src/services/observability/aggregation.js';
import { renderObservabilityReport } from '~/src/services/observability/report-formatter.js';
import type { ObservabilityEvent } from '~/src/services/observability/observability-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/report-formatter.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    {
      dim: 'integration',
      reason:
        'the formatter is a pure function of its input: no file, process or environment is read, so there is nothing to integrate with'
    }
  ]
);

const SESSION_ID = '2026-10-26-session-reportfmt';

/** One slice-transition event, in the shape the emitter writes. */
function transition(sliceRid: string, to: string, index: number): ObservabilityEvent {
  return {
    schemaVersion: 1,
    ts: new Date(Date.UTC(2026, 9, 26, 0, 0, index)).toISOString(),
    sessionId: SESSION_ID,
    category: 'slice-transition',
    sliceRid,
    detail: { artifactRole: 'rd', to, prereqOk: true, missingCount: 0 }
  };
}

/**
 * The three outcomes the report must tell apart:
 *   - `slice-done`   reached a terminal success state;
 *   - `slice-blocked` reached a terminal FAILURE state;
 *   - `slice-stuck`   advanced partway and stopped at `qa-handoff`.
 */
const EVENTS: readonly ObservabilityEvent[] = [
  transition('slice-done', 'handed-off', 0),
  transition('slice-blocked', 'blocked', 1),
  transition('slice-stuck', 'qa-handoff', 2)
];

/** The report of the three events above, as a reader receives it. */
function render(): string {
  const period: Period = 'month';
  return renderObservabilityReport({
    scope: 'session',
    scopeId: SESSION_ID,
    period,
    generatedAt: '2026-10-27T00:00:00.000Z',
    status: aggregateStatus(EVENTS),
    slices: aggregateSlices(EVENTS),
    fanout: aggregateFanout(EVENTS),
    repairCycles: aggregateRepairCycles(EVENTS)
  });
}

/** The table row of one slice, as the reader sees it. */
function rowFor(markdown: string, sliceRid: string): string {
  const row = markdown.split('\n').find((line) => line.startsWith(`| ${sliceRid} |`));
  if (row === undefined) throw new Error(`the report has no row for ${sliceRid}`);
  return row;
}

describe('Scenario: behavior — each outcome is drawn as itself', () => {
  it('when a slice reached a terminal success state, should draw it as succeeded', () => {
    // given: a slice that reached a terminal success state
    // when:  the report is rendered
    // then:  its row carries the success marker
    expect(rowFor(render(), 'slice-done')).toContain('✓');
  });

  it('when a slice reached a terminal failure state, should draw it as failed', () => {
    // given: a slice that reached a terminal failure state
    // when:  the report is rendered
    // then:  its row carries the failure marker
    expect(rowFor(render(), 'slice-blocked')).toContain('✗');
  });

  it('when a slice advanced partway and stopped, should draw it as unfinished', () => {
    // given: a slice that advanced partway and stopped at qa-handoff
    // when:  the report is rendered
    // then:  its row does NOT carry the failure marker — a slice that never
    //       reached a terminal state was not failed
    const row = rowFor(render(), 'slice-stuck');
    expect(row).not.toContain('✗');
    expect(row).toContain('…');
  });
});

describe('Scenario: render — the summary names the count the table draws', () => {
  it('when the report counts its slices, should name the stalled count', () => {
    // given: one slice of each of the three outcomes
    // when:  the report is rendered
    // then:  the summary carries the stalled count beside the other two
    const markdown = render();
    expect(markdown).toContain('| success count | 1 |');
    expect(markdown).toContain('| fail count | 1 |');
    expect(markdown).toContain('| stalled count | 1 |');
  });

  it('when the summary and the table are read together, should reconcile', () => {
    // given: one slice of each of the three outcomes
    // when:  the report is rendered
    // then:  the three counts add up to the number of rows the table shows
    const markdown = render();
    const counted = ['slice-done', 'slice-blocked', 'slice-stuck'].filter((rid) =>
      markdown.includes(`| ${rid} |`)
    );
    expect(counted).toHaveLength(3);
    expect(markdown).toContain('| total slices | 3 |');
  });
});

describe('Scenario: a11y — the marker says what it means', () => {
  it('when a reader meets the outcome column, should be told what the markers mean', () => {
    // given: a report whose outcome column carries three markers
    // when:  the report is rendered
    // then:  the reader is told which marker means "did not finish"
    const markdown = render();
    expect(markdown).toContain('did not finish');
  });
});
