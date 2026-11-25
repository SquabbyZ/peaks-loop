import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  MAX_MERGE_FAMILIES,
  measureCells,
  rankOf,
  type Accumulated
} from '../../../src/services/design/audit/render/palette-cells.js';
import { measurePalette } from '../../../src/services/design/audit/render/palette-measure.js';
import type * as colorOklch from '../../../src/services/design/audit/color-oklch.js';
import {
  deltaE,
  oklabOfHex,
  oklabOfRgb,
  type Oklab
} from '../../../src/services/design/audit/color-oklch.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { decodeFrame } from './_render-frames.js';
import { rgbPng } from './_png-bytes.js';

/** Counts every nearest-family comparison the merge makes, without changing it. */
const deltaECalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../../src/services/design/audit/color-oklch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof colorOklch>();
  return {
    ...actual,
    deltaE: (...args: Parameters<typeof actual.deltaE>) => {
      deltaECalls.count += 1;
      return actual.deltaE(...args);
    }
  };
});

declareDimensions('tests/unit/design/palette-cells-grid.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

function cellsOf(png: Buffer, width: number, height: number) {
  return measureCells(decodeFrame(png), new Uint8Array(width * height));
}

function pairPng(width: number, height: number, left: readonly number[], right: readonly number[]) {
  return rgbPng({
    width,
    height,
    pixel: (x) => (x < width / 2 ? left : right) as readonly [number, number, number]
  });
}

function familyOf(input: { weight: number; chromaHex: string; weightMax?: number }): Accumulated {
  const lab = oklabOfHex(input.chromaHex) ?? { lightness: 0, a: 0, b: 0 };
  const colour = input.chromaHex;
  return { count: 10, weight: input.weight, red: 0, green: 0, blue: 0, lab, hex: colour };
}

/** A 17-step sRGB lattice: dense enough to hold 262 colours ≥ 0.06 apart. */
const PACK_LEVELS = Array.from({ length: 16 }, (_, index) => index * 17);
/** Above the 0.05 merge threshold, so the merge must keep every picked colour. */
const PACK_MIN_DELTA_E = 0.06;

/** Colours each at least PACK_MIN_DELTA_E from every other, chosen greedily. */
function farColours(): Array<readonly [number, number, number]> {
  const kept: Array<{ rgb: readonly [number, number, number]; lab: Oklab }> = [];
  for (const red of PACK_LEVELS) {
    for (const green of PACK_LEVELS) {
      for (const blue of PACK_LEVELS) {
        const lab = oklabOfRgb(red, green, blue);
        if (kept.every((other) => deltaE(other.lab, lab) >= PACK_MIN_DELTA_E)) {
          kept.push({ rgb: [red, green, blue], lab });
        }
      }
    }
  }
  return kept.map((entry) => entry.rgb);
}

function hexOfRgb(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** One pixel per colour, one row, so every cell has count 1 and no edges merge. */
function onePixelEach(colours: readonly (readonly [number, number, number])[]): Accumulated[] {
  const pixels = Buffer.alloc(colours.length * 3);
  colours.forEach((rgb, index) => {
    pixels[index * 3] = rgb[0];
    pixels[index * 3 + 1] = rgb[1];
    pixels[index * 3 + 2] = rgb[2];
  });
  return measureCells(
    { pixels, width: colours.length, height: 1, bpp: 3 },
    new Uint8Array(colours.length)
  );
}

/** The capped fixture's 400 rows: row 0 masked, 340 colour rows, a modal tail. */
const CAPPED_HEIGHT = 400;
const CAPPED_COLOUR_ROWS = 340;

/**
 * The colours repeated down 340 app rows, over a tail painted the first colour
 * (so the tail merges into that family and only the cap can drop cells).
 */
function cappedPalettePng(colours: readonly (readonly [number, number, number])[]): Buffer {
  const fallback: readonly [number, number, number] = [0, 0, 0];
  return rgbPng({
    width: colours.length,
    height: CAPPED_HEIGHT,
    pixel: (x, y) =>
      y >= 1 && y <= CAPPED_COLOUR_ROWS ? (colours[x] ?? fallback) : (colours[0] ?? fallback)
  });
}

describe('Scenario: render — one OKLab grid cell is one family', () => {
  it('when two colours differ by one blue step, should merge them into one mean family', () => {
    // given: 16 px of #c82828 (200,40,40) and 16 px of (200,40,41)
    // when: the cells are measured
    // then: one family with the 32-pixel weighted mean #c82829
    const cells = cellsOf(pairPng(8, 4, [200, 40, 40], [200, 40, 41]), 8, 4);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ count: 32, weight: 32, hex: '#c82829' });
  });

  it('when two colours are far apart in hue, should keep them as two families', () => {
    // given: #c82828 red and #2828c8 blue
    // when: the cells are measured
    // then: two families, each with its own representative
    const cells = cellsOf(pairPng(8, 4, [200, 40, 40], [40, 40, 200]), 8, 4);
    expect(cells.map((cell) => cell.hex)).toEqual(['#2828c8', '#c82828']);
  });

  it('when two grid cells merge, should add both weights rather than subtract them', () => {
    // given: #202020 and #262626 (ΔE 0.0265, adjacent grid cells)
    // when: the cells are merged
    // then: count and weight are 32 each, the sum of the two blocks
    const cells = cellsOf(pairPng(8, 4, [32, 32, 32], [38, 38, 38]), 8, 4);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ count: 32, weight: 32, hex: '#232323' });
  });
});

describe('Scenario: behavior — an edge pixel is weighted 0.25 past the 24 step', () => {
  it('when a vertical boundary is exactly 24, should keep full weight', () => {
    // given: two 20×40 fields differing by 24
    // when: the cells are measured
    // then: both families weigh 800 (no edge discount)
    const cells = cellsOf(pairPng(40, 40, [10, 10, 10], [34, 34, 34]), 40, 40);
    expect(cells.map((cell) => [cell.hex, cell.weight])).toEqual([
      ['#0a0a0a', 800],
      ['#222222', 800]
    ]);
  });

  it('when a vertical boundary is 25, should discount the touching column', () => {
    // given: two 20×40 fields differing by 25
    // when: the cells are measured
    // then: the left family weighs 770 (40 edge pixels at quarter weight)
    const cells = cellsOf(pairPng(40, 40, [10, 10, 10], [35, 35, 35]), 40, 40);
    expect(cells.map((cell) => [cell.hex, cell.weight])).toEqual([
      ['#0a0a0a', 770],
      ['#232323', 800]
    ]);
  });

  it('when a horizontal boundary is 25, should discount the touching row', () => {
    // given: a top half #0a0a0a and a bottom half #232323
    // when: the cells are measured
    // then: the top family weighs 770 and the bottom keeps 800
    const png = rgbPng({
      width: 40,
      height: 40,
      pixel: (x, y) => (y < 20 ? [10, 10, 10] : [35, 35, 35])
    });
    expect(cellsOf(png, 40, 40).map((cell) => [cell.hex, cell.weight])).toEqual([
      ['#0a0a0a', 770],
      ['#232323', 800]
    ]);
  });
});

describe('Scenario: integration — the cell list is ordered by count then colour', () => {
  it('when two families have equal counts, should order them by hex', () => {
    // given: 16 px #c82828 and 16 px #2828c8
    // when: the cells are sorted
    // then: the blue hex sorts before the red one
    const cells = cellsOf(pairPng(8, 4, [200, 40, 40], [40, 40, 200]), 8, 4);
    expect(cells.map((cell) => cell.hex)).toEqual(['#2828c8', '#c82828']);
  });

  it('when counts differ, should put the larger family first regardless of colour', () => {
    // given: a 3-row red block (24 px) and a 1-row blue block (8 px)
    // when: the cells are sorted
    // then: red (count 24) leads blue (count 8)
    const png = rgbPng({
      width: 8,
      height: 4,
      pixel: (_x, y) => (y < 3 ? [200, 40, 40] : [40, 40, 200])
    });
    expect(cellsOf(png, 8, 4).map((cell) => [cell.hex, cell.count])).toEqual([
      ['#c82828', 24],
      ['#2828c8', 8]
    ]);
  });
});

describe('Scenario: integration — past the family cap, a far cell is never folded', () => {
  it('when more colours than the cap are all far apart, should cap without blending', () => {
    // given: 262 painted colours, each ΔE ≥ 0.06 from every other (merge is 0.05)
    // when: the cells are measured with the family list past MAX_MERGE_FAMILIES
    // then: the cap keeps genuine 1-pixel families, never a blend of far colours
    const colours = farColours();
    expect(colours.length).toBeGreaterThan(MAX_MERGE_FAMILIES);
    const cells = onePixelEach(colours);
    const painted = new Set(colours.map(hexOfRgb));
    expect(cells).toHaveLength(MAX_MERGE_FAMILIES);
    expect(cells.every((cell) => cell.count === 1)).toBe(true);
    expect(cells.every((cell) => painted.has(cell.hex))).toBe(true);
  });
});

describe('Scenario: integration — past the cap, the merge scans no family', () => {
  it('when a cell arrives past the cap, should add no nearest-family comparison', () => {
    // given: the far-apart colours with the exact cap kept and with the tail past it
    // when: each set is merged and every deltaE comparison is counted
    // then: the cells past the cap add zero comparisons, so none is scanned for
    const colours = farColours();
    const atCap = colours.slice(0, MAX_MERGE_FAMILIES);
    expect(colours.length).toBeGreaterThan(MAX_MERGE_FAMILIES);

    deltaECalls.count = 0;
    onePixelEach(atCap);
    const atCapCalls = deltaECalls.count;

    deltaECalls.count = 0;
    onePixelEach(colours);
    const pastCapCalls = deltaECalls.count;

    expect(atCapCalls).toBeGreaterThan(0);
    expect(pastCapCalls).toBe(atCapCalls);
  });
});

describe('Scenario: integration — the cap’s dropped cells stay in the measurement', () => {
  it('when the cap drops families, should count their pixels in the discarded share', () => {
    // given: 262 far-apart colours repeated down 340 app rows, over a modal tail
    // when: the palette is measured with the family list past MAX_MERGE_FAMILIES
    // then: appPixels is the unmasked count and the dropped pixels show as discarded
    const colours = farColours();
    expect(colours.length).toBeGreaterThan(MAX_MERGE_FAMILIES);
    const read = measurePalette(cappedPalettePng(colours));
    if (!read.ok) throw new Error(`fixture refused: ${read.reason}`);
    const { measurement } = read;
    expect(measurement.families).toHaveLength(MAX_MERGE_FAMILIES);
    expect(measurement.appPixels).toBe(colours.length * (CAPPED_HEIGHT - 1));
    const droppedPixels = (colours.length - MAX_MERGE_FAMILIES) * CAPPED_COLOUR_ROWS;
    expect(measurement.discardedShare).toBeCloseTo(
      (droppedPixels / measurement.appPixels) * 100,
      1
    );
  });
});

describe('Scenario: a11y — rank is the article’s 0.3 area / 0.7 chroma shape', () => {
  it('when the max weight is zero, should keep the area term at zero', () => {
    // given: a family and a maxWeight of 0
    // when: rank is computed
    // then: the area term is 0, not NaN, and chroma alone gives 0.7
    const lab = oklabOfHex('#e11d48');
    if (lab === null) throw new Error('fixture colour is not a hex');
    expect(rankOf(familyOf({ weight: 0, chromaHex: '#e11d48' }), 0, Math.hypot(lab.a, lab.b))).toBe(
      0.7
    );
  });

  it('when the max chroma is unmeasurable, should keep the chroma term at zero', () => {
    // given: a family with chroma 0.3 and maxChroma below 0.0001
    // when: rank is computed
    // then: only the area term remains (0.3)
    expect(rankOf(familyOf({ weight: 10, chromaHex: '#e11d48' }), 10, 0.00005)).toBe(0.3);
  });

  it('when the max chroma is exactly the measurable floor, should divide by it', () => {
    // given: maxChroma exactly 0.0001, which IS measurable
    // when: rank is computed
    // then: the chroma term is not zeroed, so the rank is far above the area term
    expect(rankOf(familyOf({ weight: 10, chromaHex: '#e11d48' }), 10, 0.0001)).toBeGreaterThan(1);
  });

  it('when both terms apply, should weigh area 0.3 and chroma 0.7', () => {
    // given: a full-weight family whose chroma is also the maximum
    // when: rank is computed
    // then: 0.3 × 1 + 0.7 × 1 = 1
    const lab = oklabOfHex('#e11d48');
    if (lab === null) throw new Error('fixture colour is not a hex');
    expect(rankOf(familyOf({ weight: 5, chromaHex: '#e11d48' }), 5, Math.hypot(lab.a, lab.b))).toBe(
      1
    );
  });
});
