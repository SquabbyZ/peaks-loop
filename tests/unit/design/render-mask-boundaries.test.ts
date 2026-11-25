import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { maskNonApp } from '../../../src/services/design/audit/render/render-mask.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { rgbPng } from './_png-bytes.js';
import { BACKGROUND, CHROME, TOAST, blockPng, decodeFrame } from './_render-frames.js';

declareDimensions('tests/unit/design/render-mask-boundaries.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

function maskOf(png: Buffer) {
  return maskNonApp(decodeFrame(png));
}

function toastShare(png: Buffer): number {
  return Number(maskOf(png).components.toast.toFixed(6));
}

function toastBlock(run: number, rows: number, startX = 10, startY = 5) {
  return blockPng(100, 100, [
    { x0: startX, x1: startX + run, y0: startY, y1: startY + rows, colour: TOAST }
  ]);
}

describe('Scenario: render — the top strip is the stated device-row formula', () => {
  it('when the frame is 1000 rows tall, should exclude ceil(2.5) = 3 rows', () => {
    // given: a flat 10×1000 frame
    // when: the mask is built
    // then: 3 rows of 1000 are 0.3 % of the frame
    expect(maskOf(blockPng(10, 1000, [], BACKGROUND)).components.topStrip).toBe(0.3);
  });

  it('when the frame is 1600 rows tall, should cap the strip at 4 rows', () => {
    // given: a flat 10×1600 frame
    // when: the mask is built
    // then: 4 rows of 1600 are 0.25 %
    expect(maskOf(blockPng(10, 1600, [], BACKGROUND)).components.topStrip).toBe(0.25);
  });

  it('when the frame is one row tall, should mask the whole frame and never zero rows', () => {
    // given: a flat 10×1 frame
    // when: the mask is built
    // then: at least one row is excluded, so the strip is the whole frame
    expect(maskOf(blockPng(10, 1, [], BACKGROUND)).components.topStrip).toBe(100);
  });

  it('when the caller supplies topRows, should use it verbatim, including zero', () => {
    // given: a flat 10×100 frame and an explicit topRows of 0
    // when: the mask is built with that option
    // then: no strip is excluded
    const frame = decodeFrame(blockPng(10, 100, [], BACKGROUND));
    expect(maskNonApp(frame, { topRows: 0 }).components.topStrip).toBe(0);
    expect(maskNonApp(frame, { topRows: 3 }).components.topStrip).toBe(3);
  });
});

describe('Scenario: behavior — the toast run is bounded on both sides', () => {
  it('when a run is exactly 15 % of the width, should mask it', () => {
    // given: a 15-pixel run in a 100-pixel frame (15 % exactly)
    // when: the toast band is measured
    // then: the run clears the minimum and the padded box is 1.36 %
    expect(toastShare(toastBlock(15, 5))).toBe(1.36);
  });

  it('when a run is 14 % of the width, should not mask it', () => {
    // given: a 14-pixel run
    // when: the toast band is measured
    // then: it is below the minimum run fraction
    expect(toastShare(toastBlock(14, 5))).toBe(0);
  });

  it('when a run is exactly 95 % of the width, should still mask it', () => {
    // given: a 95-pixel run
    // when: the toast band is measured
    // then: 95 % is not ABOVE the page-wide-row ceiling
    expect(toastShare(toastBlock(95, 5, 0))).toBe(7.68);
  });

  it('when a run is 96 % of the width, should reject it as a page-wide row', () => {
    // given: a 96-pixel run
    // when: the toast band is measured
    // then: it is rejected by the 95 % ceiling
    expect(toastShare(toastBlock(96, 5, 0))).toBe(0);
  });
});

describe('Scenario: integration — the height and area floors are inclusive', () => {
  it('when the block is exactly two rows tall, should accept it', () => {
    // given: a 40×2 block
    // when: the toast band is measured
    // then: two rows meet the minimum height and the padded box is 2.1 %
    expect(toastShare(toastBlock(40, 2))).toBe(2.1);
  });

  it('when the block is one row tall, should reject it', () => {
    // given: a 40×1 block
    // when: the toast band is measured
    // then: one row is below the two-row floor
    expect(toastShare(toastBlock(40, 1))).toBe(0);
  });

  it('when the block area is exactly 0.5 % of the frame, should accept it', () => {
    // given: a 25×2 block (50 px = 0.5 %)
    // when: the toast band is measured
    // then: the inclusive area floor accepts it
    expect(toastShare(toastBlock(25, 2))).toBe(1.35);
  });

  it('when the block area is below 0.5 %, should reject it', () => {
    // given: a 24×2 block (48 px < 0.5 %)
    // when: the toast band is measured
    // then: the area floor rejects it
    expect(toastShare(toastBlock(24, 2))).toBe(0);
  });
});

describe('Scenario: a11y — the toast box is grown and padded by measured amounts', () => {
  it('when a row below the block is exactly half covered, should grow into it', () => {
    // given: a 20×5 block and a 10-pixel row below it (exactly half)
    // when: the padded box is measured
    // then: the box grows one row and the padded share is 1.98 %
    const png = blockPng(100, 100, [
      { x0: 10, x1: 30, y0: 5, y1: 10, colour: TOAST },
      { x0: 10, x1: 20, y0: 10, y1: 11, colour: TOAST },
      { x0: 10, x1: 19, y0: 11, y1: 12, colour: TOAST }
    ]);
    expect(toastShare(png)).toBe(1.98);
  });

  it('when the block starts at the top strip, should pad the box by width and height fractions', () => {
    // given: a 1000×1000 frame with a 700×20 block at (100,10)
    // when: the padded box is measured
    // then: padX = 2 and padBottom = 33 give the exact 3.7312 % share
    const png = blockPng(1000, 1000, [{ x0: 100, x1: 800, y0: 10, y1: 30, colour: TOAST }]);
    expect(toastShare(png)).toBe(3.7312);
  });

  it('when the toast starts at x = 0, should not pad into the previous row', () => {
    // given: a 20-wide run at x = 0
    // when: the mask is built
    // then: the box clamps to 0 and the previous row is untouched
    const result = maskOf(blockPng(100, 100, [{ x0: 0, x1: 20, y0: 5, y1: 10, colour: TOAST }]));
    expect(result.components.toast).toBe(1.68);
    expect(result.mask[4 * 100 + 99]).toBe(0);
    expect(result.mask[5 * 100]).toBe(1);
  });

  it('when the block lies entirely at the band edge, should not search past the band', () => {
    // given: a two-row block starting at row 12 (the 12 % band ends at 12)
    // when: the toast band is measured
    // then: no toast is found
    const png = blockPng(100, 100, [{ x0: 10, x1: 40, y0: 12, y1: 15, colour: TOAST }]);
    expect(toastShare(png)).toBe(0);
  });
});

describe('Scenario: render — ties and candidates are chosen deterministically', () => {
  it('when two rows hold equally long runs, should keep the first row', () => {
    // given: equal 20-pixel runs at rows 5 and 7, with rows 5–9 only under the second
    // when: the toast band is measured
    // then: the first (shorter) row wins and the block fails the height floor
    const png = blockPng(100, 100, [
      { x0: 10, x1: 30, y0: 5, y1: 6, colour: TOAST },
      { x0: 50, x1: 70, y0: 5, y1: 10, colour: TOAST }
    ]);
    expect(toastShare(png)).toBe(0);
  });

  it('when the row below is one pixel short of half, should not grow', () => {
    // given: a 30-pixel run and a row holding only its half boundary at the outside column
    // when: the toast box grows
    // then: the growth test reads the run range only and the one-row block is rejected
    const png = blockPng(100, 100, [
      { x0: 10, x1: 40, y0: 5, y1: 6, colour: TOAST },
      { x0: 26, x1: 41, y0: 6, y1: 7, colour: TOAST }
    ]);
    expect(toastShare(png)).toBe(0);
  });

  it('when a stronger colour sits one row past the band, should still pick the in-band one', () => {
    // given: an in-band 150×2 toast block and a full page-wide row just below the band
    // when: the toast candidate is counted
    // then: the in-band block is chosen and masked (1.232 %)
    const png = blockPng(1000, 50, [
      { x0: 10, x1: 160, y0: 1, y1: 3, colour: TOAST },
      { x0: 0, x1: 1000, y0: 6, y1: 7, colour: CHROME }
    ]);
    expect(toastShare(png)).toBe(1.232);
  });

  it('when the block colour is neutral, should not treat it as a toast body', () => {
    // given: a 40×5 grey block (chroma 0)
    // when: the toast candidate is measured
    // then: it fails the chroma floor and nothing is masked
    const png = blockPng(100, 100, [{ x0: 10, x1: 50, y0: 5, y1: 10, colour: [60, 60, 60] }]);
    expect(toastShare(png)).toBe(0);
  });

  it('when the block sits within the modal-difference window, should not mask it', () => {
    // given: a 40×5 block ΔE 0.05 from the background (chroma 0.021)
    // when: the toast candidate is measured
    // then: it is the background, not a toast body
    const png = blockPng(100, 100, [{ x0: 10, x1: 50, y0: 5, y1: 10, colour: [51, 37, 37] }]);
    expect(toastShare(png)).toBe(0);
  });
});

describe('Scenario: behavior — the modal colour is the first maximum', () => {
  it('when the background and an accent tie, should keep the smaller quantised key', () => {
    // given: 5000 mid-grey and 5000 white pixels, with a mid-grey block in the corner
    // when: the mask is built
    // then: the first maximum (mid-grey) is modal, so the mid-grey block is not masked
    let white = 5000;
    let mid = 5000 - 16;
    const png = blockPngPixels(100, 100, (x, y) => {
      if (x >= 90 && x < 94 && y >= 94 && y < 98) return [96, 96, 96];
      if (white > 0) {
        white -= 1;
        return [255, 255, 255];
      }
      if (mid > 0) {
        mid -= 1;
        return [96, 96, 96];
      }
      return [255, 255, 255];
    });
    expect(maskOf(png).components.corners).toBe(0);
  });

  it('when every exact colour appears once, should not let last-write counts decide the modal', () => {
    // given: a white field with a 4×4 near-black corner block
    // when: the mask is built
    // then: white is modal and the corner block is masked (0.16 %)
    const png = blockPng(
      100,
      100,
      [{ x0: 90, x1: 94, y0: 94, y1: 98, colour: [4, 4, 4] }],
      [255, 255, 255]
    );
    expect(maskOf(png).components.corners).toBe(0.16);
  });

  it('when black is one pixel short of the maximum, should not promote it at the end of the scan', () => {
    // given: 5000 white, 4999 near-black and one grey pixel, black filling the corner
    // when: the mask is built
    // then: white stays modal and the large black corner family is page content
    let white = 5000 - 16;
    let black = 4999;
    let grey = 1;
    const png = blockPngPixels(100, 100, (x, y) => {
      if (x >= 90 && x < 94 && y >= 94 && y < 98) return [255, 255, 255];
      if (white > 0) {
        white -= 1;
        return [255, 255, 255];
      }
      if (black > 0) {
        black -= 1;
        return [4, 4, 4];
      }
      if (grey > 0) {
        grey -= 1;
        return [128, 128, 128];
      }
      return [4, 4, 4];
    });
    expect(maskOf(png).components.corners).toBe(0);
  });
});

/** A frame built from a pixel function, for count-precise fixtures. */
function blockPngPixels(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number]
): Buffer {
  return rgbPng({ width, height, pixel });
}
