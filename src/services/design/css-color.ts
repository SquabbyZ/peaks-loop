/**
 * CSS colour literals in the one form `designlang verify-ui --brand` reads.
 *
 * That reader's own parser accepts hex and `rgb()` only. The token scanner
 * stores whatever the project wrote — Tailwind v4 ships `oklch()`, and old
 * shadcn themes ship `hsl()` — so those notations are converted here rather
 * than failing the brand check for a notation the browser understands.
 *
 * A value that cannot be converted (a `var()` reference, `color-mix()`, a bare
 * HSL triplet, a named colour) returns null. Null is a recorded gap, never a
 * guessed colour: nothing in this module invents a fallback.
 */

const BYTE_MAX = 255;
const HEX_RADIX = 16;
const BYTE_DIGITS = 2;
const SHORT_HEX_LENGTH = 3;
const LONG_HEX_LENGTH = 6;
const RGB_CHANNELS = 3;
const HSL_CHANNELS = 3;
const OKLCH_CHANNELS = 3;
const OKLAB_CHANNELS = 3;
const PERCENT_MAX = 100;
const HUE_MAX = 360;
const HALF = 0.5;
const TWO = 2;
const THREE = 3;
const SIX = 6;
const ONE_SIXTH = 1 / SIX;
const TWO_THIRDS = 2 / THREE;
const HALF_TURN_DEGREES = 180;
const GAMMA = 2.4;
const INVERSE_GAMMA = 1 / GAMMA;
const GAMMA_THRESHOLD = 0.0031308;
const GAMMA_SLOPE = 12.92;
const GAMMA_SCALE = 1.055;
const GAMMA_OFFSET = 0.055;

/** Linear-sRGB rows for OKLab (Ottosson's matrices), as named coefficients. */
const OKLAB_LMS = {
  l: { l: 1, a: 0.3963377774, b: 0.2158037573 },
  m: { l: 1, a: -0.1055613458, b: -0.0638541728 },
  s: { l: 1, a: -0.0894841775, b: -1.291485548 }
} as const;

const LMS_RGB = {
  r: { l: 4.0767416621, m: -3.3077115913, s: 0.2309699292 },
  g: { l: -1.2684380046, m: 2.6097574011, s: -0.3413193965 },
  b: { l: -0.0041960863, m: -0.7034186147, s: 1.707614701 }
} as const;

type LabRow = { readonly l: number; readonly a: number; readonly b: number };
type LmsRow = { readonly l: number; readonly m: number; readonly s: number };

const HEX_VALUE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_CALL = /^([a-z]+)\(([^()]*)\)$/i;
const NUMBER_TOKEN = /^-?\d*\.?\d+$/;
const DEGREES = /^(-?\d*\.?\d+)(?:deg)?$/i;
const PERCENT = /^(-?\d*\.?\d+)%$/;

function clampChannel(channel: number): number {
  return Math.min(BYTE_MAX, Math.max(0, Math.round(channel)));
}

function channelHex(channel: number): string {
  return clampChannel(channel).toString(HEX_RADIX).padStart(BYTE_DIGITS, '0');
}

function hexFromChannels(channels: readonly number[]): string {
  return `#${channels.map(channelHex).join('')}`;
}

function normalizeHex(value: string): string | null {
  const match = HEX_VALUE.exec(value);
  if (match === null) return null;
  const digits = (match[1] ?? '').toLowerCase();
  if (digits.length === SHORT_HEX_LENGTH) {
    return `#${digits.replace(/./g, (digit) => `${digit}${digit}`)}`;
  }
  return `#${digits.slice(0, LONG_HEX_LENGTH)}`;
}

function splitParts(body: string): string[] {
  return body.split(/[\s,/]+/).filter((part) => part.length > 0);
}

function plainNumber(part: string | undefined): number | null {
  if (part === undefined || !NUMBER_TOKEN.test(part)) return null;
  return Number(part);
}

function degreeNumber(part: string | undefined): number | null {
  const match = part === undefined ? null : DEGREES.exec(part);
  return match === null ? null : Number(match[1]);
}

function percentNumber(part: string | undefined): number | null {
  const match = part === undefined ? null : PERCENT.exec(part);
  return match === null ? null : Number(match[1]);
}

function lightnessNumber(part: string | undefined): number | null {
  const percent = percentNumber(part);
  if (percent !== null) return percent / PERCENT_MAX;
  return plainNumber(part);
}

function linearToSrgb(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= GAMMA_THRESHOLD
    ? GAMMA_SLOPE * clamped
    : GAMMA_SCALE * Math.pow(clamped, INVERSE_GAMMA) - GAMMA_OFFSET;
}

function oklabToChannels(lightness: number, a: number, b: number): number[] {
  const cube = (row: LabRow): number => (row.l * lightness + row.a * a + row.b * b) ** THREE;
  const l = cube(OKLAB_LMS.l);
  const m = cube(OKLAB_LMS.m);
  const s = cube(OKLAB_LMS.s);
  const linear = (row: LmsRow): number => row.l * l + row.m * m + row.s * s;
  return [linear(LMS_RGB.r), linear(LMS_RGB.g), linear(LMS_RGB.b)].map(
    (channel) => linearToSrgb(channel) * BYTE_MAX
  );
}

function fromOklab(body: string): string | null {
  const parts = splitParts(body);
  if (parts.length < OKLAB_CHANNELS) return null;
  const lightness = lightnessNumber(parts[0]);
  const a = plainNumber(parts[1]);
  const b = plainNumber(parts[2]);
  if (lightness === null || a === null || b === null) return null;
  return hexFromChannels(oklabToChannels(lightness, a, b));
}

function fromOklch(body: string): string | null {
  const parts = splitParts(body);
  if (parts.length < OKLCH_CHANNELS) return null;
  const lightness = lightnessNumber(parts[0]);
  const chroma = plainNumber(parts[1]);
  const hue = degreeNumber(parts[2]);
  if (lightness === null || chroma === null || hue === null) return null;
  const radians = (hue * Math.PI) / HALF_TURN_DEGREES;
  return hexFromChannels(
    oklabToChannels(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians))
  );
}

function hueToChannel(p: number, q: number, t: number): number {
  const shifted = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (shifted < ONE_SIXTH) return p + (q - p) * SIX * shifted;
  if (shifted < HALF) return q;
  if (shifted < TWO_THIRDS) return p + (q - p) * (TWO_THIRDS - shifted) * SIX;
  return p;
}

function hslToChannels(hue: number, saturation: number, lightness: number): number[] {
  const h = (((hue % HUE_MAX) + HUE_MAX) % HUE_MAX) / HUE_MAX;
  const s = saturation / PERCENT_MAX;
  const l = lightness / PERCENT_MAX;
  if (s === 0) return [l, l, l].map((channel) => channel * BYTE_MAX);
  const q = l < HALF ? l * (1 + s) : l + s - l * s;
  const p = TWO * l - q;
  return [
    hueToChannel(p, q, h + ONE_SIXTH),
    hueToChannel(p, q, h),
    hueToChannel(p, q, h - ONE_SIXTH)
  ].map((channel) => channel * BYTE_MAX);
}

function fromHsl(body: string): string | null {
  const parts = splitParts(body);
  if (parts.length < HSL_CHANNELS) return null;
  const hue = degreeNumber(parts[0]);
  const saturation = percentNumber(parts[1]);
  const lightness = percentNumber(parts[2]);
  if (hue === null || saturation === null || lightness === null) return null;
  return hexFromChannels(hslToChannels(hue, saturation, lightness));
}

function fromRgb(body: string): string | null {
  const parts = splitParts(body).slice(0, RGB_CHANNELS);
  if (parts.length < RGB_CHANNELS) return null;
  const channels = parts.map((part) => Number(part));
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  return hexFromChannels(channels);
}

function fromFunctionCall(name: string, body: string): string | null {
  switch (name) {
    case 'rgb':
    case 'rgba':
      return fromRgb(body);
    case 'hsl':
    case 'hsla':
      return fromHsl(body);
    case 'oklch':
      return fromOklch(body);
    case 'oklab':
      return fromOklab(body);
    default:
      return null;
  }
}

/**
 * `#rrggbb` when `value` is a colour `designlang` can read, else null.
 *
 * Supported: hex (3, 6, or 8 digits), `rgb()`/`rgba()`, `hsl()`/`hsla()`,
 * `oklch()`, `oklab()`. Everything else is an honest null, not a guess.
 */
export function toRenderableColor(value: string): string | null {
  const trimmed = value.trim();
  const hex = normalizeHex(trimmed);
  if (hex !== null) return hex;
  const call = FUNCTION_CALL.exec(trimmed);
  if (call === null) return null;
  return fromFunctionCall((call[1] ?? '').toLowerCase(), call[2] ?? '');
}
