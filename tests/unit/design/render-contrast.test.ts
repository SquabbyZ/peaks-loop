import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  contrastRatio,
  type ContrastContract
} from '../../../src/services/design/audit/audit-contrast.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import { buildAuditReport } from '../../../src/services/design/audit/audit-report.js';
import {
  auditRenderedContrast,
  familyNearIn,
  PRESENCE_DELTA_E,
  thresholdViolated
} from '../../../src/services/design/audit/render/contrast-presence.js';
import type { PaletteMeasurement } from '../../../src/services/design/audit/render/palette-measure.js';
import {
  readRenderFrames,
  type RenderBackground,
  type RenderFrame
} from '../../../src/services/design/audit/render/render-audit.js';
import {
  gradientPairPng,
  lowPairPng,
  RENDER_TEST_TIMEOUT_MS,
  renderedFailPng,
  renderedPairPng,
  renderedPassPng
} from './_render-fixtures.js';
import { cleanupRenderTrees, makeRenderTree } from './_render-tree.js';

declareDimensions('tests/unit/design/render-contrast.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

const CAPTURE = 'probe/contrast/full-page.png';
const CONTRACT_FILE = 'design/tokens.json';

function frame(png: Buffer, background?: RenderBackground): RenderFrame {
  const built = readRenderFrames([{ png, capture: CAPTURE, route: '/' }])[0] as RenderFrame;
  // The production reader classifies from pixels; an explicit background is a
  // unit-test input for the contrast rule's own branches.
  return background === undefined ? built : { ...built, background };
}

function measurementOf(capture: RenderFrame): PaletteMeasurement {
  if (!capture.palette.ok) throw new Error(`fixture refused: ${capture.palette.reason}`);
  return capture.palette.measurement;
}

function contractOf(foreground: string, background: string, large?: boolean): ContrastContract {
  return {
    color: { ink: { $value: foreground }, paper: { $value: background } },
    pairs: [{ fg: 'ink', bg: 'paper', ...(large === true ? { large: true } : {}) }]
  };
}

function audit(contract: ContrastContract, capture: RenderFrame) {
  return auditRenderedContrast(contract, [capture], CONTRACT_FILE);
}

/** A tree with one route and a contract whose tokens declare the given pair. */
function treeOf(foreground: string, background: string): string {
  return makeRenderTree({
    color: { ink: foreground, paper: background },
    pairs: [{ fg: 'ink', bg: 'paper' }]
  });
}

afterEach(cleanupRenderTrees);

describe('Scenario: render — a declared pair is judged only where both colours render', () => {
  it('when the declared pair renders slightly off and crosses 4.5, should report a hard finding', () => {
    // given: declared #767676 on #ffffff (4.54 passes) rendered as #7a7a7a (4.29 fails)
    // when: the rendered contrast rule runs
    // then: the finding is hard and names both rendered colours
    const capture = frame(renderedFailPng());
    const result = audit(contractOf('#767676', '#ffffff'), capture);
    expect(result.judged).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      dimension: 'contrast',
      severity: 'hard',
      value: '4.29:1',
      expected: '4.5:1'
    });
    expect(result.findings[0]?.techText).toContain(
      'both rendered #7a7a7a and #ffffff present, solid; adjacency not measured'
    );
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrastRatio('#7a7a7a', '#ffffff')).toBeLessThan(4.5);
  });

  it('when both declared colours render and pass, should judge the pair without a finding', () => {
    // given: declared #111111 on #ffffff, both rendered exactly
    // when: the rendered contrast rule runs
    // then: it is judged and clean — a judged 100, not "not judged"
    const result = audit(contractOf('#111111', '#ffffff'), frame(renderedPassPng()));
    expect(result.findings).toEqual([]);
    expect(result.judged).toBe(true);
  });

  it('when a declared colour never renders, should record the pair unmeasured, never a pass', () => {
    // given: a pair declaring #000000, which the frame does not paint
    // when: the rendered contrast rule runs
    // then: the pair is unmeasured with the declared-but-not-rendered reason
    const result = audit(contractOf('#000000', '#ffffff'), frame(renderedPassPng()));
    expect(result.judged).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ dimension: 'contrast', severity: 'unmeasured' });
    expect(result.findings[0]?.techText).toContain('declared but not rendered');
    expect(result.findings[0]?.techText).toContain(`ΔE ${PRESENCE_DELTA_E}`);
  });

  it('when the pair renders over a pixel-measured gradient, should leave it unmeasured', () => {
    // given: both colours present and the pixels classify the background as a gradient
    // when: the rendered contrast rule runs
    // then: the pair is unmeasured, because a gradient is not a solid fill
    const capture = frame(gradientPairPng());
    expect(capture.background).toBe('gradient');
    const result = audit(contractOf('#111111', '#ffffff'), capture);
    expect(result.judged).toBe(false);
    expect(result.findings[0]?.techText).toContain('rendered over a gradient background');
    expect(result.findings[0]?.humanText).toContain('渐变');
  });

  it('when the background cannot be classified, should refuse to judge the pair', () => {
    // given: a frame whose pixel classification is unknown
    // when: the rendered contrast rule runs
    // then: the pair is unmeasured, not assumed solid
    const result = audit(contractOf('#111111', '#ffffff'), frame(renderedPassPng(), 'unknown'));
    expect(result.judged).toBe(false);
    expect(result.findings[0]?.techText).toContain('rendered over a unknown background');
  });

  it('when the contract declares no pairs, should judge nothing and invent nothing', () => {
    // given: a contract with colours but no pairs
    // when: the rendered contrast rule runs
    // then: no finding and judged false — S7's "not judged" survives S8
    const result = auditRenderedContrast(
      { color: { ink: { $value: '#111111' } } },
      [frame(renderedPassPng())],
      CONTRACT_FILE
    );
    expect(result.findings).toEqual([]);
    expect(result.judged).toBe(false);
  });
});

describe('Scenario: behavior — the WCAG threshold is the declared pair’s own size', () => {
  it('when a body-text pair renders at 1.26:1, should report it below 4.5:1', () => {
    // given: #888888 on #777777, both rendered exactly
    // when: the pair is body text
    // then: it is a hard finding at the body threshold
    const result = audit(contractOf('#888888', '#777777'), frame(lowPairPng()));
    expect(result.findings[0]).toMatchObject({ severity: 'hard', expected: '4.5:1' });
    expect(result.findings[0]?.techText).toContain('=1.26 < 4.5');
  });

  it('when the same 3.72:1 pair is large text, should pass while body text fails', () => {
    // given: the pilot toast pair #ff6568 on #4e3938 (3.72:1), both rendered
    // when: it is judged once as body text and once as large text
    // then: body fails the 4.5 line and large passes the 3.0 line
    const capture = frame(renderedPairPng([78, 57, 56], [255, 101, 104]));
    expect(audit(contractOf('#ff6568', '#4e3938'), capture).findings[0]?.severity).toBe('hard');
    const large = audit(contractOf('#ff6568', '#4e3938', true), capture);
    expect(large.findings).toEqual([]);
    expect(large.judged).toBe(true);
  });

  it('when the threshold rule is inverted, should fire on the passing pair and not the failing one', () => {
    // given: the low pair (1.26) and the pass pair (18.88)
    // when: the REAL exported threshold rule runs with both operators
    // then: each arm fires exactly where the other is silent
    const low = audit(contractOf('#888888', '#777777'), frame(lowPairPng()));
    const pass = audit(contractOf('#111111', '#ffffff'), frame(renderedPassPng()));
    expect(low.findings).toHaveLength(1);
    expect(pass.findings).toHaveLength(0);
    expect(thresholdViolated(1.26, 4.5)).toBe(true);
    expect(thresholdViolated(1.26, 4.5, true)).toBe(false);
    expect(thresholdViolated(18.88, 4.5)).toBe(false);
    expect(thresholdViolated(18.88, 4.5, true)).toBe(true);
  });

  it('when the presence rule is inverted, should find a family the real rule rejects', () => {
    // given: a frame that paints no #000000
    // when: the REAL exported matcher runs with both operators
    // then: the real arm finds nothing while the flipped arm finds the nearest family
    const measurement = measurementOf(frame(renderedPassPng()));
    expect(familyNearIn(measurement, '#000000')).toBeNull();
    expect(familyNearIn(measurement, '#000000', true)).not.toBeNull();
    const absent = audit(contractOf('#000000', '#ffffff'), frame(renderedPassPng()));
    expect(absent.findings[0]?.severity).toBe('unmeasured');
  });
});

describe('Scenario: integration — the audit report carries the rendered contrast verdict', () => {
  it('when a capture renders the declared pair, should score contrast 100 and judged', () => {
    // given: a one-page tree declaring #111111 on #ffffff and a frame that renders both
    // when: the project is audited with render evidence
    // then: the contrast row is judged, not null and not a gap
    const root = treeOf('#111111', '#ffffff');
    const result = runAuditProject({
      appRoot: root,
      render: [{ png: renderedPassPng(), capture: CAPTURE, route: '/' }]
    });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const report = buildAuditReport(result);
    const contrast = report.dimensions.find((row) => row.dimension === 'contrast');
    expect(contrast).toMatchObject({ judged: true, score: 100, hard: 0, unmeasured: 0 });
  });

  it('when the capture never renders a declared colour, should leave contrast not judged', () => {
    // given: a tree declaring #000000 on #ffffff and a frame that paints #111111
    // when: the project is audited with render evidence
    // then: contrast is "not judged" (score null), never a silent pass
    const root = treeOf('#000000', '#ffffff');
    const result = runAuditProject({
      appRoot: root,
      render: [{ png: renderedPassPng(), capture: CAPTURE, route: '/' }]
    });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const contrast = buildAuditReport(result).dimensions.find(
      (row) => row.dimension === 'contrast'
    );
    expect(contrast).toMatchObject({ judged: false, score: null, unmeasured: 1 });
  });

  it('when a supplied capture cannot be decoded, should not fall back to a token pass', () => {
    // given: a pair that would pass on tokens ($111111 on #ffffff) and a refused capture
    // when: the project is audited
    // then: contrast is unmeasured with the refusal, never judged 100
    const root = treeOf('#111111', '#ffffff');
    const result = runAuditProject({
      appRoot: root,
      render: [{ png: Buffer.from('not a png'), capture: CAPTURE, route: '/' }]
    });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const report = buildAuditReport(result);
    const contrast = report.dimensions.find((row) => row.dimension === 'contrast');
    expect(contrast).toMatchObject({ judged: false, score: null, unmeasured: 1 });
    expect(
      report.data.unmeasured.find((item) => item.dimension === 'contrast')?.techText
    ).toContain('capture refused, no token fallback');
  });
});

describe('Scenario: a11y — an unmeasured pair and a failing pair read differently', () => {
  it('when a pair never renders, should say it is unknown and why', () => {
    // given: the absent pair
    // when: its human text is read
    // then: the sentence says the contrast is unknown, not that it passed
    const finding = audit(contractOf('#000000', '#ffffff'), frame(renderedPassPng())).findings[0];
    expect(finding?.humanText).toContain('无法从渲染结果确认');
    expect(finding?.techText).toMatch(/^design\/tokens\.json:1 contrast:--ink\/--paper unmeasured/);
  });

  it('when a rendered pair fails, should name the rendered colours and not overclaim adjacency', () => {
    // given: the fail-after-render fixture
    // when: its human text is read
    // then: it states the measured ratio and admits adjacency is not measured
    const finding = audit(contractOf('#767676', '#ffffff'), frame(renderedFailPng())).findings[0];
    expect(finding?.humanText).toContain('4.29:1');
    expect(finding?.humanText).toContain('#7a7a7a');
    expect(finding?.humanText).toContain('没有验证文字与背景是否相邻');
    expect(finding?.techText).toMatch(/^probe\/contrast\/full-page\.png:1 contrast:/);
  });
});
