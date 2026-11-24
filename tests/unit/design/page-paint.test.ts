import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { PaintMetric } from '../../../src/services/design/paint-metric.js';
import {
  capturePaint,
  describePaint,
  measureCapture,
  paintRefusal,
  readCaptureDocument,
  unusableMarker,
  type PaintPage
} from '../../../src/services/design/page-paint.js';
import { rgbPng } from './_png-bytes.js';

declareDimensions('tests/unit/design/page-paint.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const OUT = resolve('capture-out');
const PNG_PATH = resolve(OUT, 'screenshots', 'full-page.png');

/** The JSON `designlang extract` prints, with overridable fields. */
function captureStdout(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    componentScreenshots: { fullPage: { path: 'screenshots/full-page.png' } },
    meta: { title: 'Ledgerly' },
    voice: { sampleHeadings: ['Reconciliation'] },
    ...overrides
  });
}

const RENDERED: PaintMetric = { nonModalPct: 5.5, quantisedColours: 1579, luminanceStd: 20.19 };
const BLANK: PaintMetric = { nonModalPct: 0, quantisedColours: 1, luminanceStd: 0 };

function page(overrides: Partial<PaintPage> = {}): PaintPage {
  return {
    status: 200,
    finalUrl: 'http://127.0.0.1:7611/',
    pageTitle: 'Ledgerly',
    pageHeadings: ['Reconciliation'],
    paint: RENDERED,
    ...overrides
  };
}

describe('Scenario: render — the capture document names what it wrote', () => {
  it('when the capture prints its real JSON shape, should read the PNG path, title and headings', () => {
    // given: the measured capture document
    // when: it is read against the capture out dir
    // then: every field is carried and the path is resolved inside the out dir
    const read = readCaptureDocument(captureStdout(), OUT);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.reason);
    expect(read.document).toEqual({
      pngPath: PNG_PATH,
      title: 'Ledgerly',
      headings: ['Reconciliation']
    });
  });

  it('when titles and headings carry the wrong types, should drop them without throwing', () => {
    // given: a numeric title and a heading list mixing strings with numbers
    // when: the capture document is read
    // then: only a real title string and real heading strings survive
    const read = readCaptureDocument(
      captureStdout({ meta: { title: 42 }, voice: { sampleHeadings: ['A', 7, null, 'B'] } }),
      OUT
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.document.title).toBeNull();
    expect(read.document.headings).toEqual(['A', 'B']);
  });

  it('when a title is only whitespace, should record null rather than blank text', () => {
    // given: a title of spaces and a headings value that is not an array
    // when: the capture document is read
    // then: both absent signals become null and an empty list
    const read = readCaptureDocument(
      captureStdout({ meta: { title: '   ' }, voice: { sampleHeadings: 'Reconciliation' } }),
      OUT
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.document.title).toBeNull();
    expect(read.document.headings).toEqual([]);
  });
});

describe('Scenario: behavior — a capture whose shapes are unusable is refused', () => {
  it('when the capture prints no JSON document, should refuse with that exact reason', () => {
    // given: stdout that is not JSON at all
    // when: the capture document is read
    // then: the refusal names the missing document
    expect(readCaptureDocument('Launching browser...', OUT)).toEqual({
      ok: false,
      reason: 'the capture printed no JSON document'
    });
  });

  it('when componentScreenshots carries no fullPage path, should refuse with that reason', () => {
    // given: a document whose screenshots section is missing, one that is a string,
    //        and one whose fullPage value is an array, plus a whitespace-only path
    // when: each is read
    // then: all are refused for the absent path, not misread as a path
    for (const body of [
      { meta: { title: 'x' } },
      { componentScreenshots: null },
      { componentScreenshots: 'nope' },
      { componentScreenshots: { fullPage: [] } },
      { componentScreenshots: { fullPage: { path: '   ' } } }
    ]) {
      expect(readCaptureDocument(JSON.stringify(body), OUT)).toEqual({
        ok: false,
        reason: 'the capture JSON named no componentScreenshots.fullPage.path'
      });
    }
  });

  it('when the reported path is absolute or escapes the out dir, should refuse each', () => {
    // given: four reported paths outside the capture out dir
    // when: each document is read
    // then: the refusal quotes the reported value and nothing is resolved
    for (const reported of ['/etc/passwd', '..', 'screenshots/../../escape.png', '.']) {
      const read = readCaptureDocument(
        captureStdout({ componentScreenshots: { fullPage: { path: reported } } }),
        OUT
      );
      expect(read.ok, reported).toBe(false);
      if (read.ok) throw new Error('expected a refusal');
      expect(read.reason).toBe(`the capture reported a path outside its out dir (${reported})`);
    }
  });
});

describe('Scenario: integration — reading and measuring the PNG is a value, never a throw', () => {
  it('when the capture writes a rendered PNG, should measure it and keep the document', async () => {
    // given: a rendered PNG replayed through the injected byte reader
    // when: the capture is measured
    // then: the metric is real and the document travels with it
    const bytes = rgbPng({
      width: 40,
      height: 20,
      pixel: (x) => (x < 20 ? [14, 114, 188] : [255, 101, 104])
    });
    const measured = await measureCapture(captureStdout(), OUT, () => Promise.resolve(bytes));
    expect(measured.ok).toBe(true);
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.nonModalPct).toBeCloseTo(50, 0);
    expect(measured.document.title).toBe('Ledgerly');
  });

  it('when the PNG cannot be read or is not a PNG, should return the exact refusal', async () => {
    // given: a reader that throws EACCES and one that returns non-PNG bytes
    // when: each capture is measured
    // then: the read failure and the decoder refusal are both values
    const missing = await measureCapture(captureStdout(), OUT, () =>
      Promise.reject(new Error('EACCES'))
    );
    expect(missing).toEqual({ ok: false, reason: 'the captured PNG could not be read (EACCES)' });
    const corrupt = await measureCapture(captureStdout(), OUT, () =>
      Promise.resolve(Buffer.from('not a png', 'ascii'))
    );
    expect(corrupt.ok).toBe(false);
    if (corrupt.ok) throw new Error('expected a refusal');
    expect(corrupt.reason).toBe('the captured PNG was refused: a missing PNG signature');
  });

  it('when the capture spawn throws or times out, should refuse instead of propagating', async () => {
    // given: a spawn that throws ENOENT and one whose child timed out
    // when: capturePaint runs
    // then: each failure is a named refusal value
    const threw = await capturePaint({
      url: 'http://127.0.0.1:7611/',
      outDir: OUT,
      runCapture: () => Promise.reject(new Error('spawn ENOENT'))
    });
    expect(threw).toEqual({
      ok: false,
      reason: 'the viewport capture threw before printing: spawn ENOENT'
    });
    const timedOut = await capturePaint({
      url: 'http://127.0.0.1:7611/',
      outDir: OUT,
      runCapture: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '', timedOut: true })
    });
    expect(timedOut).toEqual({ ok: false, reason: 'the viewport capture timed out' });
  });

  it('when the capture fails after printing no JSON, should append its exit code', async () => {
    // given: a capture that exits 2 with empty stdout
    // when: capturePaint runs
    // then: the refusal names the capture failure and the exit code
    const refused = await capturePaint({
      url: 'http://127.0.0.1:7611/',
      outDir: OUT,
      runCapture: () =>
        Promise.resolve({ exitCode: 2, stdout: '', stderr: 'boom', timedOut: false })
    });
    expect(refused).toEqual({
      ok: false,
      reason: 'the capture printed no JSON document (capture exited 2)'
    });
  });
});

describe('Scenario: behavior — route identity and paint decide the refusal', () => {
  it('when a title or heading starts with each unusable marker, should name that marker', () => {
    // given: every state the pilot measured as unusable, plus the anchored forms
    // when: the marker check runs
    // then: each is named by its own label
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['Sign in', 'a sign-in heading'],
      ['log-in now', 'a sign-in heading'],
      ['Login', 'a sign-in heading'],
      ['signin', 'a sign-in heading'],
      ['Page not found', 'a not-found heading'],
      ['not found', 'a not-found heading'],
      ['400 Bad Request', 'an HTTP error heading'],
      ['401', 'an HTTP error heading'],
      ['403 Forbidden zone', 'an HTTP error heading'],
      ['404 Not Found', 'an HTTP error heading'],
      ['405', 'an HTTP error heading'],
      ['500', 'an HTTP error heading'],
      ['502', 'an HTTP error heading'],
      ['503', 'an HTTP error heading'],
      ['Unauthorized', 'an access-denied heading'],
      ['Unauthorised', 'an access-denied heading'],
      ['access denied', 'an access-denied heading'],
      ['Forbidden', 'an access-denied heading']
    ];
    for (const [text, label] of cases) {
      expect(unusableMarker(text, []), text).toEqual({ label, text });
    }
  });

  it('when the marker text is surrounded by whitespace, should normalise it before matching', () => {
    // given: a title split across a newline and tab, and a marked second heading
    // when: the marker check runs
    // then: the text is single-lined and the marker is found
    expect(unusableMarker('  Sign\n\t in  Ledgerly', [])).toEqual({
      label: 'a sign-in heading',
      text: 'Sign in Ledgerly'
    });
    expect(unusableMarker(null, ['Reconciliation', '404 Not Found'])).toEqual({
      label: 'an HTTP error heading',
      text: '404 Not Found'
    });
  });

  it('when the status word is not at the start, should not false-block real content', () => {
    // given: headings that merely contain a status word or a lookalike
    // when: the marker check runs
    // then: none is a marker and the page carries no identity refusal
    for (const text of ['How to handle 404 errors', 'Signatures', 'Logistics', 'Our 500 users']) {
      expect(unusableMarker(text, []), text).toBeNull();
    }
  });

  it('when the page is marked or near-uniform, should say which refusal won', () => {
    // given: a sign-in page that is also uniform, and a blank unmarked page
    // when: the paint refusal is computed
    // then: the marker is checked first, then the paint metric
    const marked = paintRefusal(page({ pageTitle: 'Sign in', paint: BLANK }));
    expect(marked).toContain('it rendered a sign-in heading ("Sign in")');
    expect(marked).toContain('nonModalPct 0.00');
    const blank = paintRefusal(page({ pageTitle: null, pageHeadings: [], paint: BLANK }));
    expect(blank).toBe(
      'its viewport capture is near-uniform, so the page was blank or still hydrating ' +
        '(status 200, finalUrl http://127.0.0.1:7611/, nonModalPct 0.00, quantisedColours 1, luminanceStd 0.00)'
    );
    expect(paintRefusal(page())).toBeNull();
  });
});

describe('Scenario: a11y — describePaint carries measured fields, never a score', () => {
  it('when the page did not answer, should print "no response" for both HTTP fields', () => {
    // given: a page with no status and no final URL
    // when: the paint fields are described
    // then: both fall back to "no response" and the numbers keep two decimals
    expect(describePaint({ status: null, finalUrl: null }, RENDERED)).toBe(
      'status no response, finalUrl no response, nonModalPct 5.50, quantisedColours 1579, luminanceStd 20.19'
    );
  });

  it('when the final URL carries credentials, should mask them in the described text', () => {
    // given: a redirect whose final URL carries userinfo and a zero-valued metric
    // when: the paint fields are described
    // then: no credential survives and zero is formatted as 0.00
    const text = describePaint(
      { status: 302, finalUrl: 'http://alice:s3cret@127.0.0.1:4321/next' },
      { nonModalPct: 0, quantisedColours: 1, luminanceStd: 0 }
    );
    expect(text).toContain('http://127.0.0.1:4321/next');
    expect(text).not.toContain('alice');
    expect(text).not.toContain('s3cret');
    expect(text).toContain('nonModalPct 0.00');
    expect(text).toContain('luminanceStd 0.00');
    expect(text).not.toContain('score');
  });
});
