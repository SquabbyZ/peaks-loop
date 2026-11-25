import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import { buildAuditReport } from '../../../src/services/design/audit/audit-report.js';
import { fiveFamilyPng, RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { cleanupRenderTrees, makeRenderTree } from './_render-tree.js';

declareDimensions('tests/unit/design/render-wiring.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

const CAPTURE = 'probe/about/full-page.png';

afterEach(cleanupRenderTrees);

function audited(options: Parameters<typeof makeRenderTree>[0], render?: 'five' | 'bad') {
  const root = makeRenderTree(options);
  const result = runAuditProject({
    appRoot: root,
    ...(render === undefined
      ? {}
      : {
          render: [
            {
              png: render === 'five' ? fiveFamilyPng() : Buffer.from('not a png'),
              capture: CAPTURE,
              route: '/'
            }
          ]
        })
  });
  if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
  return buildAuditReport(result);
}

function row(report: ReturnType<typeof audited>, dimension: string) {
  return report.dimensions.find((entry) => entry.dimension === dimension);
}

describe('Scenario: render — a captured page gains the palette dimension', () => {
  it('when a captured page paints more families than the contract allows, should score its palette', () => {
    // given: a two-family contract and a captured frame painting three chromatic families
    // when: the project is audited with render evidence
    // then: the palette row is judged, soft 1 and 95 — an aesthetic finding, not a gap
    const report = audited({ color: { red: '#e11d48', blue: '#2563eb' } }, 'five');
    expect(row(report, 'palette')).toMatchObject({
      dimension: 'palette',
      score: 95,
      judged: true,
      soft: 1,
      hard: 0
    });
  });

  it('when a page has a capture and another does not, should give only the captured page a palette row', () => {
    // given: two routes, one capture bound by route to the index page
    // when: the per-page rows are read
    // then: index has a palette row and about has none, with its source rows intact
    const report = audited(
      { color: { red: '#e11d48', blue: '#2563eb' }, extraPages: ['about.tsx'] },
      'five'
    );
    const index = report.pages.find((page) => page.path === 'pages/index.tsx');
    const about = report.pages.find((page) => page.path === 'pages/about.tsx');
    expect(index?.dimensions.map((entry) => entry.dimension)).toContain('palette');
    expect(about?.dimensions.map((entry) => entry.dimension)).not.toContain('palette');
    expect(about?.dimensions.map((entry) => entry.dimension)).toContain('type');
  });

  it('when the contract declares the measured families, should judge a clean palette at 100', () => {
    // given: a three-family contract and the same three-family frame
    // when: the project is audited with render evidence
    // then: palette was judged and clean — a 100 that is not "nothing judged"
    const report = audited(
      { color: { red: '#e11d48', blue: '#2563eb', amber: '#f59e0b' } },
      'five'
    );
    expect(row(report, 'palette')).toMatchObject({ score: 100, judged: true, soft: 0 });
  });
});

describe('Scenario: behavior — a refused capture is a gap, never a zero or a pass', () => {
  it('when the capture cannot be decoded, should report one unmeasured palette gap', () => {
    // given: bytes the PNG decoder refuses, bound to the index route
    // when: the project is audited
    // then: the palette row is not judged and the gap names the capture
    const report = audited({ color: { red: '#e11d48', blue: '#2563eb' } }, 'bad');
    expect(row(report, 'palette')).toMatchObject({ judged: false, score: null, unmeasured: 1 });
    const gap = report.data.unmeasured.find((item) => item.dimension === 'palette');
    expect(gap?.file).toBe(CAPTURE);
    expect(gap?.techText).toContain('capture refused');
  });

  it('when the contract declares no chromatic token, should refuse to judge the family rule', () => {
    // given: a neutral-only contract and a decoded capture with three chromatic families
    // when: the project is audited
    // then: the palette row is not judged and the gap names the missing oracle
    const report = audited({ color: { ink: '#111111', paper: '#ffffff' } }, 'five');
    expect(row(report, 'palette')).toMatchObject({ judged: false, score: null, unmeasured: 1 });
    expect(report.data.unmeasured.find((item) => item.dimension === 'palette')?.techText).toContain(
      'declares no chromatic colour token'
    );
  });

  it('when the contract declares no pairs and a capture exists, should keep S7 guidance and not judge contrast', () => {
    // given: a neutral contract with no `pairs[]` and a decoded capture
    // when: the project is audited
    // then: contrast is not judged and the report still asks for declared pairs
    const report = audited({ color: { ink: '#111111', paper: '#ffffff' } }, 'five');
    expect(row(report, 'contrast')).toMatchObject({ judged: false, score: null, unmeasured: 1 });
    expect(
      report.data.unmeasured.find((item) => item.dimension === 'contrast')?.techText
    ).toContain('pairs:missing');
  });

  it('when a source dimension was judged before render evidence, should keep the same row', () => {
    // given: the same tree audited once without and once with a capture
    // when: the spacing and hierarchy rows are compared
    // then: the render evidence added rows without moving S7's source score
    const without = audited({ color: { red: '#e11d48', blue: '#2563eb' } });
    const withCapture = audited({ color: { red: '#e11d48', blue: '#2563eb' } }, 'five');
    expect(row(withCapture, 'type')).toEqual(row(without, 'type'));
    expect(row(withCapture, 'hierarchy')).toEqual(row(without, 'hierarchy'));
  });
});

describe('Scenario: integration — the declared ΔE ladder enters the report', () => {
  it('when two declared steps are too close, should report palette even with no capture', () => {
    // given: red-500 and red-600 at ΔE ≈ 0.019 with the default 0.12 step
    // when: a tree with no captures is audited
    // then: the contract-level ladder is a judged soft finding, not a render gap
    const report = audited({ color: { 'red-500': '#c81e1e', 'red-600': '#bf1d1d' } });
    expect(row(report, 'palette')).toMatchObject({ score: 95, judged: true, soft: 1 });
  });

  it('when the contract declares a finer visible step, should trust its threshold', () => {
    // given: the same pair with `visibleDeltaE: 0.01` (below the measured 0.019)
    // when: the tree is audited
    // then: no ladder finding fires, proving the contract's threshold was used
    const report = audited({
      color: { 'red-500': '#c81e1e', 'red-600': '#bf1d1d' },
      visibleDeltaE: 0.01
    });
    expect(row(report, 'palette')).toMatchObject({ judged: false, score: null, soft: 0 });
  });

  it('when the report table is built, should carry both new dimensions', () => {
    // given: a report with render evidence
    // when: the dimension rows are read
    // then: palette and overflow both survive the registry into the report table
    const report = audited({ color: { red: '#e11d48', blue: '#2563eb' } }, 'five');
    expect(report.dimensions.map((entry) => entry.dimension)).toEqual(
      expect.arrayContaining(['palette', 'overflow'])
    );
  });
});

describe('Scenario: a11y — render gaps are explained in plain language', () => {
  it('when a capture cannot be decoded, should say so and name the capture', () => {
    // given: the refused-capture report
    // when: the palette gap text is read
    // then: it explains that the frame could not be measured, in Chinese
    const gap = audited({ color: { red: '#e11d48', blue: '#2563eb' } }, 'bad').data.unmeasured.find(
      (item) => item.dimension === 'palette'
    );
    expect(gap?.humanText).toContain('无法解码');
    expect(gap?.humanText).toContain(CAPTURE);
  });

  it('when the contract has no chromatic token, should say the palette has no oracle', () => {
    // given: the neutral-only contract
    // when: the palette gap text is read
    // then: it says no chromatic token was declared, so the family rule is unknown
    const gap = audited({ color: { ink: '#111111' } }, 'five').data.unmeasured.find(
      (item) => item.dimension === 'palette'
    );
    expect(gap?.humanText).toContain('契约没有声明任何彩色颜色 token');
  });
});
