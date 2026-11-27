import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  captureIo,
  disposeProjects,
  entryOf,
  FIXTURES,
  geometryOf,
  tempProject
} from './_layout-graph-fixtures.js';
import { runDesignLayoutBuild } from '../../../src/cli/commands/design-layout-build-command.js';
import {
  runDesignLayoutRead,
  runDesignLayoutRebuild
} from '../../../src/cli/commands/design-layout-read-command.js';
import { MAX_FRAGMENT_BYTES } from '../../../src/services/design/layout/layout-inject.js';
import {
  entryPath,
  graphRoot,
  routeSlug,
  writeEntry
} from '../../../src/services/design/layout/layout-graph-store.js';
import { serializeEntry } from '../../../src/services/design/layout/layout-graph-ascii.js';
import type { LayoutEntry } from '../../../src/services/design/layout/layout-graph.js';

declareDimensions('tests/unit/design/layout-graph-cli.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

let savedExitCode: string | number | null | undefined;

const VIEW = { width: 390, height: 844 };

beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  disposeProjects();
});

/** The fixture page at the requested coordinate, as a capture would return it. */
function captureOf(name: string) {
  return async (input: { route: string; viewport: { width: number; height: number } }) => ({
    ok: true as const,
    page: {
      geometry: { ...geometryOf(name), route: input.route, viewport: input.viewport },
      html: readFileSync(join(FIXTURES, `${name}.html`), 'utf8')
    }
  });
}

type TokenContract = { space: Record<string, { $value: string }> };

/** A parsed tokens.json: an object of `space` entries that each carry a string value. */
function isTokenContract(value: unknown): value is TokenContract {
  if (typeof value !== 'object' || value === null) return false;
  const space = (value as { space?: unknown }).space;
  if (typeof space !== 'object' || space === null) return false;
  return Object.values(space as Record<string, unknown>).every((token) => {
    if (typeof token !== 'object' || token === null) return false;
    return typeof (token as { $value?: unknown }).$value === 'string';
  });
}

function envelopeOf(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

type Built = { root: string; capture: string };

async function builtProject(name = 'aligned'): Promise<Built> {
  const root = tempProject();
  const capture = captureIo();
  await runDesignLayoutBuild(
    { project: root, route: '/', url: 'http://127.0.0.1:3000/', json: true },
    capture.io,
    captureOf(name)
  );
  const envelope = envelopeOf(capture.out());
  if (envelope.ok !== true) throw new Error(`the build refused: ${capture.out()}`);
  const data = envelope.data as { entries: Record<string, unknown>[] };
  const capturePath = data.entries[0]?.capture;
  if (typeof capturePath !== 'string') throw new Error('the build reported no capture file');
  return { root, capture: capturePath };
}

describe('(behavior) rebuild derives its path from the entry coordinate', () => {
  it('when no output path is named, should write the preview under the entry state and viewport', async () => {
    // given: a built project whose entry sits at default@390x844
    // when: the rebuild runs without an output path
    // then: the preview lands in the graph's preview folder at that coordinate
    const built = await builtProject();
    const capture = captureIo();
    runDesignLayoutRebuild({ project: built.root, route: '/', json: true }, capture.io);
    const data = envelopeOf(capture.out()).data as { path: string };
    const expected = join(graphRoot(built.root), routeSlug('/'), 'preview', 'default@390x844.html');
    expect(data.path).toBe(expected);
    expect(existsSync(expected)).toBe(true);
  });

  it('when the header state tries to traverse, should refuse and write nothing outside', async () => {
    // given: an entry whose header state was rewritten to a relative path
    // when: the rebuild runs without an output path
    // then: the entry is refused as unreadable and no file escapes the graph root
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    const file = entryPath(root, { route: '/', state: 'default', viewport: VIEW });
    const lines = readFileSync(file, 'utf8').split('\n');
    lines[2] = 'state ../../evil';
    writeFileSync(file, lines.join('\n'), 'utf8');
    const capture = captureIo();
    runDesignLayoutRebuild({ project: root, route: '/', json: true }, capture.io);
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('DESIGN_LAYOUT_ENTRY_INVALID');
    expect(existsSync(join(graphRoot(root), 'evil@390x844.html'))).toBe(false);
    expect(existsSync(join(graphRoot(root), 'evil'))).toBe(false);
  });

  it('when the header state disagrees with the index row, should refuse the mismatch', () => {
    // given: an entry whose header names another state than the coordinate it was read from
    // when: the rebuild runs
    // then: the mismatch is refused before any path is derived from it
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    const file = entryPath(root, { route: '/', state: 'default', viewport: VIEW });
    const lines = readFileSync(file, 'utf8').split('\n');
    lines[2] = 'state empty';
    writeFileSync(file, lines.join('\n'), 'utf8');
    const capture = captureIo();
    runDesignLayoutRebuild({ project: root, route: '/', json: true }, capture.io);
    expect(envelopeOf(capture.out()).code).toBe('DESIGN_LAYOUT_ENTRY_MISMATCH');
    expect(process.exitCode).toBe(2);
  });
});

describe('(behavior) rebuild refuses an entry the contract marks stale', () => {
  it('when a cited token moved, should refuse the rebuild and write no preview', async () => {
    // given: a built project whose contract then moves the 16px token
    // when: the rebuild runs without an explicit allowance
    // then: the stale entry is refused and no preview file exists
    const built = await builtProject();
    const contractPath = join(built.root, 'design', 'tokens.json');
    const parsed: unknown = JSON.parse(readFileSync(contractPath, 'utf8'));
    if (!isTokenContract(parsed)) throw new Error('the fixture contract is not a token contract');
    const section = parsed.space.section;
    if (section === undefined) throw new Error('the fixture contract has no space.section');
    section.$value = '20px';
    writeFileSync(contractPath, JSON.stringify(parsed), 'utf8');
    const capture = captureIo();
    runDesignLayoutRebuild({ project: built.root, route: '/', json: true }, capture.io);
    const envelope = envelopeOf(capture.out());
    expect(envelope.code).toBe('DESIGN_LAYOUT_ENTRY_STALE');
    expect(existsSync(join(graphRoot(built.root), routeSlug('/'), 'preview'))).toBe(false);
  });

  it('when the stale entry is explicitly allowed, should write it and label the result', async () => {
    // given: the same stale project asked for as a direction only
    // when: the rebuild runs with the allowance
    // then: the preview is written and both the envelope and a warning say it is stale
    const built = await builtProject();
    const contractPath = join(built.root, 'design', 'tokens.json');
    const parsed: unknown = JSON.parse(readFileSync(contractPath, 'utf8'));
    if (!isTokenContract(parsed)) throw new Error('the fixture contract is not a token contract');
    const section = parsed.space.section;
    if (section === undefined) throw new Error('the fixture contract has no space.section');
    section.$value = '20px';
    writeFileSync(contractPath, JSON.stringify(parsed), 'utf8');
    const capture = captureIo();
    runDesignLayoutRebuild(
      { project: built.root, route: '/', allowStale: true, json: true },
      capture.io
    );
    const envelope = envelopeOf(capture.out());
    const data = envelope.data as { freshness: { status: string }; path: string };
    expect(envelope.ok).toBe(true);
    expect(data.freshness.status).toBe('stale');
    expect((envelope.warnings as string[]).join(' ')).toContain('not current alignment evidence');
    expect(existsSync(data.path)).toBe(true);
  });
});

describe('(render) the build command', () => {
  it('when a route is captured, should write the entry and report both token counts', async () => {
    // given: a project with the fixture token contract and an injected capture
    // when: the build runs
    // then: the envelope reports one entry whose graph is denser than the HTML
    const root = tempProject();
    const capture = captureIo();
    await runDesignLayoutBuild(
      { project: root, route: '/', url: 'http://127.0.0.1:3000/', json: true },
      capture.io,
      captureOf('aligned')
    );
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { entries: Record<string, unknown>[] };
    expect(data.entries).toHaveLength(1);
    const entry = data.entries[0];
    expect(entry?.roundTrip).toEqual({ ok: true, nodes: 5, anchors: 1 });
    expect(Number(entry?.asciiTokens)).toBeLessThan(Number(entry?.htmlTokens));
    expect(existsSync(join(root, '.peaks', 'layout-graph', 'index.txt'))).toBe(true);
  });
});

describe('(behavior) build refusals', () => {
  it('when the contract cannot be read, should refuse instead of storing an empty vocabulary', async () => {
    // given: a project whose token contract is not JSON
    // when: the build runs with a usable capture
    // then: it refuses with the token code and writes no entry or index
    const root = tempProject();
    writeFileSync(join(root, 'design', 'tokens.json'), '{not json', 'utf8');
    const capture = captureIo();
    await runDesignLayoutBuild(
      { project: root, route: '/', url: 'http://127.0.0.1:3000/', json: true },
      capture.io,
      captureOf('aligned')
    );
    expect(envelopeOf(capture.out()).code).toBe('DESIGN_LAYOUT_TOKENS_INVALID');
    expect(process.exitCode).toBe(2);
    expect(existsSync(join(graphRoot(root), 'index.txt'))).toBe(false);
  });

  it('when the render URL is untrusted, should refuse before any capture runs', async () => {
    // given: a private-network URL and a capture that must not be reached
    // when: the build runs
    // then: it refuses with the named code and a refused exit status
    const root = tempProject();
    const capture = captureIo();
    let reached = false;
    await runDesignLayoutBuild(
      { project: root, route: '/', url: 'http://10.0.0.5/', json: true },
      capture.io,
      async () => {
        reached = true;
        return { ok: false, reason: 'should not run' };
      }
    );
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('DESIGN_LAYOUT_URL_UNTRUSTED');
    expect(reached).toBe(false);
    expect(process.exitCode).toBe(2);
  });

  it('when the capture reports a failure, should name the capture code', async () => {
    // given: a capture that fails
    // when: the build runs on a loopback URL
    // then: the envelope carries the capture failure and writes nothing
    const root = tempProject();
    const capture = captureIo();
    await runDesignLayoutBuild(
      { project: root, route: '/', url: 'http://127.0.0.1:3000/', json: true },
      capture.io,
      async () => ({ ok: false, reason: 'no chromium here' })
    );
    const envelope = envelopeOf(capture.out());
    expect(envelope.code).toBe('DESIGN_LAYOUT_CAPTURE_FAILED');
    expect(existsSync(join(root, '.peaks', 'layout-graph', 'index.txt'))).toBe(false);
  });
});

describe('(integration) the read command', () => {
  it('when the build-owned capture is passed back, should reach the current state', async () => {
    // given: a built project and the capture file the build wrote beside the entry
    // when: the read runs with that capture
    // then: the fragment is current and within two kilobytes
    const built = await builtProject();
    expect(existsSync(built.capture)).toBe(true);
    const capture = captureIo();
    runDesignLayoutRead(
      { project: built.root, route: '/', capture: built.capture, json: true },
      capture.io
    );
    const data = envelopeOf(capture.out()).data as Record<string, unknown>;
    expect(data.status).toBe('current');
    expect(Number(data.bytes)).toBeLessThanOrEqual(MAX_FRAGMENT_BYTES);
    expect(String(data.fragment)).toContain('status=current');
  });

  it('when the capture moved, should label the entry stale on the source axis', async () => {
    // given: a built project and a capture whose first measured box shifted
    // when: the read runs with the shifted capture
    // then: the entry is stale and its edges are refused
    const built = await builtProject();
    const shifted = geometryOf('aligned');
    const target = shifted.elements[2];
    if (target !== undefined) target.padding.left = 24;
    const shiftedPath = join(built.root, 'capture-shifted.json');
    writeFileSync(shiftedPath, JSON.stringify(shifted), 'utf8');
    const capture = captureIo();
    runDesignLayoutRead(
      { project: built.root, route: '/', capture: shiftedPath, json: true },
      capture.io
    );
    const data = envelopeOf(capture.out()).data as Record<string, unknown>;
    expect(data.status).toBe('stale');
    expect(data.reasons).toContain('source-geometry-changed');
    expect(String(data.fragment)).toContain('evidence=refused');
  });

  it('when a spacing token moved, should label the entry stale and withhold its verdicts', async () => {
    // given: a built project whose token contract then changes
    // when: the read runs
    // then: the fragment is marked refused and carries no anchor verdict
    const built = await builtProject();
    const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, 'tokens.json'), 'utf8'));
    if (!isTokenContract(parsed)) throw new Error('the fixture contract is not a token contract');
    const section = parsed.space.section;
    if (section === undefined) throw new Error('the fixture contract has no space.section');
    section.$value = '18px';
    writeFileSync(join(built.root, 'design', 'tokens.json'), JSON.stringify(parsed), 'utf8');
    const capture = captureIo();
    runDesignLayoutRead({ project: built.root, route: '/', json: true }, capture.io);
    const data = envelopeOf(capture.out()).data as Record<string, unknown>;
    expect(data.status).toBe('stale');
    expect(String(data.fragment)).toContain('evidence=refused');
    expect(String(data.fragment)).not.toMatch(/^anchor /m);
    expect(String(data.fragment)).not.toContain('not-aligned');
  });
});

describe('(a11y) the reading text', () => {
  it('when an entry cannot be checked, should warn in words that it is not current evidence', async () => {
    // given: a built project read without any current capture
    // when: the read runs
    // then: the warning says the entry is unverified and its edges are not current
    const built = await builtProject();
    const capture = captureIo();
    runDesignLayoutRead({ project: built.root, route: '/', json: true }, capture.io);
    const envelope = envelopeOf(capture.out());
    expect(envelope.warnings).toBeDefined();
    expect((envelope.warnings as string[]).join(' ')).toContain('not current evidence');
  });

  it('when the preview is rebuilt, should write a marked page and report its digest', async () => {
    // given: a built project
    // when: the rebuild runs to a chosen path
    // then: the file carries the marker and the envelope reports a sha256
    const built = await builtProject();
    const out = join(built.root, 'preview.html');
    const capture = captureIo();
    runDesignLayoutRebuild({ project: built.root, route: '/', out, json: true }, capture.io);
    const data = envelopeOf(capture.out()).data as Record<string, unknown>;
    expect(readFileSync(out, 'utf8')).toContain('DIRECTION PREVIEW');
    expect(String(data.sha256)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('when the stored entry no longer matches its own text, should refuse to rebuild it', async () => {
    // given: a written entry whose node text no longer matches its id
    // when: the rebuild runs
    // then: the entry is refused at read time and nothing is written
    const root = tempProject();
    const entry = entryOf('aligned');
    const target = entry.nodes[2];
    const corrupted: LayoutEntry = {
      ...entry,
      nodes: entry.nodes.map((node, index) =>
        index === 2 && target !== undefined ? { ...node, text: 'moved text' } : node
      )
    };
    const ascii = serializeEntry(corrupted);
    if (!ascii.ok) throw new Error(ascii.reason);
    writeEntry(root, entry);
    writeFileSync(entryPath(root, corrupted), ascii.text, 'utf8');
    const out = join(root, 'preview.html');
    const capture = captureIo();
    runDesignLayoutRebuild({ project: root, route: '/', out, json: true }, capture.io);
    const envelope = envelopeOf(capture.out());
    expect(envelope.code).toBe('DESIGN_LAYOUT_ENTRY_INVALID');
    expect(existsSync(out)).toBe(false);
  });
});
