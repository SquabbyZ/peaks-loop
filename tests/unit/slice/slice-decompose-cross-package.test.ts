/**
 * Cross-package coupling in the slice dependency graph.
 *
 * The fixture holds five coupled package pairs plus a PRD. A pair is serialized
 * only when the dependency graph carries an edge between the two work units;
 * without one, every unit lands in the same parallel batch.
 *
 * The last pair is a documented residual: both sides read one shared JSON
 * schema at runtime and neither imports the other, so no source-level edge is
 * inferable. That pair is asserted to stay uncoupled rather than hidden.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildDependencyEdges } from '../../../src/services/slice/slice-decompose-import-edges.js';
import { defaultImportEdgeRunner } from '../../../src/services/slice/slice-decompose-runners.js';
import { decomposeSlices } from '../../../src/services/slice/slice-decompose-service.js';
import type {
  CodegraphRunner,
  DecompositionResult,
  DependencyEdge,
  WorkUnit
} from '../../../src/services/slice/slice-decompose-types.js';

const FIXTURE_ROOT = fileURLToPath(
  new URL('../../fixtures/slice/cross-package-coupling/', import.meta.url)
);

const PLAIN_A = 'packages/pkg-plain-a/src/plain-a.ts';
const PLAIN_B = 'packages/pkg-plain-b/src/plain-b.ts';
const DYN_A = 'packages/pkg-dyn-a/src/dyn-a.ts';
const DYN_B = 'packages/pkg-dyn-b/src/dyn-b.ts';
const REEXPORT_A = 'packages/pkg-reexport-a/src/reexport-a.ts';
const REEXPORT_B = 'packages/pkg-reexport-b/src/reexport-b.ts';
const WORKSPACE_A = 'packages/pkg-workspace-a/src/workspace-a.ts';
const WORKSPACE_B = 'packages/pkg-workspace-b/src/workspace-b.ts';
const CONTRACT_A = 'packages/pkg-contract-a/src/contract-a.ts';
const CONTRACT_B = 'packages/pkg-contract-b/src/contract-b.ts';

const COUPLED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [PLAIN_A, PLAIN_B],
  [DYN_A, DYN_B],
  [REEXPORT_A, REEXPORT_B],
  [WORKSPACE_A, WORKSPACE_B]
];

function fixtureFiles(): string[] {
  return readdirSync(join(FIXTURE_ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const srcDir = join(FIXTURE_ROOT, 'packages', entry.name, 'src');
      return readdirSync(srcDir)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => `packages/${entry.name}/src/${name}`);
    })
    .sort();
}

function fixtureCodegraph(): CodegraphRunner {
  const hits = fixtureFiles().map((filePath) => ({
    id: `file:${filePath}`,
    kind: 'file',
    name: basename(filePath),
    filePath,
    score: 1
  }));
  return {
    async query() {
      return hits;
    },
    async affected(files) {
      return { changedFiles: files, affectedTests: [], totalDependentsTraversed: 0 };
    },
    async status() {
      return { indexed: true, nodes: hits.length, edges: 0, dbMB: 0, freshness: 'indexed' };
    }
  };
}

function workUnitId(result: DecompositionResult, file: string): string {
  const wu = result.workUnits.find((candidate) => candidate.filePath === file);
  if (wu === undefined) throw new Error(`fixture file resolved to no work unit: ${file}`);
  return wu.id;
}

function edgeBetween(
  result: DecompositionResult,
  fromFile: string,
  toFile: string
): DependencyEdge | undefined {
  const from = workUnitId(result, fromFile);
  const to = workUnitId(result, toFile);
  return result.dependencyDAG.edges.find((edge) => edge.from === from && edge.to === to);
}

function batchOf(result: DecompositionResult, file: string): number {
  const batch = result.parallelBatches.find((candidate) =>
    candidate.slices.some((slice) => slice.files.includes(file))
  );
  if (batch === undefined) throw new Error(`work unit is in no batch: ${file}`);
  return batch.batch;
}

function makeWorkUnit(id: string, filePath: string): WorkUnit {
  return {
    id,
    label: basename(filePath),
    files: [filePath],
    loc: 1,
    testsAdded: 0,
    filePath,
    candidates: [`file:${filePath}`]
  };
}

let result: DecompositionResult;

beforeAll(async () => {
  const prd = readFileSync(join(FIXTURE_ROOT, 'prd', 'decompose-prd.md'), 'utf8');
  result = await decomposeSlices('cross-package-coupling', prd, FIXTURE_ROOT, {
    codegraphRunner: fixtureCodegraph()
  });
});

describe('cross-package coupling in the dependency graph', () => {
  it('when the fixture is decomposed, should turn the three bare-specifier forms into import edges', () => {
    // given: one static-import, one re-export and one dynamic-import package pair
    // when: the slice decomposition builds the dependency graph
    // then: each pair carries an import edge
    expect(result.dependencyDAG.edges).toHaveLength(COUPLED_PAIRS.length);
    for (const [from, to] of COUPLED_PAIRS.slice(0, 3)) {
      expect(edgeBetween(result, from, to)?.kind, `${from} -> ${to}`).toBe('imports');
    }
  });

  it('when only package.json declares the coupling, should add a package-dependency edge', () => {
    // given: a workspace pair whose only coupling is a declared dependency
    // when: the dependency graph is built
    // then: the pair carries a package-dependency edge
    const edge = edgeBetween(result, WORKSPACE_A, WORKSPACE_B);
    expect(edge?.kind).toBe('package-dependency');
    expect(edge?.evidence).toContain('package.json');
  });

  it('when packages are coupled, should keep each pair out of one parallel batch', () => {
    // given: the fixture's four coupled pairs
    // when: the work units are partitioned into parallel batches
    // then: the two members of every pair land in different batches
    for (const [from, to] of COUPLED_PAIRS) {
      expect(batchOf(result, from), `${from} vs ${to}`).not.toBe(batchOf(result, to));
    }
  });

  it('when the coupling is a shared runtime contract, should leave it as an uncovered residual', () => {
    // given: two packages that read one shared JSON schema and import nothing from each other
    // when: the decomposition runs with the manifest fallback in place
    // then: neither direction carries an edge, and both stay in one batch
    expect(edgeBetween(result, CONTRACT_A, CONTRACT_B)).toBeUndefined();
    expect(edgeBetween(result, CONTRACT_B, CONTRACT_A)).toBeUndefined();
    expect(batchOf(result, CONTRACT_A)).toBe(batchOf(result, CONTRACT_B));
  });
});

describe('workspace package resolution', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('when a workspace entry is ambiguous, should record a reason and invent no edge', async () => {
    // given: a workspace package with two source files and no declared entry
    // when: its importer is scanned
    // then: no edge is emitted and the diagnostic names the package
    const root = mkdtempSync(join(tmpdir(), 'peaks-slice-ws-'));
    roots.push(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'temp-root', private: true, workspaces: ['packages/*'] })
    );
    mkdirSync(join(root, 'packages', 'dep', 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'app', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'dep', 'package.json'),
      JSON.stringify({ name: '@temp/dep', version: '0.0.0' })
    );
    writeFileSync(join(root, 'packages', 'dep', 'src', 'one.ts'), 'export const one = 1;\n');
    writeFileSync(join(root, 'packages', 'dep', 'src', 'two.ts'), 'export const two = 2;\n');
    writeFileSync(
      join(root, 'packages', 'app', 'package.json'),
      JSON.stringify({ name: '@temp/app', version: '0.0.0' })
    );
    writeFileSync(
      join(root, 'packages', 'app', 'src', 'app.ts'),
      "import { one } from '@temp/dep';\n"
    );

    const runner = defaultImportEdgeRunner();
    const edges = await runner.importsOf(root, ['packages/app/src/app.ts']);

    expect(edges).toEqual([]);
    expect((runner.unresolvedImports?.() ?? []).join('\n')).toContain('@temp/dep');
  });

  it('when the project is a single package, should keep its relative import edge', async () => {
    // given: a project with no workspace manifests
    // when: a relative import is scanned
    // then: the edge and its work-unit dependency survive unchanged
    const root = mkdtempSync(join(tmpdir(), 'peaks-slice-solo-'));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'solo', private: true }));
    writeFileSync(join(root, 'src', 'a.ts'), "import { b } from './b.js';\n");
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1;\n');

    const fileA = join('src', 'a.ts');
    const fileB = join('src', 'b.ts');
    const edges = await defaultImportEdgeRunner().importsOf(root, [fileA]);
    const dag = buildDependencyEdges(
      [makeWorkUnit('W1', fileA), makeWorkUnit('W2', fileB)],
      edges,
      root
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]?.to).toBe(fileB);
    expect(dag).toHaveLength(1);
    expect(dag[0]?.kind).toBe('imports');
  });
});
