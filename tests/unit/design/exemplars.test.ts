import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  archetypeForRoute,
  readExemplars,
  type ExemplarEntry
} from '../../../src/services/design/exemplars.js';

import type * as ExemplarsModuleTypes from '../../../src/services/design/exemplars.js';

type ExemplarsModule = typeof ExemplarsModuleTypes;

/**
 * The SUT is imported per test after `vi.resetModules()` so its module-level
 * path constants (the exemplar directory and the meta file name) initialise
 * INSIDE a test body, where Stryker's per-test coverage can schedule a mutant.
 */
async function loadExemplars(): Promise<ExemplarsModule> {
  vi.resetModules();
  return import('../../../src/services/design/exemplars.js');
}

declareDimensions('tests/unit/design/exemplars.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeContractRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-exemplars-'));
  roots.push(root);
  return root;
}

type Fixture = {
  route?: string;
  sourceName?: string;
  screenshotName?: string;
  metaBody?: string;
  writeSource?: boolean;
  writeScreenshot?: boolean;
};

function writeExemplar(root: string, archetype: string, fixture: Fixture = {}): string {
  const dir = join(root, 'design', 'exemplars', archetype);
  mkdirSync(dir, { recursive: true });
  const sourceName = fixture.sourceName ?? `${archetype}.tsx`;
  if (fixture.writeSource !== false) {
    writeFileSync(join(dir, sourceName), 'export const exemplar = null;\n');
  }
  if (fixture.screenshotName !== undefined && fixture.writeScreenshot !== false) {
    writeFileSync(join(dir, fixture.screenshotName), 'png');
  }
  const metaBody =
    fixture.metaBody ??
    JSON.stringify({
      route: fixture.route ?? `/${archetype}`,
      sourceFile: sourceName,
      screenshotPath: fixture.screenshotName ?? null,
      generatedAt: '2026-11-24T00:00:00.000Z'
    });
  writeFileSync(join(dir, 'meta.json'), metaBody);
  return dir;
}

function entryFor(route: string): ExemplarEntry {
  return {
    archetype: 'list',
    route,
    sourceFile: 'list.tsx',
    screenshotPath: null,
    metaPath: 'meta.json'
  };
}

describe('Scenario: render — the shape a registered exemplar is read into', () => {
  it('should resolve the route and sibling paths of a valid entry', () => {
    // given: an archetype directory with meta.json, a source and a screenshot
    // when: the registry is read
    // then: one entry carries the route and absolute sibling paths
    const root = makeContractRoot();
    const dir = writeExemplar(root, 'list', {
      route: '/features/channels',
      sourceName: 'channels.tsx',
      screenshotName: 'channels.png'
    });

    const { entries, issues } = readExemplars(root);

    expect(issues).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      archetype: 'list',
      route: '/features/channels',
      sourceFile: join(dir, 'channels.tsx'),
      screenshotPath: join(dir, 'channels.png'),
      metaPath: join(dir, 'meta.json')
    });
  });

  it('should keep an entry but leave screenshotPath null when the screenshot is absent', () => {
    // given: a meta.json naming a screenshot file that was never written
    // when: the registry is read
    // then: the entry is recorded with screenshotPath null
    const root = makeContractRoot();
    writeExemplar(root, 'form', { screenshotName: '__missing__.png', writeScreenshot: false });

    const { entries, issues } = readExemplars(root);

    expect(issues).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.screenshotPath).toBeNull();
  });
});

describe('Scenario: behavior — route to archetype lookup', () => {
  it('should match only an exact route and never a prefix', () => {
    // given: an exemplar registered for /features
    // when: the child route /features/channels is looked up
    // then: no exemplar is returned, while the exact route resolves
    const entry = entryFor('/features');

    expect(archetypeForRoute([entry], '/features')).toBe(entry);
    expect(archetypeForRoute([entry], '/features/channels')).toBeNull();
    expect(archetypeForRoute([entry], '/features/')).toBeNull();
  });

  it('should return null when no exemplar registers the route', () => {
    // given: an empty registry
    // when: any route is looked up
    // then: the lookup returns null rather than the first entry
    expect(archetypeForRoute([], '/dashboard')).toBeNull();
    expect(archetypeForRoute([entryFor('/features')], '/dashboard')).toBeNull();
  });
});

describe('Scenario: integration — reading the exemplar tree from disk', () => {
  it('should record an issue and no entry when meta.json is not valid JSON', () => {
    // given: an archetype directory whose meta.json is truncated
    // when: the registry is read
    // then: the entry is dropped and the reason is recorded
    const root = makeContractRoot();
    writeExemplar(root, 'list', { metaBody: '{ "route": "/features",' });

    const { entries, issues } = readExemplars(root);

    expect(entries).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.archetype).toBe('list');
    expect(issues[0]?.reason).toContain('meta-invalid-json');
  });

  it('should record an issue and no entry when the source file is missing', () => {
    // given: a meta.json naming a source file that does not exist
    // when: the registry is read
    // then: the archetype is reported unusable instead of entering the registry
    const root = makeContractRoot();
    writeExemplar(root, 'list', { sourceName: 'channels.tsx', writeSource: false });

    const { entries, issues } = readExemplars(root);

    expect(entries).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toContain('source-not-found');
  });

  it('should record an issue when an archetype directory holds no meta.json', () => {
    // given: an archetype directory with a source but no metadata
    // when: the registry is read
    // then: the partial registration is an issue, not a silent omission
    const root = makeContractRoot();
    const dir = writeExemplar(root, 'list');
    rmSync(join(dir, 'meta.json'));

    const { entries, issues } = readExemplars(root);

    expect(entries).toEqual([]);
    expect(issues[0]?.reason).toContain('meta-unreadable');
  });

  it('should return an empty registry when the exemplars directory does not exist', () => {
    // given: a contract root that never registered an exemplar
    // when: the registry is read
    // then: both lists are empty and nothing throws
    const root = makeContractRoot();

    const { entries, issues } = readExemplars(root);

    expect(entries).toEqual([]);
    expect(issues).toEqual([]);
  });
});

describe('Scenario: a11y — the human-readable failure reason', () => {
  it('should name the archetype and the missing file in the issue', () => {
    // given: a meta.json pointing at an absent source file
    // when: the registry is read
    // then: the issue names both the archetype and the file a reader must add
    const root = makeContractRoot();
    writeExemplar(root, 'channels', { sourceName: 'channels.tsx', writeSource: false });

    const { issues } = readExemplars(root);

    expect(issues[0]?.archetype).toBe('channels');
    expect(issues[0]?.reason).toContain('channels.tsx');
  });
});

describe('Scenario: behavior — a meta.json that is valid JSON but not an object', () => {
  it('should record meta-not-an-object for every non-object top level', () => {
    // given: meta.json bodies that are an array, null, a number, a string and a boolean
    // when: each registry is read
    // then: every one is one issue with the exact meta-not-an-object reason
    for (const metaBody of ['[]', 'null', '42', '"text"', 'true']) {
      const root = makeContractRoot();
      writeExemplar(root, 'list', { metaBody });

      const { entries, issues } = readExemplars(root);

      expect(entries).toEqual([]);
      expect(issues).toEqual([{ archetype: 'list', reason: 'meta-not-an-object' }]);
    }
  });
});

describe('Scenario: behavior — metadata fields must be non-empty strings', () => {
  it('should refuse an empty, blank or non-string route', () => {
    // given: three meta.json bodies whose route is unusable
    // when: each registry is read
    // then: each is the exact meta-route-missing issue and no entry is registered
    for (const route of ['', '   ', 5]) {
      const root = makeContractRoot();
      writeExemplar(root, 'list', {
        metaBody: JSON.stringify({ route, sourceFile: 'list.tsx' })
      });

      const { entries, issues } = readExemplars(root);

      expect(entries).toEqual([]);
      expect(issues).toEqual([{ archetype: 'list', reason: 'meta-route-missing' }]);
    }
  });

  it('should trim the route before recording it', () => {
    // given: a route padded with spaces on both sides
    // when: the registry is read
    // then: the entry carries the trimmed route, not the raw field
    const root = makeContractRoot();
    writeExemplar(root, 'list', {
      metaBody: JSON.stringify({ route: '  /trimmed  ', sourceFile: 'list.tsx' })
    });

    const { entries } = readExemplars(root);

    expect(entries[0]?.route).toBe('/trimmed');
  });
});

describe('Scenario: integration — the source field, its alias and the escape boundary', () => {
  it('should accept the source alias when sourceFile is absent', () => {
    // given: a meta.json naming its source only through the `source` alias
    // when: the registry is read
    // then: the aliased file is resolved beside meta.json
    const root = makeContractRoot();
    const dir = writeExemplar(root, 'list', {
      metaBody: JSON.stringify({ route: '/list', source: 'alias.tsx' })
    });
    writeFileSync(join(dir, 'alias.tsx'), 'export const exemplar = null;\n');

    const { entries, issues } = readExemplars(root);

    expect(issues).toEqual([]);
    expect(entries[0]?.sourceFile).toBe(join(dir, 'alias.tsx'));
  });

  it('should record meta-source-missing when neither key names a source', () => {
    // given: a meta.json with a route but no source field at all
    // when: the registry is read
    // then: the entry is refused with the exact meta-source-missing reason
    const root = makeContractRoot();
    writeExemplar(root, 'list', { metaBody: JSON.stringify({ route: '/list' }) });

    const { entries, issues } = readExemplars(root);

    expect(entries).toEqual([]);
    expect(issues).toEqual([{ archetype: 'list', reason: 'meta-source-missing' }]);
  });

  it('should refuse a source that climbs out of the archetype directory', () => {
    // given: meta.json files naming a relative climb and an absolute path
    // when: each registry is read
    // then: neither escapes is resolved and each is the exact escape reason
    const root = makeContractRoot();
    writeExemplar(root, 'relative', {
      metaBody: JSON.stringify({ route: '/r', sourceFile: '../outside.tsx' })
    });
    const absolute = join(root, 'outside.tsx');
    writeExemplar(root, 'absolute', {
      metaBody: JSON.stringify({ route: '/a', sourceFile: absolute })
    });

    const { entries, issues } = readExemplars(root);

    expect(entries).toEqual([]);
    expect(issues).toEqual([
      { archetype: 'absolute', reason: `source-escapes-archetype: ${absolute}` },
      { archetype: 'relative', reason: 'source-escapes-archetype: ../outside.tsx' }
    ]);
  });
});

describe('Scenario: render — the screenshot alias and the directory listing', () => {
  it('should resolve the screenshot alias only when the file exists', () => {
    // given: two exemplars naming their screenshot only through the alias
    // when: one file exists and the other does not
    // then: the first records the resolved path and the second stays null
    const root = makeContractRoot();
    const present = writeExemplar(root, 'present', {
      metaBody: JSON.stringify({ route: '/p', sourceFile: 'present.tsx', screenshot: 'shot.png' })
    });
    writeFileSync(join(present, 'shot.png'), 'png');
    writeExemplar(root, 'absent', {
      metaBody: JSON.stringify({ route: '/a', sourceFile: 'absent.tsx', screenshot: 'gone.png' })
    });

    const { entries } = readExemplars(root);
    const byArchetype = new Map(entries.map((entry) => [entry.archetype, entry]));

    expect(byArchetype.get('present')?.screenshotPath).toBe(join(present, 'shot.png'));
    expect(byArchetype.get('absent')?.screenshotPath).toBeNull();
  });

  it('should list only directories, in sorted archetype order', () => {
    // given: two archetype directories registered out of order plus a stray file
    // when: the registry is read
    // then: the file is ignored and the archetypes come back sorted
    const root = makeContractRoot();
    writeExemplar(root, 'zeta');
    writeExemplar(root, 'alpha');
    writeFileSync(join(root, 'design', 'exemplars', 'stray.txt'), 'not an archetype');

    const { entries, issues } = readExemplars(root);

    expect(issues).toEqual([]);
    expect(entries.map((entry) => entry.archetype)).toEqual(['alpha', 'zeta']);
  });

  it('should sort by code unit, not by the directory listing order', () => {
    // given: archetypes created in the order a then B, where the directory
    //        listing is case-insensitive but the slug sort is code-unit
    // when: the registry is read
    // then: the uppercase name comes first, which only a real sort produces
    const root = makeContractRoot();
    writeExemplar(root, 'a');
    writeExemplar(root, 'B');

    const { entries } = readExemplars(root);

    expect(entries.map((entry) => entry.archetype)).toEqual(['B', 'a']);
  });
});

describe('Scenario: integration — an unreadable meta.json carries the OS error', () => {
  it('should keep the meta-unreadable prefix and the OS error text in the issue', () => {
    // given: an archetype directory whose meta.json was removed
    // when: the registry is read
    // then: the reason is meta-unreadable followed by the OS error, not a generic text
    const root = makeContractRoot();
    const dir = writeExemplar(root, 'list');
    rmSync(join(dir, 'meta.json'));

    const { issues } = readExemplars(root);

    expect(issues[0]?.reason.startsWith('meta-unreadable: ')).toBe(true);
    expect(issues[0]?.reason).toContain('ENOENT');
  });
});

describe('Scenario: render — the module constants initialise inside the test', () => {
  it('should find the exemplar tree and meta file on a fresh import', async () => {
    // given: a registered exemplar and a module imported after a module reset
    // when: the fresh reader walks the tree
    // then: the entry resolves design/exemplars/<archetype>/meta.json under the root
    const root = makeContractRoot();
    const dir = writeExemplar(root, 'list');
    const fresh = await loadExemplars();

    const { entries, issues } = fresh.readExemplars(root);

    expect(issues).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metaPath).toBe(join(dir, 'meta.json'));
    expect(entries[0]?.sourceFile).toBe(join(dir, 'list.tsx'));
  });
});
