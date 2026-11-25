/**
 * The pixel primitives both mask passes share (S8 close-out, cap split).
 *
 * `render-mask.ts` owns the top strip and the toast band; `render-corners.ts`
 * owns the devtools corners. Both need the same 5-bit colour key, the same
 * exact-RGB key, and the same "is this pixel in that colour family?" test with
 * a conversion cache. Keeping one copy here is what makes the two passes agree
 * on what a family is, and keeps each pass under the 300-line module ceiling.
 *
 * `MODAL_HISTOGRAM_SIZE` is 32³ = 32,768 slots. A previous
 * `CHANNEL_LEVELS ** BITS_PER_CHANNEL` = 32⁵ allocated 134 MB and scanned
 * 33.5 M empty slots on every frame; a test pins this size.
 */

import { deltaE, oklabOfRgbInto, type MutableOklab, type Oklab } from '../color-oklch.js';

/** Per-channel sRGB bytes: RGB and RGBA captures differ only in the alpha step. */
const BITS_PER_CHANNEL = 5;
const CHANNEL_LEVELS = 32;
const CHANNEL_COUNT = 3;
const CHANNEL_MASK = CHANNEL_LEVELS - 1;
export const MODAL_HISTOGRAM_SIZE = CHANNEL_LEVELS ** CHANNEL_COUNT;

const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
/** The exact-RGB key's channel shifts; `palette-cells` packs its cache with them. */
export const GREEN_SHIFT = BYTE_BITS;
export const RED_SHIFT = BYTE_BITS * 2;
const OKLAB_CACHE_LIMIT = 65_536;

/** The exact sRGB byte triple packed into one number, for a conversion cache. */
export function rgbKeyAt(pixels: Buffer, at: number): number {
  return (
    ((pixels[at] ?? 0) << RED_SHIFT) |
    ((pixels[at + 1] ?? 0) << GREEN_SHIFT) |
    (pixels[at + 2] ?? 0)
  );
}

export function redOf(key: number): number {
  return (key >> RED_SHIFT) & BYTE_MASK;
}

export function greenOf(key: number): number {
  return (key >> GREEN_SHIFT) & BYTE_MASK;
}

export function blueOf(key: number): number {
  return key & BYTE_MASK;
}

/** The 5-bit cell key one exact RGB triple falls in. */
export function packedKeyOf(red: number, green: number, blue: number): number {
  const shift = BYTE_BITS - BITS_PER_CHANNEL;
  return (
    ((red >> shift) << (BITS_PER_CHANNEL * 2)) |
    ((green >> shift) << BITS_PER_CHANNEL) |
    (blue >> shift)
  );
}

export function packedKeyAt(pixels: Buffer, at: number): number {
  return packedKeyOf(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0);
}

/** The 5-bit cell's representative RGB byte triple, packed as an exact key. */
export function unpackKey(key: number): number {
  const shift = BYTE_BITS - BITS_PER_CHANNEL;
  const half = 1 << (shift - 1);
  const red = (((key >> (BITS_PER_CHANNEL * 2)) & CHANNEL_MASK) << shift) + half;
  const green = (((key >> BITS_PER_CHANNEL) & CHANNEL_MASK) << shift) + half;
  const blue = ((key & CHANNEL_MASK) << shift) + half;
  return (red << RED_SHIFT) | (green << GREEN_SHIFT) | blue;
}

/** The strongest per-channel step between two packed pixel offsets. */
export function channelStep(pixels: Buffer, at: number, other: number): number {
  const red = Math.abs((pixels[at] ?? 0) - (pixels[other] ?? 0));
  const green = Math.abs((pixels[at + 1] ?? 0) - (pixels[other + 1] ?? 0));
  const blue = Math.abs((pixels[at + 2] ?? 0) - (pixels[other + 2] ?? 0));
  return Math.max(red, green, blue);
}

/**
 * A per-exact-colour test with a conversion cache, so a scan over hundreds of
 * thousands of pixels converts each distinct colour once instead of per pixel.
 * Identical in result to converting every pixel (same bytes, same threshold).
 */
export function makeFamilyTest(target: Oklab, threshold: number): (rgb: number) => boolean {
  const cache = new Map<number, boolean>();
  const scratch: MutableOklab = { lightness: 0, a: 0, b: 0 };
  return (rgb) => {
    const cached = cache.get(rgb);
    if (cached !== undefined) return cached;
    oklabOfRgbInto(redOf(rgb), greenOf(rgb), blueOf(rgb), scratch);
    const inside = deltaE(scratch, target) <= threshold;
    if (cache.size < OKLAB_CACHE_LIMIT) cache.set(rgb, inside);
    return inside;
  };
}
