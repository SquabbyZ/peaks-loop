/**
 * Synthetic frame builders for the S8 boundary tests (tests only).
 *
 * `_render-fixtures.ts` holds the named frames the earlier suites read.
 * These helpers build frames from MEASURED geometry — a background band
 * grid whose per-anchor step is chosen by the caller, and block rectangles —
 * so a boundary test can sit one count on either side of a stated threshold.
 */

import { rgbPng, type Pixel } from './_png-bytes.js';
import { decodePng } from '../../../src/services/design/paint-metric.js';
import type {
  RenderBackground,
  RenderFrame
} from '../../../src/services/design/audit/render/render-audit.js';
import type {
  PaletteFamily,
  PaletteMeasurement
} from '../../../src/services/design/audit/render/palette-measure.js';
import { oklabOfHex } from '../../../src/services/design/audit/color-oklch.js';

export type DecodedFrame = {
  pixels: Buffer;
  width: number;
  height: number;
  bpp: number;
};

export const BACKGROUND: Pixel = [30, 30, 30];
export const TOAST: Pixel = [78, 57, 56];
export const CHROME: Pixel = [200, 200, 200];

/** Decode a fixture into the frame shape the mask readers take. */
export function decodeFrame(png: Buffer): DecodedFrame {
  const decoded = decodePng(png);
  if (!decoded.ok) throw new Error(`fixture refused: ${decoded.reason}`);
  return { pixels: decoded.pixels, width: decoded.width, height: decoded.height, bpp: decoded.bpp };
}

export type Block = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  colour: Pixel;
};

/** A frame painted `background`, with the given half-open block rectangles. */
export function blockPng(
  width: number,
  height: number,
  blocks: readonly Block[],
  background: Pixel = BACKGROUND
): Buffer {
  return rgbPng({
    width,
    height,
    pixel: (x, y): Pixel => {
      for (const block of blocks) {
        if (x >= block.x0 && x < block.x1 && y >= block.y0 && y < block.y1) return block.colour;
      }
      return background;
    }
  });
}

/**
 * A frame whose 16-pixel background sample grid carries one step per anchor.
 * `steps` is row-major over `ceil(width/16) × ceil(height/16)` anchors; the
 * step is written to the anchor's right and lower neighbours so the
 * classifier reads exactly that value regardless of which one it prefers.
 */
export function stepFrame(width: number, height: number, steps: readonly number[]): Buffer {
  const cols = Math.ceil(width / 16);
  const base = 10;
  return rgbPng({
    width,
    height,
    pixel: (x, y): Pixel => {
      const i = Math.floor(x / 16);
      const j = Math.floor(y / 16);
      const step = steps[j * cols + i] ?? 0;
      if (step > 0) {
        if (x === i * 16 + 1 && y === j * 16) return [base + step, base + step, base + step];
        if (x === i * 16 && y === j * 16 + 1) return [base + step, base + step, base + step];
      }
      return [base, base, base];
    }
  });
}

/** `count` copies of one step value, for building `stepFrame` inputs. */
export function steps(count: number, value: number): number[] {
  return Array<number>(count).fill(value);
}

/** One synthetic palette family; chroma defaults to the measured hex's value. */
export function paletteFamily(colour: string, areaShare: number, chroma?: number): PaletteFamily {
  const lab = oklabOfHex(colour);
  const measured = chroma ?? (lab === null ? 0 : Math.hypot(lab.a, lab.b));
  return { colour, areaShare, chroma: measured, rank: 0 };
}

/** A synthetic measurement; every field a rule reads can be overridden. */
export function paletteMeasurement(input: {
  families: PaletteFamily[];
  background?: RenderBackground;
  maskShare?: number;
  discardedShare?: number;
  appPixels?: number;
  maskComponents?: { topStrip: number; toast: number; corners: number };
}): PaletteMeasurement {
  return {
    families: input.families,
    background: input.background ?? 'solid',
    neutralShare: 0,
    distinctChromatic: input.families.length,
    discardedShare: input.discardedShare ?? 0,
    maskShare: input.maskShare ?? 0,
    maskComponents: input.maskComponents ?? { topStrip: 0, toast: 0, corners: 0 },
    appPixels: input.appPixels ?? 10_000
  };
}

/** A decoded render frame carrying a synthetic measurement, for rule branches. */
export function renderFrameOf(
  measurement: PaletteMeasurement,
  background: RenderBackground = measurement.background,
  capture = 'probe/frame/full-page.png'
): RenderFrame {
  return {
    capture,
    route: '/',
    slug: null,
    background,
    palette: { ok: true, measurement }
  };
}
