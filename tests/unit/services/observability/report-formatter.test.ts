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
//     it as one is the miscount this file exists to prevent;
//   - the report with NEITHER measurement supplied is byte-identical to the
//     report as it stood before the sections existed.
//
// The near-miss section's own cases live in
// `report-formatter-near-miss.test.ts` — this file is at its line cap.
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
import type { HotspotRow } from '~/src/services/observability/hotspot-shared.js';
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

describe('Scenario: a11y — the warning travels with the body', () => {
  it('when the caller supplies a warning, should carry it in the header', () => {
    // given: a report whose scope raised a warning
    // when:  the report is rendered
    // then:  the warning is IN the body — a pasted report must not show an
    //         empty table with no explanation
    const period: Period = 'month';
    const markdown = renderObservabilityReport({
      scope: 'session',
      scopeId: SESSION_ID,
      period,
      generatedAt: '2026-10-27T00:00:00.000Z',
      status: aggregateStatus(EVENTS),
      slices: aggregateSlices(EVENTS),
      fanout: aggregateFanout(EVENTS),
      repairCycles: aggregateRepairCycles(EVENTS),
      warnings: ['the scope holds 3 event(s) in other sessions — use --all-sessions']
    });

    expect(markdown).toContain('> **warning**:');
    expect(markdown).toContain('--all-sessions');
  });

  it('when no warning was raised, should carry no warning line', () => {
    // given: a report whose scope raised no warning
    // when:  the report is rendered
    // then:  the body carries no warning line
    expect(render()).not.toContain('> **warning**:');
  });
});

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

describe('Scenario: render — the hotspot count column names what it counts', () => {
  /** One hotspot row, in the shape the ranking produces. */
  function hotspot(over: Partial<HotspotRow> = {}): HotspotRow {
    return {
      ownerSkill: 'peaks-qa',
      ownerReason: null,
      artifact: 'qa/test-cases/<rid>.md',
      kind: 'body',
      confidence: 'ambiguous',
      count: 91,
      countMeaning: 'candidate-mentions',
      sessions: 8,
      firstSeen: '2026-10-14T11:10:50.453Z',
      lastSeen: '2026-10-25T16:05:10.290Z',
      evidence: [],
      ...over
    };
  }

  /** The report with a hotspot ranking, as a reader receives it. */
  function renderWithHotspots(hotspots: readonly HotspotRow[]): string {
    const period: Period = 'month';
    return renderObservabilityReport({
      scope: 'session',
      scopeId: SESSION_ID,
      period,
      generatedAt: '2026-10-27T00:00:00.000Z',
      status: aggregateStatus(EVENTS),
      slices: aggregateSlices(EVENTS),
      fanout: aggregateFanout(EVENTS),
      repairCycles: aggregateRepairCycles(EVENTS),
      hotspots
    });
  }

  it('when a candidate row is shown, should name the column as candidate mentions', () => {
    // given: a ranking with one reconstructed row, whose count is the number
    //        of candidate MENTIONS rather than the number of failures
    // when:  the report is rendered
    // then:  the column heading says it counts candidate mentions, so a
    //         reader cannot take 91 as "91 times missing"
    const markdown = renderWithHotspots([hotspot()]);
    expect(markdown).toContain('candidate mentions');
    expect(markdown).toContain('### Candidate artifacts');
  });

  it('when a measured row is shown, should name the column as times observed missing', () => {
    // given: a ranking with one measured row, whose count IS the number of
    //        times the artifact was seen missing
    // when:  the report is rendered
    // then:  the column heading says it counts observed missing artifacts
    const markdown = renderWithHotspots([
      hotspot({
        confidence: 'exact',
        countMeaning: 'observed-missing',
        artifact: 'rd/code-review-<rid>.md',
        ownerSkill: 'peaks-rd'
      })
    ]);
    expect(markdown).toContain('times observed missing');
    expect(markdown).toContain('### Measured missing artifacts');
  });

  it('when both kinds of row are shown, should keep them in their own tables', () => {
    // given: a ranking with one measured row and one candidate row
    // when:  the report is rendered
    // then:  each table carries the heading for its own meaning, so the two
    //         numbers are never read under one heading
    const markdown = renderWithHotspots([
      hotspot({ confidence: 'exact', countMeaning: 'observed-missing', artifact: 'rd/a-<rid>.md' }),
      hotspot({ artifact: 'qa/b-<rid>.md' })
    ]);
    expect(markdown).toContain('times observed missing');
    expect(markdown).toContain('candidate mentions');
  });

  it('when no ranking is supplied, should not render the hotspot section at all', () => {
    // given: a report whose caller did not compute the ranking
    // when:  the report is rendered
    // then:  there is no hotspot section — the section is opt-in
    const markdown = render();
    expect(markdown).not.toContain('## Hotspots');
  });
});

/**
 * The report as it stood BEFORE the near-miss section existed.
 *
 * The two measurements are OPTIONAL, and a caller that computes neither must
 * get exactly the report it got before — so the whole markdown is pinned
 * here, byte for byte. Any change to the summary, the slice table or the
 * tables under it has to be a deliberate one.
 */
const EXPECTED_REPORT = `
# peaks observability report

- **scope**: session \`2026-10-26-session-reportfmt\`
- **period**: month
- **generated at**: 2026-10-27T00:00:00.000Z
- **scope marker**: from v2.11.1 install date (no backfill per PRD Q5)

## Status summary

| Metric | Value |
|---|---|
| total events | 3 |
| total slices | 3 |
| success count | 1 |
| fail count | 1 |
| stalled count | 1 |
| repair-cycle peak (v2 metric) | 0 |
| fanout cost total | 0 |

## Slices

| rid | transitions | final state | duration | outcome |
|---|---|---|---|---|
| slice-blocked | 1 | blocked | 0 | ✗ |
| slice-done | 1 | handed-off | 0 | ✓ |
| slice-stuck | 1 | qa-handoff | 0 | … |

_✓ succeeded · ✗ failed · … did not finish (stalled)_

## Fanout

_No sub-agent dispatches recorded for this period._

## Repair cycles

- **metric**: \`repair-cycles\` (version 2)
- **definition**: A repair cycle = the slice returns to an RD work state (draft | spec-locked | implemented) after it had entered a QA phase (running | verdict-issued). One rework excursion counts once.

| slice rid | repair cycles |
|---|---|
| slice-blocked | 0 |
| slice-done | 0 |
| slice-stuck | 0 |

- **total repair cycles (v2)**: 0
- **cap**: 3
- **cap hit**: no
- **slices at cap (v2)**: 0
- **QA rounds (a separate metric — a QA phase, NOT a repair cycle)**: total 0, peak 0
- **legacy v1 \`qa-role-transition-event-count\` (NOT a repair-cycle count)**: total 0, peak 0, slices at cap 0
- **legacy note**: Counts slice-transition events whose detail.artifactRole === "qa" — QA's own internal state transitions, NOT repair loops. Kept so the v1 and v2 numbers can be compared side by side.

## Top-5 slowest slices

_No slice durations available._
`
  .replace(/\r\n/g, '\n')
  .slice(1);

describe('Scenario: behavior — omitting both measurements changes nothing', () => {
  it('when neither measurement is supplied, should render the report byte-identically', () => {
    // given: a report whose caller computed neither measurement
    // when:  the report is rendered
    // then:  the markdown is byte-for-byte the report as it stood before the
    //         sections existed
    expect(render()).toBe(EXPECTED_REPORT);
  });

  it('when neither measurement is supplied, should render no measurement section at all', () => {
    // given: a report whose caller computed neither measurement
    // when:  the report is rendered
    // then:  there is no near-miss section and no hotspot section
    const markdown = render();
    expect(markdown).not.toContain('## Near-misses');
    expect(markdown).not.toContain('## Hotspots');
  });
});
