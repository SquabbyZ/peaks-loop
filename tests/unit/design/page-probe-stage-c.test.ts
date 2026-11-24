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

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** One temp capture dir with the PNG the capture JSON will name. */
function captureDir(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-probe-c-'));
  roots.push(dir);
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  writeFileSync(join(dir, 'screenshots', 'full-page.png'), bytes);
  return dir;
}

type CaptureOptions = {
  bytes?: Uint8Array;
  title?: string | null;
  headings?: string[];
  exitCode?: number;
  stdout?: string;
  timedOut?: boolean;
  throws?: boolean;
};

/** A fake capture runner (no browser): a written PNG plus the JSON that names it. */
function capture(options: CaptureOptions = {}): {
  outDir: string;
  runCapture: PageProbeInput['runCapture'];
} {
  const outDir = captureDir(options.bytes ?? RENDERED_PNG);
  const stdout =
    options.stdout ??
    JSON.stringify({
      componentScreenshots: { fullPage: { path: 'screenshots/full-page.png' } },
      meta: { title: options.title === undefined ? 'Ledgerly' : options.title },
      voice: { sampleHeadings: options.headings ?? ['Reconciliation'] }
    });
  return {
    outDir,
    runCapture: options.throws
      ? () => Promise.reject(new Error('spawn ENOENT'))
      : () =>
          Promise.resolve({
            exitCode: options.exitCode ?? 0,
            stdout,
            stderr: '',
            timedOut: options.timedOut ?? false
          })
  };
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
  input: Partial<PageProbeInput> & Pick<PageProbeInput, 'runCapture' | 'outDir'>
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

  it('when the capture is rendered, should pass with the full observation', async () => {
    // given: a stats pass and a rendered viewport frame
    // when: the probe runs
    // then: the observation carries both HTTP and stats fields plus the paint metric
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
    expect(result.observation.pageTitle).toBe('Ledgerly');
    expect(result.observation.pageHeadings).toEqual(['Reconciliation']);
    expect(result.observation.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.observation.elapsedMs).toBeLessThan(60_000);
  });

  it('when the capture spawn throws, times out, or exits without JSON, should block each', async () => {
    // given: a throwing spawn, a timed-out child and an exit-2 silent run
    // when: each probe runs
    // then: every failure is a blocked page, never a pass
    for (const options of [{ throws: true }, { timedOut: true }, { exitCode: 2, stdout: '' }]) {
      const result = await probe({ ...capture(options) });
      expect(result.ok, JSON.stringify(options)).toBe(false);
      if (result.ok) throw new Error('expected a block');
      expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
      expect(result.message).toContain('viewport capture could not be measured');
    }
  });

  it('when the capture names a path outside its out dir or no path, should block', async () => {
    // given: a document naming ../outside.png and one naming no fullPage path
    // when: each probe runs
    // then: the path refusal blocks and names what the capture reported
    const outside = await probe({
      ...capture({
        stdout: JSON.stringify({ componentScreenshots: { fullPage: { path: '../outside.png' } } })
      })
    });
    expect(outside.ok).toBe(false);
    if (outside.ok) throw new Error('expected a block');
    expect(outside.message).toContain('path outside its out dir (../outside.png)');
    const noPath = await probe({ ...capture({ stdout: '{"meta":{"title":"x"}}' }) });
    expect(noPath.ok).toBe(false);
    if (noPath.ok) throw new Error('expected a block');
    expect(noPath.message).toContain('named no componentScreenshots.fullPage.path');
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

describe('Scenario: behavior — route identity blocks an explicitly marked page', () => {
  it('when the title starts with a sign-in marker, should block', async () => {
    // given: a rendered frame whose document title is "Sign in"
    // when: the probe runs
    // then: the route-identity marker wins over the painted frame
    const result = await probe({ ...capture({ title: 'Sign in · Ledgerly' }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('sign-in heading');
    expect(result.message).toContain('nonModalPct');
  });

  it('when a rendered heading starts with an HTTP error marker, should block', async () => {
    // given: a rendered frame whose first heading is "404 Not Found"
    // when: the probe runs
    // then: the marker blocks the page
    const result = await probe({ ...capture({ headings: ['404 Not Found'] }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('HTTP error heading');
  });

  it('when the title is null but a later heading is marked, should block on that heading', async () => {
    // given: a capture whose title is absent and whose second heading is a sign-in
    // when: the probe runs
    // then: the null candidate is skipped and the marked heading is found
    const result = await probe({ ...capture({ title: null, headings: ['A', 'Log in'] }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('a sign-in heading ("Log in")');
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
