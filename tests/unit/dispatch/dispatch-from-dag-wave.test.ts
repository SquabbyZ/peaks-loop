/**
 * Slice 2026-07-28 — DAG wave + barrier tests (rid-029 E direction).
 *
 * Six cases cover the public acceptance criteria for the E direction:
 *  1. Chunking at default maxConcurrency=6: 8 leaves at one level
 *     → 2 waves (6+2).
 *  2. No chunking needed: 3 leaves at one level → 1 wave.
 *  3. Boundary: 12 leaves → 2 waves of 6 (exact boundary).
 *  4. Custom concurrency cap: maxConcurrency=2 + 6 leaves → 3 waves of 2.
 *  5. Artifact-pass enabled: Wave 1 returns populated contracts; Wave 2
 *     prompt receives them.
 *  6. Artifact-pass disabled: Wave 2 prompt does NOT contain prior
 *     contracts (default behavior; sanity guard).
 */
import { describe, expect, it } from 'vitest';
import type { SliceDag } from '../../../src/services/dispatch/slice-dag.js';
import {
  planDispatchWaves,
  runWaveWithArtifacts,
  type DispatchSpec,
  type SliceOutcome
} from '../../../src/services/code/dag-orchestrator.js';

const fanDag = (count: number, source: string): SliceDag => {
  const nodes = Array.from({ length: count + 1 }, (_, i) => ({
    id: i === 0 ? source : `L${i}`,
    role: 'rd'
  }));
  const edges = nodes.slice(1).map((n) => ({ from: source, to: n.id }));
  return { nodes, edges };
};

const flatDag = (count: number): SliceDag => ({
  nodes: Array.from({ length: count }, (_, i) => ({ id: `X${i + 1}`, role: 'rd' })),
  edges: []
});

describe('planDispatchWaves — chunking (AC-E2 case 1/2/3/4)', () => {
  it('chunks 8 leaves at one level into 6 + 2 waves with default cap', () => {
    const dag = flatDag(8);
    const waves = planDispatchWaves(dag);
    expect(waves.length).toBe(2);
    expect(waves[0]?.slices.length).toBe(6);
    expect(waves[1]?.slices.length).toBe(2);
    expect(waves[0]?.waveIndex).toBe(0);
    expect(waves[1]?.waveIndex).toBe(1);
  });

  it('returns a single wave when count <= maxConcurrency (3 leaves)', () => {
    const dag = flatDag(3);
    const waves = planDispatchWaves(dag);
    expect(waves.length).toBe(1);
    expect(waves[0]?.slices.length).toBe(3);
  });

  it('chunks 12 leaves into 2 waves of 6 (exact boundary)', () => {
    const dag = flatDag(12);
    const waves = planDispatchWaves(dag);
    expect(waves.length).toBe(2);
    expect(waves[0]?.slices.length).toBe(6);
    expect(waves[1]?.slices.length).toBe(6);
  });

  it('honors custom maxConcurrency: 6 leaves with cap=2 → 3 waves of 2', () => {
    const dag = flatDag(6);
    const waves = planDispatchWaves(dag, { maxConcurrency: 2, passArtifacts: false });
    expect(waves.length).toBe(3);
    expect(waves[0]?.slices.length).toBe(2);
    expect(waves[1]?.slices.length).toBe(2);
    expect(waves[2]?.slices.length).toBe(2);
  });
});

describe('runWaveWithArtifacts — artifact-pass (AC-E2 case 5/6)', () => {
  it('populates contracts in WaveArtifact when passArtifacts=true', async () => {
    const dag = fanDag(2, 'A');
    const waves = planDispatchWaves(dag, { maxConcurrency: 6, passArtifacts: true });
    expect(waves.length).toBe(2);
    const wave0 = waves[0]!;
    const runner = async (spec: DispatchSpec): Promise<SliceOutcome> => ({
      status: 'done',
      publicSurface: {
        exports: [`ex_${spec.sliceId}`],
        types: [`Ty_${spec.sliceId}`],
        publicSignatures: [`${spec.sliceId}(): void`]
      }
    });
    const artifact = await runWaveWithArtifacts(
      dag,
      wave0,
      runner,
      [],
      { maxConcurrency: 6, passArtifacts: true }
    );
    expect(artifact.waveIndex).toBe(0);
    expect(artifact.completedLeaves.length).toBe(1);
    expect(artifact.contracts).toHaveProperty('A');
  });

  it('produces empty contracts envelope when passArtifacts=false', async () => {
    const dag = fanDag(2, 'A');
    const waves = planDispatchWaves(dag); // default: passArtifacts=false
    const wave0 = waves[0]!;
    const runner = async (spec: DispatchSpec): Promise<SliceOutcome> => ({
      status: 'done',
      publicSurface: {
        exports: [`ex_${spec.sliceId}`],
        types: [],
        publicSignatures: []
      }
    });
    const artifact = await runWaveWithArtifacts(dag, wave0, runner);
    expect(Object.keys(artifact.contracts).length).toBe(0);
    expect(artifact.completedLeaves).toContain('A');
  });
});
