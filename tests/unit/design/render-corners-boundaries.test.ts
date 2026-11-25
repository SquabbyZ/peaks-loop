import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { maskCorners } from '../../../src/services/design/audit/render/render-corners.js';
import { oklabOfRgb } from '../../../src/services/design/audit/color-oklch.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { BACKGROUND, CHROME, blockPng, decodeFrame } from './_render-frames.js';

declareDimensions('tests/unit/design/render-corners-boundaries.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

const MODAL = oklabOfRgb(...BACKGROUND);

function cornerResult(png: Buffer, modal = MODAL) {
  const frame = decodeFrame(png);
  const mask = new Uint8Array(frame.width * frame.height);
  const removed = maskCorners(frame, modal, mask);
  const bit = (x: number, y: number): number => mask[y * frame.width + x] ?? -1;
  return { removed, bit, mask };
}

/** A right-corner block and nothing else. */
function rightBlock(x0: number, x1: number, y0: number, y1: number) {
  return blockPng(100, 100, [{ x0, x1, y0, y1, colour: CHROME }]);
}

describe('Scenario: render — the corner family must be under the page-content bound', () => {
  it('when the family is exactly 40 pixels, should mask it', () => {
    // given: 40 corner pixels (0.004 × 100 × 100 exactly)
    // when: the corners are masked
    // then: the bound is >, so 40 is still devtools chrome
    expect(cornerResult(rightBlock(87, 95, 95, 100)).removed).toBe(40);
  });

  it('when the family is 48 pixels, should treat it as page content', () => {
    // given: 48 corner pixels above the 40-pixel bound
    // when: the corners are masked
    // then: nothing is removed
    expect(cornerResult(rightBlock(87, 95, 94, 100)).removed).toBe(0);
  });
});

describe('Scenario: behavior — the corner bboxes start where the spike measured', () => {
  it('when a right-corner block starts at x = 86, should leave it alone', () => {
    // given: a column just left of the measured x0 = 87
    // when: the corners are masked
    // then: nothing is removed
    expect(cornerResult(rightBlock(86, 87, 95, 100)).removed).toBe(0);
  });

  it('when a right-corner block starts at x = 87, should mask it', () => {
    // given: a column at the measured x0
    // when: the corners are masked
    // then: all five pixels are removed
    expect(cornerResult(rightBlock(87, 88, 95, 100)).removed).toBe(5);
  });

  it('when a right-corner block ends at y = 93, should leave it alone', () => {
    // given: a row just above the measured y0 = 94
    // when: the corners are masked
    // then: nothing is removed
    expect(cornerResult(rightBlock(87, 95, 93, 94)).removed).toBe(0);
  });

  it('when a right-corner block starts at y = 94, should mask it', () => {
    // given: a row at the measured y0
    // when: the corners are masked
    // then: all eight pixels are removed
    expect(cornerResult(rightBlock(87, 95, 94, 95)).removed).toBe(8);
  });

  it('when a left-corner block sits at x = 5, should mask it', () => {
    // given: the last column inside the left bbox (x1 = ceil(0.055 × 100) = 6)
    // when: the corners are masked
    // then: all nine pixels are removed
    expect(cornerResult(rightBlock(5, 6, 91, 100)).removed).toBe(9);
  });

  it('when a left-corner block starts at x = 6, should leave it alone', () => {
    // given: the first column outside the left bbox
    // when: the corners are masked
    // then: nothing is removed
    expect(cornerResult(rightBlock(6, 7, 91, 100)).removed).toBe(0);
  });

  it('when a left-corner block ends at y = 90, should leave it alone', () => {
    // given: a row just above floor(0.915 × 100) = 91
    // when: the corners are masked
    // then: nothing is removed
    expect(cornerResult(rightBlock(0, 6, 90, 91)).removed).toBe(0);
  });

  it('when a left-corner block starts at y = 91, should mask it', () => {
    // given: the first row inside the left bbox
    // when: the corners are masked
    // then: all six pixels are removed
    expect(cornerResult(rightBlock(0, 6, 91, 92)).removed).toBe(6);
  });
});

describe('Scenario: integration — only the dominant non-modal family is masked', () => {
  it('when a differently coloured footer shares the corner, should leave it unmasked', () => {
    // given: a 40-pixel chrome block and a 20-pixel red footer in the same corner
    // when: the corners are masked
    // then: only the chrome family is removed
    const result = cornerResult(
      blockPng(100, 100, [
        { x0: 87, x1: 95, y0: 95, y1: 100, colour: CHROME },
        { x0: 95, x1: 100, y0: 95, y1: 99, colour: [220, 40, 40] }
      ])
    );
    expect(result.removed).toBe(40);
    expect(result.bit(97, 96)).toBe(0);
  });

  it('when two families tie, should mask the first one encountered', () => {
    // given: five grey pixels (row 95) and five red pixels (row 96), equal counts
    // when: the corners are masked
    // then: the first family wins and the red family is untouched
    const result = cornerResult(
      blockPng(100, 100, [
        { x0: 87, x1: 92, y0: 95, y1: 96, colour: CHROME },
        { x0: 87, x1: 92, y0: 96, y1: 97, colour: [220, 40, 40] }
      ])
    );
    expect(result.removed).toBe(5);
    expect(result.bit(89, 95)).toBe(1);
    expect(result.bit(89, 96)).toBe(0);
  });

  it('when a pixel was already masked, should not count or remask it', () => {
    // given: the 40-pixel chrome block with one pixel pre-masked
    // when: the corners are masked
    // then: only the other 39 pixels are removed
    const png = rightBlock(87, 95, 95, 100);
    const frame = decodeFrame(png);
    const mask = new Uint8Array(frame.width * frame.height);
    mask[95 * 100 + 90] = 1;
    expect(maskCorners(frame, MODAL, mask)).toBe(39);
  });

  it('when the region holds only modal pixels, should return zero', () => {
    // given: a frame painted entirely in the modal colour
    // when: the corners are masked
    // then: no family exists and nothing is removed
    const png = blockPng(100, 100, [], BACKGROUND);
    expect(cornerResult(png).removed).toBe(0);
  });

  it('when the modal-difference window is switched off, the modal fill must not dominate', () => {
    // given: 20 grey pixels inside a modal-coloured corner
    // when: the corners are masked
    // then: the grey family is dominant and removed; counting the modal fill would reject it
    expect(cornerResult(rightBlock(87, 91, 95, 100)).removed).toBe(20);
  });

  it('when the dominant family has quantised key 0, should still mask it', () => {
    // given: a 40-pixel #040404 block on a white page
    // when: the corners are masked
    // then: key 0 is a real family, not the "no family" sentinel
    const png = blockPng(
      100,
      100,
      [{ x0: 87, x1: 95, y0: 95, y1: 100, colour: [4, 4, 4] }],
      [255, 255, 255]
    );
    expect(cornerResult(png, oklabOfRgb(255, 255, 255)).removed).toBe(40);
  });

  it('when no family was counted, should return before unpacking a sentinel key', () => {
    // given: a frame painted the colour unpackKey(1) resolves to (#000c0c), all modal
    // when: the corners are masked
    // then: nothing is removed; the no-family sentinel is not a key
    const colour: [number, number, number] = [0, 12, 12];
    const png = blockPng(100, 100, [], colour);
    expect(cornerResult(png, oklabOfRgb(...colour)).removed).toBe(0);
  });

  it('when no family was counted and the page is #fcfcfc, should not unpack key -1', () => {
    // given: a frame painted #fcfcfc, which unpackKey(-1) also resolves to
    // when: the corners are masked
    // then: the negative sentinel never becomes a family
    const colour: [number, number, number] = [252, 252, 252];
    const png = blockPng(100, 100, [], colour);
    expect(cornerResult(png, oklabOfRgb(...colour)).removed).toBe(0);
  });
});

describe('Scenario: a11y — a tiny corner block still wins over an out-of-frame read', () => {
  it('when a two-pixel block sits at the left corner edge, should remove exactly two', () => {
    // given: pixels at (5,91) and (5,92), the last left-bbox column
    // when: the corners are masked
    // then: exactly two pixels go; an extra bbox column or row would add black and reject
    expect(cornerResult(rightBlock(5, 6, 91, 93)).removed).toBe(2);
  });

  it('when a two-pixel block sits at the right corner edge, should remove exactly two', () => {
    // given: pixels at (87,94) and (88,94), the first right-bbox row
    // when: the corners are masked
    // then: exactly two pixels go; an out-of-frame row would dominate and remove none
    expect(cornerResult(rightBlock(87, 89, 94, 95)).removed).toBe(2);
  });
});
