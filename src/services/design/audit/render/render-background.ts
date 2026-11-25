/**
 * The frame's background kind, measured from PIXELS (S8 close-out D3).
 *
 * The payload's `gradients[]` went `[]` → two green linear gradients between
 * two runs on the same pages while nothing visibly changed, so it cannot decide
 * whether a rendered pair was measured over a solid fill. This module replaces
 * it with a local band test on the decoded pixels. `palette-measure.ts` calls
 * it once per frame and the contrast rule reads the answer.
 */

import { channelStep } from './render-pixels.js';

export type RenderBackground = 'solid' | 'gradient' | 'image' | 'unknown';

type Frame = {
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
  readonly bpp: number;
};

/** The classifier's sample stride and measured bands. */
const SAMPLE_STRIDE = 16;
const SMOOTH_MAX_STEP = 8;
const FLAT_SHARE_SOLID = 0.9;
const SMOOTH_SHARE_GRADIENT = 0.5;
const ROUGH_SHARE_IMAGE = 0.4;

/**
 * Every 16th app pixel is an anchor; its immediate right and lower neighbours
 * give one step (the stronger of the two). A flat fill (step 0) dominates a
 * solid page; a smooth ramp (1–8, in EITHER direction — a horizontal gradient
 * has a flat lower neighbour) dominating means a gradient; a high-frequency
 * field dominating means an image; anything mixed is `unknown`, which the
 * contrast rule reports as unmeasured.
 */
// eslint-disable-next-line complexity -- the measured band test is three branches.
export function classifyBackground(frame: Frame, mask: Uint8Array): RenderBackground {
  const { pixels, width, height, bpp } = frame;
  let flat = 0;
  let smooth = 0;
  let rough = 0;
  for (let y = 0; y < height; y += SAMPLE_STRIDE) {
    for (let x = 0; x < width; x += SAMPLE_STRIDE) {
      const index = y * width + x;
      if (mask[index] === 1) continue;
      const at = index * bpp;
      let step = 0;
      if (x + 1 < width && mask[index + 1] === 0) {
        step = Math.max(step, channelStep(pixels, at, at + bpp));
      }
      if (y + 1 < height && mask[index + width] === 0) {
        step = Math.max(step, channelStep(pixels, at, at + width * bpp));
      }
      if (step === 0) flat += 1;
      else if (step <= SMOOTH_MAX_STEP) smooth += 1;
      else rough += 1;
    }
  }
  const total = flat + smooth + rough;
  if (total === 0) return 'unknown';
  if (flat / total >= FLAT_SHARE_SOLID) return 'solid';
  if (smooth / total >= SMOOTH_SHARE_GRADIENT && rough / total < ROUGH_SHARE_IMAGE) {
    return 'gradient';
  }
  if (rough / total >= ROUGH_SHARE_IMAGE) return 'image';
  return 'unknown';
}
