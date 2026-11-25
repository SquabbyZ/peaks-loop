import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { ColorTokenGroup } from '../../../src/services/design/audit/audit-color.js';
import {
  auditDeclaredLadder,
  auditPaletteDimension,
  declaredChromaticFamilies,
  paletteCaptureUnmeasured,
  paletteEmptyUnmeasured,
  paletteOracleUnmeasured,
  undeclaredChromaticFamilies
} from '../../../src/services/design/audit/render/palette.js';
import { deltaE, oklabOfHex } from '../../../src/services/design/audit/color-oklch.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { paletteFamily, paletteMeasurement } from './_render-frames.js';

declareDimensions('tests/unit/design/render-palette-judge.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

function tokens(values: Record<string, unknown>): ColorTokenGroup {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { $value: value }])
  ) as ColorTokenGroup;
}

const HUES = [
  ['#e11d48', 8],
  ['#f97316', 7],
  ['#f59e0b', 6],
  ['#eab308', 5],
  ['#84cc16', 4],
  ['#22c55e', 3],
  ['#14b8a6', 2],
  ['#2563eb', 1]
] as const;

describe('Scenario: render — declared chromatic families come from the tokens', () => {
  it('when a token is neutral or unconvertible, should omit it', () => {
    // given: red, neutral grey, a number and a non-colour string
    // when: the declared families are read
    // then: only the red token is a family
    const families = declaredChromaticFamilies(
      tokens({ red: '#e11d48', grey: '#888888', size: 42, bad: 'not-a-colour' })
    );
    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({ bucket: 0, label: '红' });
  });

  it('when the chroma is just below the source threshold, should omit the token', () => {
    // given: #000109 measures chroma 0.034975
    // when: the declared families are read
    // then: the neutral line excludes it
    expect(declaredChromaticFamilies(tokens({ ink: '#000109' }))).toEqual([]);
  });

  it('when no color group is supplied, should return no families', () => {
    // given: no color argument at all
    // when: the declared families are read
    // then: the list is empty, not a throw
    expect(declaredChromaticFamilies(undefined)).toEqual([]);
  });

  it('when steps share a bucket, should order them darkest first', () => {
    // given: red-500 and a darker red-900
    // when: the declared family is read
    // then: red-900 (lower lightness) comes before red-500
    const families = declaredChromaticFamilies(
      tokens({ 'red-500': '#e11d48', 'red-900': '#7f1d1d' })
    );
    expect(families).toHaveLength(1);
    expect(families[0]?.steps.map((step) => step.name)).toEqual(['red-900', 'red-500']);
  });

  it('when several buckets exist, should order families by bucket', () => {
    // given: a blue token and a red token in reverse declaration order
    // when: the declared families are read
    // then: the red bucket (0) precedes the blue bucket (8)
    const families = declaredChromaticFamilies(tokens({ blue: '#2563eb', red: '#e11d48' }));
    expect(families.map((family) => family.bucket)).toEqual([0, 8]);
  });
});

describe('Scenario: behavior — the ladder reports steps below the visible threshold', () => {
  it('when a near step pair is judged, should explain the indistinguishable pair', () => {
    // given: red-500 #c81e1e and red-600 #bf1d1d (ΔE ≈ 0.019)
    // when: the ladder is judged at 0.12
    // then: the bilingual pair is exact
    const findings = auditDeclaredLadder(
      tokens({ 'red-500': '#c81e1e', 'red-600': '#bf1d1d' }),
      'design/tokens.json'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.humanText).toBe(
      '契约的红色阶 --red-600 与 --red-500 的 ΔE 只有 0.019，低于可见阈值 0.12，两者在页面上分不出层级。'
    );
    expect(findings[0]?.techText).toBe(
      'design/tokens.json:1 palette-ladder:--red-600/--red-500 ΔE=0.019 < 0.12'
    );
  });

  it('when the distance exactly meets the threshold, should not report the pair', () => {
    // given: a threshold equal to the measured ΔE of the pair
    // when: the ladder is judged
    // then: the >= guard continues and no finding is emitted
    const left = oklabOfHex('#c81e1e');
    const right = oklabOfHex('#bf1d1d');
    if (left === null || right === null) throw new Error('fixture colours must be hex');
    const distance = deltaE(left, right);
    expect(
      auditDeclaredLadder(
        tokens({ 'red-500': '#c81e1e', 'red-600': '#bf1d1d' }),
        FILE_PATH,
        distance
      )
    ).toEqual([]);
    expect(
      auditDeclaredLadder(
        tokens({ 'red-500': '#c81e1e', 'red-600': '#bf1d1d' }),
        FILE_PATH,
        distance + 0.0001
      )
    ).toHaveLength(1);
  });

  it('when a family has exactly two steps, should not read past the array', () => {
    // given: two steps in one bucket
    // when: the ladder loop runs to its inclusive mutant bound
    // then: the undefined-next guard stops it, so the call never throws
    const findings = auditDeclaredLadder(
      tokens({ 'red-500': '#c81e1e', 'red-600': '#bf1d1d' }),
      FILE_PATH
    );
    expect(findings.length).toBeLessThanOrEqual(1);
  });
});

const FILE_PATH = 'design/tokens.json';

describe('Scenario: integration — undeclared families compare bucket to bucket', () => {
  it('when a family sits exactly on the chroma line, should count it as chromatic', () => {
    // given: a synthetic family with chroma 0.035 exactly
    // when: the undeclared rule runs
    // then: it is compared; a > mutation would drop it
    const measurement = paletteMeasurement({
      families: [paletteFamily('#000109', 60, 0.035), paletteFamily('#1e1e1e', 40, 0)]
    });
    expect(undeclaredChromaticFamilies(measurement, [])).toHaveLength(1);
  });

  it('when a family is neutral, should never enter the undeclared list', () => {
    // given: one neutral family and no declared tokens
    // when: the undeclared rule runs
    // then: the neutral family is filtered out
    const measurement = paletteMeasurement({ families: [paletteFamily('#1e1e1e', 100, 0)] });
    expect(undeclaredChromaticFamilies(measurement, [])).toEqual([]);
  });

  it('when areas differ, should order the undeclared families by area', () => {
    // given: blue 10 %, red 30 % (declared) and amber 20 %
    // when: the undeclared rule runs
    // then: amber (20) precedes blue (10)
    const measurement = paletteMeasurement({
      families: [
        paletteFamily('#2563eb', 10),
        paletteFamily('#e11d48', 30),
        paletteFamily('#f59e0b', 20)
      ]
    });
    const declared = declaredChromaticFamilies(tokens({ red: '#e11d48' }));
    expect(
      undeclaredChromaticFamilies(measurement, declared).map((family) => family.colour)
    ).toEqual(['#f59e0b', '#2563eb']);
  });

  it('when areas tie, should order the families by colour', () => {
    // given: blue and amber both at 10 %
    // when: the undeclared rule runs
    // then: the smaller hex sorts first
    const measurement = paletteMeasurement({
      families: [paletteFamily('#f59e0b', 10), paletteFamily('#2563eb', 10)]
    });
    expect(undeclaredChromaticFamilies(measurement, []).map((family) => family.colour)).toEqual([
      '#2563eb',
      '#f59e0b'
    ]);
  });
});

describe('Scenario: render — the family finding lists six and names them all', () => {
  it('when eight rendered families face one declared hue, should list seven by area', () => {
    // given: eight hue families and a contract declaring red only
    // when: the palette dimension is judged
    // then: the value names all seven undeclared labels and the tech line
    //       echoes only the first six families
    const measurement = paletteMeasurement({
      families: HUES.map(([colour, area]) => paletteFamily(colour, area)),
      maskShare: 3.2,
      discardedShare: 0.1,
      maskComponents: { topStrip: 1.5, toast: 1.2, corners: 0.5 }
    });
    const result = auditPaletteDimension({
      measurement,
      capture: 'probe/about/full-page.png',
      color: tokens({ red: '#e11d48' })
    });
    expect(result.judged).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.value).toBe('橙、琥珀、黄绿、青、蓝');
    expect(result.findings[0]?.humanText).toBe(
      '本页渲染出契约未声明的彩色色系：橙、琥珀、黄绿、青、蓝（共 7 个颜色家族），契约只声明了 1 个色系，页面颜色显得杂乱。'
    );
    expect(result.findings[0]?.techText).toBe(
      'probe/about/full-page.png:1 palette-undeclared:7 (橙(#f97316 7.000%); 琥珀(#f59e0b 6.000%); 琥珀(#eab308 5.000%); 黄绿(#84cc16 4.000%); 黄绿(#22c55e 3.000%); 青(#14b8a6 2.000%)) not among the 1 declared hue families [mask 3.2000% (top 1.5000 + toast 1.2000 + corners 0.5000), discarded 0.1000% outside the listed families (below the 0.05% floor or past the 256-family cap)]'
    );
    expect(result.findings[0]?.techText).not.toContain('#2563eb');
  });
});

describe('Scenario: a11y — the gap findings are exact and actionable', () => {
  it('when the palette is empty, should report the floor as an unmeasured gap', () => {
    // given: a capture whose every family fell below the floor
    // when: the gap finding is built
    // then: it is exact
    expect(paletteEmptyUnmeasured('probe/full-page.png')).toEqual({
      dimension: 'palette',
      severity: 'unmeasured',
      file: 'probe/full-page.png',
      line: 1,
      value: 'palette',
      expected: 'a colour family above the 0.05% floor',
      humanText:
        '截图 probe/full-page.png 的每个颜色家族都低于 0.05% 的面积下限，没有可测量的调色板。',
      techText:
        'probe/full-page.png:1 palette-families unmeasured (every family below the 0.05% floor)'
    });
  });

  it('when a capture cannot be decoded, should quote the decoder reason', () => {
    // given: the decoder reason "a missing PNG signature"
    // when: the gap finding is built
    // then: the reason is carried verbatim
    expect(paletteCaptureUnmeasured('probe/full-page.png', 'a missing PNG signature')).toEqual({
      dimension: 'palette',
      severity: 'unmeasured',
      file: 'probe/full-page.png',
      line: 1,
      value: 'capture',
      expected: 'a decodable full-page.png',
      humanText:
        '截图 probe/full-page.png 无法解码（a missing PNG signature），这一帧的调色板无法测量。',
      techText:
        'probe/full-page.png:1 palette unmeasured (capture refused: a missing PNG signature)'
    });
  });

  it('when there is no chromatic token, should name the missing oracle', () => {
    // given: a neutral-only contract and a measured frame
    // when: the oracle gap is built
    // then: the mask evidence travels with the finding
    const measurement = paletteMeasurement({
      families: [paletteFamily('#1e1e1e', 100, 0)],
      maskShare: 1,
      maskComponents: { topStrip: 1, toast: 0, corners: 0 }
    });
    expect(paletteOracleUnmeasured('probe/full-page.png', measurement)).toEqual({
      dimension: 'palette',
      severity: 'unmeasured',
      file: 'probe/full-page.png',
      line: 1,
      value: 'tokens.color',
      expected: 'a declared chromatic colour token',
      humanText: '契约没有声明任何彩色颜色 token，无法判断本页的彩色色系是否超出配色规范。',
      techText:
        'probe/full-page.png:1 palette-families unmeasured (tokens.color declares no chromatic colour token) [mask 1.0000% (top 1.0000 + toast 0.0000 + corners 0.0000), discarded 0.0000% outside the listed families (below the 0.05% floor or past the 256-family cap)]'
    });
  });

  it('when every family is below the floor, should judge the frame unmeasured', () => {
    // given: a measurement with an empty family list
    // when: the palette dimension is judged
    // then: it is unmeasured, never a judged 100
    const result = auditPaletteDimension({
      measurement: paletteMeasurement({ families: [] }),
      capture: 'probe/full-page.png',
      color: tokens({ red: '#e11d48' })
    });
    expect(result.judged).toBe(false);
    expect(result.findings[0]?.value).toBe('palette');
  });
});
