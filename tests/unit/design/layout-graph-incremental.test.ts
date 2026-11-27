import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  captureIo,
  disposeProjects,
  FIXTURES,
  geometryOf,
  tempProject,
  textOf,
  TOKENS
} from './_layout-graph-fixtures.js';
import { buildLayoutIndex } from '../../../src/services/design/layout/layout-align.js';
import {
  buildLayoutEntry,
  type LayoutEntry
} from '../../../src/services/design/layout/layout-graph.js';
import {
  affectedEntries,
  batchTargets,
  MAX_BATCH_ROUTES,
  type RefreshTarget
} from '../../../src/services/design/layout/layout-graph-incremental.js';
import { keyText } from '../../../src/services/design/layout/layout-graph-paths.js';
import {
  readTokenIndex,
  referencedTokens,
  TOKEN_INDEX_FILE
} from '../../../src/services/design/layout/layout-graph-token-index.js';
import {
  entryPath,
  graphRoot,
  writeEntries
} from '../../../src/services/design/layout/layout-graph-store.js';
import {
  layoutGraphRefreshNotice,
  refreshLayoutGraphAtSliceBoundary
} from '../../../src/services/design/layout/layout-graph-slice-refresh.js';
import type { LayoutGeometry } from '../../../src/services/design/layout/layout-geometry.js';
import { readSpacingTokens } from '../../../src/services/design/layout/layout-tokens.js';
import { runDesignLayoutRefresh } from '../../../src/cli/commands/design-layout-refresh-command.js';

declareDimensions(
  'tests/unit/design/layout-graph-incremental.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const VIEW = { width: 390, height: 844 };
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

function entryFor(name: string, route: string): LayoutEntry {
  const geometry = { ...geometryOf(name), route };
  return buildLayoutEntry({
    index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
    geometry,
    state: 'default',
    tokens: TOKENS
  });
}

/** Two stored pages: `/` cites space.roomy, `/card` does not. */
function twoPageProject(): string {
  const root = tempProject();
  const written = writeEntries(root, [entryFor('aligned', '/'), entryFor('card', '/card')]);
  if (!written.ok) throw new Error(written.reason);
  return root;
}

function moveToken(root: string, name: string, value: string): void {
  const path = join(root, 'design', 'tokens.json');
  const contract = JSON.parse(readFileSync(path, 'utf8')) as {
    space: Record<string, { $value: string }>;
  };
  const token = contract.space[name];
  if (token === undefined) throw new Error(`no token ${name}`);
  token.$value = value;
  writeFileSync(path, JSON.stringify(contract), 'utf8');
}

function tokensOf(root: string) {
  return readSpacingTokens(join(root, 'design'));
}

function textOfEntry(root: string, route: string): string {
  return readFileSync(entryPath(root, { route, state: 'default', viewport: VIEW }), 'utf8');
}

/** The same page with one pixel value moved, as a re-render would report it. */
function movedGeometry(name: string, from: number, to: number): LayoutGeometry {
  const geometry = geometryOf(name);
  for (const element of geometry.elements) {
    for (const side of SIDES) {
      if (element.padding[side] === from) element.padding[side] = to;
    }
  }
  return geometry;
}

function envelopeOf(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

type CaptureCalls = { route: string; url: string }[];

/** A capture seam that answers from a per-route geometry table and records calls. */
function captureFor(
  pages: Record<string, () => LayoutGeometry>,
  calls: CaptureCalls
): (input: { route: string; url: string; viewport: { width: number; height: number } }) => Promise<{
  ok: true;
  page: { geometry: LayoutGeometry; html: string };
}> {
  return async (input) => {
    calls.push({ route: input.route, url: input.url });
    const make = pages[input.route] ?? (() => geometryOf('aligned'));
    return {
      ok: true as const,
      page: {
        geometry: { ...make(), route: input.route, viewport: input.viewport },
        html: readFileSync(join(FIXTURES, 'aligned.html'), 'utf8')
      }
    };
  };
}

let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  disposeProjects();
});

describe('(render) the token reverse index', () => {
  it('when an entry stores padding values, should cite every declared token that matches them', () => {
    // given: the aligned entry and the card entry
    // when: their cited tokens are read
    // then: roomy is cited only by the page whose padding carries 24px
    const home = referencedTokens(entryFor('aligned', '/')).map((cite) => cite.name);
    const card = referencedTokens(entryFor('card', '/card')).map((cite) => cite.name);
    expect(home).toContain('space.roomy');
    expect(home).toContain('space.section');
    expect(card).toContain('space.section');
    expect(card).not.toContain('space.roomy');
  });

  it('when entries are indexed, should write one token group per cited name and a ref per citing entry', () => {
    // given: a project with the two stored pages
    // when: the token index file is read back
    // then: the group for roomy names the home page at its cited 24px and no card ref
    const root = twoPageProject();
    const index = readTokenIndex(root);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    const roomy = index.tokens.get('space.roomy') ?? [];
    expect(roomy.map((ref) => keyText(ref.key))).toEqual(['/ default@390x844']);
    expect(roomy[0]?.value).toBe('24px');
    expect(existsSync(join(graphRoot(root), TOKEN_INDEX_FILE))).toBe(true);
  });
});

describe('(behavior) the affected-entry union', () => {
  it('when no declared value moved, should name no affected entry', () => {
    // given: a two-page graph and its unchanged contract
    // when: the affected union is computed
    // then: every entry is reported unchanged
    const root = twoPageProject();
    const affected = affectedEntries(root, tokensOf(root));
    expect(affected.mode).toBe('index');
    expect(affected.affected).toEqual([]);
    expect(affected.unchanged.map(keyText)).toEqual(['/ default@390x844', '/card default@390x844']);
  });

  it('when a token cited by one page moves, should name that page alone', () => {
    // given: a two-page graph whose contract moved space.roomy from 24px to 28px
    // when: the affected union is computed
    // then: only the home page is affected and the moved token is named
    const root = twoPageProject();
    moveToken(root, 'roomy', '28px');
    const affected = affectedEntries(root, tokensOf(root));
    expect(affected.affected.map(keyText)).toEqual(['/ default@390x844']);
    expect(affected.changedTokens).toEqual(['space.roomy']);
    expect(affected.unchanged.map(keyText)).toEqual(['/card default@390x844']);
  });

  it('when a token both pages cite moves, should name both pages', () => {
    // given: a two-page graph whose contract moved space.section from 16px to 20px
    // when: the affected union is computed
    // then: both entries are affected
    const root = twoPageProject();
    moveToken(root, 'section', '20px');
    const affected = affectedEntries(root, tokensOf(root));
    expect(affected.affected.map(keyText)).toEqual(['/ default@390x844', '/card default@390x844']);
    expect(affected.changedTokens).toEqual(['space.section']);
  });

  it('when a cited token is removed from the contract, should treat every citing entry as affected', () => {
    // given: a two-page graph whose contract no longer declares space.roomy
    // when: the affected union is computed
    // then: the home page is affected and the missing name is reported
    const root = twoPageProject();
    const path = join(root, 'design', 'tokens.json');
    const contract = JSON.parse(readFileSync(path, 'utf8')) as { space: Record<string, unknown> };
    delete contract.space.roomy;
    writeFileSync(path, JSON.stringify(contract), 'utf8');
    const affected = affectedEntries(root, tokensOf(root));
    expect(affected.affected.map(keyText)).toEqual(['/ default@390x844']);
    expect(affected.changedTokens).toEqual(['space.roomy']);
  });

  it('when the token index is missing, should rebuild the union from the entries', () => {
    // given: a two-page graph with a moved token and no token index file
    // when: the affected union is computed
    // then: the index is rebuilt from the entries and the same page is named
    const root = twoPageProject();
    moveToken(root, 'roomy', '28px');
    rmSync(join(graphRoot(root), TOKEN_INDEX_FILE), { force: true });
    const affected = affectedEntries(root, tokensOf(root));
    expect(affected.mode).toBe('entries');
    expect(affected.reason).toContain('do not name every entry');
    expect(affected.affected.map(keyText)).toEqual(['/ default@390x844']);
  });

  it('when an entry file is damaged, should report a full recompute instead of a subset', () => {
    // given: a two-page graph whose card entry was overwritten with junk
    // when: the affected union is computed
    // then: the mode is full and no subset is named
    const root = twoPageProject();
    writeFileSync(
      entryPath(root, { route: '/card', state: 'default', viewport: VIEW }),
      'junk\n',
      'utf8'
    );
    const affected = affectedEntries(root, tokensOf(root));
    expect(affected.mode).toBe('full');
    expect(affected.affected).toEqual([]);
    expect(affected.reason).toContain('not a readable entry');
  });

  it('when the indexes predate a route directory, should still find that route', () => {
    // given: a third entry written straight to its route directory after both indexes
    // when: a token that entry cites moves
    // then: the union names the unindexed route
    const root = twoPageProject();
    const key = { route: '/blog', state: 'default', viewport: VIEW };
    mkdirSync(dirname(entryPath(root, key)), { recursive: true });
    writeFileSync(entryPath(root, key), textOf(entryFor('card', '/blog')), 'utf8');
    moveToken(root, 'section', '20px');
    const affected = affectedEntries(root, tokensOf(root));
    expect(affected.mode).toBe('entries');
    expect(affected.affected.map(keyText)).toContain('/blog default@390x844');
  });
});

describe('(behavior) the batch bound', () => {
  function targets(count: number, routes: number): RefreshTarget[] {
    return Array.from({ length: count }, (_, index) => ({
      route: `/p${String(index % routes)}`,
      state: 'default',
      viewport: { width: 390, height: 844 },
      url: 'http://127.0.0.1:3000/'
    }));
  }

  it('when a list holds exactly fifty routes, should keep it in one batch', () => {
    // given: fifty distinct routes
    // when: the list is batched
    // then: one batch is returned and it is reported as full
    const split = batchTargets(targets(MAX_BATCH_ROUTES, MAX_BATCH_ROUTES));
    expect(split.batches).toHaveLength(1);
    expect(split.full).toBe(true);
  });

  it('when a list holds fifty-one routes, should split it and mark it not full', () => {
    // given: fifty-one distinct routes
    // when: the list is batched
    // then: the list is split and it is reported as not full
    const split = batchTargets(targets(MAX_BATCH_ROUTES + 1, MAX_BATCH_ROUTES + 1));
    expect(split.batches.length).toBeGreaterThan(1);
    expect(split.full).toBe(false);
  });
});

describe('(integration) a per-page token change updates one entry', () => {
  it('when only one page cites the moved token, should rewrite that entry and leave the other untouched', async () => {
    // given: two stored pages, space.roomy moved to 28px, and only the home page named
    // when: the incremental refresh runs
    // then: the home entry is rewritten at 28px and the card entry keeps its bytes
    const root = twoPageProject();
    const before = textOfEntry(root, '/card');
    moveToken(root, 'roomy', '28px');
    const calls: CaptureCalls = [];
    const capture = captureFor({ '/': () => movedGeometry('aligned', 24, 28) }, calls);
    const io = captureIo();
    await runDesignLayoutRefresh(
      {
        project: root,
        page: ['/=http://127.0.0.1:3000/'],
        viewport: '390x844',
        json: true
      },
      io.io,
      capture
    );
    const data = envelopeOf(io.out()).data as Record<string, unknown>;
    expect(data.updated).toEqual(['/ default@390x844']);
    expect(data.changedTokens).toEqual(['space.roomy']);
    expect(data.affected).toEqual(['/ default@390x844']);
    expect(calls.map((call) => call.route)).toEqual(['/']);
    expect(textOfEntry(root, '/')).toContain('space.roomy=28px');
    expect(textOfEntry(root, '/card')).toBe(before);
  });

  it('when a supplied page did not move, should leave its entry byte-identical', async () => {
    // given: a stored page and a capture that reports the same measured document
    // when: the refresh runs with the unchanged page named
    // then: nothing is rewritten and the entry keeps its bytes
    const root = twoPageProject();
    const before = textOfEntry(root, '/');
    const calls: CaptureCalls = [];
    const io = captureIo();
    await runDesignLayoutRefresh(
      { project: root, page: ['/=http://127.0.0.1:3000/'], viewport: '390x844', json: true },
      io.io,
      captureFor({ '/': () => geometryOf('aligned') }, calls)
    );
    const data = envelopeOf(io.out()).data as Record<string, unknown>;
    expect(data.updated).toEqual([]);
    expect(textOfEntry(root, '/')).toBe(before);
  });
});

describe('(integration) a global token change fans out to every dependent entry', () => {
  it('when one page is named and a token both pages cite moves, should refresh both entries', async () => {
    // given: space.section moved to 20px, only the home page named, and a base URL
    // when: the incremental refresh runs
    // then: the dependent card page is addressed and both entries carry the new value
    const root = twoPageProject();
    moveToken(root, 'section', '20px');
    const calls: CaptureCalls = [];
    const capture = captureFor(
      {
        '/': () => movedGeometry('aligned', 16, 20),
        '/card': () => movedGeometry('card', 16, 20)
      },
      calls
    );
    const io = captureIo();
    await runDesignLayoutRefresh(
      {
        project: root,
        page: ['/=http://127.0.0.1:3000/'],
        baseUrl: 'http://127.0.0.1:3000',
        viewport: '390x844',
        json: true
      },
      io.io,
      capture
    );
    const data = envelopeOf(io.out()).data as Record<string, unknown>;
    expect(data.updated).toEqual(['/ default@390x844', '/card default@390x844']);
    expect(data.notAddressed).toEqual([]);
    expect(calls.map((call) => call.route).sort()).toEqual(['/', '/card']);
    expect(calls.find((call) => call.route === '/card')?.url).toBe('http://127.0.0.1:3000/card');
    expect(textOfEntry(root, '/')).toContain('space.section=20px');
    expect(textOfEntry(root, '/card')).toContain('space.section=20px');
  });

  it('when both index files are missing, should rebuild from the entries and re-measure both pages', async () => {
    // given: both indexes removed and both pages named
    // when: the refresh runs
    // then: the union is rebuilt from the route directories and both entries are written
    const root = twoPageProject();
    rmSync(join(graphRoot(root), 'index.txt'), { force: true });
    rmSync(join(graphRoot(root), TOKEN_INDEX_FILE), { force: true });
    moveToken(root, 'section', '20px');
    const calls: CaptureCalls = [];
    const io = captureIo();
    await runDesignLayoutRefresh(
      {
        project: root,
        page: ['/=http://127.0.0.1:3000/', '/card=http://127.0.0.1:3000/card'],
        viewport: '390x844',
        json: true
      },
      io.io,
      captureFor(
        {
          '/': () => movedGeometry('aligned', 16, 20),
          '/card': () => movedGeometry('card', 16, 20)
        },
        calls
      )
    );
    const data = envelopeOf(io.out()).data as Record<string, unknown>;
    expect(data.mode).toBe('entries');
    expect(calls).toHaveLength(2);
    expect(data.updated).toEqual(['/ default@390x844', '/card default@390x844']);
  });
});

describe('(a11y) the slice-boundary step', () => {
  it('when the project has no graph, should report no graph and stay silent', () => {
    // given: a project with no graph directory
    // when: the boundary step runs
    // then: it names no graph and there is nothing to print
    const result = refreshLayoutGraphAtSliceBoundary(tempProject());
    expect(result.reason).toBe('no-graph');
    expect(layoutGraphRefreshNotice(result)).toBeNull();
  });

  it('when every cited value still matches, should report nothing pending and stay silent', () => {
    // given: a two-page graph and its unchanged contract
    // when: the boundary step runs
    // then: both counts are measured zero and there is nothing to print
    const result = refreshLayoutGraphAtSliceBoundary(twoPageProject());
    expect(result).toMatchObject({ reason: 'up-to-date', markedStale: 0, pendingCapture: 0 });
    expect(layoutGraphRefreshNotice(result)).toBeNull();
  });

  it('when a cited token moved, should mark that entry stale and pending one capture', () => {
    // given: a two-page graph whose space.roomy moved
    // when: the boundary step runs
    // then: one entry is marked stale, its capture is pending, and no note claims an update
    const root = twoPageProject();
    moveToken(root, 'roomy', '28px');
    const result = refreshLayoutGraphAtSliceBoundary(root);
    expect(result).toMatchObject({ markedStale: 1, pendingCapture: 1, reason: 'capture-required' });
    const note = layoutGraphRefreshNotice(result) ?? '';
    expect(note).toContain('space.roomy');
    expect(note).not.toContain('updated');
  });

  it('when the graph directory is unreadable, should return an unknown count instead of a zero', () => {
    // given: a path where the graph directory is a file
    // when: the boundary step runs
    // then: the failure is a value, its counts are unknown, and it is printable
    const root = tempProject();
    mkdirSync(join(root, '.peaks'), { recursive: true });
    writeFileSync(join(root, '.peaks', 'layout-graph'), 'not a directory', 'utf8');
    const result = refreshLayoutGraphAtSliceBoundary(root);
    expect(result).toMatchObject({ reason: 'no-index', markedStale: null, pendingCapture: null });
    expect(layoutGraphRefreshNotice(result)).toBeTruthy();
  });
});

describe('(a11y) refresh refusals name the reason', () => {
  it('when no page is named, should refuse before any capture', async () => {
    // given: a refresh with an empty page list
    // when: the command runs
    // then: the refusal names the missing page and exits refused
    const root = tempProject();
    const io = captureIo();
    await runDesignLayoutRefresh({ project: root, page: [], json: true }, io.io);
    const envelope = envelopeOf(io.out());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('DESIGN_LAYOUT_PAGE_REQUIRED');
    expect(process.exitCode).toBe(2);
  });

  it('when a page cannot be parsed, should refuse with the page code', async () => {
    // given: a page without the route=url separator
    // when: the command runs
    // then: the refusal names the page shape
    const root = tempProject();
    const io = captureIo();
    await runDesignLayoutRefresh({ project: root, page: ['/only-a-route'], json: true }, io.io);
    expect(envelopeOf(io.out()).code).toBe('DESIGN_LAYOUT_PAGE_INVALID');
    expect(process.exitCode).toBe(2);
  });

  it('when a page URL is untrusted, should refuse before any capture', async () => {
    // given: a private-network page URL
    // when: the command runs with a capture that must not be reached
    // then: the URL is refused and no capture ran
    const root = tempProject();
    const io = captureIo();
    let reached = false;
    await runDesignLayoutRefresh(
      { project: root, page: ['/=http://10.0.0.5/'], json: true },
      io.io,
      async () => {
        reached = true;
        return { ok: false, reason: 'should not run' };
      }
    );
    expect(envelopeOf(io.out()).code).toBe('DESIGN_LAYOUT_URL_UNTRUSTED');
    expect(reached).toBe(false);
  });
});
