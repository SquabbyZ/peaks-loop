/**
 * The real-browser round trip: rebuild a graph entry as the preview page, load
 * it in Chromium through the production capture seam, cut it again, and demand
 * the ids, parent chains and anchors come back. The static reader in
 * `layout-preview-read.ts` is useful for fast unit checks, but only this test
 * measures what a browser actually lays out.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildOne, type Built } from '../../src/cli/commands/design-layout-build-command.js';
import {
  buildLayoutIndex,
  type LayoutAnchor
} from '../../src/services/design/layout/layout-align.js';
import {
  buildLayoutEntry,
  chainsOf,
  type LayoutEntry
} from '../../src/services/design/layout/layout-graph.js';
import { routeCoverage, viewportKey } from '../../src/services/design/layout/layout-graph-paths.js';
import {
  driveStates,
  LAYOUT_STATES,
  type LayoutState,
  type StateDeclarations,
  type StateDrive
} from '../../src/services/design/layout/layout-graph-query.js';
import {
  captureLayoutPage,
  type LayoutGeometry,
  type Viewport
} from '../../src/services/design/layout/layout-geometry.js';
import { rebuildHtml } from '../../src/services/design/layout/layout-preview.js';
import { verifyRoundTrip } from '../../src/services/design/layout/layout-roundtrip.js';
import { readSpacingTokens } from '../../src/services/design/layout/layout-tokens.js';
import { isLoopbackUrl } from '../../src/services/design/url-trust.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/design/layout');
const TOKENS = readSpacingTokens(FIXTURES);
const VIEWPORT: Viewport = { width: 390, height: 844 };
const TIMEOUT_MS = 120_000;

/** The three breakpoints `--all-states` drives for every state. */
const STATE_VIEWPORTS: Viewport[] = [
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1280, height: 800 }
];

/** How each state is reached: a query address, or the default page plus one click. */
const DECLARED_STATES: Extract<StateDeclarations, { ok: true }> = {
  ok: true,
  states: {
    default: { url: '/states.html' },
    empty: { url: '/states.html?state=empty' },
    error: { url: '/states.html?state=error' },
    loading: { url: '/states.html', click: '#load-more' }
  }
};

const pages = new Map<string, string>();
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const body = pages.get(request.url ?? '') ?? pages.get(path);
    if (body === undefined) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('the probe server has no port');
  base = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(() => {
  server.close();
});

function serve(name: string, html: string): string {
  pages.set(`/${name}.html`, html);
  return `${base}/${name}.html`;
}

/** Register the state fixture once; its query variants reuse the same body. */
function serveStates(): void {
  pages.set('/states.html', readFileSync(join(FIXTURES, 'states.html'), 'utf8'));
}

/** Drive the real capture and the production entry build, exactly as `--all-states` does. */
async function driveFixtureStates(declarations: StateDeclarations): Promise<StateDrive<Built>> {
  serveStates();
  const url = `${base}/states.html`;
  return driveStates(
    {
      route: '/',
      baseUrl: base,
      declarations,
      viewports: STATE_VIEWPORTS,
      trusted: isLoopbackUrl
    },
    captureLayoutPage,
    (state, viewport, page) =>
      buildOne({ project: FIXTURES, route: '/', url, state }, viewport, TOKENS, page)
  );
}

/** The declarations minus one state: the named keys that state owns become unavailable. */
function declarationsWithout(state: LayoutState): StateDeclarations {
  const states = { ...DECLARED_STATES.states };
  delete states[state];
  return { ok: true, states };
}

/** The built entries keyed by their `<state>@<WxH>` coordinate. */
function entriesByCoordinate(built: readonly Built[]): Map<string, LayoutEntry> {
  return new Map(
    built.map((item) => [`${item.entry.state}@${viewportKey(item.entry.viewport)}`, item.entry])
  );
}

/** One viewport's four entries, or the coordinate that was not built. */
function entriesAt(byKey: Map<string, LayoutEntry>, viewport: Viewport): LayoutEntry[] {
  return LAYOUT_STATES.map((state) => {
    const key = `${state}@${viewportKey(viewport)}`;
    const entry = byKey.get(key);
    if (entry === undefined) throw new Error(`no built entry for ${key}`);
    return entry;
  });
}

/** The ordered node ids of one entry: each id is a structural fingerprint, never a DOM index. */
function structureOf(entry: LayoutEntry): string {
  return entry.nodes.map((node) => `${node.kind}:${node.id}`).join('|');
}

async function liveGeometry(url: string): Promise<LayoutGeometry> {
  const captured = await captureLayoutPage({ route: '/', url, viewport: VIEWPORT });
  if (!captured.ok) throw new Error(`the real browser capture failed: ${captured.reason}`);
  return captured.page.geometry;
}

function entryFrom(name: string, geometry: LayoutGeometry): LayoutEntry {
  return buildLayoutEntry({
    index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
    geometry,
    state: 'default',
    tokens: TOKENS
  });
}

function recordedEntry(name: string): LayoutEntry {
  const geometry = JSON.parse(
    readFileSync(join(FIXTURES, `geometry-${name}.json`), 'utf8')
  ) as LayoutGeometry;
  return entryFrom(name, geometry);
}

function projection(entry: LayoutEntry): string[] {
  const chains = chainsOf(entry.nodes);
  return entry.nodes.map((node) =>
    [
      node.id,
      node.kind,
      node.tag,
      node.parentId ?? '-',
      (chains.get(node.id) ?? []).join('>')
    ].join('|')
  );
}

function sourceKey(source: LayoutAnchor['source']): string {
  if (source === null) return '-';
  return [
    source.parentId,
    source.property,
    source.value,
    source.token?.name ?? '-',
    source.token?.value ?? '-'
  ].join('|');
}

function relations(entry: LayoutEntry): string[] {
  return entry.anchors.map((anchor) =>
    [
      anchor.objectId,
      anchor.sharedWith,
      anchor.edge,
      anchor.verdict,
      sourceKey(anchor.source),
      sourceKey(anchor.otherSource)
    ].join(';')
  );
}

async function assertRealRoundTrip(entry: LayoutEntry, name: string): Promise<void> {
  const rebuilt = rebuildHtml(entry);
  if (!rebuilt.ok) throw new Error(`the rebuild refused: ${rebuilt.reason}`);
  const live = entryFrom(name, await liveGeometry(serve(name, rebuilt.html)));
  expect(projection(live)).toEqual(projection(entry));
  expect(relations(live)).toEqual(relations(entry));
}

describe('(integration) the real-browser round trip', () => {
  it(
    'when the aligned preview is rendered in Chromium, should bring back every id, chain and anchor',
    async () => {
      // given: the recorded aligned entry and its rebuilt preview
      // when: a real browser loads the preview and the capture cuts it again
      // then: node ids, parents, chains and anchor relations are identical
      const entry = recordedEntry('aligned');
      await assertRealRoundTrip(entry, 'aligned');
    },
    TIMEOUT_MS
  );

  it(
    'when the mismatched preview is rendered in Chromium, should bring back the not-aligned relation',
    async () => {
      // given: the recorded mismatched entry
      // when: its preview is loaded and measured in a real browser
      // then: the ids and the not-aligned anchor with both tokens come back
      const entry = recordedEntry('mismatched');
      await assertRealRoundTrip(entry, 'mismatched');
      expect(relations(entry).join(' ')).toContain('not-aligned');
    },
    TIMEOUT_MS
  );

  it(
    'when a painted card folds its content, should survive the real-browser round trip',
    async () => {
      // given: a page whose card is one painted object folding a title and a body
      // when: the card page is captured, rebuilt and captured again
      // then: the folded object's id, text and chain are identical
      const cardPage =
        '<!doctype html><html><head><meta charset="utf-8"><title>cards</title>' +
        '<style>body{margin:0;background:#fff}.card{background:#eef2ff;padding:16px;margin-bottom:8px}' +
        '.card h2{margin:0;font-size:18px}.card p{margin:8px 0 0;font-size:14px}</style></head><body>' +
        '<div class="card"><h2>Quarterly report</h2><p>Numbers for the third quarter.</p></div>' +
        '<div class="card"><h2>Quarterly review</h2><p>Numbers for the fourth quarter.</p></div>' +
        '</body></html>';
      const entry = entryFrom('card', await liveGeometry(serve('card-source', cardPage)));
      expect(entry.nodes.filter((node) => node.kind === 'object')).toHaveLength(2);
      await assertRealRoundTrip(entry, 'card-preview');
    },
    TIMEOUT_MS
  );

  it(
    'when a heading folds an inline element, should survive the real-browser round trip',
    async () => {
      // given: a heading whose text is split by an inline em
      // when: the page is captured, rebuilt and captured again
      // then: the heading's subtree text, id and chain are identical
      const inlinePage =
        '<!doctype html><html><head><meta charset="utf-8"><title>inline</title>' +
        '<style>body{margin:0;background:#fff}.section{padding:24px 24px 24px 16px}' +
        'h2{margin:0;font-size:18px}</style></head><body>' +
        '<div class="section"><h2>Quarterly <em>report</em></h2></div>' +
        '<div class="section"><h2>Quarterly review</h2></div>' +
        '</body></html>';
      const entry = entryFrom('inline', await liveGeometry(serve('inline-source', inlinePage)));
      expect(verifyRoundTrip(entry).ok).toBe(true);
      await assertRealRoundTrip(entry, 'inline-preview');
    },
    TIMEOUT_MS
  );

  it(
    'when the four declared states render at three breakpoints, should measure every key for real',
    async () => {
      // given: the state fixture served behind three query variants and one click
      // when: the production driver renders it at the three all-states viewports
      // then: all twelve keys are real and complete, and the four states stay structurally distinct
      const driven = await driveFixtureStates(DECLARED_STATES);
      expect(driven.keys).toHaveLength(12);
      expect(driven.keys.every((key) => key.verdict === 'real')).toBe(true);
      expect(routeCoverage('/', driven.keys, 12)).toMatchObject({
        complete: true,
        completeKeys: 12,
        expectedKeys: 12,
        missing: []
      });

      const byKey = entriesByCoordinate(driven.built);
      expect(byKey.size).toBe(12);
      for (const viewport of STATE_VIEWPORTS) {
        const entries = entriesAt(byKey, viewport);
        const structures = new Set(entries.map(structureOf));
        const fingerprints = new Set(entries.map((entry) => entry.fingerprint));
        expect(structures.size).toBe(LAYOUT_STATES.length);
        expect(fingerprints.size).toBe(LAYOUT_STATES.length);
      }
    },
    TIMEOUT_MS
  );

  it(
    'when the loading declaration is removed, should name its three keys unavailable and stay incomplete',
    async () => {
      // given: the same four-state fixture with no declaration for the loading state
      // when: the driver renders the states it can still reach
      // then: exactly the three loading keys are unavailable, named, and listed as missing
      const driven = await driveFixtureStates(declarationsWithout('loading'));
      const loading = driven.keys.filter((key) => key.state === 'loading');
      expect(loading).toHaveLength(3);
      expect(loading.every((key) => key.verdict === 'state-unavailable')).toBe(true);
      expect(
        loading.every((key) => String(key.reason).includes('no declaration for state loading'))
      ).toBe(true);
      const coverage = routeCoverage('/', driven.keys, 12);
      expect(coverage.complete).toBe(false);
      expect(coverage.completeKeys).toBe(9);
      expect([...coverage.missing].sort()).toEqual([
        'loading@1280x800',
        'loading@390x844',
        'loading@834x1112'
      ]);
      expect(driven.built).toHaveLength(9);
    },
    TIMEOUT_MS
  );
});
