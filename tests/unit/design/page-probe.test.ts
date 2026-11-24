import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/design/page-probe.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import type { DesignlangRunResult } from '../../../src/services/design/designlang.js';
import {
  fetchPageHttp,
  probePageUsable as probeWithCapture,
  visibleChars,
  type PageHttpObservation,
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

const captureRoots: string[] = [];

/** One temp capture dir; deleted after every test. */
function captureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-probe-'));
  captureRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (captureRoots.length > 0)
    rmSync(captureRoots.pop() as string, { recursive: true, force: true });
});

/** Write the named PNG where the capture JSON says it is. */
function writePng(dir: string, bytes: Uint8Array): string {
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  writeFileSync(join(dir, 'screenshots', 'full-page.png'), bytes);
  return dir;
}

type CaptureOptions = {
  bytes?: Uint8Array;
  title?: string;
  headings?: string[];
  exitCode?: number;
  stdout?: string;
  timedOut?: boolean;
};

/** A fake capture runner (no browser): a written PNG plus the JSON that names it. */
function capture(options: CaptureOptions = {}): {
  outDir: string;
  runCapture: PageProbeInput['runCapture'];
} {
  const outDir = writePng(captureDir(), options.bytes ?? RENDERED_PNG);
  const stdout =
    options.stdout ??
    JSON.stringify({
      componentScreenshots: { fullPage: { path: 'screenshots/full-page.png' } },
      meta: { title: options.title ?? 'Ledgerly' },
      voice: { sampleHeadings: options.headings ?? ['Reconciliation'] }
    });
  return {
    outDir,
    runCapture: async () => ({
      exitCode: options.exitCode ?? 0,
      stdout,
      stderr: '',
      timedOut: options.timedOut ?? false
    })
  };
}

/**
 * The wrapper every Stage A/B test already used: it supplies the injected
 * capture, so no unit test launches a browser.
 */
function probePageUsable(
  input: Omit<PageProbeInput, 'runCapture' | 'outDir'> &
    Partial<Pick<PageProbeInput, 'runCapture' | 'outDir'>>
): Promise<PageProbeResult> {
  const injected = capture();
  return probeWithCapture({ ...injected, ...input });
}

/** A stats runner that reports a rendered page unless overridden. */
function makeStats(
  overrides: Partial<DesignlangRunResult> = {}
): () => Promise<DesignlangRunResult> {
  return () =>
    Promise.resolve({
      exitCode: 0,
      stdout: JSON.stringify({ url: 'http://127.0.0.1:7611/', fontFamilyCount: 1, typeScale: 9 }),
      stderr: '',
      timedOut: false,
      ...overrides
    });
}

/** The HTTP half of a measurement, as the real fetch would report it. */
function http(overrides: Partial<PageHttpObservation> = {}): PageHttpObservation {
  return {
    status: 200,
    finalUrl: 'http://127.0.0.1:7611/',
    textChars: 695,
    hasPasswordField: false,
    ...overrides
  };
}

let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path === '/protected') {
      response.writeHead(302, { Location: '/login' });
      response.end();
      return;
    }
    if (path === '/broken') {
      response.writeHead(500);
      response.end('boom');
      return;
    }
    if (path === '/login') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<h1>Sign in</h1><input type="password" name="pw"><p>Ledgerly</p>');
      return;
    }
    if (path === '/blank') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<div id="root"></div><script src="/app.js"></script>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      `<h1>Reconciliation</h1><p>${'Ledgerly keeps every account reconciled. '.repeat(12)}</p>`
    );
  });
  await new Promise<void>((settle) => {
    server.listen(0, '127.0.0.1', () => {
      settle();
    });
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((settle) => {
    server.close(() => {
      settle();
    });
  });
});

describe('Scenario: render — the measured page observation', () => {
  it('when a rendered page answers, should report its status, final URL and visible text', async () => {
    // given: a local server serving a page with a heading and body text
    // when: the real Stage A fetch reads it
    // then: the observation carries the measured fields and no password field
    const observation = await fetchPageHttp(`${origin}/`);
    expect(observation.status).toBe(200);
    expect(observation.finalUrl).toBe(`${origin}/`);
    expect(observation.textChars).toBeGreaterThan(300);
    expect(observation.hasPasswordField).toBe(false);
  });

  it('when html carries scripts and tags, should count only visible characters', () => {
    // given: html whose script, style and tags carry most of the bytes
    // when: the visible characters are counted
    // then: only the real text is measured
    const html = '<style>.a{color:red}</style><h1>Hi</h1><script>var x = "no";</script>';
    expect(visibleChars(html)).toBe(2);
  });
});

describe('Scenario: behavior — Stage A blocks the HTTP failures', () => {
  it('when the page answers non-2xx, should block as unusable', async () => {
    // given: a page that answers HTTP 500
    // when: the probe runs with an injected observation
    // then: the page is blocked and the message names the status
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      runStats: makeStats(),
      fetchPage: async () => http({ status: 500 })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
    expect(result.message).toContain('HTTP 500');
  });

  it('when the page redirected to a different path, should block as a sign-in wall', async () => {
    // given: a protected route that lands on /login
    // when: the real Stage A fetch follows the redirect
    // then: the changed path blocks and the final URL is reported
    const result = await probePageUsable({
      url: `${origin}/protected`,
      runStats: makeStats()
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('different path');
    expect(result.message).toContain(`${origin}/login`);
  });

  it('when a short page carries a password field, should block as a sign-in form', async () => {
    // given: a 200 page with a password input and few visible characters
    // when: the real Stage A fetch reads it
    // then: the sign-in form blocks instead of reaching Stage B
    const result = await probePageUsable({ url: `${origin}/login`, runStats: makeStats() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('password field');
  });

  it('when a long page carries a password field, should NOT block on Stage A', async () => {
    // given: a settings-style page with a password field and 400+ visible characters
    // when: the probe runs
    // then: the length floor keeps a real change-password page out of the block
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      runStats: makeStats(),
      fetchPage: async () => http({ hasPasswordField: true, textChars: 400 })
    });
    expect(result.ok).toBe(true);
  });

  it('when the URL did not answer, should block as unusable', async () => {
    // given: a fetch that reports no response at all
    // when: the probe runs
    // then: a network failure blocks, never passes
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      runStats: makeStats(),
      fetchPage: async () => http({ status: null, finalUrl: null })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('did not answer');
    expect(result.message).toContain('no response');
  });

  it('when the fetch throws, should block instead of propagating', async () => {
    // given: a fetch implementation that throws (a transport failure)
    // when: the probe runs
    // then: the throw becomes the same unusable-page block
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      runStats: makeStats(),
      fetchPage: async () => {
        throw new Error('ECONNREFUSED');
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
  });
});

describe('Scenario: behavior — Stage B blocks a page with no rendered text', () => {
  it('when a blank shell renders zero font families, should block', async () => {
    // given: the real blank-shell page and a stats read of fontFamilyCount 0
    // when: the probe runs
    // then: the page blocks with status, finalUrl and fontFamilyCount — no score
    const result: PageProbeResult = await probePageUsable({
      url: `${origin}/blank`,
      runStats: makeStats({ stdout: JSON.stringify({ fontFamilyCount: 0, typeScale: 1 }) })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
    expect(result.message).toContain('status 200');
    expect(result.message).toContain(`${origin}/blank`);
    expect(result.message).toContain('fontFamilyCount 0');
    expect(result.message).not.toContain('score');
  });

  it('when a rendered page reports one font family, should pass', async () => {
    // given: a rendered page and a stats read with a font family
    // when: the probe runs
    // then: the observation carries both stages and the page is usable
    const result = await probePageUsable({ url: `${origin}/`, runStats: makeStats() });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.observation.status).toBe(200);
    expect(result.observation.fontFamilyCount).toBe(1);
  });

  it('when the page is artwork only, should block rather than fail', async () => {
    // given: a rendered page whose only content is an SVG (fontFamilyCount 0)
    // when: the probe runs
    // then: it is a blocked page, never a fail verdict
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/image-only',
      runStats: makeStats({ stdout: JSON.stringify({ fontFamilyCount: 0, typeScale: 1 }) }),
      fetchPage: async () => http({ finalUrl: 'http://127.0.0.1:7611/image-only', textChars: 0 })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
    expect(result.message).toContain('artwork-only');
  });

  it('when the stats run exits nonzero without JSON, should block', async () => {
    // given: a stats spawn that exits 2 with empty stdout
    // when: the probe runs
    // then: a probe failure blocks, never passes
    const result = await probePageUsable({
      url: `${origin}/`,
      runStats: makeStats({ exitCode: 2, stdout: '' })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('without a JSON document');
  });

  it('when the stats run emits no fontFamilyCount, should block', async () => {
    // given: a stats document that carries no fontFamilyCount
    // when: the probe runs
    // then: the missing measurement is a block, not a pass
    const result = await probePageUsable({
      url: `${origin}/`,
      runStats: makeStats({ stdout: JSON.stringify({ colors: 7 }) })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('without a fontFamilyCount');
  });

  it('when fontFamilyCount is not a finite number, should block for each shape', async () => {
    // given: stats documents carrying a string, NaN and Infinity
    // when: each probe runs
    // then: a non-numeric count is missing evidence, never zero
    for (const fontFamilyCount of ['1', Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await probePageUsable({
        url: `${origin}/`,
        runStats: makeStats({ stdout: JSON.stringify({ fontFamilyCount, typeScale: 9 }) })
      });
      expect(result.ok, String(fontFamilyCount)).toBe(false);
      if (result.ok) throw new Error('expected a block');
      expect(result.message).toContain('without a fontFamilyCount');
      expect(result.message).toContain('fontFamilyCount unknown');
    }
  });

  it('when the stats run throws or emits no JSON, should block with its own detail', async () => {
    // given: a stats spawn that throws and one that exits 2 silently
    // when: each probe runs
    // then: the throw is a block value and the silent run names the exit code
    const threw = await probePageUsable({
      url: `${origin}/`,
      runStats: () => Promise.reject(new Error('spawn ENOENT'))
    });
    expect(threw.ok).toBe(false);
    if (threw.ok) throw new Error('expected a block');
    expect(threw.message).toContain('designlang stats threw before printing: spawn ENOENT');
    const silent = await probePageUsable({
      url: `${origin}/`,
      runStats: makeStats({ exitCode: 2, stdout: '' })
    });
    expect(silent.ok).toBe(false);
    if (silent.ok) throw new Error('expected a block');
    expect(silent.message).toContain('designlang stats exited 2 without a JSON document');
  });

  it('when the blank-shell test depends on typeScale, should block only at 1 or below', async () => {
    // given: fontFamilyCount 0 with typeScale 1, null and 2
    // when: each probe runs
    // then: 1 and null are the blank shell; 2 is a rendered page that proceeds
    for (const typeScale of [1, null]) {
      const result = await probePageUsable({
        url: `${origin}/`,
        runStats: makeStats({ stdout: JSON.stringify({ fontFamilyCount: 0, typeScale }) })
      });
      expect(result.ok, String(typeScale)).toBe(false);
      if (result.ok) throw new Error('expected a block');
      expect(result.message).toContain('artwork-only');
    }
    const rendered = await probePageUsable({
      url: `${origin}/`,
      runStats: makeStats({ stdout: JSON.stringify({ fontFamilyCount: 0, typeScale: 2 }) })
    });
    expect(rendered.ok).toBe(true);
  });

  it('when the answer status is on either edge of 2xx, should trust only the bucket', async () => {
    // given: statuses 199, 200, 299 and 300
    // when: each probe runs
    // then: 200 and 299 proceed, while 199 and 300 block as answered HTTP
    for (const status of [199, 300]) {
      const result = await probePageUsable({
        url: 'http://127.0.0.1:7611/',
        runStats: makeStats(),
        fetchPage: async () => http({ status })
      });
      expect(result.ok, String(status)).toBe(false);
      if (result.ok) throw new Error('expected a block');
      expect(result.message).toContain(`the URL answered HTTP ${String(status)}`);
    }
    for (const status of [200, 299]) {
      const result = await probePageUsable({
        url: 'http://127.0.0.1:7611/',
        runStats: makeStats(),
        fetchPage: async () => http({ status })
      });
      expect(result.ok, String(status)).toBe(true);
    }
  });

  it('when a password field sits on the 300-character floor, should block only below it', async () => {
    // given: a password field with 299 and exactly 300 visible characters
    // when: each probe runs
    // then: 299 is a sign-in wall and 300 is a real page
    const below = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      runStats: makeStats(),
      fetchPage: async () => http({ hasPasswordField: true, textChars: 299 })
    });
    expect(below.ok).toBe(false);
    if (below.ok) throw new Error('expected a block');
    expect(below.message).toContain('only 299 visible characters');
    const at = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      runStats: makeStats(),
      fetchPage: async () => http({ hasPasswordField: true, textChars: 300 })
    });
    expect(at.ok).toBe(true);
  });

  it('when a redirect crossed to an untrusted host, should refuse before judging the status', async () => {
    // given: a 500 answer that also reports an untrusted redirect target
    // when: the probe runs
    // then: the trust refusal is reported, not the HTTP status
    const result = await probePageUsable({
      url: 'http://127.0.0.1:7611/',
      runStats: makeStats(),
      fetchPage: async () => http({ status: 500, untrustedRedirect: 'http://evil.test/x' })
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.message).toContain('redirected to an untrusted host');
    expect(result.message).not.toContain('answered HTTP 500');
  });

  it('when a URL cannot be parsed, should not invent a different-path refusal', async () => {
    // given: an unparsable requested URL, and a valid final URL on another path
    // when: the probe runs
    // then: the path comparison is skipped instead of refusing
    const result = await probePageUsable({
      url: 'not a url',
      runStats: makeStats(),
      fetchPage: async () =>
        http({ status: 200, finalUrl: 'http://127.0.0.1:7611/elsewhere', textChars: 400 })
    });
    expect(result.ok).toBe(true);
  });
});
