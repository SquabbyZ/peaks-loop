import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { measurePalette } from '../../../src/services/design/audit/render/palette-measure.js';
import { BACKGROUND, blockPng } from './_render-frames.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';

declareDimensions('tests/unit/design/palette-measure-floor.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

function measured(png: Buffer) {
  const read = measurePalette(png);
  if (!read.ok) throw new Error(`fixture refused: ${read.reason}`);
  return read.measurement;
}

describe('Scenario: behavior — the family floor is inclusive at exactly 0.05 %', () => {
  it('when a colour covers exactly 0.05 % of the app pixels, should list it as a family', () => {
    // given: a 100×21 frame (the top row is masked, leaving 2000 app pixels)
    // when: one cyan pixel covers exactly 1/2000 = 0.05 %
    // then: the family is kept — the floor is >=, not >
    const measurement = measured(
      blockPng(100, 21, [{ x0: 50, x1: 51, y0: 10, y1: 11, colour: [0, 255, 255] }])
    );
    expect(measurement.appPixels).toBe(2000);
    expect(measurement.families.map((family) => family.colour)).toEqual(['#00ffff', '#1e1e1e']);
    expect(measurement.families[0]?.areaShare).toBe(0.05);
    expect(measurement.discardedShare).toBe(0);
  });

  it('when a colour covers less than 0.05 %, should discard it and report the share', () => {
    // given: 9900 app pixels, so the floor is 4.95 px
    // when: a 2×2 block covers 4 px (0.0404 %)
    // then: it is not a family and the discarded share reports it
    const measurement = measured(
      blockPng(100, 100, [{ x0: 20, x1: 22, y0: 20, y1: 22, colour: [0, 255, 255] }])
    );
    expect(measurement.families.map((family) => family.colour)).not.toContain('#00ffff');
    expect(measurement.discardedShare).toBeCloseTo(0.0404, 4);
  });
});

describe('Scenario: render — rounded chroma sits on the neutral line', () => {
  it('when a family’s rounded chroma is exactly 0.035, should count it as chromatic', () => {
    // given: #000109 measures chroma 0.034975, which rounds to 0.035
    // when: the palette is measured
    // then: distinctChromatic counts it and neutralShare does NOT
    const measurement = measured(
      blockPng(100, 100, [{ x0: 20, x1: 30, y0: 20, y1: 30, colour: [0, 1, 9] }])
    );
    const family = measurement.families.find((entry) => entry.colour === '#000109');
    expect(family?.chroma).toBe(0.035);
    expect(measurement.distinctChromatic).toBe(1);
    expect(measurement.neutralShare).toBeCloseTo(98.9899, 4);
  });

  it('when a family is neutral, should count its share as neutral and not chromatic', () => {
    // given: the monochrome dark background family (chroma 0)
    // when: the palette is measured
    // then: distinctChromatic is 0 and neutralShare is 100
    const measurement = measured(blockPng(100, 100, [], BACKGROUND));
    expect(measurement.distinctChromatic).toBe(0);
    expect(measurement.neutralShare).toBe(100);
  });
});

describe('Scenario: integration — an unreadable frame is a reason, never an empty success', () => {
  it('when the bytes are not a PNG, should return the decoder’s own reason', () => {
    // given: bytes without a PNG signature
    // when: the palette reader runs
    // then: the refusal carries the decoder reason, not a generic message
    expect(measurePalette(Buffer.from('not a png'))).toEqual({
      ok: false,
      reason: 'a missing PNG signature'
    });
  });

  it('when every pixel is masked, should refuse the measurement by name', () => {
    // given: a 1×1 frame whose single pixel is the excluded top strip
    // when: the palette is measured
    // then: the app area is empty and the reason says so
    expect(measurePalette(blockPng(1, 1, [], BACKGROUND))).toEqual({
      ok: false,
      reason: 'every pixel was masked as non-app'
    });
  });
});

describe('Scenario: a11y — the floor appears in the report wording', () => {
  it('when a below-floor capture is measured, should still report the measured numbers', () => {
    // given: the four-pixel cyan frame
    // when: its discarded share is read
    // then: the share is the measured remainder, not a silent zero
    const measurement = measured(
      blockPng(100, 100, [{ x0: 20, x1: 22, y0: 20, y1: 22, colour: [0, 255, 255] }])
    );
    expect(measurement.discardedShare).toBeGreaterThan(0);
    expect(measurement.discardedShare).toBeLessThan(0.05);
  });
});
