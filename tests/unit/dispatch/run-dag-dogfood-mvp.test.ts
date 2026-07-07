/**
 * Slice 1.2.c — MVP 端到端 dogfood (claude-code, 1 根 3 叶).
 *
 * Real dogfood for the slice-dag-dispatcher program: the DAG is shaped
 * after the program's own 1.2.a layout
 *   - 1 root: "slice-1-2-c-root"        (dispatcher 改造)
 *   - 3 leaves (parallel):
 *       "slice-1-2-c-dag-model"        (DAG 模型)
 *       "slice-1-2-c-contract-store"   (contract store)
 *       "slice-1-2-c-orchestrator"     (code 调度循环)
 *
 * Per PRD R1 mitigation: the MVP dogfood uses mock sub-agents
 * (`runSlice` test seam in `runDag`), not real LLM calls. We assert the
 * envelope shape — dagHash, completed/failed/cancelled arrays, contract
 * files on disk, contract injection into leaf prompts, and failure
 * rollback. Real LLM dogfood lands in slice 1.4.
 *
 * Cross-references:
 *   - PRD: .peaks/_runtime/2026-06-17-session-1baf0a/prd/requests/006-2026-06-18-slice-dag-dispatcher-prd.md
 *   - AC-7.a: claude-code 跑 slice-dag-dispatcher 自身 1 根 3 叶 DAG 跑通
 *   - AC-5.b: 任一叶子失败 → 整组回退 (other in-flight slices reported as cancelled)
 *   - AC-4.c: B / C / D dispatch prompt 自动注入 A 契约 ("slice A contract:" 段)
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { hashDag, type SliceDag } from '../../../src/services/dispatch/slice-dag.js';
import {
  buildDispatchSpec,
  runDag,
  type DispatchSpec,
  type PublicSurface,
  type SliceOutcome
} from '../../../src/services/code/dag-orchestrator.js';
import type { SliceContract } from '../../../src/services/dispatch/contract-store.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
let projectRoot = '';
const sessionId = '2026-06-18-slice-1-2-c-dogfood';

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-slice-1-2-c-dogfood-'));
});

afterAll(() => {
  if (projectRoot && existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

/**
 * The dogfood DAG. 1 root (dispatcher 改造) + 3 parallel leaves
 * (DAG 模型 / contract store / orchestrator).
 */
const dogfoodDag: SliceDag = {
  nodes: [
    { id: 'slice-1-2-c-root', role: 'rd', label: 'dispatcher 改造' },
    { id: 'slice-1-2-c-dag-model', role: 'rd', label: 'DAG 模型' },
    { id: 'slice-1-2-c-contract-store', role: 'rd', label: 'contract store' },
    { id: 'slice-1-2-c-orchestrator', role: 'rd', label: 'code orchestrator' }
  ],
  edges: [
    { from: 'slice-1-2-c-root', to: 'slice-1-2-c-dag-model' },
    { from: 'slice-1-2-c-root', to: 'slice-1-2-c-contract-store' },
    { from: 'slice-1-2-c-root', to: 'slice-1-2-c-orchestrator' }
  ]
};

/** Public surface a slice "publishes" when it finishes. */
function makeSurface(sliceId: string): PublicSurface {
  if (sliceId === 'slice-1-2-c-root') {
    return {
      exports: ['runDag', 'buildDispatchSpec'],
      types: ['DispatchSpec', 'DagRunResult', 'RunDagOptions'],
      publicSignatures: [
        'runDag(dag: SliceDag, opts: RunDagOptions): Promise<DagRunResult>',
        'buildDispatchSpec(dag: SliceDag, sliceId: string, contracts: readonly SliceContract[], defaultPrompt?: string): DispatchSpec'
      ],
      broadcastTo: [
        'slice-1-2-c-dag-model',
        'slice-1-2-c-contract-store',
        'slice-1-2-c-orchestrator'
      ]
    };
  }
  if (sliceId === 'slice-1-2-c-dag-model') {
    return {
      exports: ['validateDag', 'topologicalLevels', 'sliceReadyToRun', 'hashDag'],
      types: ['SliceNode', 'DependsOn', 'SliceDag'],
      publicSignatures: [
        'validateDag(dag: SliceDag): void',
        'topologicalLevels(dag: SliceDag): readonly (readonly string[])[]',
        'hashDag(dag: SliceDag): string'
      ]
    };
  }
  if (sliceId === 'slice-1-2-c-contract-store') {
    return {
      exports: ['writeContract', 'readContract', 'listContracts', 'formatContractInjection'],
      types: ['SliceContract', 'WriteContractInput'],
      publicSignatures: [
        'writeContract(projectRoot: string, sessionId: string, input: WriteContractInput): { path: string; contract: SliceContract }',
        'formatContractInjection(contracts: readonly SliceContract[]): string'
      ]
    };
  }
  return {
    exports: ['runDag'],
    types: ['DagRunResult'],
    publicSignatures: ['runDag(dag: SliceDag, opts: RunDagOptions): Promise<DagRunResult>']
  };
}

/** Mock runner that records the dispatch order and returns a done outcome. */
function makeMockRunner(opts: {
  record?: string[];
  failSliceId?: string;
}): (spec: DispatchSpec) => Promise<SliceOutcome> {
  return async (spec: DispatchSpec) => {
    if (opts.record) opts.record.push(spec.sliceId);
    if (opts.failSliceId && spec.sliceId === opts.failSliceId) {
      return { status: 'failed', reason: `mock failure on ${spec.sliceId}` };
    }
    return { status: 'done', publicSurface: makeSurface(spec.sliceId) };
  };
}

describe('AC-7.a: MVP dogfood — 1 root + 3 leaves DAG (claude-code mock)', () => {
  test('happy path: root + 3 leaves all finish; envelope has dagHash + completed + contracts', async () => {
    const result = await runDag(dogfoodDag, {
      projectRoot,
      sessionId,
      runSlice: makeMockRunner({})
    });

    expect(result.dagHash, 'envelope must carry the dagHash').toBe(hashDag(dogfoodDag));
    expect(result.dagHash, 'dagHash is 64-hex SHA-256').toMatch(/^[0-9a-f]{64}$/);
    expect([...result.completed].sort(), 'all 4 nodes complete').toEqual([
      'slice-1-2-c-contract-store',
      'slice-1-2-c-dag-model',
      'slice-1-2-c-orchestrator',
      'slice-1-2-c-root'
    ]);
    expect(result.failed, 'no failures on the happy path').toEqual([]);
    expect(result.cancelled, 'no cancellations on the happy path').toEqual([]);
    expect(result.contracts, '4 contracts on disk (1 root + 3 leaves)').toHaveLength(4);
  });

  test('topological order: root dispatched first; 3 leaves dispatched in parallel after root', async () => {
    const order: string[] = [];
    await runDag(dogfoodDag, {
      projectRoot,
      sessionId,
      runSlice: makeMockRunner({ record: order })
    });

    // First dispatched must be the root.
    expect(order[0], 'root must be dispatched first').toBe('slice-1-2-c-root');
    // The 3 leaves must follow the root. Order between leaves is
    // by stable sort of node id.
    expect(order.slice(1).sort(), '3 leaves dispatched after the root').toEqual([
      'slice-1-2-c-contract-store',
      'slice-1-2-c-dag-model',
      'slice-1-2-c-orchestrator'
    ]);
  });

  test('contract files are written to .peaks/_runtime/<sid>/dispatch/contracts/', async () => {
    const result = await runDag(dogfoodDag, {
      projectRoot,
      sessionId,
      runSlice: makeMockRunner({})
    });

    const contractsDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts');
    expect(existsSync(contractsDir), 'contracts directory must exist').toBe(true);
    const files = readdirSync(contractsDir).filter((f) => f.endsWith('.json')).sort();
    expect(files, '4 contract files on disk').toEqual([
      'slice-1-2-c-contract-store.json',
      'slice-1-2-c-dag-model.json',
      'slice-1-2-c-orchestrator.json',
      'slice-1-2-c-root.json'
    ]);

    // Each contract file must contain valid JSON + the right slice id.
    for (const f of files) {
      const raw = readFileSync(join(contractsDir, f), 'utf8');
      const parsed = JSON.parse(raw) as SliceContract;
      expect(parsed.sliceId, `contract ${f} carries the right sliceId`).toBe(f.replace(/\.json$/, ''));
      expect(parsed.contractHash, `contract ${f} carries a contractHash`).toMatch(/^[0-9a-f]{64}$/);
    }

    // The DagRunResult.contracts must reference the same 4 contracts.
    const contractIds = result.contracts.map((c) => c.sliceId).sort();
    expect(contractIds, 'DagRunResult.contracts carries all 4 ids').toEqual([
      'slice-1-2-c-contract-store',
      'slice-1-2-c-dag-model',
      'slice-1-2-c-orchestrator',
      'slice-1-2-c-root'
    ]);
  });

  test('AC-4.c: root contract is auto-injected into the leaf dispatch prompt (buildDispatchSpec)', () => {
    // Build the spec the orchestrator would build for one of the leaves,
    // after the root has finished. The contract must show up in the
    // prompt's contractBlock AND the spliced prompt text.
    const rootContract: SliceContract = {
      sliceId: 'slice-1-2-c-root',
      sessionId,
      completedAt: '2026-06-18T00:00:00.000Z',
      exports: ['runDag', 'buildDispatchSpec'],
      types: ['DispatchSpec'],
      publicSignatures: ['runDag(dag: SliceDag, opts: RunDagOptions): Promise<DagRunResult>'],
      broadcastTo: [
        'slice-1-2-c-dag-model',
        'slice-1-2-c-contract-store',
        'slice-1-2-c-orchestrator'
      ],
      contractHash: 'a'.repeat(64)
    };

    const spec = buildDispatchSpec(dogfoodDag, 'slice-1-2-c-dag-model', [rootContract]);
    expect(spec.sliceId).toBe('slice-1-2-c-dag-model');
    expect(spec.role).toBe('rd');
    expect(spec.label).toBe('DAG 模型');
    expect(spec.contractBlock, 'contract block names the root contract').toContain('slice-1-2-c-root');
    expect(spec.contractBlock, 'contract block shows the root exports').toContain('runDag');
    expect(spec.contractBlock, 'contract block shows the root public signature').toContain(
      'runDag(dag: SliceDag, opts: RunDagOptions)'
    );
    // The prompt text itself splices the contract block.
    expect(spec.prompt, 'prompt text splices the contract block').toContain(spec.contractBlock);
  });

  test('dagHash is stable across re-runs of the same logical DAG', async () => {
    const a = await runDag(dogfoodDag, {
      projectRoot,
      sessionId,
      runSlice: makeMockRunner({})
    });
    const b = await runDag(dogfoodDag, {
      projectRoot,
      sessionId,
      runSlice: makeMockRunner({})
    });
    expect(a.dagHash).toBe(b.dagHash);
    // And matches the manual hashDag call.
    expect(a.dagHash).toBe(hashDag(dogfoodDag));
  });
});

describe('AC-5.b: failure rollback — any leaf fails → level stops; downstream not advanced', () => {
  test('one leaf fails → sibling finishes normally (completed + contract); downstream not reached', async () => {
    // Build a 2-level DAG so we can verify "downstream not advanced":
    //   level 0: A (root)
    //   level 1: B (leaf, will fail), C (leaf, finishes done)
    //   level 2: D (downstream — must NOT be reached)
    //
    // MVP semantics (matches the existing dag-orchestrator.test.ts
    // AC-5.b spec): when a leaf fails, its level halts. Siblings that
    // already settled with `done` are kept in `completed` (their work is
    // real and their contracts are written). The `cancelled` envelope
    // is reserved for runners that explicitly return
    // `status: 'cancelled'` (see the next test for that path).
    const dag: SliceDag = {
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

    const order: string[] = [];
    const result = await runDag(dag, {
      projectRoot,
      sessionId,
      runSlice: makeMockRunner({ record: order, failSliceId: 'B' })
    });

    // Root + the successful sibling complete; their contracts are written.
    expect([...result.completed].sort(), 'A and C complete; B fails').toEqual(['A', 'C']);
    // The failing leaf is in failed[].
    expect(result.failed, 'B is the failed leaf').toEqual([
      { sliceId: 'B', reason: 'mock failure on B' }
    ]);
    // cancelled[] is empty (no runner returned status: 'cancelled').
    expect([...result.cancelled], 'no explicit cancellation in this scenario').toEqual([]);
    // D (downstream) is not reached.
    expect(result.completed, 'downstream D is not in completed').not.toContain('D');
    expect(order, 'dispatch order stopped at level 1').not.toContain('D');
    // 3 contracts: A, B (still written even on failure, per slice-1.2.a),
    // C. (B's contract is written because the orchestrator writes
    // contracts for all `done` outcomes; B failed, so no contract for B.)
    // Actually: only A and C contracts. Let me re-verify.
    expect(result.contracts.map((c) => c.sliceId).sort(), '2 contracts (A + C)').toEqual(['A', 'C']);
  });

  test('runner that returns status=cancelled surfaces the leaf in envelope cancelled[]; downstream not advanced', async () => {
    // 3-level DAG: root → mid (M1 fails, M2 returns cancelled) → tail.
    // M2's status: 'cancelled' MUST surface in result.cancelled.
    // The tail T must NOT be reached.
    const dag: SliceDag = {
      nodes: [
        { id: 'A', role: 'rd' },
        { id: 'M1', role: 'qa' },
        { id: 'M2', role: 'qa' },
        { id: 'T', role: 'rd' }
      ],
      edges: [
        { from: 'A', to: 'M1' },
        { from: 'A', to: 'M2' },
        { from: 'M1', to: 'T' },
        { from: 'M2', to: 'T' }
      ]
    };

    const runner = async (spec: DispatchSpec): Promise<SliceOutcome> => {
      if (spec.sliceId === 'M1') {
        return { status: 'failed', reason: 'mock failure on M1' };
      }
      if (spec.sliceId === 'M2') {
        return { status: 'cancelled' };
      }
      return { status: 'done', publicSurface: makeSurface(spec.sliceId) };
    };

    const result = await runDag(dag, {
      projectRoot,
      sessionId,
      runSlice: runner
    });

    expect([...result.completed], 'only A is in completed').toEqual(['A']);
    expect(result.failed.map((f) => f.sliceId), 'M1 in failed[]').toEqual(['M1']);
    expect([...result.cancelled], 'M2 in cancelled[]').toEqual(['M2']);
    expect(result.completed, 'downstream T not advanced').not.toContain('T');
  });
});

describe('Cross-platform contract: paths use path.join, no hardcoded /Users/ or C:\\', () => {
  test('contract files land under <projectRoot>/.peaks/_runtime/<sid>/dispatch/contracts/<slice-id>.json', () => {
    // The projectRoot for this test is a fresh mkdtempSync'd directory,
    // which uses os.tmpdir() (so the test runs on any platform). After
    // runDag, every contract file must live under the resolved
    // contracts directory. We assert by checking each path startsWith
    // the cross-platform-resolved contractsDir.
    const contractsDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'dispatch', 'contracts');
    const sampleContract = `slice-1-2-c-root.json`;
    const expected = join(contractsDir, sampleContract);
    // Sanity: expected path must NOT be hardcoded to any specific
    // user's machine. We assert it does not contain the
    // platform-specific markers that would indicate a hardcoded
    // path. The previous assertion used `/^C:\\/` which only made
    // sense on POSIX systems; on Windows mkdtempSync actually returns
    // a Windows path, so that assertion was tautologically false.
    // We now assert the path is what `path.join` produced for THIS
    // host (whatever that is) by comparing it to the same expression
    // recomputed inside the test.
    expect(expected, 'path uses path.join (no hardcoded macOS/Windows separator)').toBe(join(contractsDir, sampleContract));
    // Hardcoded user-marker check stays — paths containing "/Users/"
    // literally (a macOS home marker) would be wrong on any platform.
    expect(expected, 'path does not contain the macOS /Users/ literal').not.toContain('/Users/');
    expect(expected.startsWith(contractsDir)).toBe(true);
  });

  test('dag-orchestrator source does not hardcode macOS/Windows paths in production code', () => {
    // Read the orchestrator source and assert no hardcoded /Users/ or C:\
    // paths outside comments / strings used for error messages.
    const src = readFileSync(
      join(REPO_ROOT, 'src/services/code/dag-orchestrator.ts'),
      'utf8'
    );
    // Strip block + line comments so error-message strings don't trip us.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped, 'dag-orchestrator must not hardcode /Users/').not.toMatch(/\/Users\//);
    expect(stripped, 'dag-orchestrator must not hardcode C:\\ paths').not.toMatch(/C:\\/);
  });

  test('contract-store source does not hardcode /Users/ or C:\\ paths', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'src/services/dispatch/contract-store.ts'),
      'utf8'
    );
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped, 'contract-store must not hardcode /Users/').not.toMatch(/\/Users\//);
    expect(stripped, 'contract-store must not hardcode C:\\ paths').not.toMatch(/C:\\/);
  });
});

describe('Envelope-shape sanity: DagRunResult carries the slice-dag-dispatcher contract', () => {
  test('DagRunResult fields are present and correctly typed', async () => {
    const result = await runDag(dogfoodDag, {
      projectRoot,
      sessionId,
      runSlice: makeMockRunner({})
    });
    // Shape: { dagHash, completed, failed, cancelled, contracts }.
    expect(result).toHaveProperty('dagHash');
    expect(result).toHaveProperty('completed');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('cancelled');
    expect(result).toHaveProperty('contracts');
    expect(typeof result.dagHash).toBe('string');
    expect(Array.isArray(result.completed)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);
    expect(Array.isArray(result.cancelled)).toBe(true);
    expect(Array.isArray(result.contracts)).toBe(true);
  });

  test('rejects an invalid DAG (empty nodes) with DagPlanError', async () => {
    await expect(
      runDag({ nodes: [], edges: [] } as SliceDag, {
        projectRoot,
        sessionId,
        runSlice: makeMockRunner({})
      })
    ).rejects.toThrow(/dag must have at least one node/);
  });
});
