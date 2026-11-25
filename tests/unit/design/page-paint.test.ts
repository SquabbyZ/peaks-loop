import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { DesignlangRunResult } from '../../../src/services/design/designlang.js';
import {
  CAPTURE_TIMEOUT_MS,
  captureIdentity,
  captureScreenshot,
  measureCapture,
  readIdentityDocument
} from '../../../src/services/design/page-capture.js';
import { EVIDENCE_SNIPPET_MAX } from '../../../src/services/design/evidence-text.js';
import type { PaintMetric } from '../../../src/services/design/paint-metric.js';
import {
  describePaint,
  paintRefusal,
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

/** The JSON `designlang extract --json` prints WITHOUT `--screenshots`. */
function identityStdout(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    componentScreenshots: {},
    meta: { title: 'Ledgerly' },
    voice: { sampleHeadings: ['Reconciliation'] },
    ...overrides
  });
}

function run(overrides: Partial<DesignlangRunResult> = {}): DesignlangRunResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...overrides };
}

/** A screenshot arm's stdout: a file list, never JSON. */
const SCREENSHOT_STDOUT = '/tmp/out/screenshots/full-page.png\n/tmp/out/DESIGN.md\n';

const RENDERED: PaintMetric = { nonModalPct: 5.5, quantisedColours: 1579, luminanceStd: 20.19 };
const BLANK: PaintMetric = { nonModalPct: 0, quantisedColours: 1, luminanceStd: 0 };

/** A rendered PNG for the injected byte reader. */
const RENDERED_PNG = rgbPng({
  width: 10,
  height: 10,
  pixel: (x) => (x < 5 ? [14, 114, 188] : [255, 101, 104])
});

function page(overrides: Partial<PaintPage> = {}): PaintPage {
  return {
    status: 200,
    finalUrl: 'http://127.0.0.1:7611/',
    paint: RENDERED,
    ...overrides
  };
}

describe('Scenario: render — the identity extract names the rendered text', () => {
  it('when the identity JSON has no screenshot path, should read title and headings', () => {
    // given: the measured identity payload, whose componentScreenshots is empty
    // when: it is read
    // then: title and headings are carried, the same payload feeds the route stage
    const read = readIdentityDocument(identityStdout());
    expect(read).toEqual({
      ok: true,
      document: { observation: { title: 'Ledgerly', headings: ['Reconciliation'] } }
    });
  });

  it('when titles and headings carry the wrong types, should drop them without throwing', () => {
    // given: a numeric title and a heading list mixing strings with numbers
    // when: the identity document is read
    // then: only a real title string and real heading strings survive
    const read = readIdentityDocument(
      identityStdout({ meta: { title: 42 }, voice: { sampleHeadings: ['A', 7, null, 'B'] } })
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.document.observation.title).toBeUndefined();
    expect(read.document.observation.headings).toEqual(['A', 'B']);
  });

  it('when a title is only whitespace, should record null rather than blank text', () => {
    // given: a title of spaces and a headings value that is not an array
    // when: the identity document is read
    // then: neither signal survives, so the observation stays empty
    const read = readIdentityDocument(
      identityStdout({ meta: { title: '   ' }, voice: { sampleHeadings: 'Reconciliation' } })
    );
    if (!read.ok) throw new Error(read.reason);
    expect(read.document.observation).toEqual({});
  });

  it('when the identity extract prints no JSON document, should refuse with that reason', () => {
    // given: stdout that is not JSON at all
    // when: the identity document is read
    // then: the refusal names the missing document
    expect(readIdentityDocument('Launching browser...')).toEqual({
      ok: false,
      reason: 'the identity extract printed no JSON document'
    });
  });
});

describe('Scenario: integration — the fixed screenshot path is measured, never a throw', () => {
  it('when the screenshot wrote a rendered PNG, should measure it', async () => {
    // given: a rendered PNG replayed through the injected byte reader
    // when: the out dir is measured
    // then: the metric is real and the reader was asked for the fixed path
    const bytes = rgbPng({
      width: 40,
      height: 20,
      pixel: (x) => (x < 20 ? [14, 114, 188] : [255, 101, 104])
    });
    const readBytes = vi.fn(() => Promise.resolve(bytes));
    const measured = await measureCapture(OUT, readBytes);
    expect(measured.ok).toBe(true);
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.nonModalPct).toBeCloseTo(50, 0);
    expect(readBytes).toHaveBeenCalledWith(resolve(OUT, 'screenshots', 'full-page.png'));
  });

  it('when the PNG cannot be read or is not a PNG, should return the exact refusal', async () => {
    // given: a reader that throws EACCES and one that returns non-PNG bytes
    // when: each capture is measured
    // then: the read failure and the decoder refusal are both values
    const missing = await measureCapture(OUT, () => Promise.reject(new Error('EACCES')));
    expect(missing).toEqual({ ok: false, reason: 'the captured PNG could not be read (EACCES)' });
    const corrupt = await measureCapture(OUT, () => Promise.resolve(Buffer.from('not a png')));
    expect(corrupt.ok).toBe(false);
    if (corrupt.ok) throw new Error('expected a refusal');
    expect(corrupt.reason).toBe('the captured PNG was refused: a missing PNG signature');
  });
});

describe('Scenario: behavior — the identity half runs and is timed on its own', () => {
  it('when the identity extract answers, should return the document and its elapsedMs', async () => {
    // given: a fake clock and an identity runner that takes 3 s
    // when: captureIdentity runs
    // then: the document is carried and the call is timed to the millisecond
    let clock = 1_000;
    const measured = await captureIdentity({
      url: 'http://127.0.0.1:7611/',
      runIdentity: () => {
        clock += 3_000;
        return Promise.resolve(run({ stdout: identityStdout() }));
      },
      now: () => clock
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.document.observation.title).toBe('Ledgerly');
    expect(measured.elapsedMs).toBe(3_000);
  });

  it('when the identity extract exits without JSON, should refuse as identity-failed', async () => {
    // given: an identity arm that exits 2 printing nothing
    // when: captureIdentity runs
    // then: the cause is identity-failed and the reason names the missing document
    const measured = await captureIdentity({
      url: 'http://127.0.0.1:7611/',
      runIdentity: () => Promise.resolve(run({ exitCode: 2, stdout: '' }))
    });
    expect(measured.ok).toBe(false);
    if (measured.ok) throw new Error('expected a refusal');
    expect(measured.cause).toBe('identity-failed');
    expect(measured.reason).toContain('the identity extract printed no JSON document');
  });

  it('when the identity extract throws or times out, should name that cause and time', async () => {
    // given: an identity runner that rejects and one that overran its budget
    // when: each is captured
    // then: each failure is a value naming its own cause
    const thrown = await captureIdentity({
      url: 'http://127.0.0.1:7611/',
      runIdentity: () => Promise.reject(new Error('spawn ENOENT'))
    });
    expect(thrown).toMatchObject({
      ok: false,
      cause: 'identity-failed',
      reason: 'the identity extract threw before printing: spawn ENOENT'
    });
    const timedOut = await captureIdentity({
      url: 'http://127.0.0.1:7611/',
      runIdentity: () => Promise.resolve(run({ timedOut: true }))
    });
    expect(timedOut).toMatchObject({
      ok: false,
      cause: 'identity-timeout',
      reason: 'the identity extract timed out'
    });
  });
});

describe('Scenario: behavior — the screenshot half runs alone and is bounded', () => {
  it('when the screenshot wrote a rendered PNG, should return the metric and elapsedMs', async () => {
    // given: a screenshot arm printing a file list and a replayed PNG
    // when: captureScreenshot runs
    // then: no JSON is required from it and the decoded metric is returned
    const measured = await captureScreenshot({
      url: 'http://127.0.0.1:7611/',
      outDir: OUT,
      runScreenshot: () => Promise.resolve(run({ stdout: SCREENSHOT_STDOUT })),
      readBytes: () => Promise.resolve(RENDERED_PNG)
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) throw new Error(measured.reason);
    expect(measured.metric.nonModalPct).toBeCloseTo(50, 0);
  });

  it('when the screenshot overruns its own budget, should report capture-timeout', async () => {
    // given: a screenshot arm marked timed out and a clock that advances 60 s
    // when: captureScreenshot runs
    // then: the cause is capture-timeout and the budget's elapsed time is measured
    let clock = 0;
    const measured = await captureScreenshot({
      url: 'http://127.0.0.1:7611/',
      outDir: OUT,
      runScreenshot: () => {
        clock += CAPTURE_TIMEOUT_MS;
        return Promise.resolve(run({ timedOut: true }));
      },
      now: () => clock
    });
    expect(measured).toEqual({
      ok: false,
      cause: 'capture-timeout',
      reason: 'the viewport screenshot timed out',
      elapsedMs: CAPTURE_TIMEOUT_MS
    });
  });

  it('when the screenshot spawn throws, should refuse instead of propagating', async () => {
    // given: a screenshot runner that rejects with ENOENT
    // when: captureScreenshot runs
    // then: the failure is a named capture-failed refusal
    const measured = await captureScreenshot({
      url: 'http://127.0.0.1:7611/',
      outDir: OUT,
      runScreenshot: () => Promise.reject(new Error('spawn ENOENT'))
    });
    expect(measured).toMatchObject({
      ok: false,
      cause: 'capture-failed',
      reason: 'the viewport screenshot threw before writing: spawn ENOENT'
    });
  });

  it('when the screenshot wrote no readable PNG, should refuse as capture-failed', async () => {
    // given: a screenshot arm that exits 0 and a byte reader that throws
    // when: captureScreenshot runs
    // then: the read failure is a capture-failed value, never a pass or a throw
    const measured = await captureScreenshot({
      url: 'http://127.0.0.1:7611/',
      outDir: OUT,
      runScreenshot: () => Promise.resolve(run({ stdout: SCREENSHOT_STDOUT })),
      readBytes: () => Promise.reject(new Error('EACCES'))
    });
    expect(measured.ok).toBe(false);
    if (measured.ok) throw new Error('expected a refusal');
    expect(measured.cause).toBe('capture-failed');
    expect(measured.reason).toContain('could not be read (EACCES)');
  });
});

describe('Scenario: behavior — the paint refusal is now the paint judge alone', () => {
  it('when the capture is near-uniform, should block naming the measured paint', () => {
    // given: a uniform frame with a benign page title
    // when: the paint refusal is computed
    // then: it blocks and names every measured field
    expect(paintRefusal(page({ paint: BLANK }))).toBe(
      'its viewport capture is near-uniform, so the page was blank or still hydrating ' +
        '(status 200, finalUrl http://127.0.0.1:7611/, nonModalPct 0.00, quantisedColours 1, luminanceStd 0.00)'
    );
  });

  it('when the page rendered, should not block — a marker is the route stage’s job', () => {
    // given: a rendered page, and the same page whose title is a sign-in state
    // when: the paint refusal is computed
    // then: paint never blocks on identity text, so the two codes cannot swap back
    expect(paintRefusal(page())).toBeNull();
    expect(
      paintRefusal(page({ paint: RENDERED, finalUrl: 'http://127.0.0.1:7611/sign-in' }))
    ).toBeNull();
  });
});

describe('Scenario: a11y — describePaint carries measured fields and sanitises the URL', () => {
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

  it('when the final URL carries control bytes, should strip and bound them', () => {
    // given: a final URL with an ESC sequence and a 200-character path
    // when: the paint fields are described
    // then: no control byte survives and the URL echo is capped
    const text = describePaint(
      { status: 200, finalUrl: `http://127.0.0.1:4321/\u001b]0;pwned\u0007${'a'.repeat(200)}` },
      RENDERED
    );
    expect(text).not.toMatch(/\p{Cc}/u);
    expect(text).toContain('…');
    expect(text).not.toContain('a'.repeat(EVIDENCE_SNIPPET_MAX));
  });
});
