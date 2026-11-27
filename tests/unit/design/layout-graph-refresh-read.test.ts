import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  captureIo,
  disposeProjects,
  FIXTURES,
  geometryOf,
  tempProject,
  TOKENS
} from './_layout-graph-fixtures.js';
import { buildLayoutIndex } from '../../../src/services/design/layout/layout-align.js';
import {
  buildLayoutEntry,
  type LayoutEntry
} from '../../../src/services/design/layout/layout-graph.js';
import { entryPath, writeEntries } from '../../../src/services/design/layout/layout-graph-store.js';
import { affectedEntries } from '../../../src/services/design/layout/layout-graph-incremental.js';
import { keyText } from '../../../src/services/design/layout/layout-graph-paths.js';
import { readSpacingTokens } from '../../../src/services/design/layout/layout-tokens.js';
import { recordDesignRoot } from '../../../src/services/design/layout/layout-graph-root-record.js';
import {
  layoutGraphRefreshNotice,
  refreshLayoutGraphAtSliceBoundary
} from '../../../src/services/design/layout/layout-graph-slice-refresh.js';
import type { LayoutGeometry } from '../../../src/services/design/layout/layout-geometry.js';
import { runDesignLayoutRead } from '../../../src/cli/commands/design-layout-read-command.js';
import { runDesignLayoutRefresh } from '../../../src/cli/commands/design-layout-refresh-command.js';

declareDimensions(
  'tests/unit/design/layout-graph-refresh-read.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'the read envelope shape is asserted by the existing CLI test file; this file asserts status transitions'
    },
    {
      dim: 'a11y',
      reason:
        'no new human-facing text: the read warnings are unchanged and asserted by the existing CLI cases'
    }
  ]
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

function movedGeometry(name: string, from: number, to: number): LayoutGeometry {
  const geometry = geometryOf(name);
  for (const element of geometry.elements) {
    for (const side of SIDES) {
      if (element.padding[side] === from) element.padding[side] = to;
    }
  }
  return geometry;
}

async function refreshedProject(): Promise<string> {
  const root = twoPageProject();
  moveToken(root, 'roomy', '28px');
  const io = captureIo();
  await runDesignLayoutRefresh(
    { project: root, page: ['/=http://127.0.0.1:3000/'], viewport: '390x844', json: true },
    io.io,
    async (input) => ({
      ok: true as const,
      page: {
        geometry: {
          ...movedGeometry('aligned', 24, 28),
          route: input.route,
          viewport: input.viewport
        },
        html: readFileSync(join(FIXTURES, 'aligned.html'), 'utf8')
      }
    })
  );
  return root;
}

function readData(root: string, route: string, capture?: string): Record<string, unknown> {
  const io = captureIo();
  runDesignLayoutRead(
    { project: root, route, ...(capture === undefined ? {} : { capture }), json: true },
    io.io
  );
  return (JSON.parse(io.out()) as { data: Record<string, unknown> }).data;
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

describe('(behavior) the three-state rule survives a refresh', () => {
  it('when a refreshed entry is read with no current capture, should stay unverified rather than current', async () => {
    // given: a refreshed graph entry and a read with no measured document
    // when: the read runs
    // then: the entry is not current just because it was just written
    const root = await refreshedProject();
    const data = readData(root, '/');
    expect(data.status).toBe('unverified');
    expect(String(data.fragment)).toContain('evidence=refused');
  });

  it('when the refreshed entry is read with the new capture, should report current', async () => {
    // given: a refreshed graph entry and the measured document it was built from
    // when: the read runs with that capture
    // then: both fingerprint axes match and the entry is current
    const root = await refreshedProject();
    const capturePath = join(root, 'current.json');
    writeFileSync(capturePath, JSON.stringify(movedGeometry('aligned', 24, 28)), 'utf8');
    const data = readData(root, '/', capturePath);
    expect(data.status).toBe('current');
  });

  it('when a token another page cites moves, should keep this entry current with its capture', async () => {
    // given: a refreshed graph whose untouched card page never cites space.roomy
    // when: the card entry is read with its own measured document
    // then: only the cited subset is fingerprinted, so the card entry stays current
    const root = await refreshedProject();
    const capturePath = join(root, 'card.json');
    writeFileSync(capturePath, JSON.stringify({ ...geometryOf('card'), route: '/card' }), 'utf8');
    const data = readData(root, '/card', capturePath);
    expect(data.status).toBe('current');
  });

  it('when a token the entry cites moves, should report that entry stale', () => {
    // given: a two-page graph whose shared space.section moved
    // when: the card entry is read
    // then: the cited subset moved, so the entry is stale on the token axis
    const root = twoPageProject();
    moveToken(root, 'section', '20px');
    const data = readData(root, '/card');
    expect(data.status).toBe('stale');
    expect(data.reasons).toContain('spacing-tokens-changed');
  });
});

describe('(integration) an unaddressable dependent page', () => {
  it('when a dependent route has no page and no base URL, should report it rather than guess', async () => {
    // given: space.section moved and only the home page named
    // when: the refresh runs without a base URL
    // then: the card entry is reported as not addressed and the run is not full
    const root = twoPageProject();
    moveToken(root, 'section', '20px');
    const io = captureIo();
    await runDesignLayoutRefresh(
      { project: root, page: ['/=http://127.0.0.1:3000/'], viewport: '390x844', json: true },
      io.io,
      async (input) => ({
        ok: true as const,
        page: {
          geometry: {
            ...movedGeometry('aligned', 16, 20),
            route: input.route,
            viewport: input.viewport
          },
          html: readFileSync(join(FIXTURES, 'aligned.html'), 'utf8')
        }
      })
    );
    const data = (JSON.parse(io.out()) as { data: Record<string, unknown> }).data;
    expect(data.notAddressed).toEqual([
      { key: '/card default@390x844', reason: 'no base URL was supplied' }
    ]);
    expect(data.updated).toEqual(['/ default@390x844']);
    expect(data.full).toBe(false);
  });
});

describe('(integration) the recorded design root and a damaged contract', () => {
  it('when the design root is recorded outside the default path, should read that contract', () => {
    // given: a two-page graph and a contract under app/design
    // when: the boundary step and a read run without naming the app root
    // then: both follow the recorded contract and neither reports a miss
    const root = twoPageProject();
    mkdirSync(join(root, 'app', 'design'), { recursive: true });
    copyFileSync(join(root, 'design', 'tokens.json'), join(root, 'app', 'design', 'tokens.json'));
    rmSync(join(root, 'design', 'tokens.json'), { force: true });
    expect(recordDesignRoot(root, join(root, 'app', 'design')).ok).toBe(true);
    const result = refreshLayoutGraphAtSliceBoundary(root);
    expect(result).toMatchObject({ reason: 'up-to-date', markedStale: 0, pendingCapture: 0 });
    const capturePath = join(root, 'card.json');
    writeFileSync(capturePath, JSON.stringify({ ...geometryOf('card'), route: '/card' }), 'utf8');
    expect(readData(root, '/card', capturePath).status).toBe('current');
  });

  it('when the contract is not readable, should report unavailable instead of blaming a token', () => {
    // given: a two-page graph whose contract file is not JSON
    // when: the boundary step runs
    // then: it reports the read failure and claims no count
    const root = twoPageProject();
    writeFileSync(join(root, 'design', 'tokens.json'), '{not json', 'utf8');
    const result = refreshLayoutGraphAtSliceBoundary(root);
    expect(result.reason).toBe('unavailable');
    expect(result.markedStale).toBeNull();
    expect(result.pendingCapture).toBeNull();
    expect(layoutGraphRefreshNotice(result)).toContain('could not be read');
  });

  it('when the contract cannot be read, should judge the token axis stale rather than matching', () => {
    // given: a two-page graph whose contract file is not JSON
    // when: the card entry is read with its own measured document
    // then: an unreadable contract is a stale axis, never an assumed match
    const root = twoPageProject();
    writeFileSync(join(root, 'design', 'tokens.json'), '{not json', 'utf8');
    const capturePath = join(root, 'card.json');
    writeFileSync(capturePath, JSON.stringify({ ...geometryOf('card'), route: '/card' }), 'utf8');
    const data = readData(root, '/card', capturePath);
    expect(data.status).toBe('stale');
    expect(data.reasons).toContain('spacing-tokens-unreadable');
  });

  it('when the refresh meets an unreadable contract, should refuse instead of fanning out', async () => {
    // given: a two-page graph whose contract file is not JSON
    // when: the refresh runs with the home page named
    // then: it refuses with the token contract code
    const root = twoPageProject();
    writeFileSync(join(root, 'design', 'tokens.json'), '{not json', 'utf8');
    const io = captureIo();
    await runDesignLayoutRefresh(
      { project: root, page: ['/=http://127.0.0.1:3000/'], json: true },
      io.io
    );
    const envelope: unknown = JSON.parse(io.out());
    const code =
      typeof envelope === 'object' && envelope !== null && 'code' in envelope
        ? (envelope as { code?: unknown }).code
        : undefined;
    expect(code).toBe('DESIGN_LAYOUT_TOKENS_INVALID');
    expect(process.exitCode).toBe(2);
  });
});

describe('(integration) the refresh leaves an unaffected entry on disk', () => {
  it('when only one page is refreshed, should leave the other entry at its old value', async () => {
    // given: a two-page graph refreshed after space.roomy moved
    // when: both stored entries are read back as files
    // then: the refreshed page cites the new value and the untouched page keeps the old one
    const root = await refreshedProject();
    const home = readFileSync(
      entryPath(root, { route: '/', state: 'default', viewport: VIEW }),
      'utf8'
    );
    const card = readFileSync(
      entryPath(root, { route: '/card', state: 'default', viewport: VIEW }),
      'utf8'
    );
    expect(home).toContain('space.roomy=28px');
    expect(card).toContain('space.roomy=24px');
  });
});

describe('(behavior) the token view names only the cited tokens', () => {
  it('when a current page asks which tokens it uses, should list the cited subset alone', () => {
    // given: a stored card entry that cites 0px and 16px but never the 24px token
    // when: the read is asked a token question with a current capture
    // then: the fragment lists the cited tokens and omits the declared one it never cites
    const root = twoPageProject();
    const capturePath = join(root, 'card.json');
    writeFileSync(capturePath, JSON.stringify({ ...geometryOf('card'), route: '/card' }), 'utf8');
    const io = captureIo();
    runDesignLayoutRead(
      {
        project: root,
        route: '/card',
        question: 'which spacing tokens does this page use?',
        capture: capturePath,
        json: true
      },
      io.io
    );
    const data = (JSON.parse(io.out()) as { data: Record<string, unknown> }).data;
    expect(data.status).toBe('current');
    expect(String(data.fragment)).toContain('token space.section=16px');
    expect(String(data.fragment)).not.toContain('space.roomy');
  });
});

describe('(integration) a tampered entry header cannot steer a path', () => {
  it('when a header state tries to traverse, should refuse the boundary without joining it', () => {
    // given: a graph whose indexes are missing and whose card header state is a relative path
    // when: the slice boundary runs and must rebuild the union from the entries
    // then: the entry is refused as unreadable, no count is claimed, and no path escapes
    const root = twoPageProject();
    const file = entryPath(root, { route: '/card', state: 'default', viewport: VIEW });
    const lines = readFileSync(file, 'utf8').split('\n');
    lines[2] = 'state ../../evil';
    writeFileSync(file, lines.join('\n'), 'utf8');
    rmSync(join(root, '.peaks', 'layout-graph', 'index.txt'), { force: true });
    const result = refreshLayoutGraphAtSliceBoundary(root);
    expect(result.reason).toBe('no-index');
    expect(result.markedStale).toBeNull();
    expect(result.note).toContain('not a readable entry');
    expect(existsSync(join(root, '.peaks', 'evil@390x844.txt'))).toBe(false);
  });
});

describe('(integration) refresh keeps the root the graph was built against', () => {
  it('when the graph was built under an app root, should refresh that contract and keep the record', async () => {
    // given: a graph recorded against app/design while design/ holds a different contract
    // when: the refresh runs without naming the app root
    // then: the app contract is the one refreshed and the record still names it
    const root = twoPageProject();
    mkdirSync(join(root, 'app', 'design'), { recursive: true });
    copyFileSync(join(root, 'design', 'tokens.json'), join(root, 'app', 'design', 'tokens.json'));
    const appContractPath = join(root, 'app', 'design', 'tokens.json');
    const parsed = JSON.parse(readFileSync(appContractPath, 'utf8')) as {
      space: Record<string, { $value: string }>;
    };
    const roomy = parsed.space.roomy;
    if (roomy === undefined) throw new Error('the fixture contract has no space.roomy');
    roomy.$value = '28px';
    writeFileSync(appContractPath, JSON.stringify(parsed), 'utf8');
    expect(recordDesignRoot(root, join(root, 'app', 'design')).ok).toBe(true);
    const io = captureIo();
    await runDesignLayoutRefresh(
      { project: root, page: ['/=http://127.0.0.1:3000/'], viewport: '390x844', json: true },
      io.io,
      async (input) => ({
        ok: true as const,
        page: {
          geometry: {
            ...movedGeometry('aligned', 24, 28),
            route: input.route,
            viewport: input.viewport
          },
          html: readFileSync(join(FIXTURES, 'aligned.html'), 'utf8')
        }
      })
    );
    const data = (JSON.parse(io.out()) as { data: Record<string, unknown> }).data;
    expect(data.changedTokens).toEqual(['space.roomy']);
    expect(data.updated).toEqual(['/ default@390x844']);
    const record = readFileSync(join(root, '.peaks', 'layout-graph', 'design-root.txt'), 'utf8');
    expect(record.trim()).toBe('app/design');
  });
});

describe('(behavior) the union does not hide an unreadable graph or an added token', () => {
  it('when the union cannot be computed, should report the refresh as not full', async () => {
    // given: a two-page graph whose card entry was overwritten with junk
    // when: the refresh runs with the home page named
    // then: the mode is full and the run is not reported as complete
    const root = twoPageProject();
    writeFileSync(
      entryPath(root, { route: '/card', state: 'default', viewport: VIEW }),
      'junk\n',
      'utf8'
    );
    const io = captureIo();
    await runDesignLayoutRefresh(
      { project: root, page: ['/=http://127.0.0.1:3000/'], viewport: '390x844', json: true },
      io.io,
      async (input) => ({
        ok: true as const,
        page: {
          geometry: { ...geometryOf('aligned'), route: input.route, viewport: input.viewport },
          html: readFileSync(join(FIXTURES, 'aligned.html'), 'utf8')
        }
      })
    );
    const data = (JSON.parse(io.out()) as { data: Record<string, unknown> }).data;
    expect(data.mode).toBe('full');
    expect(data.full).toBe(false);
  });

  it('when the contract adds a token at a value already cited, should mark the citing entries', () => {
    // given: a two-page graph whose contract gains a 16px token nobody cited by name
    // when: the affected union is computed
    // then: both pages cite 16px, so both are affected although no value moved
    const root = twoPageProject();
    const path = join(root, 'design', 'tokens.json');
    const contract = JSON.parse(readFileSync(path, 'utf8')) as { space: Record<string, unknown> };
    contract.space.twin = { $value: '16px', $type: 'dimension' };
    writeFileSync(path, JSON.stringify(contract), 'utf8');
    const affected = affectedEntries(root, readSpacingTokens(join(root, 'design')));
    expect(affected.mode).toBe('index');
    expect(affected.affected.map(keyText)).toEqual(['/ default@390x844', '/card default@390x844']);
    expect(affected.changedTokens).toContain('space.twin');
  });
});
