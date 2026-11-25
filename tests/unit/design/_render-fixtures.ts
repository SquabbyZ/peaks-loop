/**
 * Synthetic captured frames for the S8 render tests.
 *
 * Every image is a real 8-bit RGB PNG assembled from a pixel function, through
 * the same encoder `paint-metric` tests use (`_png-bytes.ts`) — no image
 * library, no browser, and the decoder is driven from bytes exactly as it is in
 * production. The block geometry is chosen so the measured area shares are
 * exact under the S8 mask (the top device row is excluded; nothing sits in the
 * devtools corners and no block forms a toast-like top band except the fixture
 * that is meant to).
 */

import { rgbPng, type Pixel } from './_png-bytes.js';

/** Fixture side in device pixels; 100×100 keeps area shares easy to read. */
export const FIXTURE_SIDE = 100;

/**
 * The per-test budget these files set for themselves.
 *
 * Stryker's vitest-runner dry run gives every test a 5 s timeout (its own
 * config, not this repo's 30 s). The first test in a freshly instrumented
 * worker pays the module/codec cold start, which was measured crossing 5 s in
 * the S8 mutation run while the test body itself takes milliseconds. 30 s is
 * this repo's own per-test budget (see `vitest.config.ts`), so the mutation
 * harness gets the same allowance as a normal run — this is a hang detector,
 * never an assertion about how long the work should take.
 */
export const RENDER_TEST_TIMEOUT_MS = 30_000;

type Rgb = readonly [number, number, number];

const BACKGROUND: Rgb = [30, 30, 30];
const RED: Rgb = [225, 29, 72];
const BLUE: Rgb = [37, 99, 235];
const WHITE: Rgb = [255, 255, 255];
const AMBER: Rgb = [245, 158, 11];
/** The pilot toast body's colour family: a low-chroma red-brown solid block. */
const TOAST: Rgb = [78, 57, 56];

/** Five families with a known split: 6000 neutral, 2000 red, 1000 blue, 600 white, 400 amber. */
export function fiveFamilyPng(): Buffer {
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (x, y): Pixel => {
      if (y >= 20 && y < 40) return RED;
      if (y >= 40 && y < 50) return BLUE;
      if (y >= 50 && y < 56) return WHITE;
      if (y >= 56 && y < 60) return AMBER;
      return BACKGROUND;
    }
  });
}

/** The five-family frame plus a solid toast-like block in its top band. */
export function sixFamilyWithToastPng(): Buffer {
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (x, y): Pixel => {
      if (y >= 2 && y < 9 && x >= 10 && x < 90) return TOAST;
      if (y >= 20 && y < 40) return RED;
      if (y >= 40 && y < 50) return BLUE;
      if (y >= 50 && y < 56) return WHITE;
      if (y >= 56 && y < 60) return AMBER;
      return BACKGROUND;
    }
  });
}

/** One neutral only: the near-monochrome frame. */
export function monochromePng(): Buffer {
  return rgbPng({ width: FIXTURE_SIDE, height: FIXTURE_SIDE, pixel: (): Pixel => BACKGROUND });
}

/**
 * Three shades of ONE hue (red): dark `#991b1b`, mid `#c81e1e`, light `#f87171`.
 * They are ΔE 0.10–0.27 apart, so the merge keeps three families, and all three
 * fall in the same 30° hue bucket a single declared red token names.
 */
export function threeShadePng(): Buffer {
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (_x, y): Pixel => {
      if (y >= 20 && y < 35) return [153, 27, 27];
      if (y >= 35 && y < 50) return [200, 30, 30];
      if (y >= 50 && y < 60) return [248, 113, 113];
      return BACKGROUND;
    }
  });
}

/** A horizontal sRGB gradient: many raw colours, few visible steps. */
export function gradientPng(): Buffer {
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (x): Pixel => [Math.round((x * 255) / (FIXTURE_SIDE - 1)), 30, 30]
  });
}

/**
 * A 100×100 frame whose TOP DEVICE ROW is a different dark grey (`#3c3c3c`,
 * ΔE 0.0284 from the toast cell `#4c3c3c`) above a real toast block. Task 5
 * measured this shape on `/channels`: without excluding the masked top strip,
 * that row becomes the longest run and the toast survives as extra families.
 */
export function toastWithGreyTopPng(): Buffer {
  const grey: Rgb = [60, 60, 60];
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (x, y): Pixel => {
      if (y === 0) return grey;
      if (y >= 2 && y < 9 && x >= 10 && x < 90) return TOAST;
      if (y >= 20 && y < 40) return RED;
      if (y >= 40 && y < 50) return BLUE;
      if (y >= 50 && y < 56) return WHITE;
      if (y >= 56 && y < 60) return AMBER;
      return BACKGROUND;
    }
  });
}

/**
 * A frame whose only non-background colour covers 2 of 9,900 app pixels
 * (0.0202 %): below the 0.05 % family floor, so it must be discarded, never
 * listed as a family.
 */
export function subFloorPng(): Buffer {
  const cyan: Rgb = [0, 255, 255];
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (x, y): Pixel => (y === 50 && (x === 1 || x === 2) ? cyan : BACKGROUND)
  });
}

/**
 * A smooth grey gradient background with a white 30 % block and a small
 * `#111111` block: both declared pair colours are present while the pixels
 * classify the background as `gradient`.
 */
export function gradientPairPng(): Buffer {
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (x, y): Pixel => {
      if (x >= 70) return WHITE;
      if (y >= 90 && y < 95 && x < 10) return [17, 17, 17];
      const value = Math.round((x * 0x7a) / (FIXTURE_SIDE - 31));
      return [value, value, value];
    }
  });
}

/** One flat background with a 40×20 colour block (8.08 % of app pixels). */
export function renderedPairPng(background: Rgb, block: Rgb): Buffer {
  return rgbPng({
    width: FIXTURE_SIDE,
    height: FIXTURE_SIDE,
    pixel: (x, y): Pixel => (y >= 40 && y < 60 && x >= 30 && x < 70 ? block : background)
  });
}

/** A white frame whose 8.08 % block is `renderedFail` (declared `declaredPass`). */
export function renderedFailPng(): Buffer {
  return renderedPairPng([255, 255, 255], [122, 122, 122]);
}

/** A white frame whose block is the declared ink: the pair really renders. */
export function renderedPassPng(): Buffer {
  return renderedPairPng([255, 255, 255], [17, 17, 17]);
}

/** A low-contrast pair that fails before and after rendering (calibration bad arm). */
export function lowPairPng(): Buffer {
  return renderedPairPng([119, 119, 119], [136, 136, 136]);
}
