/**
 * Synthetic PNG bytes for the paint-metric tests. No image library, no
 * browser: a real 8-bit RGB PNG is assembled from a pixel function (zlib
 * IDAT, CRC-32 chunks), so the decoder is driven from bytes exactly as it is
 * in production.
 */
import { deflateSync } from 'node:zlib';

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export type Pixel = readonly [number, number, number];

/** The PNG filter byte written per row. 5 is deliberately out of range. */
export type PngFilter = 0 | 1 | 2 | 3 | 4 | 5;

export type RgbPngOptions = {
  width: number;
  height: number;
  pixel: (x: number, y: number) => Pixel;
  /** Defaults to 2 (RGB). 6 writes RGBA with an opaque alpha channel. */
  colourType?: 2 | 6;
  /** Defaults to 0 (none); 1-4 exercise every unfilter arm, 5 is refused. */
  filter?: PngFilter;
};

/** The PNG Paeth predictor, mirroring the decoder's own branch order. */
function paethEncoder(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** Build one valid 8-bit, non-interlaced PNG from a pixel function. */
export function rgbPng(options: RgbPngOptions): Buffer {
  const { width, height, pixel, colourType = 2, filter = 0 } = options;
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const decoded = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      const at = y * stride + x * bpp;
      decoded[at] = red;
      decoded[at + 1] = green;
      decoded[at + 2] = blue;
      if (bpp === 4) decoded[at + 3] = 255;
    }
  }
  // Encode each row with the requested PNG filter, using DECODED neighbours.
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + stride);
    raw[row] = filter;
    for (let x = 0; x < stride; x += 1) {
      const value = decoded[y * stride + x] ?? 0;
      const left = x >= bpp ? (decoded[y * stride + x - bpp] ?? 0) : 0;
      const up = y > 0 ? (decoded[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= bpp ? (decoded[(y - 1) * stride + x - bpp] ?? 0) : 0;
      const predicted =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paethEncoder(left, up, upLeft)
                : 0;
      const encoded = value - predicted;
      raw[row + 1 + x] = encoded & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = colourType;
  header[10] = 0; // compression
  header[11] = 0; // filter method
  header[12] = 0; // non-interlaced
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Overwrite one byte of a PNG (used to break a header field on purpose). */
export function withByte(bytes: Buffer, index: number, value: number): Buffer {
  const copy = Buffer.from(bytes);
  copy[index] = value;
  return copy;
}

/** A PNG whose IHDR chunk body is `length` bytes, shorter than the 13 it must be. */
export function shortIhdrPng(length: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', Buffer.alloc(length, 0)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * A PNG whose IHDR passes every shape check but whose IDAT inflates to
 * `rawBytes` bytes of zeros — more than the declared image can hold, so the
 * decoder must refuse it before allocating the whole stream.
 */
export function inflateBombPng(options: {
  width: number;
  height: number;
  rawBytes: number;
}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(options.width, 0);
  header.writeUInt32BE(options.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(options.rawBytes))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Insert an extra chunk body (e.g. tRNS) just before IDAT. */
export function withChunk(bytes: Buffer, type: string, data: Uint8Array): Buffer {
  const extra = chunk(type, data);
  const idat = bytes.indexOf(Buffer.from('IDAT', 'ascii')) - 4;
  return Buffer.concat([bytes.subarray(0, idat), extra, bytes.subarray(idat)]);
}

/** Append a well-formed chunk after IEND, where a strict decoder never reads it. */
export function appendChunk(bytes: Buffer, type: string, data: Uint8Array): Buffer {
  return Buffer.concat([bytes, chunk(type, data)]);
}

/** Remove the first chunk of `type` (length, type, body and CRC). */
export function withoutChunk(bytes: Buffer, type: string): Buffer {
  const typeAt = bytes.indexOf(Buffer.from(type, 'ascii'));
  if (typeAt < 4) throw new Error(`no ${type} chunk in the fixture`);
  const start = typeAt - 4;
  const length = bytes.readUInt32BE(start);
  return Buffer.concat([bytes.subarray(0, start), bytes.subarray(start + 12 + length)]);
}

/** The 13-byte IHDR body of a valid PNG, for duplicate-header fixtures. */
export function ihdrBody(bytes: Buffer): Buffer {
  const typeAt = bytes.indexOf(Buffer.from('IHDR', 'ascii'));
  const dataAt = typeAt + 4;
  return Buffer.from(bytes.subarray(dataAt, dataAt + 13));
}
