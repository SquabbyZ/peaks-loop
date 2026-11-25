/**
 * The OKLab grid and family merge behind `measurePalette` (S8 close-out, cap
 * split). `palette-measure.ts` owns the decode, mask, shares and background
 * classification; this module owns "which colours are families".
 *
 * Each pixel is converted ONCE per distinct exact colour (a measured 4.1 M-px
 * frame dropped from 3.4 s to ~0.24 s when the per-pixel conversion cache
 * landed), accumulated onto a 0.02 OKLab grid with an anti-aliased edge weight,
 * then merged at `PALETTE_MERGE_DELTA_E`. Determinism is a contract: cells and
 * families are ordered by measured counts then colour, never by Map insertion.
 */

import { deltaE, oklabOfRgb, oklabOfRgbInto, type MutableOklab } from '../color-oklch.js';
import { channelStep, GREEN_SHIFT, RED_SHIFT } from './render-pixels.js';

type Frame = {
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
  readonly bpp: number;
};

/** The OKLab grid: 0.02 in L and in each opponent axis. */
const GRID_LIGHTNESS = 0.02;
const GRID_OPPONENT = 0.02;
const OPPONENT_CELLS = 40;
const OPPONENT_OFFSET = 20;
const LIGHTNESS_CELLS = 50;

/**
 * Neighbours closer than this are one family. 0.05 is a DELIBERATE measured
 * choice, not half of the 0.12 visible step (0.12/2 = 0.06): #777777 and
 * #888888 are ΔE 0.058 apart, and merging at 0.06 would fold that near-threshold
 * contrast pair into one family and hide the pair the contrast reader verifies.
 */
export const PALETTE_MERGE_DELTA_E = 0.05;

/** A pixel on a strong colour step is anti-aliased edge, not flat area. */
const EDGE_STEP = 24;
const EDGE_WEIGHT = 0.25;

/**
 * At most this many families are kept. A frame with more distinct colours keeps
 * the largest families and discards the rest; the measurement counts those
 * pixels in its discarded share because the share denominator is the unmasked
 * app pixel count. A cell is NEVER folded into a family it is not near.
 */
export const MAX_MERGE_FAMILIES = 256;
/** One OKLab conversion per distinct exact colour; the cap bounds hostile input. */
const COLOUR_CACHE_LIMIT = 131_072;

/** Rank weights, the article's Okmain shape. */
const AREA_WEIGHT = 0.3;
const CHROMA_WEIGHT = 0.7;
const RANK_DECIMALS = 10_000;
/** Below this the frame has no measurable chroma; the chroma term is zeroed. */
const MIN_MEASURABLE_CHROMA = 0.0001;

const HEX_RADIX = 16;

type Cell = {
  count: number;
  weight: number;
  red: number;
  green: number;
  blue: number;
};

/** One grid cell or merged family, with its representative colour. */
export type Accumulated = Cell & { lab: ReturnType<typeof oklabOfRgb>; hex: string };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The stated OKLab grid cell one colour falls in. */
function gridKey(lab: { lightness: number; a: number; b: number }): number {
  const lightness = clamp(Math.round(lab.lightness / GRID_LIGHTNESS), 0, LIGHTNESS_CELLS);
  const a = clamp(Math.round(lab.a / GRID_OPPONENT) + OPPONENT_OFFSET, 0, OPPONENT_CELLS);
  const b = clamp(Math.round(lab.b / GRID_OPPONENT) + OPPONENT_OFFSET, 0, OPPONENT_CELLS);
  return (lightness * (OPPONENT_CELLS + 1) + a) * (OPPONENT_CELLS + 1) + b;
}

function hexOf(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => value.toString(HEX_RADIX).padStart(2, '0')).join('')}`;
}

/** Round to a stated display scale; shared with the measurement's shares. */
export function rounded(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

/** 1 for a flat pixel, EDGE_WEIGHT when a neighbour differs by a strong step. */
function edgeWeight(frame: Frame, x: number, y: number): number {
  const { pixels, width, height, bpp } = frame;
  const at = (y * width + x) * bpp;
  if (x + 1 < width && channelStep(pixels, at, (y * width + x + 1) * bpp) > EDGE_STEP) {
    return EDGE_WEIGHT;
  }
  if (y + 1 < height && channelStep(pixels, at, ((y + 1) * width + x) * bpp) > EDGE_STEP) {
    return EDGE_WEIGHT;
  }
  return 1;
}

/** Accumulate unmasked pixels onto the OKLab grid with an edge weight. */
function accumulate(frame: Frame, mask: Uint8Array): Map<number, Cell> {
  const { pixels, width, height, bpp } = frame;
  const cells = new Map<number, Cell>();
  const gridCache = new Map<number, number>();
  const scratch: MutableOklab = { lightness: 0, a: 0, b: 0 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 1) continue;
      const at = index * bpp;
      const red = pixels[at] ?? 0;
      const green = pixels[at + 1] ?? 0;
      const blue = pixels[at + 2] ?? 0;
      const rgb = (red << RED_SHIFT) | (green << GREEN_SHIFT) | blue;
      let key = gridCache.get(rgb);
      if (key === undefined) {
        oklabOfRgbInto(red, green, blue, scratch);
        key = gridKey(scratch);
        if (gridCache.size < COLOUR_CACHE_LIMIT) gridCache.set(rgb, key);
      }
      const cell = cells.get(key) ?? { count: 0, weight: 0, red: 0, green: 0, blue: 0 };
      cell.count += 1;
      cell.weight += edgeWeight(frame, x, y);
      cell.red += red;
      cell.green += green;
      cell.blue += blue;
      cells.set(key, cell);
    }
  }
  return cells;
}

function representative(cell: Cell): Accumulated {
  const red = Math.round(cell.red / cell.count);
  const green = Math.round(cell.green / cell.count);
  const blue = Math.round(cell.blue / cell.count);
  return { ...cell, lab: oklabOfRgb(red, green, blue), hex: hexOf(red, green, blue) };
}

/** Cells sorted by measured count, ties broken by colour so the merge is stable. */
function sortedCells(cells: Map<number, Cell>): Accumulated[] {
  return [...cells.values()]
    .map(representative)
    .sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex));
}

/** Fold one cell into its family and recompute the family's weighted mean. */
function foldInto(family: Accumulated, cell: Accumulated): void {
  family.count += cell.count;
  family.weight += cell.weight;
  family.red += cell.red;
  family.green += cell.green;
  family.blue += cell.blue;
  const red = Math.round(family.red / family.count);
  const green = Math.round(family.green / family.count);
  const blue = Math.round(family.blue / family.count);
  family.lab = oklabOfRgb(red, green, blue);
  family.hex = hexOf(red, green, blue);
}

/** Merge cells within the family threshold; each family keeps its weighted mean. */
function mergeFamilies(cells: readonly Accumulated[]): Accumulated[] {
  const families: Accumulated[] = [];
  for (const cell of cells) {
    // The list is full: STOP scanning and DROP the cell, so every remaining
    // cell costs O(1) instead of a MAX_MERGE_FAMILIES-wide nearest scan. The
    // cell is not folded, not even into a near family, and never into the
    // NEAREST family at any distance (that broke "neighbours within ΔE 0.05
    // are one family" and blended colours that were never near). Cells arrive
    // largest-first, so the kept families are the largest. The dropped tail is
    // absent from every listed family while still counting in the measurement's
    // unmasked app denominator, so its pixels land in the discarded share.
    if (families.length >= MAX_MERGE_FAMILIES) continue;
    const match = families.find((family) => deltaE(family.lab, cell.lab) <= PALETTE_MERGE_DELTA_E);
    if (match !== undefined) {
      foldInto(match, cell);
      continue;
    }
    families.push({ ...cell });
  }
  return families;
}

/** Every merged family of one masked frame, before the floor cut. */
export function measureCells(frame: Frame, mask: Uint8Array): Accumulated[] {
  return mergeFamilies(sortedCells(accumulate(frame, mask)));
}

/** `0.3 × normalised weighted share + 0.7 × normalised chroma`, 0–1. */
export function rankOf(family: Accumulated, maxWeight: number, maxChroma: number): number {
  const area = maxWeight === 0 ? 0 : family.weight / maxWeight;
  const chroma = Math.hypot(family.lab.a, family.lab.b);
  const chromaPart = maxChroma < MIN_MEASURABLE_CHROMA ? 0 : chroma / maxChroma;
  return rounded(AREA_WEIGHT * area + CHROMA_WEIGHT * chromaPart, RANK_DECIMALS);
}
