import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/design/page-probe-stage-c.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import {
  probePageUsable as probeWithCapture,
  type PageProbeInput,
  type PageProbeResult
} from '../../../src/services/design/page-probe.js';
import { rgbPng } from './_png-bytes.js';

/** A rendered frame: half brand blue, half coral — paint is non-uniform. */
const RENDERED_PNG = rgbPng({
  width: 100,
  height: 100,
  pixel: (x) => (x < 50 ? [14, 114, 188] : [255, 101, 104])
});

/** A blank frame: every pixel white. */
const BLANK_PNG = rgbPng({ width: 100, height: 100, pixel: () => [255, 255, 255] });

/** The screenshot arm's stdout: a file list, deliberately not JSON. */
const SCREENSHOT_PROGRESS = 'capture-out/screenshots/full-page.png\ncapture-out/DESIGN.md\n';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-probe-c-'));
  roots.push(dir);
  return dir;
}

/** One temp capture dir holding the PNG the screenshot arm writes. */
function captureDir(bytes: Uint8Array): string {
  const dir = tempDir();
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  writeFileSync(join(dir, 'screenshots', 'full-page.png'), bytes);
  return dir;
}

type CaptureOptions = {
  bytes?: Uint8Array;
  title?: string | null;
  headings?: string[];
  identityStdout?: string;
  identityExitCode?: number;
  identityTimedOut?: boolean;
  identityThrows?: boolean;
  screenshotTimedOut?: boolean;
  screenshotThrows?: boolean;
  missingPng?: boolean;
};

type FakeCapture = {
  outDir: string;
  runIdentity: PageProbeInput['runIdentity'];
  runScreenshot: PageProbeInput['runScreenshot'];
};

/** A fake pair of designlang arms (no browser): identity JSON plus a written PNG. */
function capture(options: CaptureOptions = {}): FakeCapture {
  const outDir = options.missingPng ? tempDir() : captureDir(options.bytes ?? RENDERED_PNG);
  const identityStdout =
    options.identityStdout ??
    JSON.stringify({
      componentScreenshots: {},
      meta: { title: options.title === undefined ? 'Ledgerly' : options.title },
      voice: { sampleHeadings: options.headings ?? ['Reconciliation'] }
    });
  const runIdentity: PageProbeInput['runIdentity'] = options.identityThrows
    ? () => Promise.reject(new Error('spawn ENOENT'))
    : () =>
        Promise.resolve({
          exitCode: options.identityExitCode ?? 0,
          stdout: identityStdout,
          stderr: '',
          timedOut: options.identityTimedOut ?? false
        });
  const runScreenshot: PageProbeInput['runScreenshot'] = options.screenshotThrows
    ? () => Promise.reject(new Error('spawn ENOENT'))
    : () =>
        Promise.resolve({
          exitCode: 0,
          stdout: SCREENSHOT_PROGRESS,
          stderr: '',
          timedOut: options.screenshotTimedOut ?? false
        });
  return { outDir, runIdentity, runScreenshot };
}

function stats(): PageProbeInput['runStats'] {
  return () =>
    Promise.resolve({
      exitCode: 0,
      stdout: JSON.stringify({ url: 'http://127.0.0.1:7611/', fontFamilyCount: 1, typeScale: 9 }),
      stderr: '',
      timedOut: false
    });
}

const URL = 'http://127.0.0.1:7611/';

function probe(
  input: Partial<PageProbeInput> & Pick<PageProbeInput, 'runIdentity' | 'runScreenshot' | 'outDir'>
): Promise<PageProbeResult> {
  return probeWithCapture({
    url: URL,
    runStats: stats(),
    fetchPage: () =>
      Promise.resolve({ status: 200, finalUrl: URL, textChars: 695, hasPasswordField: false }),
    ...input
  });
}

describe('Scenario: render — Stage C measures the viewport capture', () => {
  it('when stats pass but the capture is blank, should block with every paint field', async () => {
    // given: the pilot's false-pass stats and a uniform PNG
    // when: the probe runs
    // then: the paint metric blocks and the message carries the measured fields, no score
    const result = await probe({ ...capture({ bytes: BLANK_PNG }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
    expect(result.message).toContain('near-uniform');
    expect(result.message).toContain('status 200, finalUrl http://127.0.0.1:7611/');
    expect(result.message).toContain('nonModalPct 0.00');
    expect(result.message).toContain('quantisedColours 1');
    expect(result.message).toContain('luminanceStd 0.00');
    expect(result.message).toContain('elapsedMs');
    expect(result.message).not.toContain('score');
  });

  it('when the capture is rendered, should pass with both call timings', async () => {
    // given: a stats pass and a rendered viewport frame
    // when: the probe runs
    // then: the observation carries both call timings plus the paint metric
    const result = await probe({ ...capture() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.observation.status).toBe(200);
    expect(result.observation.finalUrl).toBe(URL);
    expect(result.observation.textChars).toBe(695);
    expect(result.observation.hasPasswordField).toBe(false);
    expect(result.observation.fontFamilyCount).toBe(1);
    expect(result.observation.typeScale).toBe(9);
    expect(result.observation.paint.nonModalPct).toBeGreaterThan(1);
    expect(result.observation.route).toEqual({ kind: 'inert' });
    expect(result.observation.identityElapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.observation.captureElapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.observation.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.observation.elapsedMs).toBeLessThan(60_000);
  });

  it('when the identity JSON names no screenshot path, should still pass', async () => {
    // given: an identity payload whose componentScreenshots is empty
    // when: the probe runs with the separate screenshot arm
    // then: the identity call needs no PNG path and the page passes
    const fake = capture();
    const result = await probe({ ...fake });
    expect(result.ok).toBe(true);
  });

  it('when the screenshot prints no JSON, should still pass on the PNG it wrote', async () => {
    // given: a screenshot arm whose stdout is a file list, not JSON
    // when: the probe runs
    // then: no JSON is required from the screenshot call
    const result = await probe({ ...capture() });
    expect(result.ok).toBe(true);
  });

  it('when the identity extract throws, times out, or exits without JSON, should block each', async () => {
    // given: a throwing identity spawn, a timed-out identity run and a silent exit 2
    // when: each probe runs
    // then: every failure is a blocked page naming the identity half, never a pass
    for (const options of [
      { identityThrows: true },
      { identityTimedOut: true },
      { identityExitCode: 2, identityStdout: '' }
    ]) {
      const result = await probe({ ...capture(options) });
      expect(result.ok, JSON.stringify(options)).toBe(false);
      if (result.ok) throw new Error('expected a block');
      expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
      expect(result.message).toContain('the page identity could not be read');
      expect(result.message).toContain('cause identity-');
      expect(result.message).not.toContain('captureElapsedMs');
    }
  });

  it('when the screenshot throws or times out, should block with its cause', async () => {
    // given: a throwing screenshot spawn and a screenshot run at its budget
    // when: each probe runs
    // then: the cause names the screenshot half, never the identity half
    for (const [options, cause] of [
      [{ screenshotThrows: true }, 'capture-failed'],
      [{ screenshotTimedOut: true }, 'capture-timeout']
    ] as const) {
      const result = await probe({ ...capture(options) });
      expect(result.ok, JSON.stringify(options)).toBe(false);
      if (result.ok) throw new Error('expected a block');
      expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
      expect(result.message).toContain(`cause ${cause}`);
    }
  });

  it('when the screenshot times out, should block with cause capture-timeout and elapsedMs', async () => {
    // given: a screenshot arm that overran its own budget
    // when: the probe runs
    // then: the block is DESIGN_PAGE_UNUSABLE with the cause and the measured time
    const result = await probe({ ...capture({ screenshotTimedOut: true }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
    expect(result.message).toContain('cause capture-timeout');
    expect(result.message).toMatch(/captureElapsedMs \d+/);
    expect(result.message).not.toContain('score');
  });

  it('when the screenshot wrote no PNG, should block with the read failure', async () => {
    // given: a screenshot arm that exits 0 but writes no file
    // when: the probe runs
    // then: the missing file blocks and names the read failure
    const result = await probe({ ...capture({ missingPng: true }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('could not be read');
  });

  it('when the captured PNG cannot be read, should block with the read failure', async () => {
    // given: a capture whose PNG byte reader throws EACCES
    // when: the probe runs
    // then: the read failure is a block, not a pass or a throw
    const injected = capture();
    const result = await probe({
      ...injected,
      readCaptureBytes: () => Promise.reject(new Error('EACCES'))
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('could not be read (EACCES)');
  });

  it('when the PNG shape cannot be decoded, should block instead of misreading it', async () => {
    // given: a PNG file whose bytes are not a PNG
    // when: the probe runs
    // then: the decoder refusal blocks and names the signature
    const result = await probe({
      ...capture({ bytes: Buffer.from('not a png', 'ascii') })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('refused');
    expect(result.message).toContain('signature');
  });
});

describe('Scenario: behavior — route identity blocks before the capture', () => {
  it('when the title starts with a sign-in marker, should block as a route mismatch', async () => {
    // given: a document title that opens with "Sign in"
    // when: the probe judges the page identity before the screenshot
    // then: the route code blocks and no capture metric is reported
    const result = await probe({ ...capture({ title: 'Sign in · Ledgerly' }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal negative-marker');
    expect(result.message).not.toContain('nonModalPct');
  });

  it('when a rendered heading starts with a negative marker, should block as a route mismatch', async () => {
    // given: a rendered heading "Unauthorized access"
    // when: the probe judges the page identity
    // then: the heading surface blocks and the message names it
    const result = await probe({ ...capture({ headings: ['Unauthorized access'] }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('Unauthorized access');
    expect(result.message).toContain('a heading');
  });

  it('when the title is null but a later heading is marked, should block on that heading', async () => {
    // given: a capture whose title is absent and whose second heading is a sign-in
    // when: the probe runs
    // then: the null candidate is skipped and the marked heading is found
    const result = await probe({ ...capture({ title: null, headings: ['A', 'Log in'] }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('"Log in"');
  });

  it('when a docs heading merely contains a status word, should pass', async () => {
    // given: a real content heading "How to handle 404 errors"
    // when: the probe runs
    // then: the anchored marker does not false-block real content
    const result = await probe({ ...capture({ headings: ['How to handle 404 errors'] }) });
    expect(result.ok).toBe(true);
  });
});

describe('Scenario: a11y — every block message names measured fields and no credentials', () => {
  it('when a blocked page carried credentials in its final URL, should mask them', async () => {
    // given: a 500 answer whose final URL carries a username and password
    // when: the probe blocks before Stage B
    // then: neither credential survives into the persisted message
    const result = await probe({
      ...capture(),
      fetchPage: () =>
        Promise.resolve({
          status: 500,
          finalUrl: 'http://alice:s3cret@127.0.0.1:7611/private',
          textChars: 0,
          hasPasswordField: false
        })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('http://127.0.0.1:7611/private');
    expect(result.message).not.toContain('alice');
    expect(result.message).not.toContain('s3cret');
  });

  it('when no stage observed anything, should still name every measured field', async () => {
    // given: a fetch that reports no response at all
    // when: the probe blocks
    // then: the exact sentence names status, finalUrl, unknown font count and elapsed time
    const result = await probe({
      ...capture(),
      fetchPage: () =>
        Promise.resolve({ status: null, finalUrl: null, textChars: 0, hasPasswordField: false })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toMatch(
      /^The page http:\/\/127\.0\.0\.1:7611\/ cannot be judged: the URL did not answer \(a refused connection, DNS failure, or timeout\) \(status no response, finalUrl http:\/\/127\.0\.0\.1:7611\/, fontFamilyCount unknown, elapsedMs \d+\)\. An unusable page is blocked, never turned into a render verdict\.$/
    );
  });
});
