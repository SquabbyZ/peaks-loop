// The real page-probe builders for G2 and G3a, with the spawn mocked.
//
// `buildPageProbe` is what `design-engine-deps` hands G2, and
// `buildGatedPageProbe` is what `design-check-g3-suite` hands G3a. This file
// pins the composition the S5 spike asked for: stats first, then the probed
// capture vector, writing under `<session>/design/probe/<url-slug>/`, with the
// PNG decoded for real. `runDesignlang` is the only mock, so no unit test here
// launches a browser or a process.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  CAPTURE_TIMEOUT_MS,
  IDENTITY_TIMEOUT_MS
} from '../../../src/services/design/page-capture.js';
import type { EngineAvailability } from '../../../src/services/design/engine-status.js';
import { rgbPng } from './_png-bytes.js';

declareDimensions('tests/unit/design/page-probe-deps.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const mocks = vi.hoisted(() => ({ runDesignlang: vi.fn() }));

vi.mock('../../../src/services/design/designlang.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../src/services/design/designlang.js'
  );
  return { ...actual, runDesignlang: mocks.runDesignlang };
});

import {
  buildGatedPageProbe,
  buildPageProbe,
  probeSlug,
  pruneStaleProbes
} from '../../../src/services/design/page-probe-deps.js';

const AVAILABLE: EngineAvailability = {
  available: true,
  version: '13.4.1',
  entryPath: '/opt/designlang/bin/design-extract.js',
  browserReady: true,
  browserKind: 'system-chrome',
  codes: []
};

const UNAVAILABLE: EngineAvailability = {
  available: false,
  version: null,
  entryPath: null,
  browserReady: false,
  browserKind: null,
  codes: ['DESIGN_ENGINE_UNAVAILABLE']
};

let server: Server;
let servedUrl = '';

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      `<h1>Reconciliation</h1><p>${'Ledgerly keeps every account reconciled. '.repeat(12)}</p>`
    );
  });
  await new Promise<void>((settle) => {
    server.listen(0, '127.0.0.1', () => settle());
  });
  servedUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
});

afterAll(async () => {
  await new Promise<void>((settle) => {
    server.close(() => settle());
  });
});

const roots: string[] = [];
afterEach(() => {
  mocks.runDesignlang.mockReset();
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-probe-deps-'));
  roots.push(root);
  return root;
}

/** A rendered PNG, written where the capture JSON says it wrote it. */
function writeCapture(args: readonly string[]): void {
  const outDir = args[args.indexOf('-o') + 1] ?? '';
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  writeFileSync(
    join(outDir, 'screenshots', 'full-page.png'),
    rgbPng({
      width: 100,
      height: 100,
      pixel: (x) => (x < 50 ? [14, 114, 188] : [255, 101, 104])
    })
  );
}

function captureStdout(): string {
  return JSON.stringify({
    componentScreenshots: {},
    meta: { title: 'Ledgerly' },
    voice: { sampleHeadings: ['Reconciliation'] }
  });
}

/** True when the argument vector is the separate screenshot arm. */
function isScreenshotArm(args: readonly string[]): boolean {
  return args.includes('--screenshots');
}

/** One fake designlang dispatch answer for stats, identity, or screenshots. */
function fakeAnswer(args: readonly string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
} {
  if (args[0] === 'stats') {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ fontFamilyCount: 2, typeScale: 4 }),
      stderr: '',
      timedOut: false
    };
  }
  if (isScreenshotArm(args)) {
    writeCapture(args);
    return {
      exitCode: 0,
      stdout: 'capture-out/screenshots/full-page.png\n',
      stderr: '',
      timedOut: false
    };
  }
  return { exitCode: 0, stdout: captureStdout(), stderr: '', timedOut: false };
}

describe('Scenario: integration — G2 and G3a get stats plus the paint capture', () => {
  it('when the probe runs, should spawn stats, identity, then the screenshot arm', async () => {
    // given: a mock designlang that answers stats, identity JSON and a capture
    // when: the G2 probe runs one URL
    // then: the two capture halves run in order, each under its own budget
    const root = projectRoot();
    mocks.runDesignlang.mockImplementation(async ({ args }: { args: readonly string[] }) =>
      fakeAnswer(args)
    );
    const result = await buildPageProbe({
      availability: AVAILABLE,
      projectRoot: root,
      sessionId: 'sid-1'
    })(servedUrl);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.observation.paint.nonModalPct).toBeGreaterThan(1);
    expect(result.observation.elapsedMs).toBeGreaterThanOrEqual(0);
    const calls = mocks.runDesignlang.mock.calls as [
      { args: readonly string[]; timeoutMs?: number }
    ][];
    const vectors = calls.map(([input]) => input.args);
    expect(vectors[0]).toEqual(['stats', servedUrl, '--as-json']);
    expect(vectors[1]?.slice(0, 2)).toEqual([servedUrl, '--json']);
    expect(vectors[1]).not.toContain('--screenshots');
    expect(vectors[2]?.slice(0, 2)).toEqual([servedUrl, '--screenshots']);
    expect(vectors[2]).not.toContain('--json');
    expect(calls[1]?.[0].timeoutMs).toBe(IDENTITY_TIMEOUT_MS);
    expect(calls[2]?.[0].timeoutMs).toBe(CAPTURE_TIMEOUT_MS);
    const outDir = vectors[2]?.[vectors[2].indexOf('-o') + 1] ?? '';
    expect(outDir).toBe(
      join(root, '.peaks', '_runtime', 'sid-1', 'design', 'probe', probeSlug(servedUrl))
    );
  });

  it('when the screenshot arm writes no PNG, should block rather than pass', async () => {
    // given: a mock that answers stats and identity but never writes the PNG
    // when: the G2 probe runs
    // then: the missing file is a DESIGN_PAGE_UNUSABLE block
    const root = projectRoot();
    mocks.runDesignlang.mockImplementation(async ({ args }: { args: readonly string[] }) =>
      isScreenshotArm(args)
        ? {
            exitCode: 0,
            stdout: 'capture-out/screenshots/full-page.png\n',
            stderr: '',
            timedOut: false
          }
        : fakeAnswer(args)
    );
    const result = await buildPageProbe({
      availability: AVAILABLE,
      projectRoot: root,
      sessionId: 'sid-1'
    })(servedUrl);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_PAGE_UNUSABLE');
    expect(result.message).toContain('could not be read');
  });

  it('when the engine is unavailable, should block without spawning G3a at all', async () => {
    // given: an unavailable engine
    // when: the G3a gated probe is called
    // then: it blocks with the engine code and runs nothing
    const result = await buildGatedPageProbe({
      availability: UNAVAILABLE,
      projectRoot: projectRoot(),
      sessionId: 'sid-1'
    })(servedUrl);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ENGINE_UNAVAILABLE');
    expect(mocks.runDesignlang).not.toHaveBeenCalled();
  });

  it('when an entry path is null, should block without an empty node spawn', async () => {
    // given: an availability record whose entry path did not resolve
    // when: the probe runs
    // then: it never spawns and blocks on the null entry
    const unresolved: EngineAvailability = { ...AVAILABLE, available: false, entryPath: null };
    const result = await buildPageProbe({
      availability: unresolved,
      projectRoot: projectRoot(),
      sessionId: 'sid-1'
    })(servedUrl);
    expect(result.ok).toBe(false);
    expect(mocks.runDesignlang).not.toHaveBeenCalled();
  });
});

describe('Scenario: integration — the paved road’s route markers reach the probe', () => {
  /** A project root whose `design/paved-road.json` declares the given markers. */
  function rootWithMarkers(markers: Record<string, string>): string {
    const root = projectRoot();
    const designRoot = join(root, 'design');
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(
      join(designRoot, 'paved-road.json'),
      JSON.stringify({ routeMarkers: markers }),
      'utf8'
    );
    return root;
  }

  /** The identity arm answers a two-input page with the given headings. */
  function mockRenderedIdentity(headings: string[]): void {
    mocks.runDesignlang.mockImplementation(async ({ args }: { args: readonly string[] }) => {
      if (args[0] === 'stats' || isScreenshotArm(args)) return fakeAnswer(args);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          meta: { title: 'Ledgerly' },
          voice: { sampleHeadings: headings },
          components: { inputs: { count: 2 } }
        }),
        stderr: '',
        timedOut: false
      };
    });
  }

  it('when the declared marker is unobserved beside inputs, should block as a route mismatch', async () => {
    // given: a paved road declaring a marker the rendered two-input page does not show
    // when: the G2 probe runs that URL
    // then: the probe blocks with DESIGN_ROUTE_MISMATCH and the rendered-form signal
    const root = rootWithMarkers({ '/': 'Quarterly reports' });
    mockRenderedIdentity([]);
    const result = await buildPageProbe({
      availability: AVAILABLE,
      projectRoot: root,
      sessionId: 'sid-1',
      designRoot: join(root, 'design')
    })(servedUrl);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a block');
    expect(result.code).toBe('DESIGN_ROUTE_MISMATCH');
    expect(result.message).toContain('signal rendered-form');
    expect(result.message).toContain('"Quarterly reports"');
  });

  it('when the declared marker is observed, should pass with the rendered inputs', async () => {
    // given: the same declared marker, now rendered as a heading
    // when: the G2 probe runs that URL
    // then: the observed marker wins over the input count and the page passes
    const root = rootWithMarkers({ '/': 'Quarterly reports' });
    mockRenderedIdentity(['Quarterly reports']);
    const result = await buildPageProbe({
      availability: AVAILABLE,
      projectRoot: root,
      sessionId: 'sid-1',
      designRoot: join(root, 'design')
    })(servedUrl);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.observation.route).toEqual({ kind: 'declared-marker' });
  });

  it('when a marker key is spelled with slashes or a query, should still find the route', async () => {
    // given: one marker per reachable key spelling — exact, doubled slash, query, other route
    //        (a blank key never reaches here: markerMap drops it, pinned in paved-road tests)
    // when: each paved road is read and the probe runs the served "/" route
    // then: every spelling of "/" declares the marker and /other declares none
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ['/', true],
      ['//', true],
      ['/?tab=1', true],
      ['/#top', true],
      ['/other', false]
    ];
    for (const [key, matches] of cases) {
      const root = rootWithMarkers({ [key]: 'Quarterly reports' });
      mockRenderedIdentity([]);
      const result = await buildPageProbe({
        availability: AVAILABLE,
        projectRoot: root,
        sessionId: 'sid-1',
        designRoot: join(root, 'design')
      })(servedUrl);
      expect(result.ok, key).toBe(!matches);
      if (!result.ok && matches) expect(result.code, key).toBe('DESIGN_ROUTE_MISMATCH');
    }
  });
});

describe('Scenario: integration — stale probe captures are pruned', () => {
  it('when older sessions hold a capture for the same slug, should keep only the recent ones', () => {
    // given: three sessions holding a capture for one slug, a sibling file, and
    //        a slug-named directory outside the runtime root
    // when: the cleanup runs for the newest session
    // then: only the oldest capture goes; every other path survives
    const root = projectRoot();
    const slug = probeSlug(servedUrl);
    const sessions = ['s-old', 's-mid', 's-new'].map((name, index) => {
      const dir = join(root, '.peaks', '_runtime', name, 'design', 'probe', slug);
      mkdirSync(dir, { recursive: true });
      const stamp = new Date(2026, 0, index + 1);
      utimesSync(dir, stamp, stamp);
      return dir;
    });
    const sentinel = join(root, '.peaks', '_runtime', 's-old', 'design', 'probe', 'keep-me.txt');
    writeFileSync(sentinel, 'evidence', 'utf8');
    const outside = join(root, 'design', 'probe', slug);
    mkdirSync(outside, { recursive: true });

    const outcome = pruneStaleProbes(
      join(root, '.peaks', '_runtime', 's-new'),
      servedUrl,
      sessions[2] as string,
      2
    );

    expect(outcome).toEqual({ removed: [sessions[0]], failed: 0 });
    expect(existsSync(sessions[0] as string)).toBe(false);
    expect(existsSync(sessions[1] as string)).toBe(true);
    expect(existsSync(sessions[2] as string)).toBe(true);
    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(outside)).toBe(true);
  });

  it('when the probe runs again, should prune the older session capture for that slug', async () => {
    // given: two older sessions holding a capture for the probed URL
    // when: the G2 probe runs that URL and writes a new capture
    // then: the oldest directory is gone, the previous one and the new one stay
    const root = projectRoot();
    const staleDir = (name: string, year: number): string => {
      const dir = join(root, '.peaks', '_runtime', name, 'design', 'probe', probeSlug(servedUrl));
      mkdirSync(dir, { recursive: true });
      const stamp = new Date(year, 0, 1);
      utimesSync(dir, stamp, stamp);
      return dir;
    };
    const oldest = staleDir('old', 2020);
    const previous = staleDir('previous', 2021);
    mocks.runDesignlang.mockImplementation(async ({ args }: { args: readonly string[] }) =>
      fakeAnswer(args)
    );
    const result = await buildPageProbe({
      availability: AVAILABLE,
      projectRoot: root,
      sessionId: 'sid-1'
    })(servedUrl);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.pruned?.removed).toEqual([oldest]);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(previous)).toBe(true);
    expect(
      existsSync(join(root, '.peaks', '_runtime', 'sid-1', 'design', 'probe', probeSlug(servedUrl)))
    ).toBe(true);
  });

  it('when an ancestor is a junction out of the runtime root, should never remove through it', () => {
    // given: a session whose design/probe is a junction to a directory outside
    //        `_runtime`, holding a real directory under the probed slug
    // when: the cleanup runs
    // then: the resolved-outside capture survives and is not reported removed
    const root = projectRoot();
    const slug = probeSlug(servedUrl);
    const outside = join(root, 'outside', slug);
    mkdirSync(outside, { recursive: true });
    const trapSession = join(root, '.peaks', '_runtime', 's-trap');
    mkdirSync(join(trapSession, 'design'), { recursive: true });
    symlinkSync(join(root, 'outside'), join(trapSession, 'design', 'probe'), 'junction');
    const keepDir = join(root, '.peaks', '_runtime', 's-new', 'design', 'probe', slug);
    mkdirSync(keepDir, { recursive: true });

    const outcome = pruneStaleProbes(join(root, '.peaks', '_runtime', 's-new'), servedUrl, keepDir);

    expect(outcome).toEqual({ removed: [], failed: 0 });
    expect(existsSync(outside)).toBe(true);
  });
});
