/**
 * OKLCH hue classification for the S7 colour detector.
 *
 * `css-color.ts` converts every notation a project writes (hex, `rgb()`,
 * `hsl()`, `oklch()`, `oklab()`) into `#rrggbb`. This module goes the other
 * way — hex back to OKLab/OKLCH — because the family question is "which 30°
 * hue wedge?", and a hex string cannot answer it. The matrices are Ottosson's,
 * written in the same named-coefficient style as `css-color.ts`; nothing here
 * is a second parser.
 *
 * A colour below MIN_CHROMA is neutral, not a chromatic family. A Tailwind
 * palette name carries its family, so `paletteHue` returns the measured hue of
 * that family's 500 shade — a name, not a round-trip through a value the
 * project never wrote.
 */

/** Hue-bucket width in degrees: a family is one 30° wedge of the OKLCH circle. */
const HUE_BUCKET_DEGREES = 30;

/** Below this OKLCH chroma a colour is neutral, not a chromatic family. */
const MIN_CHROMA = 0.035;

/** The 12 labels a hue bucket can carry, in bucket order (0°–360°). */
export const HUE_LABELS = [
  '红',
  '橙',
  '琥珀',
  '黄',
  '黄绿',
  '绿',
  '青',
  '天蓝',
  '蓝',
  '蓝紫',
  '紫',
  '洋红'
] as const;

const HUE_MAX = 360;
const HEX_LENGTH = 7;
const HEX_RADIX = 16;
const BYTE_MAX = 255;
const BYTE_MASK = 0xff;
const SHIFT_RED = 16;
const SHIFT_GREEN = 8;
const GAMMA_THRESHOLD = 0.04045;
const GAMMA_SLOPE = 12.92;
const GAMMA_SCALE = 1.055;
const GAMMA_OFFSET = 0.055;
const GAMMA = 2.4;
const CUBE_ROOT = 3;
const HALF_TURN_DEGREES = 180;
const DEGREES_PER_RADIAN = HALF_TURN_DEGREES / Math.PI;

/** sRGB → linear-light, the inverse of `css-color.ts`'s `linearToSrgb`. */
function linearChannel(channel: number): number {
  const ratio = channel / BYTE_MAX;
  return ratio <= GAMMA_THRESHOLD
    ? ratio / GAMMA_SLOPE
    : ((ratio + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA;
}

/** OKLab's l/m/s rows for linear sRGB (Ottosson), the inverse direction. */
const OKLAB_FROM_RGB = {
  l: { r: 0.4122214708, g: 0.5363325363, b: 0.0514459929 },
  m: { r: 0.2119034982, g: 0.6806995451, b: 0.1073969566 },
  s: { r: 0.0883024619, g: 0.2817188376, b: 0.6299787005 }
} as const;

/** OKLab's l/a/b rows over the cube-rooted l/m/s channels. */
const OKLAB_LMS = {
  l: { l: 0.2104542553, m: 0.793617785, s: -0.0040720468 },
  a: { l: 1.9779984951, m: -2.428592205, s: 0.4505937099 },
  b: { l: 0.0259040371, m: 0.7827717662, s: -0.808675766 }
} as const;

/** OKLab coordinates: lightness 0–1, a/b roughly -0.4–0.4. */
export type Oklab = { readonly lightness: number; readonly a: number; readonly b: number };

/** A caller-owned OKLab target, so a hot loop converts without allocating. */
export type MutableOklab = { lightness: number; a: number; b: number };

/**
 * OKLab coordinates of one sRGB byte triple, written into `out`.
 *
 * NO ALLOCATION IN THE CALL: the matrix rows are module constants and every
 * expression is inline. The render reader scans millions of pixels, so the
 * closure-per-row shape this replaced (two closures + one object per call) was
 * a measured 66 % RSS increase on a 4.1 M-pixel frame. The arithmetic order is
 * unchanged, so the result is bit-identical to the allocating form.
 */
export function oklabOfRgbInto(
  red: number,
  green: number,
  blue: number,
  out: MutableOklab
): MutableOklab {
  const r = linearChannel(red);
  const g = linearChannel(green);
  const b = linearChannel(blue);
  const l =
    (OKLAB_FROM_RGB.l.r * r + OKLAB_FROM_RGB.l.g * g + OKLAB_FROM_RGB.l.b * b) ** (1 / CUBE_ROOT);
  const m =
    (OKLAB_FROM_RGB.m.r * r + OKLAB_FROM_RGB.m.g * g + OKLAB_FROM_RGB.m.b * b) ** (1 / CUBE_ROOT);
  const s =
    (OKLAB_FROM_RGB.s.r * r + OKLAB_FROM_RGB.s.g * g + OKLAB_FROM_RGB.s.b * b) ** (1 / CUBE_ROOT);
  out.lightness = OKLAB_LMS.l.l * l + OKLAB_LMS.l.m * m + OKLAB_LMS.l.s * s;
  out.a = OKLAB_LMS.a.l * l + OKLAB_LMS.a.m * m + OKLAB_LMS.a.s * s;
  out.b = OKLAB_LMS.b.l * l + OKLAB_LMS.b.m * m + OKLAB_LMS.b.s * s;
  return out;
}

/**
 * OKLab coordinates of one sRGB byte triple. S8's render reader converts the
 * captured pixels with this same matrix instead of carrying a second copy of
 * the constants (paint-metric decodes bytes; this is the only colour space).
 */
export function oklabOfRgb(red: number, green: number, blue: number): Oklab {
  return oklabOfRgbInto(red, green, blue, { lightness: 0, a: 0, b: 0 });
}

/** OKLab coordinates of a normalised `#rrggbb`, or null when it is not one. */
export function oklabOfHex(hex: string): Oklab | null {
  if (hex.length !== HEX_LENGTH) return null;
  const numeric = Number.parseInt(hex.slice(1), HEX_RADIX);
  if (!Number.isFinite(numeric)) return null;
  return oklabOfRgb(
    (numeric >> SHIFT_RED) & BYTE_MASK,
    (numeric >> SHIFT_GREEN) & BYTE_MASK,
    numeric & BYTE_MASK
  );
}

/**
 * The article's colour difference `E = √(ΔL² + Δa² + Δb²)` in OKLab. The
 * visible-step reference (0.12) is the caller's; this module only measures.
 */
export function deltaE(left: Oklab, right: Oklab): number {
  return Math.hypot(left.lightness - right.lightness, left.a - right.a, left.b - right.b);
}

/** OKLCH coordinates of a normalised `#rrggbb`, or null when it is not one. */
function oklchOf(hex: string): { lightness: number; chroma: number; hue: number } | null {
  const lab = oklabOfHex(hex);
  if (lab === null) return null;
  const hue = (((Math.atan2(lab.b, lab.a) * DEGREES_PER_RADIAN) % HUE_MAX) + HUE_MAX) % HUE_MAX;
  return { lightness: lab.lightness, chroma: Math.hypot(lab.a, lab.b), hue };
}

/** The chromatic hue and measured chroma of a colour; hue is null when neutral. */
export function oklchFields(hex: string): { hue: number | null; chroma: number | null } {
  const oklch = oklchOf(hex);
  if (oklch === null) return { hue: null, chroma: null };
  return {
    hue: oklch.chroma >= MIN_CHROMA ? oklch.hue : null,
    chroma: oklch.chroma
  };
}

/** The 30° bucket a hue falls in: `0` for 0°–30°, `11` for 330°–360°. */
export function hueBucket(hue: number): number {
  const normalized = ((hue % HUE_MAX) + HUE_MAX) % HUE_MAX;
  return Math.floor(normalized / HUE_BUCKET_DEGREES);
}

/**
 * The measured OKLCH hue of each Tailwind palette family's 500 shade. A shade
 * number does not move a chromatic family across a 30° boundary, so one
 * representative hue per family is enough for bucketing. Neutrals (slate,
 * gray, zinc, neutral, stone) and the keywords (`black`, `white`,
 * `transparent`, `current`) are absent: they are not chromatic families.
 */
const PALETTE_HUE: Record<string, number> = {
  red: 25.3,
  orange: 47.6,
  amber: 70.1,
  yellow: 86.1,
  lime: 130.9,
  green: 149.6,
  emerald: 162.5,
  teal: 182.5,
  cyan: 215.2,
  sky: 237.3,
  blue: 259.8,
  indigo: 277.1,
  violet: 292.7,
  purple: 303.9,
  fuchsia: 322.2,
  pink: 354.3,
  rose: 16.4
};

/** The representative hue of a Tailwind palette family, or undefined for neutrals. */
export function paletteHue(family: string): number | undefined {
  return PALETTE_HUE[family];
}
