/**
 * Palette measured from the captured PNG (S8 Task 2; grid split to
 * `palette-cells.ts`, background to `render-background.ts` in the close-out).
 *
 * The payload's `colors.dominance[].areaShare` is NOT frame area and must never
 * be used here: the spike measured that the pilot's payload ranks the toast body
 * `#4e3938` at 99.9 % while the same PNG measures it at 1.680 % and the real
 * dominant colour `#1e1e1e` at 93.650 %. This reader decodes the actual frame
 * (`paint-metric.ts`, no second decoder), masks the measured non-app regions,
 * quantises to a stated OKLab grid, merges neighbours into families, and ranks
 * by the article's *色彩、算法与美学* Okmain shape:
 *
 *     rank = 0.3 × weighted area share + 0.7 × normalised OKLab chroma
 *
 * with edge pixels down-weighted. The article is a reference for the SHAPE of
 * the formula; it is not an oracle, and nothing is executed from it.
 *
 * Determinism: the same PNG bytes always produce byte-identical output (cells
 * and families are ordered by measured counts then colour). Live capture-to-
 * capture variation is the caller's problem (the spike measured ~0.03 pp drift).
 */

/* eslint-disable no-magic-numbers -- display precision and the family floor are stated constants. */

import { decodePng } from '../../paint-metric.js';
import { maskNonApp, type DecodedFrame, type MaskShare, type RenderMask } from './render-mask.js';
import { classifyBackground, type RenderBackground } from './render-background.js';
import { measureCells, rankOf, rounded, type Accumulated } from './palette-cells.js';

export { PALETTE_MERGE_DELTA_E } from './palette-cells.js';

/** One rendered colour family, after the merge. */
export type PaletteFamily = {
  /** Representative `#rrggbb` (the weighted mean of the family's pixels). */
  colour: string;
  /** Percent of APP pixels (masked pixels excluded); edge pixels keep full area. */
  areaShare: number;
  /** OKLab chroma of the representative colour. */
  chroma: number;
  /** `0.3 × normalised weighted share + 0.7 × normalised chroma`, 0–1. */
  rank: number;
};

export type PaletteMeasurement = {
  families: PaletteFamily[];
  /** The frame's background kind, measured from PIXELS (close-out D3). */
  background: RenderBackground;
  /** Percent of app pixels in families below the chromatic threshold. */
  neutralShare: number;
  /** Distinct chromatic families (OKLab chroma ≥ 0.035) after the merge. */
  distinctChromatic: number;
  /** Percent of app pixels not in a listed family: below the floor or past the cap. */
  discardedShare: number;
  /** Percent of the whole frame removed as non-app evidence. */
  maskShare: number;
  /** The mask's own components, for the finding's evidence line. */
  maskComponents: MaskShare;
  /** Unmasked frame pixels the shares are computed over. */
  appPixels: number;
};

export type PaletteRead =
  { ok: true; measurement: PaletteMeasurement } | { ok: false; reason: string };

/** The source detector's neutral line, so "chromatic" means one thing. */
export const PALETTE_MIN_CHROMA = 0.035;
/**
 * A colour covering less than 0.05 % of the app pixels is not a palette family:
 * on a 4.1 M-pixel capture that is ~2,000 px, the scale of anti-aliased text
 * fringes and one-pixel icons, which the spike showed otherwise flood the
 * chroma term with dozens of 0.00x % "colours". The discarded share is reported.
 */
export const PALETTE_MIN_FAMILY_SHARE = 0.05;

const DISPLAY_DECIMALS = 10_000;

/** The kept cells as ranked, display-rounded families. */
function familyRows(kept: readonly Accumulated[], appPixels: number): PaletteFamily[] {
  const shareOf = (family: Accumulated): number => (family.count / appPixels) * 100;
  const maxWeight = Math.max(...kept.map((family) => family.weight));
  const maxChroma = Math.max(...kept.map((family) => Math.hypot(family.lab.a, family.lab.b)));
  return kept
    .map((family) => ({
      colour: family.hex,
      areaShare: rounded(shareOf(family), DISPLAY_DECIMALS),
      chroma: rounded(Math.hypot(family.lab.a, family.lab.b), DISPLAY_DECIMALS),
      rank: rankOf(family, maxWeight, maxChroma)
    }))
    .sort(
      (left, right) =>
        right.rank - left.rank ||
        right.areaShare - left.areaShare ||
        left.colour.localeCompare(right.colour)
    );
}

/** The measurement a family list implies; an empty list is a 100 % discard. */
function measurementOf(
  families: PaletteFamily[],
  masked: RenderMask,
  background: RenderBackground,
  appPixels: number
): PaletteMeasurement {
  const neutralShare = rounded(
    families
      .filter((family) => family.chroma < PALETTE_MIN_CHROMA)
      .reduce((sum, family) => sum + family.areaShare, 0),
    DISPLAY_DECIMALS
  );
  const keptShare = families.reduce((sum, family) => sum + family.areaShare, 0);
  return {
    families,
    background,
    neutralShare,
    distinctChromatic: families.filter((family) => family.chroma >= PALETTE_MIN_CHROMA).length,
    discardedShare: rounded(Math.max(0, 100 - keptShare), DISPLAY_DECIMALS),
    maskShare: rounded(masked.maskShare, DISPLAY_DECIMALS),
    maskComponents: masked.components,
    appPixels
  };
}

/** Decode one capture and measure the palette of its app pixels. */
export function measurePalette(png: Uint8Array): PaletteRead {
  const decoded = decodePng(png);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  const { width, height, bpp, pixels } = decoded;
  const frame: DecodedFrame = { pixels, width, height, bpp };
  const masked = maskNonApp(frame);
  const merged = measureCells(frame, masked.mask);
  // The denominator is the UNMASKED frame pixel count, never the retained
  // families' own sum: `measureCells` drops the family-cap tail, and summing
  // the survivors would shrink both the denominator and the discarded share,
  // hiding exactly the pixels the cap removed. Over the real app area those
  // pixels remain in `100 − keptShare`, so the drop stays visible.
  const appPixels = width * height - masked.maskedPixels;
  if (appPixels <= 0) return { ok: false, reason: 'every pixel was masked as non-app' };
  // Every family below the floor leaves an EMPTY list: the dimension then
  // reports unmeasured, never a phantom neutral family scored as judged 100.
  const kept = merged.filter(
    (family) => (family.count / appPixels) * 100 >= PALETTE_MIN_FAMILY_SHARE
  );
  const families = kept.length === 0 ? [] : familyRows(kept, appPixels);
  return {
    ok: true,
    measurement: measurementOf(families, masked, classifyBackground(frame, masked.mask), appPixels)
  };
}
