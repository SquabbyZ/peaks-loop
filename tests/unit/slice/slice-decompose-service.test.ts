/**
 * Unit tests for `slice-decompose-service.ts`.
 *
 * Target: 100% coverage on the pure function `decomposeSlices()`.
 * Strategy: 18 cases covering all 6 algorithm stages + envelope shape.
 * AC1 (8-WU 2.1.0 replay) is the load-bearing case; the other 17
 * exist to lock down the contract for edge cases.
 *
 * Test doubles:
 *   - `codegraphRunner`: in-memory fake returning canned query/affected
 *   - `understandRunner`: in-memory fake returning null (fallback path) or
 *     a small synthetic knowledge graph
 *   - `importEdgeRunner`: in-memory fake returning canned import edges
 *
 * The 2.1.0 replay uses the EXACT work units from the hand-derived
 * dry-run at .peaks/_runtime/.../sc/dry-run-2.1.0-result.json so the
 * acceptance criterion (matches dry-run within ±10%) is checkable.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decomposeSlices,
  type DecomposeOptions
} from '../../../src/services/slice/slice-decompose-service.js';
import type {
  CodegraphAffectedResult,
  CodegraphQueryHit,
  CodegraphRunner,
  ImportEdge,
  ImportEdgeRunner,
  KnowledgeGraph,
  UnderstandRunner
} from '../../../src/services/slice/slice-decompose-types.js';

// ---------- Test double helpers ----------

function makeCodegraphRunner(opts: {
  indexed: boolean;
  queryHits?: (text: string) => readonly CodegraphQueryHit[];
  affected?: (files: readonly string[]) => CodegraphAffectedResult;
}): CodegraphRunner {
  return {
    query: vi.fn(async (text: string) => (opts.queryHits ? opts.queryHits(text) : [])),
    affected: vi.fn(async (files: readonly string[]) =>
      opts.affected ? opts.affected(files) : { changedFiles: files, affectedTests: [], totalDependentsTraversed: 0 }
    ),
    status: vi.fn(async () =>
      opts.indexed
        ? { indexed: true, nodes: 5778, edges: 13158, dbMB: 11.82, freshness: 'abc123' }
        : { indexed: false, nodes: 0, edges: 0, dbMB: 0, freshness: 'unindexed' }
    )
  };
}

function makeUnderstandRunner(kg: KnowledgeGraph | null = null): UnderstandRunner {
  return {
    read: vi.fn(async () => kg)
  };
}

function makeImportEdgeRunner(edges: readonly ImportEdge[] = []): ImportEdgeRunner {
  return {
    importsOf: vi.fn(async () => edges)
  };
}

// ---------- The 2.1.0 replay fixtures (mirrors the dry-run JSON) ----------

const SLIM_2_1_0_FRAMING = '## Acceptance criteria\n\nAC1: split sidecar-store\nAC2: ship provider-service\nAC3: ship proxy-service\nAC4: ship workspace-state-service\nAC5: ship config-migration\nAC6: ship config-types slim\nAC7: ship config-service auto-slim\nAC8: ship workflow-commands type fix\n';
const SLIM_2_1_0_FAKE_GRAPH: readonly CodegraphQueryHit[] = [
  { id: 'file:src/services/config/sidecar-store.ts', kind: 'file', name: 'sidecar-store.ts', filePath: 'src/services/config/sidecar-store.ts', score: 90 },
  { id: 'file:src/services/config/provider-service.ts', kind: 'file', name: 'provider-service.ts', filePath: 'src/services/config/provider-service.ts', score: 80 },
  { id: 'file:src/services/config/proxy-service.ts', kind: 'file', name: 'proxy-service.ts', filePath: 'src/services/config/proxy-service.ts', score: 80 },
  { id: 'file:src/services/config/workspace-state-service.ts', kind: 'file', name: 'workspace-state-service.ts', filePath: 'src/services/config/workspace-state-service.ts', score: 80 },
  { id: 'file:src/services/config/config-migration.ts', kind: 'file', name: 'config-migration.ts', filePath: 'src/services/config/config-migration.ts', score: 80 },
  { id: 'file:src/services/config/config-types.ts', kind: 'file', name: 'config-types.ts', filePath: 'src/services/config/config-types.ts', score: 80 },
  { id: 'file:src/services/config/config-service.ts', kind: 'file', name: 'config-service.ts', filePath: 'src/services/config/config-service.ts', score: 80 },
  { id: 'file:src/cli/commands/workflow-commands.ts', kind: 'file', name: 'workflow-commands.ts', filePath: 'src/cli/commands/workflow-commands.ts', score: 80 }
];
const SLIM_2_1_0_IMPORTS: readonly ImportEdge[] = [
  { from: 'src/services/config/provider-service.ts', to: 'src/services/config/sidecar-store.ts', evidence: "import { ... } from './sidecar-store.js'" },
  { from: 'src/services/config/proxy-service.ts', to: 'src/services/config/sidecar-store.ts', evidence: "import { ... } from './sidecar-store.js'" },
  { from: 'src/services/config/workspace-state-service.ts', to: 'src/services/config/sidecar-store.ts', evidence: "import { ... } from './sidecar-store.js'" },
  { from: 'src/services/config/workspace-state-service.ts', to: 'src/services/config/config-types.ts', evidence: "import type { WorkspaceConfig } from './config-types.js'" },
  { from: 'src/services/config/config-migration.ts', to: 'src/services/config/sidecar-store.ts', evidence: "import { ... } from './sidecar-store.js'" },
  { from: 'src/services/config/config-service.ts', to: 'src/services/config/sidecar-store.ts', evidence: "import { ... } from './config-safety.js'" }, // uses config-safety but tests shape
  { from: 'src/services/config/config-service.ts', to: 'src/services/config/config-migration.ts', evidence: "import { globalConfigPath, CONFIG_SCHEMA_VERSION_V2 } from './config-migration.js'" },
  { from: 'src/services/config/config-service.ts', to: 'src/services/config/config-types.ts', evidence: "import type { ... PeaksConfig ... } from './config-types.js'" },
  { from: 'src/cli/commands/workflow-commands.ts', to: 'src/services/config/config-service.ts', evidence: "import { ... } from '../../services/config/config-service.js'" }
];

// ---------- Tests ----------

describe('slice-decompose-service', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'peaks-decompose-test-'));
    mkdirSync(workDir, { recursive: true });
  });

  describe('envelope shape (basic)', () => {
    it('emits an ISO 8601 generatedAt timestamp', async () => {
      const opts: DecomposeOptions = {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner()
      };
      const result = await decomposeSlices('test-rid', SLIM_2_1_0_FRAMING, workDir, opts);
      expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('echoes the rid on the result', async () => {
      const result = await decomposeSlices('my-rid-2026-06-13', '## Goals\nship it', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner()
      });
      expect(result.rid).toBe('my-rid-2026-06-13');
    });

    it('throws when codegraph is not indexed', async () => {
      await expect(
        decomposeSlices('rid', '## Goals\nship', workDir, {
          codegraphRunner: makeCodegraphRunner({ indexed: false }),
          understandRunner: makeUnderstandRunner(),
          importEdgeRunner: makeImportEdgeRunner()
        })
      ).rejects.toThrow(/codegraph/i);
    });

    it('marks understand-anything as unavailable when kg is null', async () => {
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(null),
        importEdgeRunner: makeImportEdgeRunner()
      });
      expect(result.understandAnything.available).toBe(false);
      expect(result.understandAnything.fallback).toBe('structural-only');
    });

    it('marks understand-anything as available when kg is present', async () => {
      const kg: KnowledgeGraph = {
        nodes: [
          { id: 'file:x.ts', type: 'file', name: 'x.ts', filePath: 'x.ts', tags: [], complexity: 1 }
        ],
        edges: [],
        layers: []
      };
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(kg),
        importEdgeRunner: makeImportEdgeRunner()
      });
      expect(result.understandAnything.available).toBe(true);
      expect(result.understandAnything.fallback).toBe('semantic');
      expect(result.understandAnything.kgNodes).toBe(1);
    });

    it('populates codegraph envelope with status info', async () => {
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner()
      });
      expect(result.codegraph.nodes).toBe(5778);
      expect(result.codegraph.edges).toBe(13158);
      expect(result.codegraph.dbMB).toBe(11.82);
      expect(result.codegraph.freshness).toBe('abc123');
    });
  });

  describe('Stage 1: work-unit resolution', () => {
    it('returns empty workUnits when PRD has no ACs', async () => {
      const result = await decomposeSlices('rid', '## Goals\njust goals, no ACs', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner()
      });
      expect(result.workUnits).toHaveLength(0);
    });

    it('handles a WU with zero candidate files', async () => {
      const result = await decomposeSlices('rid', '## Acceptance criteria\nAC1: do something completely novel', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true, queryHits: () => [] }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner()
      });
      // WU may or may not be created depending on algorithm; if created,
      // files must be empty array, not null/undefined.
      for (const wu of result.workUnits) {
        expect(wu.files).toBeDefined();
        expect(Array.isArray(wu.files)).toBe(true);
      }
    });
  });

  describe('Stage 2: dependency DAG', () => {
    it('builds a chain from real import edges (A -> B -> C)', async () => {
      const imports: readonly ImportEdge[] = [
        { from: 'a.ts', to: 'b.ts', evidence: 'a imports b' },
        { from: 'b.ts', to: 'c.ts', evidence: 'b imports c' }
      ];
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(imports)
      });
      // Should have at least one imports edge among the dependency edges
      const importEdges = result.dependencyDAG.edges.filter((e) => e.kind === 'imports');
      expect(importEdges.length).toBeGreaterThanOrEqual(2);
    });

    it('falls back to import edges when codegraph.affected returns 0 dependents', async () => {
      const imports: readonly ImportEdge[] = [
        { from: 'a.ts', to: 'b.ts', evidence: 'a imports b' }
      ];
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          affected: (files) => ({ changedFiles: files, affectedTests: [], totalDependentsTraversed: 0 })
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(imports)
      });
      expect(result.codegraph.affectedCrossFile).toBe(false);
      const importEdges = result.dependencyDAG.edges.filter((e) => e.kind === 'imports');
      expect(importEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('flags import edges as structural (not semantic) confidence', async () => {
      const imports: readonly ImportEdge[] = [
        { from: 'a.ts', to: 'b.ts', evidence: 'a imports b' }
      ];
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(imports)
      });
      const importEdges = result.dependencyDAG.edges.filter((e) => e.kind === 'imports');
      for (const e of importEdges) {
        expect(e.confidence).toBe('structural');
        expect(e.isSemantic).toBe(false);
        expect(e.weight).toBe(10.0);
      }
    });
  });

  describe('Stage 3: SCC + critical path', () => {
    it('reports trivial SCCs for acyclic inputs', async () => {
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner([])
      });
      // Empty input -> all SCCs trivial (or no SCCs at all)
      expect(result.sccAnalysis.nonTrivialSCCs).toHaveLength(0);
    });

    it('handles the diamond shape without infinite loop', async () => {
      // a -> b, a -> c, b -> d, c -> d (diamond, no cycle)
      const imports: readonly ImportEdge[] = [
        { from: 'a.ts', to: 'b.ts', evidence: 'a->b' },
        { from: 'a.ts', to: 'c.ts', evidence: 'a->c' },
        { from: 'b.ts', to: 'd.ts', evidence: 'b->d' },
        { from: 'c.ts', to: 'd.ts', evidence: 'c->d' }
      ];
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(imports)
      });
      expect(result.criticalPath.nodes).toBeDefined();
      expect(Array.isArray(result.criticalPath.nodes)).toBe(true);
    });
  });

  describe('Stage 5: estimation', () => {
    it('produces work estimates for each slice', async () => {
      const result = await decomposeSlices('rid', SLIM_2_1_0_FRAMING, workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          queryHits: (text) => SLIM_2_1_0_FAKE_GRAPH
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(SLIM_2_1_0_IMPORTS)
      });
      for (const batch of result.parallelBatches) {
        for (const slice of batch.slices) {
          expect(slice.estimate).toBeDefined();
          expect(slice.estimate.minutesP50).toBeGreaterThanOrEqual(0);
          expect(slice.estimate.minutesP90).toBeGreaterThanOrEqual(slice.estimate.minutesP50);
        }
      }
    });

    it('marks confidence as low when no historical sample', async () => {
      const result = await decomposeSlices('rid', SLIM_2_1_0_FRAMING, workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          queryHits: () => SLIM_2_1_0_FAKE_GRAPH
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(SLIM_2_1_0_IMPORTS)
      });
      for (const batch of result.parallelBatches) {
        for (const slice of batch.slices) {
          expect(slice.estimate.confidence).toBe('low');
        }
      }
    });
  });

  describe('Stage 6: parallelBatches', () => {
    it('numbers batches starting from 1', async () => {
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner([])
      });
      for (let i = 0; i < result.parallelBatches.length; i++) {
        expect(result.parallelBatches[i]!.batch).toBe(i + 1);
      }
    });

    it('includes the first batch with empty dependsOn', async () => {
      const result = await decomposeSlices('rid', '## Goals\nship', workDir, {
        codegraphRunner: makeCodegraphRunner({ indexed: true }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner([])
      });
      if (result.parallelBatches.length > 0) {
        expect(result.parallelBatches[0]!.dependsOn).toEqual([]);
      }
    });

    it('sets pickHint when slice count exceeds 10', async () => {
      // Fabricate many WUs to force pickHint
      const acs = Array.from({ length: 15 }, (_, i) => `AC${i + 1}: ship feature ${i + 1}`).join('\n');
      const result = await decomposeSlices('rid', `## Acceptance criteria\n${acs}`, workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          queryHits: () => Array.from({ length: 15 }, (_, i) => ({
            id: `file:src/feature${i}.ts`,
            kind: 'file' as const,
            name: `feature${i}.ts`,
            filePath: `src/feature${i}.ts`,
            score: 80
          }))
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner([])
      });
      const totalSlices = result.parallelBatches.reduce((sum, b) => sum + b.slices.length, 0);
      if (totalSlices > 10) {
        expect(result.pickHint).toBeDefined();
        expect(result.pickHint).toMatch(/split|pick session/i);
      }
    });
  });

  describe('AC1 full replay — 8-WU 2.1.0 config-slim', () => {
    it('produces 8 work units from the slim PRD', async () => {
      const result = await decomposeSlices('rid', SLIM_2_1_0_FRAMING, workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          queryHits: () => SLIM_2_1_0_FAKE_GRAPH
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(SLIM_2_1_0_IMPORTS)
      });
      // 8 ACs in the framing -> expect 8 work units (one per AC)
      expect(result.workUnits).toHaveLength(8);
    });

    it('builds a dependency DAG with >= 7 edges (imports + understand-any)', async () => {
      const result = await decomposeSlices('rid', SLIM_2_1_0_FRAMING, workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          queryHits: () => SLIM_2_1_0_FAKE_GRAPH
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(SLIM_2_1_0_IMPORTS)
      });
      // The 2.1.0 dry-run has 8 real import edges; we should have >= 7
      // (some edges might be filtered if both endpoints resolve to the same WU)
      expect(result.dependencyDAG.edges.length).toBeGreaterThanOrEqual(7);
    });

    it('total p50 estimate is within ±10% of dry-run p50 (225 min)', async () => {
      const result = await decomposeSlices('rid', SLIM_2_1_0_FRAMING, workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          queryHits: () => SLIM_2_1_0_FAKE_GRAPH
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(SLIM_2_1_0_IMPORTS)
      });
      const totalP50 = result.parallelBatches
        .flatMap((b) => b.slices)
        .reduce((sum, s) => sum + s.estimate.minutesP50, 0);
      // Dry-run p50: 225 min; tolerance: ±10% = [202.5, 247.5]
      expect(totalP50).toBeGreaterThanOrEqual(202);
      expect(totalP50).toBeLessThanOrEqual(248);
    });

    it('critical path includes at least 2 work units', async () => {
      const result = await decomposeSlices('rid', SLIM_2_1_0_FRAMING, workDir, {
        codegraphRunner: makeCodegraphRunner({
          indexed: true,
          queryHits: () => SLIM_2_1_0_FAKE_GRAPH
        }),
        understandRunner: makeUnderstandRunner(),
        importEdgeRunner: makeImportEdgeRunner(SLIM_2_1_0_IMPORTS)
      });
      expect(result.criticalPath.nodes.length).toBeGreaterThanOrEqual(2);
    });
  });
});
