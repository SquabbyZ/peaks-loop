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

type RgbRow = { readonly r: number; readonly g: number; readonly b: number };
type LmsRow = { readonly l: number; readonly m: number; readonly s: number };

/** OKLCH coordinates of a normalised `#rrggbb`, or null when it is not one. */
function oklchOf(hex: string): { lightness: number; chroma: number; hue: number } | null {
  if (hex.length !== HEX_LENGTH) return null;
  const numeric = Number.parseInt(hex.slice(1), HEX_RADIX);
  if (!Number.isFinite(numeric)) return null;
  const r = linearChannel((numeric >> SHIFT_RED) & BYTE_MASK);
  const g = linearChannel((numeric >> SHIFT_GREEN) & BYTE_MASK);
  const b = linearChannel(numeric & BYTE_MASK);
  const cube = (row: RgbRow): number => (row.r * r + row.g * g + row.b * b) ** (1 / CUBE_ROOT);
  const l = cube(OKLAB_FROM_RGB.l);
  const m = cube(OKLAB_FROM_RGB.m);
  const s = cube(OKLAB_FROM_RGB.s);
  const channel = (row: LmsRow): number => row.l * l + row.m * m + row.s * s;
  const a = channel(OKLAB_LMS.a);
  const bAxis = channel(OKLAB_LMS.b);
  const hue = (((Math.atan2(bAxis, a) * DEGREES_PER_RADIAN) % HUE_MAX) + HUE_MAX) % HUE_MAX;
  return { lightness: channel(OKLAB_LMS.l), chroma: Math.hypot(a, bAxis), hue };
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
