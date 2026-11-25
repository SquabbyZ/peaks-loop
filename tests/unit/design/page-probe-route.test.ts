import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/design/page-probe-route.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import {
  probePageUsable,
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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-probe-route-'));
  roots.push(dir);
  return dir;
}

/** One temp capture dir holding the PNG the screenshot arm writes. */
function captureDir(bytes: Uint8Array = RENDERED_PNG): string {
  const dir = tempDir();
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  writeFileSync(join(dir, 'screenshots', 'full-page.png'), bytes);
  return dir;
}

type FakeCapture = {
  outDir: string;
  runIdentity: PageProbeInput['runIdentity'];
  runScreenshot: PageProbeInput['runScreenshot'];
};

/** A fake pair of designlang arms; the identity caller supplies the payload. */
function capture(payload: Record<string, unknown>, bytes: Uint8Array = RENDERED_PNG): FakeCapture {
  return {
    outDir: captureDir(bytes),
    runIdentity: async () => ({
      exitCode: 0,
      stdout: JSON.stringify(payload),
      stderr: '',
      timedOut: false
    }),
    runScreenshot: async () => ({
      exitCode: 0,
      stdout: 'capture-out/screenshots/full-page.png\n',
      stderr: '',
      timedOut: false
    })
  };
}

function stats(): PageProbeInput['runStats'] {
  return async () => ({
    exitCode: 0,
    stdout: JSON.stringify({ typeScale: 9, fontFamilyCount: 1 }),
    stderr: '',
    timedOut: false
  });
}

const URL = 'http://127.0.0.1:7611/reports';

function http(): NonNullable<PageProbeInput['fetchPage']> {
  return async () => ({ status: 200, finalUrl: URL, textChars: 695, hasPasswordField: false });
}

function probe(
  input: Partial<PageProbeInput> & Pick<PageProbeInput, 'runIdentity' | 'runScreenshot' | 'outDir'>
): Promise<PageProbeResult> {
  return probePageUsable({
    url: URL,
    runStats: stats(),
    fetchPage: http(),
    ...input
  });
}

/** The measured pilot sign-in shape: heading inside a form, so no heading is collected. */
function signInPayload(buttons: unknown[] = []): Record<string, unknown> {
  return {
    meta: { url: URL, title: 'Acme Analytics — Reports' },
    voice: { sampleHeadings: [], buttonPatterns: buttons },
    components: { inputs: { count: 2 } }
  };
}

describe('Scenario: render — the sign-in fixture blocks on the route identity', () => {
  it('when the declared marker is unobserved beside rendered inputs, should block as rendered-form', async () => {
    // given: a sign-in fixture whose heading is inside a form and whose paved road declared a marker
    // when: the probe judges the route before any screenshot
    // then: the unobserved marker plus two inputs block as rendered-form, never a score
    const result = await probe({
      ...capture(signInPayload()),
      expectedMarker: 'Quarterly reports'
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal rendered-form');
    expect(result.message).toContain('2 form input(s)');
    expect(result.message).toContain('"Quarterly reports"');
    expect(result.message).not.toContain('score');
  });

  it('when headings are empty but a header button says Sign in, should block on the form wall', async () => {
    // given: the same form fixture, whose exposed "sign in" is a shared header button
    // when: the probe judges the route with a declared marker it does not render
    // then: the button copy is not evidence, and the missing marker plus inputs block
    const result = await probe({
      ...capture(signInPayload([{ value: 'sign in' }])),
      expectedMarker: 'Quarterly reports'
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal rendered-form');
    expect(result.message).not.toContain('a button label');
  });
});

describe('Scenario: behavior — rendered fixtures pass or stay inert', () => {
  it('when a 404 card does not render its declared marker, should block as marker-unobserved', async () => {
    // given: a div-card 404 whose only retained text is its sample text
    // when: the probe judges the route its paved road declared
    // then: the unobserved declaration blocks even with no inputs to show
    const result = await probe({
      ...capture({
        meta: { title: 'Acme Analytics — Reports' },
        voice: { sampleHeadings: [] },
        componentAnatomy: [{ variants: [{ sampleText: ['Page Not Found'] }] }]
      }),
      expectedMarker: 'channel type'
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal marker-unobserved');
    expect(result.message).toContain('"channel type"');
  });

  it('when a 404 card is undeclared, should stay inert instead of guessing', async () => {
    // given: the same card, with no declared marker for its route
    // when: the probe judges the route
    // then: its sample text is shared chrome, so the stage reports it cannot tell
    const result = await probe({
      ...capture({
        meta: { title: 'Acme Analytics — Reports' },
        voice: { sampleHeadings: [] },
        componentAnatomy: [{ variants: [{ sampleText: ['Page Not Found'] }] }]
      })
    });
    expect(result.ok).toBe(true);
  });

  it('when a rendered route shows its declared marker, should pass with the mapped observation', async () => {
    // given: a rendered reports page whose heading is the declared marker
    // when: the probe runs
    // then: the marker wins and the observation records the declared judgment
    const result = await probe({
      ...capture({
        meta: { title: 'Acme Analytics — Reports' },
        voice: { sampleHeadings: ['Quarterly reports'], buttonPatterns: [{ value: 'export' }] },
        components: { inputs: { count: 0 } }
      }),
      expectedMarker: 'Quarterly reports'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.observation.route).toEqual({ kind: 'declared-marker' });
  });

  it('when no marker and no signal were observed, should stay inert and pass', async () => {
    // given: a constant SPA title and an otherwise empty identity payload
    // when: the probe runs with no declared marker
    // then: the route stage guesses nothing and the page passes
    const result = await probe({ ...capture({ meta: { title: 'ModelMatrix' } }) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.observation.route).toEqual({ kind: 'inert' });
  });

  it('when a real page carries the site-wide Sign in button, should pass (the /about shape)', async () => {
    // given: the pilot's /about payload — a benign heading and a header Sign in button
    // when: the probe runs with no declared marker
    // then: shared chrome is not route evidence and the rendered page passes
    const result = await probe({
      ...capture({
        meta: { title: 'ModelMatrix' },
        voice: {
          sampleHeadings: ['No About Content Set'],
          buttonPatterns: [{ value: 'sign in' }]
        }
      })
    });
    expect(result.ok).toBe(true);
  });
});

describe('Scenario: behavior — a route refusal preempts the screenshot', () => {
  it('when a negative title blocks, should skip the screenshot and claim no capture cost', async () => {
    // given: a page titled "Sign in" and a counted screenshot arm
    // when: the probe judges the route
    // then: no screenshot runs, the block names the identity time, and it never names a capture time
    const screenshot = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'capture-out/screenshots/full-page.png\n',
      stderr: '',
      timedOut: false
    }));
    const fake = capture({ meta: { title: 'Sign in · Ledgerly' } });
    const result = await probe({ ...fake, runScreenshot: screenshot });
    expect(screenshot).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal negative-marker');
    expect(result.message).toMatch(/identityElapsedMs \d+/);
    expect(result.message).not.toContain('captureElapsedMs');
  });

  it('when a page is titled 404 Not Found, should block and name HTTP 404', async () => {
    // given: the most common SPA 404 shape — the title opens with the status code
    // when: the probe judges the page identity
    // then: the status-code label blocks the route and the detail names the code
    const result = await probe({ ...capture({ meta: { title: '404 Not Found' } }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal negative-marker');
    expect(result.message).toContain('"HTTP 404"');
  });

  it('when a page renders an Access denied heading, should block as a route mismatch', async () => {
    // given: an access wall whose only page-identity text is the access label
    // when: the probe judges the page identity
    // then: the access label blocks the route with the negative-marker signal
    const result = await probe({
      ...capture({ meta: { title: 'Ledgerly' }, voice: { sampleHeadings: ['Access denied'] } })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal negative-marker');
  });

  it('when a page is titled with a sign-in state, should block as a route mismatch, not unusable', async () => {
    // given: a collected "Sign in" title — the branch D4 measured as unreachable
    // when: the probe judges the page identity
    // then: the route code wins, pinning that the two block codes cannot swap back
    const result = await probe({ ...capture({ meta: { title: 'Sign in · Ledgerly' } }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).not.toContain('DESIGN_PAGE_UNUSABLE');
  });

  it('when the route passes, should still pay the screenshot and let paint refuse it', async () => {
    // given: a plausible route whose frame is blank
    // when: the probe runs
    // then: the screenshot runs and the paint stage blocks the page as unusable
    const fake = capture({ meta: { title: 'Ledgerly' } }, BLANK_PNG);
    const screenshot = vi.fn(fake.runScreenshot);
    const result = await probe({ ...fake, runScreenshot: screenshot });
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
    expect(result.message).toContain('near-uniform');
    expect(result.message).toMatch(/captureElapsedMs \d+/);
  });
});
