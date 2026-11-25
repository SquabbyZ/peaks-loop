import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import { buildAuditReport, KNOWN_GAPS } from '../../../src/services/design/audit/audit-report.js';
import {
  OVERFLOW_KNOWN_GAP,
  OVERFLOW_UNAVAILABLE_REASON,
  overflowGapFinding
} from '../../../src/services/design/audit/render/render-audit.js';
import { fiveFamilyPng, RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { cleanupRenderTrees, makeRenderTree } from './_render-tree.js';

declareDimensions('tests/unit/design/render-overflow.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

afterEach(cleanupRenderTrees);

function reportFor(render: boolean) {
  const root = makeRenderTree({ color: { ink: '#111111', paper: '#ffffff' } });
  const result = runAuditProject({
    appRoot: root,
    ...(render
      ? {
          render: [
            {
              png: fiveFamilyPng(),
              capture: 'probe/about/full-page.png',
              route: '/'
            }
          ]
        }
      : {})
  });
  if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
  return buildAuditReport(result);
}

describe('Scenario: render — overflow is one fixed row, not a measurement', () => {
  it('when the row is built, should carry the measured missing capability', () => {
    // given: the fixed overflow finding helper
    // when: the row is built for a capture set
    // then: it is one unmeasured row whose technical text names every measured gap
    const finding = overflowGapFinding('probe/about/full-page.png');
    expect(finding).toMatchObject({
      dimension: 'overflow',
      severity: 'unmeasured',
      file: 'probe/about/full-page.png',
      line: 1,
      value: 'responsive-overflow'
    });
    expect(finding.techText).toContain('2–5 top-level regions[].bounds');
    expect(finding.techText).toContain('--width 390 still reports w=1280');
    expect(finding.techText).toContain('--responsive-shots is a dead flag in 13.4.1');
    expect(finding.techText).toContain('~7 s/page');
  });

  it('when the known gap is read, should carry the same measured reason', () => {
    // given: the fixed known-gap entry and the exported reason
    // when: both are read
    // then: they are one decision, and the entry is present in the report's gaps
    expect(OVERFLOW_KNOWN_GAP.reason).toBe(OVERFLOW_UNAVAILABLE_REASON);
    expect(KNOWN_GAPS.find((gap) => gap.id === 'responsive-overflow')).toMatchObject(
      OVERFLOW_KNOWN_GAP
    );
  });
});

describe('Scenario: behavior — no heuristic may fire as overflow', () => {
  it('when a capture exists, should still emit exactly one unmeasured overflow row', () => {
    // given: a tree audited with a decoded capture
    // when: every finding is read
    // then: overflow contributes one unmeasured row and no hard/soft finding
    const report = reportFor(true);
    const findings = report.pages
      .flatMap((page) => page.findings)
      .filter((finding) => finding.dimension === 'overflow');
    const global = report.dimensions.find((row) => row.dimension === 'overflow');
    expect(findings).toEqual([]);
    expect(global).toMatchObject({ hard: 0, soft: 0, unmeasured: 1, judged: false, score: null });
  });

  it('when render evidence changes, should leave the row identical and the source rows intact', () => {
    // given: the same tree audited once without a capture and once with one
    // when: the source dimension rows are compared
    // then: only the render dimensions differ; S7 source rows are untouched
    const without = reportFor(false);
    const withCapture = reportFor(true);
    const sourceRows = (report: ReturnType<typeof reportFor>) =>
      report.dimensions.filter(
        (row) => !['palette', 'overflow', 'contrast'].includes(row.dimension)
      );
    expect(sourceRows(withCapture)).toEqual(sourceRows(without));
    const overflowWithout = without.dimensions.find((row) => row.dimension === 'overflow');
    const overflowWith = withCapture.dimensions.find((row) => row.dimension === 'overflow');
    expect(overflowWith).toEqual(overflowWithout);
  });
});

describe('Scenario: integration — the report renders overflow as not judged', () => {
  it('when the report is built, should render the overflow row "not judged" and keep the gap', () => {
    // given: an audited tree with no render evidence
    // when: the dimension table and known gaps are read
    // then: overflow is not judged, and the gap reason carries the spike numbers
    const report = reportFor(false);
    expect(report.dimensions.find((row) => row.dimension === 'overflow')).toMatchObject({
      judged: false,
      score: null,
      unmeasured: 1
    });
    const gap = report.data.knownGaps.find((entry) => entry.id === 'responsive-overflow');
    expect(gap?.reason).toContain('--responsive-shots');
    expect(gap?.reason).toContain('~7 s/page');
    expect(report.data.unmeasured.filter((item) => item.dimension === 'overflow')).toHaveLength(1);
  });

  it('when a page has no capture, should keep every source dimension and lose only render rows', () => {
    // given: a tree with no captures at all
    // when: its page rows are read
    // then: the page has no palette row and its source rows still exist
    const report = reportFor(false);
    const page = report.pages[0];
    expect(page?.dimensions.map((row) => row.dimension)).not.toContain('palette');
    expect(page?.dimensions.map((row) => row.dimension)).toEqual(
      expect.arrayContaining(['type', 'hierarchy', 'a11y'])
    );
  });
});

describe('Scenario: a11y — the overflow gap says what is missing', () => {
  it('when the row is read aloud, should name the mobile-width question and the missing capture', () => {
    // given: the fixed overflow row
    // when: its human text is read
    // then: it says the mobile overflow question is unanswerable and why
    const finding = overflowGapFinding('design/probe');
    expect(finding.humanText).toContain('手机宽度下是否溢出无法判定');
    expect(finding.humanText).toContain('双视口截图');
    expect(finding.techText).toMatch(/^design\/probe:1 overflow:responsive-overflow unmeasured/);
  });
});
