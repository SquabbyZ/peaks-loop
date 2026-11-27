import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  disposeProjects,
  entryOf,
  geometryOf,
  tempProject,
  textOf,
  TOKENS
} from './_layout-graph-fixtures.js';
import { readEntry, selectEntry } from '../../../src/services/design/layout/layout-graph-query.js';
import { buildLayoutIndex } from '../../../src/services/design/layout/layout-align.js';
import {
  buildLayoutEntry,
  type LayoutEntry
} from '../../../src/services/design/layout/layout-graph.js';
import {
  affectedEntries,
  indexMatchesDirectories
} from '../../../src/services/design/layout/layout-graph-incremental.js';
import { keyText } from '../../../src/services/design/layout/layout-graph-paths.js';
import { readSpacingTokens } from '../../../src/services/design/layout/layout-tokens.js';
import { refreshLayoutGraphAtSliceBoundary } from '../../../src/services/design/layout/layout-graph-slice-refresh.js';
import {
  capturePath,
  entryPath,
  graphRoot,
  readIndex,
  scanEntries,
  writeBatch,
  writeCapture,
  writeEntries,
  writeEntry
} from '../../../src/services/design/layout/layout-graph-store.js';

declareDimensions(
  'tests/unit/design/layout-graph-store.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'the store writes files and prints no human-facing text' }]
);

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VIEW = { width: 390, height: 844 };

/** Two stored pages: `/` cites space.roomy, `/card` does not. */
function twoPageProject(): string {
  const root = tempProject();
  const make = (name: string, route: string): LayoutEntry => {
    const geometry = { ...geometryOf(name), route };
    return buildLayoutEntry({
      index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
      geometry,
      state: 'default',
      tokens: TOKENS
    });
  };
  const written = writeEntries(root, [make('aligned', '/'), make('card', '/card')]);
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

afterEach(disposeProjects);

describe('(render) the graph directory', () => {
  it('when an entry is written, should land under a route directory with an index beside it', () => {
    // given: a throwaway project and the aligned entry
    // when: the entry is written
    // then: the entry file and the index exist and the entry reads back
    const root = tempProject();
    const written = writeEntry(root, entryOf('aligned'));
    expect(written.ok).toBe(true);
    if (written.ok) {
      expect(written.path).toBe(entryPath(root, entryOf('aligned')));
      expect(written.path).toContain(join('layout-graph', 'page'));
      expect(written.path.endsWith('default@390x844.txt')).toBe(true);
      expect(readFileSync(written.path, 'utf8')).toBe(textOf(entryOf('aligned')));
    }
    expect(existsSync(join(graphRoot(root), 'index.txt'))).toBe(true);
  });

  it('when two viewports are written, should list both entries in the index', () => {
    // given: a project and the same route at two viewports
    // when: both entries are written
    // then: the index lists each state and viewport once
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    const wide = { ...entryOf('aligned'), viewport: { width: 1280, height: 800 } };
    writeEntry(root, wide);
    const index = readIndex(root);
    expect(index.ok).toBe(true);
    if (index.ok) {
      expect(
        index.entries.map((entry) => `${entry.state}@${String(entry.viewport.width)}`)
      ).toEqual(['default@390', 'default@1280']);
    }
  });
});

describe('(behavior) selection and refusals', () => {
  it('when one entry exists for a route, should select it without a viewport', () => {
    // given: one written entry
    // when: the route alone is selected
    // then: the entry is returned with its key
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    const selected = selectEntry(root, { route: '/' });
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.entry.viewport).toEqual({ width: 390, height: 844 });
  });

  it('when two viewports exist and none is named, should refuse as ambiguous', () => {
    // given: two written viewports for one route
    // when: the route alone is selected
    // then: the refusal lists the available keys
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    writeEntry(root, { ...entryOf('aligned'), viewport: { width: 1280, height: 800 } });
    const selected = selectEntry(root, { route: '/' });
    expect(selected.ok).toBe(false);
    if (!selected.ok) expect(selected.available).toEqual(['default@390x844', 'default@1280x800']);
  });

  it('when a state tries to escape the route directory, should refuse before writing', () => {
    // given: an entry whose state contains a path separator
    // when: it is written
    // then: the write is refused and nothing lands outside the graph root
    const root = tempProject();
    const escaped = { ...entryOf('aligned'), state: '../escape' };
    const written = writeEntry(root, escaped);
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.reason).toContain('file-safe');
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });

  it('when the index path is a directory, should answer with a failure instead of throwing', () => {
    // given: a project whose index.txt was replaced by a directory
    // when: a batch is written
    // then: the write returns a structured failure and does not throw
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    const indexPath = join(graphRoot(root), 'index.txt');
    rmSync(indexPath, { force: true });
    mkdirSync(join(indexPath, 'nested'), { recursive: true });
    const written = writeEntries(root, [entryOf('aligned')]);
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.reason).toContain('could not be written');
  });

  it('when an entry is larger than the bound, should refuse it instead of writing', () => {
    // given: an entry whose first node carries nine thousand characters of text
    // when: it is written
    // then: the refusal names the byte bound
    const root = tempProject();
    const entry = entryOf('aligned');
    const large = {
      ...entry,
      nodes: entry.nodes.map((node, index) =>
        index === 0 ? { ...node, text: 'x'.repeat(9000), ownText: 'x'.repeat(9000) } : node
      )
    };
    const written = writeEntry(root, large);
    expect(written.ok).toBe(false);
    if (!written.ok) expect(written.reason).toContain('over the');
  });

  it('when a batch holds one oversized entry, should leave none of the batch on disk', () => {
    // given: a valid entry and an oversized one in one batch
    // when: the batch is written
    // then: it is refused before any final file exists
    const root = tempProject();
    const entry = entryOf('aligned');
    const large = {
      ...entry,
      viewport: { width: 1280, height: 800 },
      nodes: entry.nodes.map((node, index) =>
        index === 0 ? { ...node, text: 'x'.repeat(9000), ownText: 'x'.repeat(9000) } : node
      )
    };
    const written = writeEntries(root, [entry, large]);
    expect(written.ok).toBe(false);
    expect(existsSync(entryPath(root, entry))).toBe(false);
    expect(existsSync(entryPath(root, large))).toBe(false);
  });

  it('when a batch is refused, should leave neither its entries nor its captures', () => {
    // given: a valid entry with its capture and an oversized second entry
    // when: the batch is written
    // then: nothing of the batch exists after the refusal
    const root = tempProject();
    const entry = entryOf('aligned');
    const large = {
      ...entry,
      viewport: { width: 1280, height: 800 },
      nodes: entry.nodes.map((node, index) =>
        index === 0 ? { ...node, text: 'x'.repeat(9000), ownText: 'x'.repeat(9000) } : node
      )
    };
    const written = writeBatch(root, [
      { entry, capture: { route: '/', viewport: entry.viewport, elements: [] } },
      { entry: large, capture: { route: '/', viewport: large.viewport, elements: [] } }
    ]);
    expect(written.ok).toBe(false);
    expect(existsSync(entryPath(root, entry))).toBe(false);
    expect(existsSync(capturePath(root, entry))).toBe(false);
  });

  it('when a capture is kept, should sit beside the entry inside the graph directory', () => {
    // given: an entry and the measured document it was built from
    // when: the capture is written
    // then: it lands under captures/ and reads back as the same document
    const root = tempProject();
    const entry = entryOf('aligned');
    const geometry = { route: '/', viewport: entry.viewport, elements: [] };
    const written = writeCapture(root, entry, geometry);
    expect(written.ok).toBe(true);
    if (written.ok) {
      expect(written.path).toBe(capturePath(root, entry));
      expect(JSON.parse(readFileSync(written.path, 'utf8'))).toEqual(geometry);
    }
  });
});

describe('(integration) damaged files and the ignore rule', () => {
  it('when an entry file is corrupted, should make the index scan refuse rather than skip it', () => {
    // given: a written entry whose file is then overwritten with junk
    // when: the entries are scanned
    // then: the corruption is a reason, not a silent omission
    const root = tempProject();
    const written = writeEntry(root, entryOf('aligned'));
    expect(written.ok).toBe(true);
    if (written.ok) writeFileSync(written.path, 'not an entry\n', 'utf8');
    const scanned = scanEntries(root);
    expect(scanned.ok).toBe(false);
    if (!scanned.ok) expect(scanned.reason).toContain('not a readable entry');
  });

  it('when a graph file exists in this repository, should be ignored by git and absent from status', () => {
    // given: a probe file under the real graph root
    // when: git check-ignore and git status read the tree
    // then: the ignore rule names the directory and status shows no graph file
    const root = graphRoot(REPO);
    mkdirSync(root, { recursive: true });
    const probe = join(root, 'check-ignore-probe.txt');
    writeFileSync(probe, 'probe\n', 'utf8');
    try {
      const ignored = execFileSync(
        'git',
        ['check-ignore', '-v', '.peaks/layout-graph/check-ignore-probe.txt'],
        {
          cwd: REPO,
          encoding: 'utf8',
          windowsHide: true
        }
      );
      expect(ignored).toContain('.peaks/layout-graph/');
      const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: REPO,
        encoding: 'utf8',
        windowsHide: true
      });
      expect(status).not.toContain('.peaks/layout-graph');
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it('when a written entry is read back, should return the same anchors', () => {
    // given: a written entry
    // when: it is read by key
    // then: its anchors and nodes equal the entry that was written
    const root = tempProject();
    const entry = entryOf('mismatched');
    writeEntry(root, entry);
    const read = readEntry(root, entry);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.entry.anchors).toEqual(entry.anchors);
      expect(read.entry.nodes.map((node) => node.id)).toEqual(entry.nodes.map((node) => node.id));
    }
  });
});

describe('(integration) the fast path does not trust a rewritten entry', () => {
  it('when an entry is overwritten under the same name, should refuse the index and name it', () => {
    // given: a two-page graph whose card entry is rewritten in place to cite space.roomy
    // when: space.roomy moves and the affected union is computed
    // then: the index is refused as out of date and the rewritten entry is named
    const root = twoPageProject();
    const geometry = { ...geometryOf('aligned'), route: '/card' };
    const rewritten = buildLayoutEntry({
      index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
      geometry,
      state: 'default',
      tokens: TOKENS
    });
    writeFileSync(
      entryPath(root, { route: '/card', state: 'default', viewport: VIEW }),
      textOf(rewritten),
      'utf8'
    );
    const index = readIndex(root);
    expect(index.ok).toBe(true);
    if (!index.ok) return;
    expect(indexMatchesDirectories(root, index.entries)).toEqual({ ok: true, matches: false });
    moveToken(root, 'roomy', '28px');
    const affected = affectedEntries(root, readSpacingTokens(join(root, 'design')));
    expect(affected.mode).toBe('entries');
    expect(affected.needsRewrite).toBe(true);
    expect(affected.affected.map(keyText)).toEqual(['/ default@390x844', '/card default@390x844']);
  });

  it('when nothing changed, should leave both index files byte-identical', () => {
    // given: a two-page graph whose indexes are current
    // when: the slice boundary runs twice with no change between them
    // then: neither index file moves and the fast path reports no rewrite
    const root = twoPageProject();
    const stateOf = (name: string) => {
      const path = join(root, '.peaks', 'layout-graph', name);
      return {
        hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
        mtimeMs: statSync(path).mtimeMs
      };
    };
    const before = { index: stateOf('index.txt'), tokens: stateOf('tokens.txt') };
    expect(refreshLayoutGraphAtSliceBoundary(root).reason).toBe('up-to-date');
    expect(refreshLayoutGraphAtSliceBoundary(root).reason).toBe('up-to-date');
    expect({ index: stateOf('index.txt'), tokens: stateOf('tokens.txt') }).toEqual(before);
    const affected = affectedEntries(root, readSpacingTokens(join(root, 'design')));
    expect(affected.mode).toBe('index');
    expect(affected.needsRewrite).toBe(false);
  });
});
