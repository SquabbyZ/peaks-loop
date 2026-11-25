/**
 * The non-app mask for a captured frame (S8 Task 2, close-out B/D1).
 *
 * The spike (`rd/s8-spike.md` §5) measured what a Playwright page screenshot
 * contains besides the app: browser chrome 0 % (the capture is page-only), a
 * toast host body + halo ≈ 2.68 %, two devtools corner chrome patches ≈ 0.3 %
 * painted, and an unstable top device-row strip ≈ 0.25 % — ≈ 3.2 % total on the
 * pilot's three frames. This module removes those regions BY MEASUREMENT so a
 * toast shadow never becomes "the app's red family"; it never guesses a pixel
 * rectangle from the contract. The devtools corners live in `render-corners.ts`
 * (cap split); both passes share `render-pixels.ts`.
 *
 *   - TOP STRIP: the top 2 CSS px at DPR 2 (≤ 4 device rows). Its colour changes
 *     between captures and routes, which no browser chrome would, so it is an
 *     overlay edge and is always excluded. The toast search STARTS BELOW it:
 *     `/channels` paints `#3c3c3c` there, ΔE 0.0284 from the toast cell, which
 *     otherwise became the longest run and hid the real toast (D1).
 *   - TOAST BAND: the largest solid non-background block in the top 12 % of the
 *     frame, found as the longest horizontal run of one low-chroma family and
 *     grown to the block's own row extent. A page-wide run is rejected (a
 *     layout row is not a toast), the block must be at least two rows tall, and
 *     its box is padded by the measured shadow extent (0.2 % of the width
 *     sideways, 3.3 % of the height downward).
 *
 * A page that legitimately paints a solid non-background banner in its top 12 %
 * would be read as a toast band; the mask's own share is reported on every
 * measurement, so that cost is visible instead of silent.
 */

/* eslint-disable no-magic-numbers -- the spike's measured pixel geometry, written once; every constant is a fraction of the frame or a stated device-row count. */

import {
  deltaE,
  oklabOfRgb,
  oklabOfRgbInto,
  type MutableOklab,
  type Oklab
} from '../color-oklch.js';
import { maskCorners } from './render-corners.js';
import {
  blueOf,
  greenOf,
  makeFamilyTest,
  MODAL_HISTOGRAM_SIZE,
  packedKeyAt,
  redOf,
  rgbKeyAt,
  unpackKey
} from './render-pixels.js';

export { MODAL_HISTOGRAM_SIZE } from './render-pixels.js';

/** The top strip: 2 CSS px at DPR 2, capped at 4 device rows. */
export const TOP_STRIP_DEVICE_ROWS = 4;
const TOP_STRIP_FRACTION = 0.0025;

/** The toast host lives in the top band; the spike's body rows are 50–153 of 1600. */
const TOAST_BAND_FRACTION = 0.12;
/** A toast body is a large low-chroma block, measurably not the modal background. */
const TOAST_MIN_CHROMA = 0.015;
const TOAST_MODAL_DELTA_E = 0.12;
/** The body family is tight; the halo is masked by the padded bounding box. */
const TOAST_FAMILY_DELTA_E = 0.03;
/** The block must span at least 15 % of the width and 0.5 % of the frame. */
const TOAST_MIN_RUN_FRACTION = 0.15;
const TOAST_MIN_AREA_FRACTION = 0.005;
/** A run this wide is a page-wide row, not a toast block (the pilot is 28 % wide). */
const TOAST_MAX_RUN_FRACTION = 0.95;
/** A toast body is more than one row tall (the pilot body is 115/1600 = 7.2 %). */
const TOAST_MIN_HEIGHT_FRACTION = 0.005;
/** The measured shadow extent, as a fraction of the frame. */
const TOAST_PAD_X_FRACTION = 0.002;
const TOAST_PAD_BOTTOM_FRACTION = 0.033;

/** What the mask removed, in pixels and as a percent of the whole frame. */
export type MaskShare = {
  topStrip: number;
  toast: number;
  corners: number;
};

export type RenderMask = {
  /** 0 = app pixel, 1 = masked non-app pixel; same row-major order as the decode. */
  readonly mask: Uint8Array;
  /** Pixels the mask covers, so a caller can derive the unmasked app count exactly. */
  readonly maskedPixels: number;
  /** Percent of the frame the mask covers. */
  readonly maskShare: number;
  readonly components: MaskShare;
};

/** The decoded frame every helper here reads, bundled so none takes five params. */
export type DecodedFrame = {
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
  readonly bpp: number;
};

/** The frame's single most frequent 5-bit colour, the app background. */
function modalColour(frame: DecodedFrame): number {
  const counts = new Uint32Array(MODAL_HISTOGRAM_SIZE);
  const total = frame.width * frame.height;
  for (let index = 0; index < total; index += 1) {
    const key = packedKeyAt(frame.pixels, index * frame.bpp);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  let modal = 0;
  let modalKey = 0;
  for (let key = 0; key < counts.length; key += 1) {
    if ((counts[key] ?? 0) > modal) {
      modal = counts[key] ?? 0;
      modalKey = key;
    }
  }
  return unpackKey(modalKey);
}

type ToastRect = { x0: number; y0: number; x1: number; y1: number };

/** The longest contiguous run of `inside` pixels in one row. */
function longestRun(
  width: number,
  y: number,
  inside: (index: number) => boolean
): { start: number; length: number } {
  let best = { start: 0, length: 0 };
  let x = 0;
  while (x < width) {
    while (x < width && !inside(y * width + x)) x += 1;
    const start = x;
    while (x < width && inside(y * width + x)) x += 1;
    if (x - start > best.length) best = { start, length: x - start };
  }
  return best;
}

/**
 * The toast band's padded bounding box, or null when the frame has no solid
 * non-background block below the top strip. Rows and columns are device pixels.
 */
// eslint-disable-next-line complexity -- the measured toast shape has three guards.
function toastRect(frame: DecodedFrame, modal: Oklab, startRow: number): ToastRect | null {
  const { width, height, bpp, pixels } = frame;
  const band = Math.max(startRow + 1, Math.round(height * TOAST_BAND_FRACTION));
  const candidate = toastCandidate(frame, band, modal, startRow);
  if (candidate === null) return null;
  const isFamily = makeFamilyTest(candidate, TOAST_FAMILY_DELTA_E);
  const inside = (index: number): boolean => isFamily(rgbKeyAt(pixels, index * bpp));
  let best = { row: startRow, start: 0, length: 0 };
  for (let y = startRow; y < band; y += 1) {
    const run = longestRun(width, y, inside);
    if (run.length > best.length) best = { row: y, start: run.start, length: run.length };
  }
  if (best.length < width * TOAST_MIN_RUN_FRACTION) return null;
  if (best.length > width * TOAST_MAX_RUN_FRACTION) return null;
  const countIn = (y: number): number => {
    let count = 0;
    for (let x = best.start; x < best.start + best.length; x += 1) {
      if (inside(y * width + x)) count += 1;
    }
    return count;
  };
  let y0 = best.row;
  let y1 = best.row;
  while (y0 > startRow && countIn(y0 - 1) >= best.length * 0.5) y0 -= 1;
  while (y1 < height - 1 && countIn(y1 + 1) >= best.length * 0.5) y1 += 1;
  const minHeight = Math.max(2, Math.round(height * TOAST_MIN_HEIGHT_FRACTION));
  if (y1 - y0 + 1 < minHeight) return null;
  if (best.length * (y1 - y0 + 1) < width * height * TOAST_MIN_AREA_FRACTION) return null;
  const padX = Math.max(1, Math.round(width * TOAST_PAD_X_FRACTION));
  const padBottom = Math.round(height * TOAST_PAD_BOTTOM_FRACTION);
  return {
    x0: Math.max(0, best.start - padX),
    x1: Math.min(width - 1, best.start + best.length - 1 + padX),
    y0,
    y1: Math.min(height - 1, y1 + padBottom)
  };
}

/** The largest solid low-chroma colour in the band that is not the modal one. */
function toastCandidate(
  frame: DecodedFrame,
  band: number,
  modal: Oklab,
  startRow: number
): Oklab | null {
  const { pixels, bpp } = frame;
  const counts = new Map<number, number>();
  for (let index = startRow * frame.width; index < frame.width * band; index += 1) {
    const key = packedKeyAt(pixels, index * bpp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const scratch: MutableOklab = { lightness: 0, a: 0, b: 0 };
  let best: Oklab | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count <= bestCount) continue;
    const rgb = unpackKey(key);
    oklabOfRgbInto(redOf(rgb), greenOf(rgb), blueOf(rgb), scratch);
    if (Math.hypot(scratch.a, scratch.b) < TOAST_MIN_CHROMA) continue;
    if (deltaE(scratch, modal) < TOAST_MODAL_DELTA_E) continue;
    best = { lightness: scratch.lightness, a: scratch.a, b: scratch.b };
    bestCount = count;
  }
  return best;
}

/** The mask's own measured components, so a caller can report why a pixel went. */
export type MaskOptions = { topRows?: number };

/**
 * Build the non-app mask for one decoded frame. Deterministic: the same bytes
 * and dimensions always produce the same mask and the same shares.
 */
export function maskNonApp(frame: DecodedFrame, options: MaskOptions = {}): RenderMask {
  const { width, height } = frame;
  const total = width * height;
  const mask = new Uint8Array(total);
  const modalRgb = modalColour(frame);
  const modal = oklabOfRgb(redOf(modalRgb), greenOf(modalRgb), blueOf(modalRgb));
  const rows =
    options.topRows ??
    Math.max(1, Math.min(TOP_STRIP_DEVICE_ROWS, Math.ceil(height * TOP_STRIP_FRACTION)));
  const topPixels = Math.min(total, rows * width);
  mask.fill(1, 0, topPixels);
  const toast = toastRect(frame, modal, rows);
  if (toast !== null) {
    for (let y = toast.y0; y <= toast.y1; y += 1) {
      mask.fill(1, y * width + toast.x0, y * width + toast.x1 + 1);
    }
  }
  const corners = maskCorners(frame, modal, mask);
  let masked = 0;
  for (const bit of mask) masked += bit;
  const percent = (count: number): number => (total === 0 ? 0 : (count / total) * 100);
  return {
    mask,
    maskedPixels: masked,
    maskShare: percent(masked),
    components: {
      topStrip: percent(topPixels),
      toast: toast === null ? 0 : percent((toast.x1 - toast.x0 + 1) * (toast.y1 - toast.y0 + 1)),
      corners: percent(corners)
    }
  };
}
