import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';
import { readPavedRoad } from '../../../src/services/design/source-scan/inputs.js';
import { buildEngineContract } from '../../../src/services/design/engine-contract.js';

declareDimensions('tests/unit/design/paved-road-and-engine.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

/**
 * URL trust is imported per test, after a module reset, so the module-level
 * constants (`LOOPBACK_HOSTS`, `PRIVATE_IPV4`) are initialised INSIDE a test
 * body. Under Stryker's per-test coverage a module-scope initialiser is
 * executed before any test, so a mutant in it is never scheduled and reads as
 * "survived" although no test ever ran — that is not a verdict.
 */
import type * as UrlTrustModuleTypes from '../../../src/services/design/url-trust.js';
type UrlTrustModule = typeof UrlTrustModuleTypes;

async function loadUrlTrust(): Promise<UrlTrustModule> {
  vi.resetModules();
  return import('../../../src/services/design/url-trust.js');
}

describe('Scenario: behavior — the paved road defaults', () => {
  it('when no rules are supplied, should hard-fail arbitrary values and raw primitives', () => {
    // given: a default paved road
    // when: the rules are read
    // then: the two symptom rules are fail, coverage stays warn
    const road = buildPavedRoad({
      pageRoots: ['src/routes'],
      componentEntrypoints: ['@/components/ui']
    });
    expect(road.rules.DESIGN_ARBITRARY_VALUE).toBe('fail');
    expect(road.rules.DESIGN_RAW_PRIMITIVE).toBe('fail');
    expect(road.rules.DESIGN_TOKEN_COVERAGE).toBe('warn');
  });
});

describe('Scenario: behavior — an older paved road still reads', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
  });

  it('when the file predates exclude, should read it as an empty list', () => {
    // given: a paved-road.json written before the exclude field existed
    // when: the tolerant reader parses it
    // then: the missing list defaults to empty and the roots survive
    const root = mkdtempSync(join(tmpdir(), 'peaks-paved-road-'));
    roots.push(root);
    writeFileSync(
      join(root, 'paved-road.json'),
      JSON.stringify({ pageRoots: ['src/app'] }),
      'utf8'
    );
    const road = readPavedRoad(root);
    expect(road.exclude).toEqual([]);
    expect(road.pageRoots).toEqual(['src/app']);
    expect(road.routeMarkers).toEqual({});
  });

  it('when the file records exclude, should keep every entry', () => {
    // given: a paved-road.json carrying two excluded paths
    // when: the tolerant reader parses it
    // then: both paths are read back in order
    const root = mkdtempSync(join(tmpdir(), 'peaks-paved-road-'));
    roots.push(root);
    writeFileSync(
      join(root, 'paved-road.json'),
      JSON.stringify({ pageRoots: ['src/app'], exclude: ['legacy', 'src/gen'] }),
      'utf8'
    );
    expect(readPavedRoad(root).exclude).toEqual(['legacy', 'src/gen']);
  });

  it('when the file declares route markers, should read each route and drop bad entries', () => {
    // given: a paved road whose routeMarkers mixes a string, a blank and a number
    // when: the tolerant reader parses it
    // then: only non-empty string markers survive, keyed by their route
    const root = mkdtempSync(join(tmpdir(), 'peaks-paved-road-'));
    roots.push(root);
    writeFileSync(
      join(root, 'paved-road.json'),
      JSON.stringify({
        pageRoots: ['src/app'],
        routeMarkers: { '/reports': 'Quarterly reports', '/blank': '   ', '/number': 3 }
      }),
      'utf8'
    );
    expect(readPavedRoad(root).routeMarkers).toEqual({ '/reports': 'Quarterly reports' });
  });

  it('when routeMarkers is not an object, should read it as no markers declared', () => {
    // given: a paved road whose routeMarkers is an array
    // when: the tolerant reader parses it
    // then: the malformed map is empty rather than a crash
    const root = mkdtempSync(join(tmpdir(), 'peaks-paved-road-'));
    roots.push(root);
    writeFileSync(
      join(root, 'paved-road.json'),
      JSON.stringify({ pageRoots: ['src/app'], routeMarkers: ['/reports'] }),
      'utf8'
    );
    expect(readPavedRoad(root).routeMarkers).toEqual({});
  });
});

describe('Scenario: behavior — the engine contract does not hardcode a URL', () => {
  it('when built with no explicit URL, should leave render.url null', () => {
    // given: a dev command and port
    // when: the engine file is read
    // then: no fixed URL is stored, and the recorded command implies on-request
    const engine = buildEngineContract({
      cwd: 'web',
      startCommand: 'bun run dev',
      port: 3000,
      pages: ['/'],
      archetypes: ['list']
    });
    expect(engine.render.url).toBeNull();
    expect(engine.render.cwd).toBe('web');
    expect(engine.render.startPolicy).toBe('on-request');
  });
});

describe('Scenario: a11y — URL trust', () => {
  const engine = buildEngineContract({
    cwd: 'web',
    startCommand: null,
    port: 3000,
    pages: ['/'],
    archetypes: ['list']
  });

  it('when the host is loopback, should trust it', async () => {
    // given: loopback spellings
    // when: each is checked
    // then: all are trusted
    const { isTrustedDesignUrl } = await loadUrlTrust();
    expect(isTrustedDesignUrl('http://localhost:3000', engine)).toBe(true);
    expect(isTrustedDesignUrl('http://127.0.0.1:3000', engine)).toBe(true);
    expect(isTrustedDesignUrl('http://[::1]:3000', engine)).toBe(true);
  });

  it('when the host is a private IP or a lookalike, should refuse', async () => {
    // given: private and lookalike hosts
    // when: each is checked
    // then: none is trusted
    const { isTrustedDesignUrl } = await loadUrlTrust();
    expect(isTrustedDesignUrl('http://192.168.1.5:3000', engine)).toBe(false);
    expect(isTrustedDesignUrl('https://localhost.evil.com', engine)).toBe(false);
    expect(isTrustedDesignUrl('http://user:pass@localhost:3000', engine)).toBe(false);
    expect(isTrustedDesignUrl('file:///tmp/page.html', engine)).toBe(false);
    expect(isTrustedDesignUrl('not-a-url', engine)).toBe(false);
  });

  it('when only one credential is present, should still refuse', async () => {
    // given: a URL carrying a username but no password, and the mirror image
    // when: each is checked
    // then: credentials of any shape are refused, not only the pair
    const { isTrustedDesignUrl } = await loadUrlTrust();
    expect(isTrustedDesignUrl('http://user@localhost:3000', engine)).toBe(false);
    expect(isTrustedDesignUrl('http://:pass@localhost:3000', engine)).toBe(false);
  });

  it('when the engine records an explicit URL, should trust exactly that URL', async () => {
    // given: a recorded public URL
    // when: it and a different host are checked
    // then: only the recorded one is trusted
    const { isTrustedDesignUrl } = await loadUrlTrust();
    const recorded = {
      ...engine,
      render: { ...engine.render, url: 'https://design.example.com' }
    };
    expect(isTrustedDesignUrl('https://design.example.com', recorded)).toBe(true);
    expect(isTrustedDesignUrl('https://other.example.com', recorded)).toBe(false);
  });

  it('when the recorded URL is on a private network, should refuse it', async () => {
    // given: engines whose recorded URL is private-network, a .local name, or a
    //        WHATWG-canonicalized IPv4-mapped IPv6 address
    // when: each exact recorded URL is checked
    // then: the exact-match escape hatch does not bypass the private refusal
    const { isTrustedDesignUrl } = await loadUrlTrust();
    for (const url of [
      'http://192.168.1.5:3000',
      'http://10.0.0.7:3000',
      'http://design.local',
      'http://[::ffff:192.168.1.5]:3000'
    ]) {
      const recorded = { ...engine, render: { ...engine.render, url } };
      expect(isTrustedDesignUrl(url, recorded)).toBe(false);
    }
  });

  it('when a public host merely contains a private-looking octet, should trust it', async () => {
    // given: recorded hosts whose names are outside every private range
    // when: each is checked against its own recorded URL
    // then: the private-range test is anchored and range-exact
    const { isTrustedDesignUrl } = await loadUrlTrust();
    for (const url of [
      'http://not192.168.1.5.example.com',
      'http://172.15.0.1',
      'http://172.2a.example.com',
      'http://172.32.0.1',
      'http://100.60.0.1',
      'http://100.10.0.1',
      'http://100.7a.example.com',
      'http://100.190.0.1',
      'http://100.129.0.1'
    ]) {
      const recorded = { ...engine, render: { ...engine.render, url } };
      expect(isTrustedDesignUrl(url, recorded)).toBe(true);
    }
  });

  it('when a recorded URL uses a non-HTTP scheme, should refuse it', async () => {
    // given: an engine that records an ftp:// URL
    // when: that exact URL is checked
    // then: the scheme refusal wins over the exact-match escape hatch
    const { isTrustedDesignUrl } = await loadUrlTrust();
    const url = 'ftp://design.example.com';
    const recorded = { ...engine, render: { ...engine.render, url } };
    expect(isTrustedDesignUrl(url, recorded)).toBe(false);
  });
});
