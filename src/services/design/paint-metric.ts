/**
 * A minimal, dependency-free PNG reader and the paint metric the page probe
 * blocks on (S5 spike, `rd/s5-usability-round3.md` §5).
 *
 * The spike measured that no `designlang stats` / `extract` DOM field separates
 * a blank SPA shell from a rendered route on the pilot (devtools inflate the
 * element counts), while a 1280×800 screenshot does: blank = one quantised
 * colour, 0.00 % non-modal pixels, luminance std 0.00; the rendered minimum
 * over seven captures = 3.03 %, 1296 colours, std 13.77.
 *
 * Only the PNG shape `designlang`/Playwright writes is decoded — 8-bit,
 * non-interlaced, colour type 2 (RGB) or 6 (RGBA). Any other shape is REFUSED
 * with a reason rather than measured, because a wrong parse would report a
 * confident number about bytes it never understood. Chunk CRCs are not
 * verified; the inflate length and the per-row filter byte are, and a corrupt
 * stream is refused before a single pixel is counted.
 *
 * Thresholds (one predicate, from the spike): a frame is near-uniform when
 * `nonModalPct < 1.0`, or equivalently when it has at most eight quantised
 * colours and a luminance std below 2. The 1.0 % line is one third of the
 * smallest measured rendered value, so it never touches a painted page.
 */

/* eslint-disable no-magic-numbers, complexity -- PNG byte offsets, colour-type numbers, filter types and the Rec.709 weights are format constants; the unfilter arms are a state machine, not policy. */
import { inflateSync } from 'node:zlib';

/** A screenshot quantised per channel to 5 bits, then measured. */
export type PaintMetric = {
  /** Pixels that are not the single most frequent quantised colour, in percent. */
  nonModalPct: number;
  /** Distinct colours after per-channel 5-bit quantisation. */
  quantisedColours: number;
  /** Population standard deviation of Rec.709 luminance over every pixel. */
  luminanceStd: number;
};

/** The spike's primary boundary: blank 0.00 % vs rendered minimum 3.03 %. */
export const PAINT_NON_MODAL_MIN_PCT = 1.0;
/** Corroborating flatness: a handful of colours … */
export const PAINT_FLAT_MAX_COLOURS = 8;
/** … combined with almost no luminance variance. */
export const PAINT_FLAT_MAX_STD = 2;

/** Bit depth every accepted PNG must use. */
const BIT_DEPTH_8 = 8;
/** Colour type 2 = RGB, 6 = RGBA. Indexed/greyscale are refused. */
const COLOUR_RGB = 2;
const COLOUR_RGBA = 6;
/**
 * Guard against a decompression bomb claiming a huge canvas. The measured
 * capture is 2560×1600 = 4.1 M px, so this is ~4× headroom (a taller
 * full-page shot still fits) and the inflate cap below is derived from it.
 */
const MAX_PIXELS = 16_000_000;
/** IHDR is 13 bytes: width, height, bit depth, colour type, compression, filter, interlace. */
const IHDR_BYTES = 13;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export type PngDecode =
  | { ok: true; width: number; height: number; bpp: number; pixels: Buffer }
  | { ok: false; reason: string };

export type PaintRead = { ok: true; metric: PaintMetric } | { ok: false; reason: string };

type Header = {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  compression: number;
  filter: number;
  interlace: number;
};

function readHeader(data: Buffer): Header {
  return {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8] ?? 0,
    colourType: data[9] ?? 0,
    compression: data[10] ?? 0,
    filter: data[11] ?? 0,
    interlace: data[12] ?? 0
  };
}

/** Why this IHDR is outside the shape this decoder understands, or null. */
function headerRefusal(header: Header): string | null {
  if (header.width === 0 || header.height === 0) return 'a zero-sized IHDR';
  if (header.width * header.height > MAX_PIXELS) return 'an IHDR larger than the pixel cap';
  if (header.bitDepth !== BIT_DEPTH_8) {
    return `bit depth ${String(header.bitDepth)} (only 8-bit is supported)`;
  }
  if (header.colourType !== COLOUR_RGB && header.colourType !== COLOUR_RGBA) {
    return `colour type ${String(header.colourType)} (only RGB/RGBA are supported)`;
  }
  if (header.compression !== 0) return `compression method ${String(header.compression)}`;
  if (header.filter !== 0) return `filter method ${String(header.filter)}`;
  if (header.interlace !== 0) return 'an interlaced PNG';
  return null;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

type Unfiltered = { ok: true; pixels: Buffer } | { ok: false; reason: string };

/** Unfilter every scanline; a filter byte outside 0..4 refuses the image. */
function unfilter(raw: Buffer, header: Header, bpp: number): Unfiltered {
  const stride = header.width * bpp;
  const out = Buffer.alloc(header.height * stride);
  let position = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filterType = raw[position] ?? -1;
    if (filterType < 0 || filterType > 4) {
      return { ok: false, reason: `row ${String(y)} uses filter type ${String(filterType)}` };
    }
    position += 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[position + x] ?? 0;
      const left = (x >= bpp ? out[row + x - bpp] : 0) ?? 0;
      const up = (y > 0 ? out[row - stride + x] : 0) ?? 0;
      const upLeft = (y > 0 && x >= bpp ? out[row - stride + x - bpp] : 0) ?? 0;
      let decoded = value;
      if (filterType === 1) decoded = value + left;
      else if (filterType === 2) decoded = value + up;
      else if (filterType === 3) decoded = value + ((left + up) >> 1);
      else if (filterType === 4) decoded = value + paeth(left, up, upLeft);
      out[row + x] = decoded & 0xff;
    }
    position += stride;
  }
  return { ok: true, pixels: out };
}

type Scan = { ok: true; header: Header; dataChunks: Buffer[] } | { ok: false; reason: string };

/** Walk the chunk stream, refusing an IHDR shape the decoder cannot read. */
function scanChunks(buffer: Buffer): Scan {
  let offset: number = PNG_SIGNATURE.length;
  let header: Header | null = null;
  const dataChunks: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) return { ok: false, reason: `a truncated ${type} chunk` };
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset = end;
    if (type === 'IHDR') {
      if (header !== null) return { ok: false, reason: 'a second IHDR chunk' };
      // Every field is read at a fixed offset: a shorter chunk would throw out
      // of the decoder instead of being refused, so its length is checked first.
      if (data.length < IHDR_BYTES) return { ok: false, reason: 'a truncated IHDR chunk' };
      header = readHeader(data);
      const refusal = headerRefusal(header);
      if (refusal !== null) return { ok: false, reason: refusal };
    } else if (type === 'IDAT') {
      dataChunks.push(data);
    } else if (type === 'tRNS') {
      // Silence would read transparent pixels as their un-blended RGB.
      return { ok: false, reason: 'a tRNS transparency chunk' };
    } else if (type === 'IEND') {
      break;
    }
  }
  if (header === null) return { ok: false, reason: 'no IHDR chunk' };
  if (dataChunks.length === 0) return { ok: false, reason: 'no IDAT chunk' };
  return { ok: true, header, dataChunks };
}

/**
 * Decode one PNG into raw RGB(A) bytes. Every refusal names the shape it saw,
 * so the caller blocks with a reason instead of measuring a misread image.
 */
export function decodePng(bytes: Uint8Array): PngDecode {
  const buffer = Buffer.from(bytes);
  if (buffer.length < PNG_SIGNATURE.length)
    return { ok: false, reason: 'a truncated PNG signature' };
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) return { ok: false, reason: 'a missing PNG signature' };
  }
  const scan = scanChunks(buffer);
  if (!scan.ok) return scan;
  const { header, dataChunks } = scan;
  const bpp = header.colourType === COLOUR_RGBA ? 4 : 3;
  const expected = header.height * (1 + header.width * bpp);
  let raw: Buffer;
  try {
    raw = inflateZlib(Buffer.concat(dataChunks), expected);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `an IDAT stream that did not inflate (${detail})` };
  }
  if (raw.length !== expected) {
    return {
      ok: false,
      reason: `an IDAT stream of ${String(raw.length)} bytes, expected ${String(expected)}`
    };
  }
  const pixels = unfilter(raw, header, bpp);
  if (!pixels.ok) return pixels;
  return { ok: true, width: header.width, height: header.height, bpp, pixels: pixels.pixels };
}

/**
 * One indirection so a test could observe the inflate refusal without mocking
 * zlib. `maxOutputLength` is the IHDR's own expected raw size, so a stream that
 * inflates past what the image can hold is refused DURING inflate instead of
 * after a multi-hundred-megabyte allocation.
 */
function inflateZlib(data: Buffer, maxOutputLength: number): Buffer {
  return inflateSync(data, { maxOutputLength });
}

/**
 * Quantise every channel to 5 bits and measure the modal-colour share, the
 * distinct-colour count, and the population luminance std. The mean luminance
 * is 0..255 (Rec.709 weights), so the std matches the spike's scale.
 */
export function paintMetric(
  pixels: Buffer,
  width: number,
  height: number,
  bpp: number
): PaintMetric {
  const total = width * height;
  const counts = new Int32Array(32 * 32 * 32);
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < total; index += 1) {
    const at = index * bpp;
    const red = pixels[at] ?? 0;
    const green = pixels[at + 1] ?? 0;
    const blue = pixels[at + 2] ?? 0;
    counts[((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3)] =
      (counts[((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3)] ?? 0) + 1;
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  let modal = 0;
  let colours = 0;
  for (const count of counts) {
    if (count === 0) continue;
    colours += 1;
    if (count > modal) modal = count;
  }
  const mean = sum / total;
  return {
    nonModalPct: total === 0 ? 0 : ((total - modal) / total) * 100,
    quantisedColours: colours,
    luminanceStd: Math.sqrt(Math.max(sumSquares / total - mean * mean, 0))
  };
}

/** The one predicate: a near-uniform frame is unusable evidence of a page. */
export function isNearUniform(metric: PaintMetric): boolean {
  return (
    metric.nonModalPct < PAINT_NON_MODAL_MIN_PCT ||
    (metric.quantisedColours <= PAINT_FLAT_MAX_COLOURS && metric.luminanceStd < PAINT_FLAT_MAX_STD)
  );
}

/** Decode and measure one PNG; a refused shape is a value, never a throw. */
export function measurePng(bytes: Uint8Array): PaintRead {
  const decoded = decodePng(bytes);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  return {
    ok: true,
    metric: paintMetric(decoded.pixels, decoded.width, decoded.height, decoded.bpp)
  };
}
