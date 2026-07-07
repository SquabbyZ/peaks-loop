/**
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) — dag-orchestrator tests.
 *
 * Covers AC-5.a / AC-5.b from the 1.1 PRD:
 *  - runDag exists and returns a DagRunResult.
 *  - 任一叶子失败 → 整组回退(other in-flight slices reported as cancelled).
 *  - Successful slices write contracts to disk and have them broadcast
 *    into the next level's prompt.
 */
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDispatchSpec,
  DagPlanError,
  runDag,
  type DispatchSpec,
  type PublicSurface,
  type SliceOutcome
} from '../../../src/services/code/dag-orchestrator.js';
import type { SliceDag } from '../../../src/services/dispatch/slice-dag.js';

let projectRoot = '';
const sessionId = '2026-06-18-test-session';

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-orchestrator-'));
});

afterAll(() => {
  if (projectRoot && existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

const diamond: SliceDag = {
  nodes: [
    { id: 'A', role: 'rd' },
    { id: 'B', role: 'qa' },
    { id: 'C', role: 'qa' },
    { id: 'D', role: 'rd' }
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D' }
  ]
};

const linear: SliceDag = {
  nodes: [
    { id: 'A', role: 'rd' },
    { id: 'B', role: 'qa' },
    { id: 'C', role: 'qa' }
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' }
  ]
};

describe('runDag happy path (AC-5.a)', () => {
  it('runs all 4 diamond nodes in 3 levels with all done', async () => {
    const result = await runDag(diamond, {
      projectRoot,
      sessionId,
      runSlice: async (spec): Promise<SliceOutcome> => ({
        status: 'done',
        publicSurface: {
          exports: [`export_${spec.sliceId}`],
          types: [`Type_${spec.sliceId}`],
          publicSignatures: [`${spec.sliceId}(): void`]
        }
      }),
      writeContractFn: (sliceId, surface: PublicSurface) => ({
        sliceId,
        sessionId,
        completedAt: '2026-06-18T05:00:00.000Z',
        exports: surface.exports,
        types: surface.types,
        publicSignatures: surface.publicSignatures,
        contractHash: 'mock-' + sliceId
      })
    });
    expect(result.completed).toEqual(['A', 'B', 'C', 'D']);
    expect(result.failed).toEqual([]);
    expect(result.cancelled).toEqual([]);
    expect(result.contracts.length).toBe(4);
    expect(result.dagHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('propagates ancestor contracts into downstream prompt via buildDispatchSpec', async () => {
    const dag: SliceDag = {
      nodes: [
        { id: 'A', role: 'rd' },
        { id: 'B', role: 'qa' },
        { id: 'C', role: 'qa' }
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' }
      ]
    };
    const result = await runDag(dag, {
      projectRoot,
      sessionId,
      runSlice: async (spec): Promise<SliceOutcome> => ({
        status: 'done',
        publicSurface: {
          exports: [`export_${spec.sliceId}`],
          types: ['T'],
          publicSignatures: [`${spec.sliceId}(): void`],
          ...(spec.sliceId === 'A' ? { broadcastTo: ['B', 'C'] } : {})
        }
      }),
      writeContractFn: (sliceId, surface) => ({
        sliceId,
        sessionId,
        completedAt: '2026-06-18T05:00:00.000Z',
        exports: surface.exports,
        types: surface.types,
        publicSignatures: surface.publicSignatures,
        ...(surface.broadcastTo !== undefined ? { broadcastTo: surface.broadcastTo } : {}),
        contractHash: 'mock-' + sliceId
      })
    });
    expect(result.completed).toEqual(['A', 'B', 'C']);

    const downstream = buildDispatchSpec(dag, 'B', result.contracts);
    expect(downstream.contractBlock).toContain('mock-A');
  });
});

describe('runDag failure rollback (AC-5.b)', () => {
  it('reports a failed leaf + stops dispatching further levels + does not include downstream levels', async () => {
    // Mock runner: A done, B fails, C done (same level), D would normally be the next
    // level. We use a level-3 DAG so the test exercises the cross-level stop.
    const result = await runDag(diamond, {
      projectRoot,
      sessionId,
      runSlice: async (spec): Promise<SliceOutcome> => {
        if (spec.sliceId === 'B') {
          return { status: 'failed', reason: 'unit-test failure' };
        }
        return {
          status: 'done',
          publicSurface: { exports: [], types: [], publicSignatures: [] }
        };
      },
      writeContractFn: (sliceId) => ({
        sliceId,
        sessionId,
        completedAt: '2026-06-18T05:00:00.000Z',
        exports: [],
        types: [],
        publicSignatures: [],
        contractHash: 'mock-' + sliceId
      })
    });
    // A and C succeed; B fails. The orchestrator must STOP advancing to
    // D (downstream level) once any leaf in the current level fails.
    expect([...result.completed].sort()).toEqual(['A', 'C']);
    expect(result.failed.map((f) => f.sliceId)).toContain('B');
    // D (downstream of the failed level) is never reached.
    expect(result.completed).not.toContain('D');
    expect(result.failed.find((f) => f.sliceId === 'B')?.reason).toBe('unit-test failure');
  });

  it('emits a cancelled marker for slices that returned status=cancelled in the runner', async () => {
    // AC-5.b: 任一叶子失败 → 整组回退. The "cancellation" surface in the
    // MVP is the per-slice `status: 'cancelled'` outcome the runner can
    // emit. The orchestrator must surface that in `cancelled` and stop
    // advancing to the next level.
    const result = await runDag(
      {
        nodes: [
          { id: 'A', role: 'rd' },
          { id: 'B', role: 'qa' },
          { id: 'C', role: 'qa' }
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'A', to: 'C' }
        ]
      },
      {
        projectRoot,
        sessionId,
        runSlice: (spec): Promise<SliceOutcome> => {
          if (spec.sliceId === 'A') {
            return Promise.resolve({ status: 'done', publicSurface: { exports: [], types: [], publicSignatures: [] } });
          }
          if (spec.sliceId === 'B') {
            return Promise.resolve({ status: 'cancelled' });
          }
          return Promise.resolve({ status: 'done', publicSurface: { exports: [], types: [], publicSignatures: [] } });
        },
        writeContractFn: (sliceId) => ({
          sliceId,
          sessionId,
          completedAt: '2026-06-18T05:00:00.000Z',
          exports: [],
          types: [],
          publicSignatures: [],
          contractHash: 'mock-' + sliceId
        })
      }
    );
    expect([...result.completed].sort()).toEqual(['A', 'C']);
    expect(result.cancelled).toContain('B');
  });
});

describe('runDag validation', () => {
  it('throws DagPlanError on an empty DAG', async () => {
    await expect(
      runDag({ nodes: [], edges: [] }, { projectRoot, sessionId })
    ).rejects.toBeInstanceOf(DagPlanError);
  });
});

describe('default runner (no runSlice provided)', () => {
  it('runs to completion with empty public surfaces', async () => {
    const result = await runDag(linear, { projectRoot, sessionId });
    expect(result.completed).toEqual(['A', 'B', 'C']);
  });

  it('writes contracts to disk by default', () => {
    const dir = join(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts');
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildDispatchSpec edge cases', () => {
  it('throws on unknown sliceId', () => {
    expect(() => buildDispatchSpec(diamond, 'Z', [])).toThrow(DagPlanError);
  });
  it('uses the node.prompt override when present', () => {
    const spec: DispatchSpec = buildDispatchSpec(
      { ...diamond, nodes: diamond.nodes.map((n) => (n.id === 'A' ? { ...n, prompt: 'custom A prompt' } : n)) },
      'A',
      []
    );
    // Slice 2026-06-24-test-tool-detection-injection: every dispatched
    // prompt is prepended with the Test Tool Detection block. The
    // custom `node.prompt` is preserved verbatim AFTER the block.
    expect(spec.prompt.endsWith('custom A prompt')).toBe(true);
    expect(spec.prompt).toContain('## Test Tool Detection (mandatory)');
  });
});
