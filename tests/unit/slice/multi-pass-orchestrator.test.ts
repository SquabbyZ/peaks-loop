/**
 * Unit tests for MultiPassOrchestrator (peaks-solo/multipass W2 T9).
 *
 * Behavior under test (10 cases from the spec):
 *   1. granularity: 'service'  → single Pass 1 only.
 *   2. granularity: 'file'     → single Pass 2 only (file-only mode).
 *   3. granularity: 'both'     → Pass 1 + Pass 2 in parallel.
 *   4. granularity: 'auto'     → uses shouldSubdivide per parent.
 *   5. shouldSubdivide returns 'tie-break' → Pass 2 still runs.
 *   6. Cross-pass edges fire when opts.llmRunner is provided.
 *   7. No opts.llmRunner + 'auto' granularity → empty crossPassEdges, no crash.
 *   8. resetArbitratorBudget called at the top of each invocation.
 *   9. Output shape conforms to DecompositionResultV2.
 *  (10. Surgical: skipped — relies on next CC's review of git diff.)
 *
 * Mocking strategy:
 *   - decomposeSlices is fully mocked per test to control return values.
 *   - cross-pass-edge-merger is mocked (default returns empty MergeResult)
 *     so tests don't depend on file system scans.
 *   - llm-arbitrator is partially mocked: resetArbitratorBudget is wrapped
 *     in vi.fn so the orchestrator's call is observable, but the real
 *     arbitrate() is still accessible for any downstream callers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/slice/slice-decompose-service.js', () => ({
  decomposeSlices: vi.fn()
}));

vi.mock('../../../src/services/slice/cross-pass-edge-merger.js', () => ({
  merge: vi.fn().mockResolvedValue({ edges: [], llmCalls: [] })
}));

vi.mock('../../../src/services/slice/llm-arbitrator.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/slice/llm-arbitrator.js')
  >('../../../src/services/slice/llm-arbitrator.js');
  return {
    ...actual,
    resetArbitratorBudget: vi.fn(actual.resetArbitratorBudget)
  };
});

import { decomposeSlices } from '../../../src/services/slice/slice-decompose-service.js';
import { merge } from '../../../src/services/slice/cross-pass-edge-merger.js';
import { resetArbitratorBudget } from '../../../src/services/slice/llm-arbitrator.js';
import { decompose } from '../../../src/services/slice/multi-pass-orchestrator.js';
import type { LlmRunner } from '../../../src/services/audit/audit-goal-service.js';
import type {
  DecompositionResult,
  WorkUnit
} from '../../../src/services/slice/slice-decompose-types.js';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeWu(
  overrides: Partial<WorkUnit> & { id: string; files: readonly string[] }
): WorkUnit {
  const { id, files, label, loc, filePath, ...rest } = overrides;
  return {
    id,
    label: label ?? id,
    files,
    loc: loc ?? 100,
    testsAdded: 0,
    filePath: filePath ?? files[0] ?? 'src/mock.ts',
    candidates: [],
    ...rest
  };
}

function makeDecompositionResult(
  workUnits: readonly WorkUnit[]
): DecompositionResult {
  return {
    rid: 'mock-rid',
    generatedAt: '2026-06-25T00:00:00.000Z',
    codegraph: {
      nodes: 100,
      edges: 50,
      dbMB: 1.0,
      freshness: 'indexed',
      affectedCrossFile: false,
      note: 'mock'
    },
    understandAnything: {
      kgNodes: 0,
      kgEdges: 0,
      available: false,
      fallback: 'structural-only',
      note: 'mock'
    },
    workUnits,
    dependencyDAG: { edges: [] },
    sccAnalysis: {
      sccCount: workUnits.length,
      trivialSCCs: workUnits.map((w) => w.id),
      nonTrivialSCCs: [],
      condensationEdges: 0
    },
    criticalPath: {
      nodes: workUnits.map((w) => w.id),
      edges: [],
      totalLoc: 0,
      totalDeltaLoc: 0,
      rationale: 'mock'
    },
    minCutResult: { algorithm: 'mock', cutEdges: [], partitions: [] },
    parallelBatches: []
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MultiPassOrchestrator.decompose', () => {
  beforeEach(() => {
    vi.mocked(decomposeSlices).mockReset();
    vi.mocked(merge).mockReset();
    vi.mocked(merge).mockResolvedValue({ edges: [], llmCalls: [] });
    vi.mocked(resetArbitratorBudget).mockClear();
  });

  // -------------------------------------------------------------------------
  // 1. granularity: 'service' → single Pass 1 only
  // -------------------------------------------------------------------------
  it("granularity='service' runs only Pass 1 with the workUnits returned by decomposeSlices", async () => {
    vi.mocked(decomposeSlices).mockResolvedValue(
      makeDecompositionResult([
        makeWu({ id: 'S1', files: ['src/svc1.ts'] }),
        makeWu({ id: 'S2', files: ['src/svc2.ts'] })
      ])
    );

    const result = await decompose('rid-1', '# prd', '/tmp', {
      granularity: 'service'
    });

    expect(vi.mocked(decomposeSlices)).toHaveBeenCalledTimes(1);
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0]!.passNumber).toBe(1);
    expect(result.passes[0]!.granularity).toBe('service');
    expect(result.passes[0]!.slices).toHaveLength(2);
    expect(result.passes[0]!.slices.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(result.passes[0]!.slices.every((s) => s.parentSliceId === null)).toBe(
      true
    );
    expect(result.crossPassEdges).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. granularity: 'file' → single Pass 2 only (file-only mode)
  // -------------------------------------------------------------------------
  it("granularity='file' runs only Pass 2 (Pass 1 is not invoked)", async () => {
    vi.mocked(decomposeSlices).mockResolvedValue(
      makeDecompositionResult([
        makeWu({ id: 'F1', files: ['src/file1.ts'] })
      ])
    );

    const result = await decompose('rid-2', '# prd', '/tmp', {
      granularity: 'file'
    });

    expect(vi.mocked(decomposeSlices)).toHaveBeenCalledTimes(1);
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0]!.passNumber).toBe(2);
    expect(result.passes[0]!.granularity).toBe('file');
    expect(result.passes[0]!.slices).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 3. granularity: 'both' → Pass 1 + Pass 2 in parallel
  // -------------------------------------------------------------------------
  it("granularity='both' runs Pass 1 + N Pass 2 results (one per parent)", async () => {
    vi.mocked(decomposeSlices)
      .mockResolvedValueOnce(
        makeDecompositionResult([
          // Both parents exceed default thresholds (loc > 400 OR files > 3).
          makeWu({
            id: 'S1',
            files: ['src/a1.ts', 'src/a2.ts', 'src/a3.ts', 'src/a4.ts'],
            loc: 500
          }),
          makeWu({
            id: 'S2',
            files: ['src/b1.ts', 'src/b2.ts', 'src/b3.ts', 'src/b4.ts'],
            loc: 500
          })
        ])
      )
      .mockResolvedValue(
        makeDecompositionResult([
          makeWu({ id: 'W1', files: ['src/a1.ts'] })
        ])
      );

    const result = await decompose('rid-3', '# prd', '/tmp', {
      granularity: 'both'
    });

    // 1 Pass 1 + 2 Pass 2 (one per qualifying parent) = 3 calls.
    expect(vi.mocked(decomposeSlices)).toHaveBeenCalledTimes(3);
    expect(result.passes).toHaveLength(3);
    expect(result.passes[0]!.passNumber).toBe(1);
    expect(result.passes[0]!.granularity).toBe('service');
    expect(result.passes[0]!.slices.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(result.passes[1]!.passNumber).toBe(2);
    expect(result.passes[1]!.granularity).toBe('file');
    expect(result.passes[2]!.passNumber).toBe(2);
    expect(result.passes[2]!.granularity).toBe('file');
    // No llmRunner → merge is NOT called.
    expect(vi.mocked(merge)).not.toHaveBeenCalled();
    expect(result.crossPassEdges).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 4. granularity: 'auto' → uses shouldSubdivide per parent
  // -------------------------------------------------------------------------
  it("granularity='auto' only subdivides parents where shouldSubdivide !== false", async () => {
    vi.mocked(decomposeSlices)
      .mockResolvedValueOnce(
        makeDecompositionResult([
          // small parent → shouldSubdivide returns { subdivide: false }
          makeWu({ id: 'S1', files: ['src/small.ts'], loc: 100 }),
          // large parent → shouldSubdivide returns { subdivide: true }
          makeWu({
            id: 'S2',
            files: ['src/big1.ts', 'src/big2.ts', 'src/big3.ts', 'src/big4.ts'],
            loc: 500
          })
        ])
      )
      .mockResolvedValue(
        makeDecompositionResult([
          makeWu({ id: 'W1', files: ['src/big1.ts'] })
        ])
      );

    const result = await decompose('rid-4', '# prd', '/tmp', {
      granularity: 'auto'
    });

    // 1 Pass 1 + 1 Pass 2 (only the large parent subdivides) = 2 calls.
    expect(vi.mocked(decomposeSlices)).toHaveBeenCalledTimes(2);
    expect(result.passes).toHaveLength(2);
    expect(result.passes[0]!.slices.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(result.passes[1]!.slices.map((s) => s.id)).toEqual(['S2.1']);
    expect(result.passes[1]!.slices[0]!.parentSliceId).toBe('S2');
  });

  // -------------------------------------------------------------------------
  // 5. shouldSubdivide returns 'tie-break' → Pass 2 still runs
  // -------------------------------------------------------------------------
  it("granularity='auto' with a 'tie-break' parent still triggers Pass 2 (subdivide !== false)", async () => {
    // loc=350, files=1 → 350 > 320 (80% of 400) but not > 400 → tie-break.
    vi.mocked(decomposeSlices)
      .mockResolvedValueOnce(
        makeDecompositionResult([
          makeWu({ id: 'S1', files: ['src/edge.ts'], loc: 350 })
        ])
      )
      .mockResolvedValue(
        makeDecompositionResult([
          makeWu({ id: 'W1', files: ['src/edge.ts'] })
        ])
      );

    const result = await decompose('rid-5', '# prd', '/tmp', {
      granularity: 'auto'
    });

    // tie-break qualifies (subdivide !== false), so Pass 2 fires.
    expect(vi.mocked(decomposeSlices)).toHaveBeenCalledTimes(2);
    expect(result.passes).toHaveLength(2);
    expect(result.passes[1]!.slices[0]!.parentSliceId).toBe('S1');
  });

  // -------------------------------------------------------------------------
  // 6. Cross-pass edges fire when opts.llmRunner provided
  // -------------------------------------------------------------------------
  it('populates crossPassEdges and llmArbitrations when opts.llmRunner is provided', async () => {
    vi.mocked(decomposeSlices)
      .mockResolvedValueOnce(
        makeDecompositionResult([
          makeWu({
            id: 'S1',
            files: ['src/a1.ts', 'src/a2.ts', 'src/a3.ts', 'src/a4.ts'],
            loc: 500
          }),
          makeWu({
            id: 'S2',
            files: ['src/b1.ts', 'src/b2.ts', 'src/b3.ts', 'src/b4.ts'],
            loc: 500
          })
        ])
      )
      .mockResolvedValue(
        makeDecompositionResult([
          makeWu({ id: 'W1', files: ['src/a1.ts'] })
        ])
      );

    vi.mocked(merge).mockResolvedValue({
      edges: [
        {
          fromPass: 1,
          toPass: 2,
          fromSliceId: 'S1',
          toSliceId: 'S1.1',
          kind: 'llm-arbitrated',
          confidence: 'llm',
          evidence: 'mocked',
          arbitratedBy: 'live:abc'
        }
      ],
      llmCalls: [{ callId: 'live:abc', tokens: { input: 1, output: 1 } }]
    });

    const llmRunner: LlmRunner = { call: vi.fn() };
    const result = await decompose('rid-6', '# prd', '/tmp', {
      granularity: 'both',
      llmRunner
    });

    // merge invoked exactly once with (passes, { projectRoot, llmRunner }).
    expect(vi.mocked(merge)).toHaveBeenCalledTimes(1);
    const mergeCall = vi.mocked(merge).mock.calls[0]!;
    expect(mergeCall[0]).toHaveLength(3); // 1 Pass 1 + 2 Pass 2
    expect(mergeCall[1]).toMatchObject({
      projectRoot: '/tmp',
      llmRunner
    });

    // Edge and arbitration are propagated from the merge result.
    expect(result.crossPassEdges).toHaveLength(1);
    expect(result.crossPassEdges[0]!.kind).toBe('llm-arbitrated');
    expect(result.crossPassEdges[0]!.arbitratedBy).toBe('live:abc');
    expect(result.llmArbitrations).toHaveLength(1);
    expect(result.llmArbitrations[0]!.callId).toBe('live:abc');
    expect(result.llmArbitrations[0]!.tokens).toEqual({ input: 1, output: 1 });
  });

  // -------------------------------------------------------------------------
  // 7. No opts.llmRunner + 'auto' granularity → empty crossPassEdges, no crash
  // -------------------------------------------------------------------------
  it("no llmRunner + auto granularity yields empty crossPassEdges and llmArbitrations without crashing", async () => {
    vi.mocked(decomposeSlices)
      .mockResolvedValueOnce(
        makeDecompositionResult([
          makeWu({
            id: 'S1',
            files: ['src/big1.ts', 'src/big2.ts', 'src/big3.ts', 'src/big4.ts'],
            loc: 500
          })
        ])
      )
      .mockResolvedValue(
        makeDecompositionResult([
          makeWu({ id: 'W1', files: ['src/big1.ts'] })
        ])
      );

    const result = await decompose('rid-7', '# prd', '/tmp', {
      granularity: 'auto'
    });

    expect(vi.mocked(merge)).not.toHaveBeenCalled();
    expect(result.crossPassEdges).toEqual([]);
    expect(result.llmArbitrations).toEqual([]);
    expect(result.partial).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. resetArbitratorBudget called at the top of each invocation
  // -------------------------------------------------------------------------
  it('calls resetArbitratorBudget at the start of every invocation', async () => {
    vi.mocked(decomposeSlices).mockResolvedValue(makeDecompositionResult([]));

    await decompose('rid-8a', '# prd', '/tmp', { granularity: 'service' });
    await decompose('rid-8b', '# prd', '/tmp', { granularity: 'service' });

    expect(vi.mocked(resetArbitratorBudget)).toHaveBeenCalled();
    // One reset per invocation, so at least 2 resets across 2 invocations.
    expect(vi.mocked(resetArbitratorBudget).mock.calls.length).toBeGreaterThanOrEqual(
      2
    );
  });

  // -------------------------------------------------------------------------
  // 9. Output shape conforms to DecompositionResultV2
  // -------------------------------------------------------------------------
  it('output shape conforms to DecompositionResultV2 (schemaVersion, rid, generatedAt, partial)', async () => {
    vi.mocked(decomposeSlices).mockResolvedValue(
      makeDecompositionResult([
        makeWu({ id: 'S1', files: ['src/a.ts'] })
      ])
    );

    const result = await decompose('rid-shape', '# prd', '/tmp', {
      granularity: 'service'
    });

    expect(result.schemaVersion).toBe('v2');
    expect(result.rid).toBe('rid-shape');
    expect(result.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
    expect(result.partial).toBe(false);
    // All required top-level fields are present.
    expect(result.passes).toBeDefined();
    expect(result.crossPassEdges).toBeDefined();
    expect(result.llmArbitrations).toBeDefined();
    expect(result.codegraph).toBeDefined();
    expect(result.understandAnything).toBeDefined();
  });
});
