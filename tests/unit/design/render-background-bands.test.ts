import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { classifyBackground } from '../../../src/services/design/audit/render/render-background.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { decodeFrame, stepFrame, steps } from './_render-frames.js';
import { rgbPng } from './_png-bytes.js';

declareDimensions('tests/unit/design/render-background-bands.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

const SMOOTH = 3;
const ROUGH = 50;

function classify(width: number, height: number, pattern: readonly number[]): string {
  return classifyBackground(
    decodeFrame(stepFrame(width, height, pattern)),
    new Uint8Array(width * height)
  );
}

describe('Scenario: render — the solid band is inclusive at exactly 90 %', () => {
  it('when 18 of 20 anchors are flat, should classify the frame as solid', () => {
    // given: an 80×64 frame (5×4 = 20 anchors) with 18 flat and 2 rough
    // when: the background is classified
    // then: 18/20 = 0.90 meets the solid floor exactly
    const mask = new Uint8Array(80 * 64);
    expect(
      classifyBackground(
        decodeFrame(stepFrame(80, 64, [...steps(18, 0), ...steps(2, ROUGH)])),
        mask
      )
    ).toBe('solid');
  });

  it('when 17 of 20 anchors are flat, should not call the frame solid', () => {
    // given: the same 20-anchor grid with 17 flat and 3 rough
    // when: the background is classified
    // then: 0.85 is below the solid floor and the mixed frame is unknown
    const mask = new Uint8Array(80 * 64);
    expect(
      classifyBackground(
        decodeFrame(stepFrame(80, 64, [...steps(17, 0), ...steps(3, ROUGH)])),
        mask
      )
    ).toBe('unknown');
  });
});

describe('Scenario: behavior — the gradient band reads both shares inclusively', () => {
  it('when smooth is exactly half, should classify the frame as gradient', () => {
    // given: a 96×64 frame (6×4 = 24 anchors) with 12 smooth, 5 rough, 7 flat
    // when: the background is classified
    // then: smooth/total = 0.50 meets the gradient floor
    const mask = new Uint8Array(96 * 64);
    expect(
      classifyBackground(
        decodeFrame(stepFrame(96, 64, [...steps(7, 0), ...steps(12, SMOOTH), ...steps(5, ROUGH)])),
        mask
      )
    ).toBe('gradient');
  });

  it('when rough is exactly 40 %, should classify the frame as image', () => {
    // given: an 80×80 frame (5×5 = 25 anchors) with 10 rough, 13 smooth, 2 flat
    // when: the background is classified
    // then: rough/total = 0.40 is not BELOW the image floor, so it is image
    const mask = new Uint8Array(80 * 80);
    expect(
      classifyBackground(
        decodeFrame(stepFrame(80, 80, [...steps(2, 0), ...steps(13, SMOOTH), ...steps(10, ROUGH)])),
        mask
      )
    ).toBe('image');
  });

  it('when a step is exactly the smooth ceiling, should count it as smooth', () => {
    // given: 5 flat + 24 smooth + 19 rough + one step-8 anchor (49 anchors)
    // when: the background is classified
    // then: the step-8 anchor is smooth, so smooth/total = 0.51 and the frame is gradient
    const mask = new Uint8Array(100 * 100);
    const pattern = [...steps(5, 0), ...steps(24, SMOOTH), ...steps(19, ROUGH), 8];
    expect(classifyBackground(decodeFrame(stepFrame(100, 100, pattern)), mask)).toBe('gradient');
  });
});

describe('Scenario: integration — the counts and the mask decide the class', () => {
  it('when flat, smooth and rough are all present, should return unknown', () => {
    // given: 19 flat + 20 smooth + 10 rough anchors
    // when: the background is classified
    // then: no share clears its floor, so no class is guessed
    const mask = new Uint8Array(100 * 100);
    expect(
      classifyBackground(
        decodeFrame(
          stepFrame(100, 100, [...steps(19, 0), ...steps(20, SMOOTH), ...steps(10, ROUGH)])
        ),
        mask
      )
    ).toBe('unknown');
  });

  it('when a strong-step anchor is masked, should not count it at all', () => {
    // given: a rough anchor first, then 44 flat and 4 smooth anchors
    // when: the rough anchor is masked
    // then: 44/48 is solid; an unmasked read would be 44/49 = unknown
    const mask = new Uint8Array(100 * 100);
    mask[0] = 1;
    const pattern = [ROUGH, ...steps(44, 0), ...steps(4, SMOOTH)];
    expect(classifyBackground(decodeFrame(stepFrame(100, 100, pattern)), mask)).toBe('solid');
  });

  it('when every anchor is masked, should return unknown rather than a divide by zero', () => {
    // given: a 16×16 frame whose only anchor is masked
    // when: the background is classified
    // then: total is zero and the answer is unknown
    expect(
      classifyBackground(decodeFrame(stepFrame(16, 16, [0])), new Uint8Array(256).fill(1))
    ).toBe('unknown');
  });
});

describe('Scenario: a11y — neighbour reads stay inside the frame', () => {
  it('when the frame is one flat field, should read solid and not invent rough edges', () => {
    // given: a 100×100 frame painted one colour (49 flat anchors)
    // when: the background is classified
    // then: every anchor is flat, so the frame is solid
    expect(classify(100, 100, steps(49, 0))).toBe('solid');
  });

  it('when the last anchor sits at the right/bottom edge, should still read solid', () => {
    // given: a 97×97 frame (7×7 anchors, last anchor at x=y=96, edge at 97)
    // when: the background is classified
    // then: an out-of-bounds neighbour is not read as a colour step
    expect(classify(97, 97, steps(49, 0))).toBe('solid');
  });

  it('when a mixed frame gains the edge anchors, should stay image, not collapse to unknown', () => {
    // given: 29 flat and 20 rough anchors (20/49 = 0.408 image)
    // when: the classifier samples the grid
    // then: the image class holds; extra flat anchors would drop rough below 0.40
    expect(classify(100, 100, [...steps(29, 0), ...steps(20, ROUGH)])).toBe('image');
  });

  it('when the last sampled column is dark, should not read the next row as its neighbour', () => {
    // given: a 97×97 bright field whose last column is dark, so the last anchor is flat
    // when: the classifier samples the grid
    // then: a wrapped right-neighbour read would turn seven anchors rough
    const png = rgbPng({
      width: 97,
      height: 97,
      pixel: (x) => (x === 96 ? [10, 10, 10] : [200, 200, 200])
    });
    expect(classifyBackground(decodeFrame(png), new Uint8Array(97 * 97))).toBe('solid');
  });

  it('when the last sampled row is dark, should not read past the frame as its neighbour', () => {
    // given: a 97×97 bright field whose last row is dark
    // when: the classifier samples the grid
    // then: a wrapped lower-neighbour read would turn seven anchors rough
    const png = rgbPng({
      width: 97,
      height: 97,
      pixel: (_x, y) => (y === 96 ? [10, 10, 10] : [200, 200, 200])
    });
    expect(classifyBackground(decodeFrame(png), new Uint8Array(97 * 97))).toBe('solid');
  });
});
