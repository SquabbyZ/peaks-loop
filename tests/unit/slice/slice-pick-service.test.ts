import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickSlicesInteractive, type PickedResult } from '../../../src/services/slice/slice-pick-service.js';
import type { DecompositionResult, SliceCandidate } from '../../../src/services/slice/slice-decompose-types.js';

// Mock child_process so tests don't actually spawn fzf
const mockExec = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mockExec(...args)
  };
});

function makeSlice(rid: string, label: string, batch: number, files: readonly string[], minutesP50: number): { batch: number; slice: SliceCandidate } {
  return {
    batch,
    slice: {
      rid,
      label,
      files,
      estimate: {
        complexitySum: 0,
        testCount: 0,
        locSum: 100,
        minutesP50,
        minutesP90: minutesP50 * 1.6,
        confidence: 'low',
        rationale: 'test'
      },
      semanticAnchor: `file:${files[0] ?? 'x'}`
    }
  };
}

function makeDecomposition(slices: ReadonlyArray<{ batch: number; slice: SliceCandidate }>): DecompositionResult {
  const batches: { batch: number; dependsOn: readonly number[]; slices: readonly SliceCandidate[]; parallelizableWithinBatch: boolean }[] = [];
  const byBatch = new Map<number, SliceCandidate[]>();
  for (const { batch, slice } of slices) {
    if (!byBatch.has(batch)) byBatch.set(batch, []);
    byBatch.get(batch)!.push(slice);
  }
  for (const [batch, ss] of byBatch) {
    batches.push({
      batch,
      dependsOn: batch > 1 ? [batch - 1] : [],
      slices: ss,
      parallelizableWithinBatch: ss.length > 1
    });
  }
  batches.sort((a, b) => a.batch - b.batch);
  return {
    rid: 'test-rid',
    generatedAt: '2026-06-13T12:00:00.000Z',
    codegraph: { nodes: 0, edges: 0, dbMB: 0, freshness: 'test', affectedCrossFile: false, note: '' },
    understandAnything: { kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: '' },
    workUnits: slices.map((s) => ({
      id: s.slice.rid,
      label: s.slice.label,
      files: s.slice.files,
      loc: 100,
      testsAdded: 0,
      filePath: s.slice.files[0] ?? 'x',
      candidates: []
    })),
    dependencyDAG: { edges: [] },
    sccAnalysis: { sccCount: 0, trivialSCCs: [], nonTrivialSCCs: [], condensationEdges: 0 },
    criticalPath: { nodes: [], edges: [], totalLoc: 0, totalDeltaLoc: 0, rationale: '' },
    minCutResult: { algorithm: 'test', cutEdges: [], partitions: [] },
    parallelBatches: batches
  };
}

describe('slice-pick-service', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'peaks-pick-test-'));
    mockExec.mockReset();
  });

  it('throws with one-line install hint when fzf is missing', async () => {
    mockExec.mockImplementation(() => {
      const err = new Error('fzf: command not found') as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    });
    const decomp = makeDecomposition([makeSlice('W1', 'w1', 1, ['x.ts'], 30)]);
    await expect(
      pickSlicesInteractive('rid', decomp, workDir)
    ).rejects.toThrow(/brew install fzf|apt-get install fzf/);
  });

  it('throws when fzf version is < 0.38', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') {
        return '0.32\n';
      }
      return '';
    });
    const decomp = makeDecomposition([makeSlice('W1', 'w1', 1, ['x.ts'], 30)]);
    await expect(
      pickSlicesInteractive('rid', decomp, workDir)
    ).rejects.toThrow(/older than required 0\.38/);
  });

  it('picks a single candidate when fzf returns one line', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return 'B1 | W1 | w1 | 30m | x.ts\n';
    });
    const decomp = makeDecomposition([makeSlice('W1', 'w1', 1, ['x.ts'], 30)]);
    const result = await pickSlicesInteractive('rid', decomp, workDir);
    expect(result.picked).toHaveLength(1);
    expect(result.picked[0]?.rid).toBe('W1');
  });

  it('picks multiple candidates when fzf returns multiple lines', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return [
        'B1 | W1 | w1 | 30m | x.ts',
        'B1 | W2 | w2 | 40m | y.ts',
        ''
      ].join('\n');
    });
    const decomp = makeDecomposition([
      makeSlice('W1', 'w1', 1, ['x.ts'], 30),
      makeSlice('W2', 'w2', 1, ['y.ts'], 40)
    ]);
    const result = await pickSlicesInteractive('rid', decomp, workDir);
    expect(result.picked).toHaveLength(2);
    expect(result.picked.map((s) => s.rid).sort()).toEqual(['W1', 'W2']);
  });

  it('returns empty picked when fzf exits 130 (user pressed Esc)', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      const err = new Error('interrupted') as Error & { status?: number };
      err.status = 130;
      throw err;
    });
    const decomp = makeDecomposition([makeSlice('W1', 'w1', 1, ['x.ts'], 30)]);
    const result = await pickSlicesInteractive('rid', decomp, workDir);
    expect(result.picked).toHaveLength(0);
  });

  it('writes <rid>-picked.json to .peaks/_runtime/_sc/slice-decomposition/', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return 'B1 | W1 | w1 | 30m | x.ts\n';
    });
    const decomp = makeDecomposition([makeSlice('W1', 'w1', 1, ['x.ts'], 30)]);
    const result: PickedResult = await pickSlicesInteractive('rid', decomp, workDir);
    expect(existsSync(result.outputPath)).toBe(true);
    const json = JSON.parse(readFileSync(result.outputPath, 'utf8'));
    expect(json.rid).toBe('rid');
    expect(json.picked).toHaveLength(1);
    expect(json.fzfVersion).toBe('0.38');
  });

  it('uses overrideStdin to bypass fzf spawn (test injection point)', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      throw new Error('should not spawn fzf in test mode');
    });
    const decomp = makeDecomposition([makeSlice('W1', 'w1', 1, ['x.ts'], 30)]);
    const result = await pickSlicesInteractive('rid', decomp, workDir, {
      overrideStdin: 'B1 | W1 | w1 | 30m | x.ts\n'
    });
    expect(result.picked).toHaveLength(1);
  });
});
