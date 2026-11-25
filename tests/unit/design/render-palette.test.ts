import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { ColorTokenGroup } from '../../../src/services/design/audit/audit-color.js';
import { decodePng } from '../../../src/services/design/paint-metric.js';
import {
  auditDeclaredLadder,
  auditPaletteDimension,
  declaredChromaticFamilies,
  DEFAULT_VISIBLE_DELTA_E,
  undeclaredChromaticFamilies
} from '../../../src/services/design/audit/render/palette.js';
import {
  measurePalette,
  PALETTE_MIN_FAMILY_SHARE,
  type PaletteMeasurement
} from '../../../src/services/design/audit/render/palette-measure.js';
import {
  maskNonApp,
  MODAL_HISTOGRAM_SIZE,
  type DecodedFrame
} from '../../../src/services/design/audit/render/render-mask.js';
import { rgbPng, type Pixel } from './_png-bytes.js';
import {
  fiveFamilyPng,
  gradientPng,
  monochromePng,
  RENDER_TEST_TIMEOUT_MS,
  sixFamilyWithToastPng,
  subFloorPng,
  threeShadePng,
  toastWithGreyTopPng
} from './_render-fixtures.js';

declareDimensions('tests/unit/design/render-palette.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

function measured(png: Buffer): PaletteMeasurement {
  const read = measurePalette(png);
  if (!read.ok) throw new Error(`fixture refused: ${read.reason}`);
  return read.measurement;
}

function frameOf(png: Buffer): DecodedFrame {
  const decoded = decodePng(png);
  if (!decoded.ok) throw new Error(`fixture refused: ${decoded.reason}`);
  return { pixels: decoded.pixels, width: decoded.width, height: decoded.height, bpp: decoded.bpp };
}

function tokenGroup(values: Record<string, string>): ColorTokenGroup {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { $value: value }])
  );
}

function emptyMeasurement(): PaletteMeasurement {
  return {
    families: [],
    background: 'solid',
    neutralShare: 0,
    distinctChromatic: 0,
    discardedShare: 100,
    maskShare: 0,
    maskComponents: { topStrip: 0, toast: 0, corners: 0 },
    appPixels: 100
  };
}

describe('Scenario: render — the palette is measured from the PNG, not the payload', () => {
  it('when a five-family frame is decoded, should report the exact app-area shares and mask', () => {
    // given: 100×100 with 6000 neutral / 2000 red / 1000 blue / 600 white / 400 amber
    // when: the palette is measured (the top device row is non-app)
    // then: 5 families over 9900 app pixels, with the one-row mask as evidence
    const measurement = measured(fiveFamilyPng());
    expect(measurement.appPixels).toBe(9900);
    expect(measurement.families).toHaveLength(5);
    expect(measurement.distinctChromatic).toBe(3);
    expect(measurement.maskShare).toBe(1);
    expect(measurement.maskComponents).toEqual({ topStrip: 1, toast: 0, corners: 0 });
    expect(measurement.discardedShare).toBe(0);
    expect(measurement.neutralShare).toBe(65.6566);
    expect(measurement.families.map((family) => [family.colour, family.areaShare])).toEqual([
      ['#e11d48', 20.202],
      ['#2563eb', 10.101],
      ['#f59e0b', 4.0404],
      ['#1e1e1e', 59.596],
      ['#ffffff', 6.0606]
    ]);
  });

  it('when the families are ranked, should weigh area 0.3 and normalised chroma 0.7', () => {
    // given: the five-family measurement
    // when: rank is read
    // then: the saturated red leads and the modal neutral keeps only its area term
    const measurement = measured(fiveFamilyPng());
    const red = measurement.families.find((family) => family.colour === '#e11d48');
    const neutral = measurement.families.find((family) => family.colour === '#1e1e1e');
    expect(red?.rank).toBe(0.7991);
    expect(neutral?.rank).toBe(0.3);
    expect(measurement.families[0]?.colour).toBe('#e11d48');
  });

  it('when a frame is near-monochrome, should report one neutral family and no chromatic family', () => {
    // given: a 100×100 frame that is one colour
    // when: the palette is measured
    // then: neutralShare is 100 and distinctChromatic is 0, never a phantom family
    const measurement = measured(monochromePng());
    expect(measurement.families).toHaveLength(1);
    expect(measurement.families[0]).toMatchObject({ colour: '#1e1e1e', chroma: 0 });
    expect(measurement.neutralShare).toBe(100);
    expect(measurement.distinctChromatic).toBe(0);
  });

  it('when a toast-like block sits in the top band, should mask the block and not report its family', () => {
    // given: the five-family frame plus a solid red-brown block in its top 12 %
    // when: the palette is measured
    // then: the block's family is gone and the mask names the toast component
    const measurement = measured(sixFamilyWithToastPng());
    expect(measurement.families.map((family) => family.colour)).not.toContain('#4e3938');
    expect(measurement.maskShare).toBeGreaterThan(8);
    expect(measurement.maskComponents.toast).toBeGreaterThan(8);
    expect(measurement.distinctChromatic).toBe(3);
  });

  it('when the top row is a dark grey within the toast window, should still mask the toast below it', () => {
    // given: row 0 #3c3c3c (ΔE 0.0284 from the toast cell) above a real toast
    // when: the palette is measured (the top strip is excluded from the search)
    // then: the toast family is gone and only the three intended families remain
    const measurement = measured(toastWithGreyTopPng());
    expect(measurement.families.map((family) => family.colour)).not.toContain('#4e3938');
    expect(measurement.maskComponents.toast).toBeGreaterThan(0);
    expect(measurement.distinctChromatic).toBe(3);
  });

  it('when the modal histogram is allocated, should be 32³ and not 32⁵', () => {
    // given: the 5-bit key has three channels
    // when: the histogram size is read
    // then: it is 32,768 slots — the old 32⁵ allocated 134 MB and scanned 33.5 M
    expect(MODAL_HISTOGRAM_SIZE).toBe(32_768);
  });
});

describe('Scenario: behavior — the mask is measured, so a footer survives it', () => {
  it('when a devtools-family block and a differently coloured footer share a corner, should mask only the devtools family', () => {
    // given: a 5×5 grey block and a 3×2 red footer inside the right corner region
    // when: the non-app mask is built
    // then: the grey block is masked and the red footer pixel is untouched
    const png = rgbPng({
      width: 100,
      height: 100,
      pixel: (x, y): Pixel => {
        if (y >= 94 && y < 99 && x >= 88 && x < 93) return [200, 200, 200];
        if (y >= 98 && y < 100 && x >= 94 && x < 97) return [220, 40, 40];
        return [30, 30, 30];
      }
    });
    const result = maskNonApp(frameOf(png));
    const at = (x: number, y: number): number => result.mask[y * 100 + x] ?? -1;
    expect(at(90, 96)).toBe(1);
    expect(at(95, 99)).toBe(0);
    expect(result.components.corners).toBeGreaterThan(0);
  });

  it('when the corner family is larger than the measured devtools bound, should mask nothing', () => {
    // given: a 13×6 block (78 px = 0.78 %) in the right corner region
    // when: the mask is built
    // then: it is page content, not chrome, so the corner share stays zero
    const png = rgbPng({
      width: 100,
      height: 100,
      pixel: (x, y): Pixel => (y >= 94 && x >= 87 ? [200, 200, 200] : [30, 30, 30])
    });
    expect(maskNonApp(frameOf(png)).components.corners).toBe(0);
  });
});

describe('Scenario: behavior — the family rule is the contract’s declared hues', () => {
  it('when a frame paints a hue the contract never declares, should report a soft finding', () => {
    // given: the five-family frame and a contract declaring red and blue only
    // when: the palette dimension is judged
    // then: the undeclared amber family is named; red and blue are not
    const measurement = measured(fiveFamilyPng());
    const result = auditPaletteDimension({
      measurement,
      capture: 'probe/about/full-page.png',
      color: tokenGroup({ 'brand-500': '#e11d48', 'info-500': '#2563eb' })
    });
    expect(result.judged).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      dimension: 'palette',
      severity: 'soft',
      value: '琥珀',
      expected: 'a declared hue family'
    });
    expect(result.findings[0]?.techText).toContain('palette-undeclared:1');
    expect(result.findings[0]?.techText).toContain('#f59e0b 4.040%');
    expect(result.findings[0]?.techText).toContain('mask 1.0000%');
  });

  it('when the contract declares the measured hues, should judge the frame clean', () => {
    // given: the same frame and a contract declaring red, blue and amber
    // when: the palette dimension is judged
    // then: no finding, but the frame WAS judged (a clean 100, not "not judged")
    const result = auditPaletteDimension({
      measurement: measured(fiveFamilyPng()),
      capture: 'probe/about/full-page.png',
      color: tokenGroup({ red: '#e11d48', blue: '#2563eb', amber: '#f59e0b' })
    });
    expect(result.findings).toEqual([]);
    expect(result.judged).toBe(true);
  });

  it('when three shades of one declared hue are painted, should judge the palette clean', () => {
    // given: dark/mid/light red shades (ΔE 0.10–0.27) and one declared red token
    // when: the palette dimension is judged
    // then: all three families share the declared hue bucket, so no finding, judged
    const measurement = measured(threeShadePng());
    expect(measurement.distinctChromatic).toBe(3);
    const result = auditPaletteDimension({
      measurement,
      capture: 'probe/about/full-page.png',
      color: tokenGroup({ brand: '#e11d48' })
    });
    expect(result.judged).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('when the hue rule is inverted, should fire on the declared families and not the undeclared one', () => {
    // given: two declared hues and three rendered families
    // when: the SAME exported rule runs with the flipped operator
    // then: each arm reports the complement of the other, so deleting the
    //       comparison fails this test instead of passing it
    const measurement = measured(fiveFamilyPng());
    const declared = declaredChromaticFamilies(tokenGroup({ red: '#e11d48', blue: '#2563eb' }));
    const undeclared = undeclaredChromaticFamilies(measurement, declared);
    const flipped = undeclaredChromaticFamilies(measurement, declared, true);
    expect(undeclared.map((family) => family.colour)).toEqual(['#f59e0b']);
    expect(flipped.map((family) => family.colour)).toEqual(['#e11d48', '#2563eb']);
    const narrowed = declaredChromaticFamilies(
      tokenGroup({ red: '#e11d48', blue: '#2563eb', amber: '#f59e0b' })
    );
    expect(undeclaredChromaticFamilies(measurement, narrowed)).toEqual([]);
  });

  it('when the contract declares no chromatic token, should not judge the family rule', () => {
    // given: a contract of neutrals only
    // when: the palette dimension is judged
    // then: there is no oracle, so the frame is not judged
    const color = tokenGroup({ ink: '#111111', paper: '#ffffff', grey: '#888888' });
    const result = auditPaletteDimension({
      measurement: measured(fiveFamilyPng()),
      capture: 'probe/about/full-page.png',
      color
    });
    expect(declaredChromaticFamilies(color)).toEqual([]);
    expect(result.judged).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it('when every family is below the floor, should report the palette unmeasured, never a judged 100', () => {
    // given: a measurement with no family above the 0.05 % floor
    // when: the palette dimension is judged
    // then: the frame is a gap, not a clean pass
    const result = auditPaletteDimension({
      measurement: emptyMeasurement(),
      capture: 'probe/about/full-page.png',
      color: tokenGroup({ red: '#e11d48' })
    });
    expect(result.judged).toBe(false);
    expect(result.findings[0]).toMatchObject({ dimension: 'palette', severity: 'unmeasured' });
    expect(result.findings[0]?.techText).toContain('every family below the 0.05% floor');
  });

  it('when two declared steps are closer than the visible threshold, should report the pair', () => {
    // given: red-500 #c81e1e and red-600 #bf1d1d (measured ΔE ≈ 0.019)
    // when: the declared ladder is judged at the 0.12 reference
    // then: one soft finding names both steps and the measured distance
    const findings = auditDeclaredLadder(
      tokenGroup({ 'red-500': '#c81e1e', 'red-600': '#bf1d1d' }),
      'design/tokens.json'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      dimension: 'palette',
      severity: 'soft',
      value: '--red-600/--red-500',
      expected: '>=0.12'
    });
    expect(findings[0]?.techText).toContain('ΔE=0.019 < 0.12');
    expect(DEFAULT_VISIBLE_DELTA_E).toBe(0.12);
  });

  it('when the ladder rule is inverted, should fire on far steps and not on near ones', () => {
    // given: a near declared pair (ΔE 0.019) and a far declared pair
    //        red-800 #991b1b / red-200 #fecaca (ΔE 0.453), both in the red family
    // when: the SAME exported rule runs with the flipped operator
    // then: the real arm reports the near pair and the inverted arm the far one,
    //       so deleting or flipping the comparison fails this test
    const near = tokenGroup({ 'red-500': '#c81e1e', 'red-600': '#bf1d1d' });
    const far = tokenGroup({ 'red-800': '#991b1b', 'red-200': '#fecaca' });
    expect(auditDeclaredLadder(near, 'design/tokens.json')).toHaveLength(1);
    expect(auditDeclaredLadder(near, 'design/tokens.json', DEFAULT_VISIBLE_DELTA_E, true)).toEqual(
      []
    );
    expect(auditDeclaredLadder(far, 'design/tokens.json')).toEqual([]);
    const flipped = auditDeclaredLadder(far, 'design/tokens.json', DEFAULT_VISIBLE_DELTA_E, true);
    expect(flipped.map((finding) => finding.value)).toEqual(['--red-800/--red-200']);
    expect(flipped[0]?.techText).toContain('ΔE=0.453 >= 0.12');
  });
});

describe('Scenario: integration — decoding is deterministic and gaps are real', () => {
  it('when the same PNG is measured twice, should produce byte-identical output', () => {
    // given: the same captured bytes
    // when: the palette is measured twice
    // then: every field and its order match, so reports are comparable across runs
    const png = fiveFamilyPng();
    expect(JSON.stringify(measurePalette(png))).toBe(JSON.stringify(measurePalette(png)));
  });

  it('when the capture is not a PNG, should return the decoder reason instead of a measurement', () => {
    // given: bytes that are not a PNG
    // when: the palette reader runs
    // then: it refuses with a reason, never a zero score
    const read = measurePalette(Buffer.from('not a png at all'));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason.length).toBeGreaterThan(0);
  });

  it('when a gradient frame is measured, should collapse its raw colours into visible families', () => {
    // given: a horizontal gradient with 100 distinct raw colours
    // when: the 0.05 OKLab merge runs
    // then: a handful of families remain, proving the merge rather than a raw count
    const measurement = measured(gradientPng());
    expect(measurement.families.length).toBeLessThanOrEqual(10);
    expect(measurement.families.length).toBeGreaterThan(1);
    expect(measurement.maskComponents.toast).toBe(0);
  });

  it('when a colour is below the family floor, should discard it and report the share', () => {
    // given: a 2-pixel cyan mark (0.0202 % of app pixels)
    // when: the families are read
    // then: no listed family is below PALETTE_MIN_FAMILY_SHARE and the rest is discarded
    const measurement = measured(subFloorPng());
    expect(PALETTE_MIN_FAMILY_SHARE).toBe(0.05);
    expect(measurement.families.map((family) => family.colour)).not.toContain('#00ffff');
    for (const family of measurement.families) {
      expect(family.areaShare).toBeGreaterThanOrEqual(PALETTE_MIN_FAMILY_SHARE);
    }
    expect(measurement.discardedShare).toBeGreaterThan(0);
  });

  it('when the background is flat versus a ramp, should classify it from the pixels', () => {
    // given: a flat frame and a gradient frame
    // when: the measurement's background is read
    // then: the flat frame is solid and the ramp is gradient, from pixels only
    expect(measured(fiveFamilyPng()).background).toBe('solid');
    expect(measured(gradientPng()).background).toBe('gradient');
  });
});

describe('Scenario: a11y — the palette finding is readable by a person and an agent', () => {
  it('when the family finding is read, should explain the undeclared hue and cite the capture', () => {
    // given: the frame against a two-hue contract
    // when: the finding's bilingual pair is read
    // then: the sentence says which hue is undeclared and the technical line is greppable
    const finding = auditPaletteDimension({
      measurement: measured(fiveFamilyPng()),
      capture: 'probe/about/full-page.png',
      color: tokenGroup({ red: '#e11d48', blue: '#2563eb' })
    }).findings[0];
    expect(finding?.humanText).toContain('契约未声明');
    expect(finding?.techText).toMatch(/^probe\/about\/full-page\.png:1 palette-undeclared:/);
  });

  it('when the ladder finding is read, should say the steps are indistinguishable and cite the contract', () => {
    // given: the near red pair
    // when: the finding's bilingual pair is read
    // then: the sentence names the visible threshold and the technical line is greppable
    const finding = auditDeclaredLadder(
      tokenGroup({ 'red-500': '#c81e1e', 'red-600': '#bf1d1d' }),
      'design/tokens.json'
    )[0];
    expect(finding?.humanText).toContain('分不出层级');
    expect(finding?.techText).toMatch(/^design\/tokens\.json:1 palette-ladder:/);
  });
});
