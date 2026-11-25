/**
 * The devtools-corner mask (S8 close-out B), split from `render-mask.ts` to
 * keep both passes under the module ceiling.
 *
 * The regions come from the spike's MEASURED bboxes on a 2560×1600 frame:
 * launcher 24..119 x (0..0.0465), 1480..1575 y (0.925..0.9844) and badge
 * 2252..2543 x (0.8797..0.9934), 1524..1583 y (0.9525..0.9894), plus a ~0.8 %
 * margin. The old right edge `x0: 0.94` was narrower than the measured badge
 * start (0.8797), so it cut the badge in half.
 *
 * Inside each region the module measures the dominant non-modal colour family
 * and masks ONLY pixels that match it, never a rectangle. An ordinary page
 * corner survives, and a footer whose colour differs from that family is not
 * masked. A dominant family larger than `CORNER_MAX_FAMILY_FRACTION` is page
 * content, not chrome, so nothing is masked: under-masking a chrome badge is
 * recoverable, eating the page's own footer is not. (A footer that paints the
 * exact measured devtools family cannot be separated by colour alone; the
 * reported corner share makes that residual visible.)
 */

import {
  deltaE,
  oklabOfRgb,
  oklabOfRgbInto,
  type MutableOklab,
  type Oklab
} from '../color-oklch.js';
import {
  blueOf,
  greenOf,
  makeFamilyTest,
  packedKeyOf,
  redOf,
  rgbKeyAt,
  unpackKey
} from './render-pixels.js';

export type CornerFrame = {
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
  readonly bpp: number;
};

type Corner = {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
};

const CORNER_LEFT = { x0: 0, x1: 0.055, y0: 0.915, y1: 1 } as const;
const CORNER_RIGHT = { x0: 0.874, x1: 0.999, y0: 0.947, y1: 1 } as const;
/** A corner pixel is devtools candidate paint when it differs from the modal background. */
const CORNER_MODAL_DELTA_E = 0.12;
/** The family's own tightness when the second pass decides a pixel matches. */
const CORNER_FAMILY_DELTA_E = 0.03;
/** Devtools painted 0.30 % of the frame; a larger family is page content. */
const CORNER_MAX_FAMILY_FRACTION = 0.004;

/**
 * Mask the devtools paint inside one corner region; return the pixels removed.
 * Two passes: count the non-modal 5-bit families, then mask matches of the
 * dominant one (subject to the page-content bound).
 */
// eslint-disable-next-line complexity -- two measured passes (count, then mask).
function maskCorner(frame: CornerFrame, corner: Corner, modal: Oklab, mask: Uint8Array): number {
  const { width, height, bpp, pixels } = frame;
  const x0 = Math.floor(width * corner.x0);
  const x1 = Math.ceil(width * corner.x1);
  const y0 = Math.floor(height * corner.y0);
  const y1 = Math.ceil(height * corner.y1);
  const scratch: MutableOklab = { lightness: 0, a: 0, b: 0 };
  const counts = new Map<number, number>();
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * width + x;
      if (mask[index] === 1) continue;
      const rgb = rgbKeyAt(pixels, index * bpp);
      oklabOfRgbInto(redOf(rgb), greenOf(rgb), blueOf(rgb), scratch);
      if (deltaE(scratch, modal) <= CORNER_MODAL_DELTA_E) continue;
      const key = packedKeyOf(redOf(rgb), greenOf(rgb), blueOf(rgb));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let familyKey = -1;
  let familyCount = 0;
  for (const [key, count] of counts) {
    if (count > familyCount) {
      familyKey = key;
      familyCount = count;
    }
  }
  if (familyKey < 0) return 0;
  if (familyCount > width * height * CORNER_MAX_FAMILY_FRACTION) return 0;
  const representative = unpackKey(familyKey);
  const isFamily = makeFamilyTest(
    oklabOfRgb(redOf(representative), greenOf(representative), blueOf(representative)),
    CORNER_FAMILY_DELTA_E
  );
  let removed = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * width + x;
      if (mask[index] === 1) continue;
      if (!isFamily(rgbKeyAt(pixels, index * bpp))) continue;
      mask[index] = 1;
      removed += 1;
    }
  }
  return removed;
}

/** Mask both devtools corners; return the total pixels removed. */
export function maskCorners(frame: CornerFrame, modal: Oklab, mask: Uint8Array): number {
  return [CORNER_LEFT, CORNER_RIGHT].reduce(
    (sum, corner) => sum + maskCorner(frame, corner, modal, mask),
    0
  );
}
