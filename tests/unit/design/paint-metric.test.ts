import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  decodePng,
  isNearUniform,
  measurePng,
  paintMetric,
  type PaintMetric
} from '../../../src/services/design/paint-metric.js';
import {
  rgbPng,
  inflateBombPng,
  shortIhdrPng,
  withByte,
  withChunk,
  appendChunk,
  ihdrBody,
  withoutChunk
} from './_png-bytes.js';

declareDimensions('tests/unit/design/paint-metric.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** A white/black split whose second colour covers exactly `nonModalPct`. */
function splitPng(nonModalPct: number): ReturnType<typeof rgbPng> {
  const width = 1000;
  const height = 100;
  const dark = Math.round((nonModalPct / 100) * width * height);
  return rgbPng({
    width,
    height,
    pixel: (x, y) => (y * width + x < dark ? [0, 0, 0] : [255, 255, 255])
  });
}

describe('Scenario: render — synthetic PNGs decode into the measured metric', () => {
  it('when every pixel is the same colour, should report one colour and zero variance', () => {
    // given: a uniform 20×10 RGB PNG
    // when: it is decoded and measured
    // then: the frame is one quantised colour with no non-modal pixels
    const measured = measurePng(rgbPng({ width: 20, height: 10, pixel: () => [40, 80, 120] }));
    expect(measured.ok).toBe(true);
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.quantisedColours).toBe(1);
    expect(measured.metric.nonModalPct).toBe(0);
    expect(measured.metric.luminanceStd).toBeLessThan(0.001);
    expect(isNearUniform(measured.metric)).toBe(true);
  });

  it('when a frame carries several colours, should count them and pass the paint test', () => {
    // given: a PNG with a coloured top half and white bottom half
    // when: it is measured
    // then: it has more than one colour, a large non-modal share, and is not near-uniform
    const measured = measurePng(
      rgbPng({
        width: 40,
        height: 20,
        pixel: (x, y) => (y < 10 ? [14, 114, 188] : [255, 255, 255])
      })
    );
    expect(measured.ok).toBe(true);
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.quantisedColours).toBeGreaterThan(1);
    expect(measured.metric.nonModalPct).toBeCloseTo(50, 0);
    expect(isNearUniform(measured.metric)).toBe(false);
  });

  it('when the PNG is RGBA, should measure the RGB channels and ignore alpha', () => {
    // given: an RGBA PNG with opaque alpha
    // when: it is measured
    // then: it decodes and measures like the RGB equivalent
    const measured = measurePng(
      rgbPng({ width: 10, height: 10, colourType: 6, pixel: () => [200, 100, 50] })
    );
    expect(measured.ok).toBe(true);
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.quantisedColours).toBe(1);
  });

  it('when rows use the Sub and Up filters, should unfilter them to the same metric', () => {
    // given: one pixel pattern encoded with filter 0, 1, and 2
    // when: each is decoded
    // then: all three report the same colours and variance
    const pattern = (x: number): readonly [number, number, number] =>
      x % 2 === 0 ? [10, 20, 30] : [240, 250, 200];
    const baseline = measurePng(rgbPng({ width: 8, height: 6, pixel: pattern, filter: 0 }));
    const sub = measurePng(rgbPng({ width: 8, height: 6, pixel: pattern, filter: 1 }));
    const up = measurePng(rgbPng({ width: 8, height: 6, pixel: pattern, filter: 2 }));
    for (const measured of [baseline, sub, up]) {
      expect(measured.ok).toBe(true);
    }
    if (!baseline.ok || !sub.ok || !up.ok) throw new Error('expected three decodes');
    expect(sub.metric).toEqual(baseline.metric);
    expect(up.metric).toEqual(baseline.metric);
  });

  it('when rows use Average or Paeth, should unfilter a two-dimensional pattern exactly', () => {
    // given: a 6×5 gradient encoded with filter 0, 3 (Average) and 4 (Paeth)
    // when: each is decoded
    // then: both predictive filters reproduce the unfiltered metric pixel for pixel
    const gradient = (x: number, y: number): readonly [number, number, number] => [
      (x * 37 + y * 11) & 0xff,
      (x * 13 + y * 71) & 0xff,
      (x * 5 + y * 3) & 0xff
    ];
    const baseline = measurePng(rgbPng({ width: 6, height: 5, pixel: gradient, filter: 0 }));
    const average = measurePng(rgbPng({ width: 6, height: 5, pixel: gradient, filter: 3 }));
    const paeth = measurePng(rgbPng({ width: 6, height: 5, pixel: gradient, filter: 4 }));
    if (!baseline.ok || !average.ok || !paeth.ok) throw new Error('expected three decodes');
    expect(average.metric).toEqual(baseline.metric);
    expect(paeth.metric).toEqual(baseline.metric);
    const baselinePixels = decodePng(rgbPng({ width: 6, height: 5, pixel: gradient, filter: 0 }));
    const paethPixels = decodePng(rgbPng({ width: 6, height: 5, pixel: gradient, filter: 4 }));
    if (!baselinePixels.ok || !paethPixels.ok) throw new Error('expected two pixel decodes');
    expect(Array.from(paethPixels.pixels)).toEqual(Array.from(baselinePixels.pixels));
  });

  it('when a scanline carries an out-of-range filter byte, should refuse with its row number', () => {
    // given: a row whose filter byte is 5
    // when: the decoder runs
    // then: the refusal names the row and the byte instead of guessing a filter
    const refused = decodePng(rgbPng({ width: 4, height: 3, pixel: () => [1, 2, 3], filter: 5 }));
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.reason).toBe('row 0 uses filter type 5');
  });
});

describe('Scenario: behavior — the block threshold and its boundaries', () => {
  it('when the non-modal share is 0.9 %, should block', () => {
    // given: a frame 0.9 % non-modal
    // when: it is measured
    // then: it is below the 1.0 % line and blocks
    const measured = measurePng(splitPng(0.9));
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.nonModalPct).toBeCloseTo(0.9, 6);
    expect(isNearUniform(measured.metric)).toBe(true);
  });

  it('when the non-modal share is exactly 1.0 %, should pass', () => {
    // given: a frame exactly on the threshold
    // when: it is measured
    // then: the predicate is strictly less-than, so it does not block
    const measured = measurePng(splitPng(1));
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.nonModalPct).toBeCloseTo(1, 6);
    expect(isNearUniform(measured.metric)).toBe(false);
  });

  it('when the non-modal share is 3.0 % (the round-3 rendered minimum), should pass', () => {
    // given: a frame at the smallest rendered share the spike measured
    // when: it is measured
    // then: real content is never blocked by the threshold
    const measured = measurePng(splitPng(3));
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.nonModalPct).toBeCloseTo(3, 6);
    expect(isNearUniform(measured.metric)).toBe(false);
  });

  it('when few colours and low variance meet above 1 %, should block on the equivalent clause', () => {
    // given: a metric with 1.5 % non-modal, four colours, and variance 1.0
    // when: the predicate runs
    // then: the corroborating clause blocks it without the primary clause
    const flat: PaintMetric = { nonModalPct: 1.5, quantisedColours: 4, luminanceStd: 1 };
    expect(isNearUniform(flat)).toBe(true);
    expect(isNearUniform({ ...flat, quantisedColours: 9 })).toBe(false);
    expect(isNearUniform({ ...flat, luminanceStd: 3 })).toBe(false);
  });

  it('when the round-3 measured rows are replayed, should sort blank from rendered', () => {
    // given: the spike's measured blank and rendered captures
    // when: the predicate runs on each row
    // then: only the blank row blocks
    const rows: { label: string; metric: PaintMetric; block: boolean }[] = [
      {
        label: 'blank shell',
        metric: { nonModalPct: 0, quantisedColours: 1, luminanceStd: 0 },
        block: true
      },
      {
        label: 'fixture blank',
        metric: { nonModalPct: 0, quantisedColours: 1, luminanceStd: 0 },
        block: true
      },
      {
        label: '404 card (rendered minimum)',
        metric: { nonModalPct: 3.03, quantisedColours: 1296, luminanceStd: 13.77 },
        block: false
      },
      {
        label: '/channels sign-in redirect',
        metric: { nonModalPct: 6.82, quantisedColours: 1541, luminanceStd: 16.55 },
        block: false
      },
      {
        label: '/about',
        metric: { nonModalPct: 5.5, quantisedColours: 1579, luminanceStd: 20.19 },
        block: false
      },
      {
        label: '/docs',
        metric: { nonModalPct: 13.91, quantisedColours: 1775, luminanceStd: 33.6 },
        block: false
      },
      {
        label: 'fixture rendered',
        metric: { nonModalPct: 23.9, quantisedColours: 661, luminanceStd: 25.59 },
        block: false
      }
    ];
    for (const row of rows) expect(isNearUniform(row.metric), row.label).toBe(row.block);
  });
});

describe('Scenario: integration — a PNG shape the decoder cannot read is refused', () => {
  const valid = rgbPng({ width: 4, height: 4, pixel: () => [1, 2, 3] });

  it('when the signature is missing, should refuse', () => {
    // given: bytes that are not a PNG
    // when: the decoder runs
    // then: it refuses the signature
    const refused = decodePng(Buffer.from('not a png at all', 'ascii'));
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.reason).toContain('signature');
  });

  it('when the PNG is truncated, should refuse rather than measure partial bytes', () => {
    // given: the first 20 bytes of a valid PNG
    // when: the decoder runs
    // then: the truncated chunk is refused
    const refused = decodePng(valid.subarray(0, 20));
    expect(refused.ok).toBe(false);
  });

  it('when the IHDR is 16-bit, indexed, or interlaced, should refuse each shape', () => {
    // given: three PNGs whose IHDR is outside the supported shape
    // when: each is decoded
    // then: each refusal names the shape it saw
    const sixteenBit = decodePng(withByte(valid, 24, 16));
    const indexed = decodePng(withByte(valid, 25, 3));
    const interlaced = decodePng(withByte(valid, 28, 1));
    for (const refused of [sixteenBit, indexed, interlaced]) {
      expect(refused.ok).toBe(false);
    }
    if (sixteenBit.ok || indexed.ok || interlaced.ok) throw new Error('expected refusals');
    expect(sixteenBit.reason).toContain('bit depth');
    expect(indexed.reason).toContain('colour type');
    expect(interlaced.reason).toContain('interlaced');
  });

  it('when a tRNS chunk or a corrupt IDAT appears, should refuse', () => {
    // given: a PNG with transparency, and one whose IDAT bytes are corrupted
    // when: each is decoded
    // then: neither is silently misread as opaque RGB
    const transparent = decodePng(withChunk(valid, 'tRNS', Buffer.from([0, 1, 0, 2, 0, 3])));
    const corrupt = Buffer.from(valid);
    const idat = corrupt.indexOf(Buffer.from('IDAT', 'ascii'));
    corrupt.fill(0xff, idat + 4, idat + 12);
    const corrupted = decodePng(corrupt);
    expect(transparent.ok).toBe(false);
    expect(corrupted.ok).toBe(false);
    if (transparent.ok || corrupted.ok) throw new Error('expected refusals');
    expect(transparent.reason).toContain('tRNS');
  });

  it('when the pixel count is zero, should refuse', () => {
    // given: an IHDR claiming width 0 (its low byte cleared)
    // when: the decoder runs
    // then: a zero-sized canvas is refused
    const refused = decodePng(withByte(valid, 19, 0));
    expect(refused.ok).toBe(false);
  });

  it('when the IHDR is 0, 2, 4 or 7 bytes, should refuse without throwing', () => {
    // given: four IHDR chunks shorter than the 13 bytes every field read needs
    // when: each is decoded
    // then: each is a value, never a RangeError out of the decoder
    for (const length of [0, 2, 4, 7]) {
      expect(() => decodePng(shortIhdrPng(length))).not.toThrow();
      const refused = decodePng(shortIhdrPng(length));
      expect(refused.ok, `IHDR of ${String(length)} bytes`).toBe(false);
      if (refused.ok) throw new Error('expected a refusal');
      expect(refused.reason).toContain('IHDR');
    }
  });

  it('when the IDAT inflates past the declared image, should refuse during inflate', () => {
    // given: a 10×10 RGB header (310 raw bytes) and an IDAT holding 4 MiB of zeros
    // when: the decoder runs
    // then: the output cap refuses it as an inflate failure, before any length check
    const refused = decodePng(inflateBombPng({ width: 10, height: 10, rawBytes: 4 * 1024 * 1024 }));
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.reason).toContain('did not inflate');
  });

  it('when the IHDR is larger than the pixel cap, should refuse it', () => {
    // given: a 4096×4096 canvas (16.7 M px) and the measured 2560×1600 capture size
    // when: each header is decoded
    // then: the oversized canvas is refused and the real capture shape is not
    const oversized = decodePng(inflateBombPng({ width: 4096, height: 4096, rawBytes: 0 }));
    const measured = decodePng(inflateBombPng({ width: 2560, height: 1600, rawBytes: 0 }));
    expect(oversized.ok).toBe(false);
    expect(measured.ok).toBe(false);
    if (oversized.ok || measured.ok) throw new Error('expected refusals');
    expect(oversized.reason).toContain('pixel cap');
    expect(measured.reason).not.toContain('pixel cap');
  });
});

describe('Scenario: behavior — the metric is pure arithmetic', () => {
  it('when a 2×2 buffer is measured directly, should return the modal share', () => {
    // given: three white pixels and one black pixel
    // when: the metric is computed from raw bytes
    // then: the non-modal share is exactly 25 %
    const pixels = Buffer.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0]);
    const metric = paintMetric(pixels, 2, 2, 3);
    expect(metric.nonModalPct).toBe(25);
    expect(metric.quantisedColours).toBe(2);
  });

  it('when one pixel is red, green or blue and the other black, should use Rec.709 weights', () => {
    // given: each primary colour paired with black
    // when: the luminance standard deviation is measured
    // then: each channel's own weight decides the result
    const metricOf = (pixel: readonly [number, number, number]): PaintMetric =>
      paintMetric(Buffer.from([...pixel, 0, 0, 0]), 2, 1, 3);
    expect(metricOf([255, 0, 0]).luminanceStd).toBeCloseTo(27.1065, 4);
    expect(metricOf([0, 255, 0]).luminanceStd).toBeCloseTo(91.188, 4);
    expect(metricOf([0, 0, 255]).luminanceStd).toBeCloseTo(9.2055, 4);
  });

  it('when the pixel buffer is shorter than its declared size, should treat missing channels as zero', () => {
    // given: three two-pixel buffers that each omit or vary one channel
    // when: the metric is computed straight from the short bytes
    // then: every omitted channel reads as zero instead of dropping a pixel
    const greenOmitted = paintMetric(Buffer.from([10, 20, 0, 10, 0, 0]), 2, 1, 3);
    expect(greenOmitted.quantisedColours).toBe(2);
    expect(greenOmitted.nonModalPct).toBe(50);
    const blueOmitted = paintMetric(Buffer.from([10, 20, 24, 10, 20, 0]), 2, 1, 3);
    expect(blueOmitted.quantisedColours).toBe(2);
    const redOmitted = paintMetric(Buffer.from([18, 20, 0, 10, 20, 0]), 2, 1, 3);
    expect(redOmitted.quantisedColours).toBe(2);
    const trailingOmitted = paintMetric(Buffer.from([10, 20]), 1, 1, 3);
    expect(trailingOmitted.quantisedColours).toBe(1);
  });

  it('when the canvas is empty, should report no non-modal share and no colours', () => {
    // given: zero pixels with a declared zero size
    // when: the metric is computed
    // then: the modal share is 0 rather than NaN and no colour is counted
    const metric = paintMetric(Buffer.alloc(0), 0, 0, 3);
    expect(metric.nonModalPct).toBe(0);
    expect(metric.quantisedColours).toBe(0);
  });
});

describe('Scenario: integration — refusals name the exact shape they saw', () => {
  const valid = rgbPng({ width: 4, height: 4, pixel: () => [1, 2, 3] });

  it('when the signature is shorter than eight bytes or all zeroes, should name each failure', () => {
    // given: a three-byte input and eight zero bytes
    // when: each is decoded
    // then: the truncated and missing signatures are told apart
    const truncated = decodePng(Buffer.from([137, 80, 78]));
    const missing = decodePng(Buffer.alloc(8));
    if (truncated.ok || missing.ok) throw new Error('expected refusals');
    expect(truncated.reason).toBe('a truncated PNG signature');
    expect(missing.reason).toBe('a missing PNG signature');
  });

  it('when the compression or filter method is nonzero, should refuse each method', () => {
    // given: an IHDR whose compression byte and filter byte are 1
    // when: each is decoded
    // then: each refusal names the field and its value
    const compression = decodePng(withByte(valid, 26, 1));
    const filter = decodePng(withByte(valid, 27, 1));
    if (compression.ok || filter.ok) throw new Error('expected refusals');
    expect(compression.reason).toBe('compression method 1');
    expect(filter.reason).toBe('filter method 1');
  });

  it('when the height is zero, should refuse the zero-sized canvas', () => {
    // given: an IHDR whose height low byte is cleared
    // when: the decoder runs
    // then: a zero-sized canvas is refused before any allocation
    const refused = decodePng(withByte(valid, 23, 0));
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.reason).toBe('a zero-sized IHDR');
  });

  it('when the canvas is exactly at the pixel cap, should not refuse it for size', () => {
    // given: 4000×4000 (exactly 16 M px) and 4001×4000 (over it)
    // when: each header is decoded
    // then: only the larger canvas is refused by the pixel cap
    const atCap = decodePng(inflateBombPng({ width: 4000, height: 4000, rawBytes: 0 }));
    const overCap = decodePng(inflateBombPng({ width: 4001, height: 4000, rawBytes: 0 }));
    if (atCap.ok || overCap.ok) throw new Error('expected refusals');
    expect(atCap.reason).not.toContain('pixel cap');
    expect(atCap.reason).toBe('an IDAT stream of 0 bytes, expected 48004000');
    expect(overCap.reason).toBe('an IHDR larger than the pixel cap');
  });

  it('when there is no IDAT or a second IHDR, should refuse each stream shape', () => {
    // given: a PNG without IDAT and one with two IHDR chunks
    // when: each is decoded
    // then: the missing data and the duplicate header are named exactly
    const noData = decodePng(withoutChunk(valid, 'IDAT'));
    const twice = decodePng(withChunk(valid, 'IHDR', ihdrBody(valid)));
    if (noData.ok || twice.ok) throw new Error('expected refusals');
    expect(noData.reason).toBe('no IDAT chunk');
    expect(twice.reason).toBe('a second IHDR chunk');
  });

  it('when bytes follow IEND, should stop at IEND instead of reading them', () => {
    // given: a valid PNG with another IDAT appended after its IEND
    // when: it is decoded
    // then: the trailer is never inflated and the image still measures
    const measured = measurePng(appendChunk(valid, 'IDAT', Buffer.alloc(4)));
    expect(measured.ok).toBe(true);
  });

  it('when the PNG decodes, should report its width, height, bpp and pixel bytes', () => {
    // given: a 4×3 RGB PNG and a 4×3 RGBA PNG
    // when: each is decoded
    // then: the byte-per-pixel and buffer length follow the colour type
    const rgb = decodePng(rgbPng({ width: 4, height: 3, pixel: () => [1, 2, 3] }));
    const rgba = decodePng(rgbPng({ width: 4, height: 3, colourType: 6, pixel: () => [1, 2, 3] }));
    if (!rgb.ok || !rgba.ok) throw new Error('expected two decodes');
    expect({
      width: rgb.width,
      height: rgb.height,
      bpp: rgb.bpp,
      length: rgb.pixels.length
    }).toEqual({
      width: 4,
      height: 3,
      bpp: 3,
      length: 36
    });
    expect(rgba.bpp).toBe(4);
    expect(rgba.pixels.length).toBe(48);
  });

  it('when the flatness clause sits on either boundary, should use strict comparisons', () => {
    // given: eight colours at std 2, eight at 1.99, and nine at std 0
    // when: the predicate runs
    // then: exactly eight colours with a std below 2 is the only extra block
    const flat: PaintMetric = { nonModalPct: 5, quantisedColours: 8, luminanceStd: 2 };
    expect(isNearUniform(flat)).toBe(false);
    expect(isNearUniform({ ...flat, luminanceStd: 1.99 })).toBe(true);
    expect(isNearUniform({ ...flat, quantisedColours: 9, luminanceStd: 0 })).toBe(false);
    expect(isNearUniform({ ...flat, nonModalPct: 0.999, quantisedColours: 100 })).toBe(true);
  });
});
