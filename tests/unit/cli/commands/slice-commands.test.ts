/**
 * Unit tests for the `peaks slice decompose --granularity` flag (W3 T10).
 *
 * Three cases under test:
 *   a. `--granularity=service` (non-default) routes the request through
 *      `multi-pass-orchestrator.decompose`, writes the v2 envelope via
 *      `SchemaRouter.writeResult`, and emits a `SchemaRouter-aware consumers`
 *      nextActions hint.
 *   b. `--granularity=bogus` short-circuits with `SLICE_DECOMPOSE_FAILED`
 *      and a nextActions hint listing the four allowed values.
 *   c. No `--granularity` flag (default = `'both'`) keeps the existing v1
 *      path: `decomposeSlices` is called, `multiPassDecompose` is not, and
 *      the on-disk JSON has no `schemaVersion` field.
 *
 * Mocking strategy:
 *   - `slice-decompose-service.decomposeSlices` and
 *     `multi-pass-orchestrator.decompose` are stubbed via `vi.mock` so the
 *     CLI test does not need a real codegraph.
 *   - The CLI's own `readPrdBody` helper is exercised end-to-end (with a
 *     fixture PRD at `.peaks/prd/requests/<rid>.md`) to ensure the route
 *     wiring works under realistic input conditions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

vi.mock('../../../../src/services/slice/slice-decompose-service.js', () => ({
  decomposeSlices: vi.fn()
}));

vi.mock('../../../../src/services/slice/multi-pass-orchestrator.js', () => ({
  decompose: vi.fn()
}));

// Stub the benchmark service even though no current test case passes
// --benchmark; keeps the import graph honest if a future test does.
vi.mock('../../../../src/services/slice/slice-benchmark-service.js', () => ({
  decomposeSlicesWithBenchmark: vi.fn()
}));

import { decomposeSlices } from '../../../../src/services/slice/slice-decompose-service.js';
import { decompose as multiPassDecompose } from '../../../../src/services/slice/multi-pass-orchestrator.js';
import { registerSliceCommands } from '../../../../src/cli/commands/slice-commands.js';

let workdir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-slice-cli-gran-'));
  // Stage a PRD body so the CLI's readPrdBody succeeds on first search root.
  mkdirSync(join(workdir, '.peaks', 'prd', 'requests'), { recursive: true });
  writeFileSync(
    join(workdir, '.peaks', 'prd', 'requests', 'rid-gran.md'),
    '# PRD for granularity test\n\n- Feature X\n',
    'utf8'
  );
  stdout = [];
  stderr = [];
  vi.mocked(decomposeSlices).mockReset();
  vi.mocked(multiPassDecompose).mockReset();
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('peaks slice decompose --granularity', () => {
  it('routes --granularity=service through multi-pass-orchestrator and emits a v2 envelope', async () => {
    const v2Result = {
      schemaVersion: 'v2' as const,
      rid: 'rid-gran',
      generatedAt: '2026-06-25T00:00:00.000Z',
      passes: [
        {
          passNumber: 1 as const,
          granularity: 'service' as const,
          slices: [
            {
              id: 'S1',
              label: 'svc-1',
              granularity: 'service' as const,
              files: ['src/a.ts'],
              loc: 100,
              parentSliceId: null,
              semanticAnchor: 'file:src/a.ts'
            }
          ],
          internalEdges: []
        }
      ],
      crossPassEdges: [],
      llmArbitrations: [],
      codegraph: {
        nodes: 0,
        edges: 0,
        dbMB: 0,
        freshness: 'unindexed' as const,
        affectedCrossFile: false,
        note: 'mock'
      },
      understandAnything: {
        kgNodes: 0,
        kgEdges: 0,
        available: false,
        fallback: 'structural-only' as const,
        note: 'mock'
      },
      partial: false
    };
    vi.mocked(multiPassDecompose).mockResolvedValue(v2Result);

    const program = new Command();
    registerSliceCommands(program, {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t)
    });

    await program.parseAsync([
      'node', 'peaks', 'slice', 'decompose', 'rid-gran',
      '--project', workdir,
      '--granularity', 'service',
      '--json'
    ]);

    // v2 path: multiPassDecompose called once with the right granularity.
    expect(multiPassDecompose).toHaveBeenCalledTimes(1);
    expect(multiPassDecompose).toHaveBeenCalledWith(
      'rid-gran',
      expect.any(String),
      workdir,
      expect.objectContaining({ granularity: 'service' })
    );
    // v2 path: v1 service MUST NOT be called directly.
    expect(decomposeSlices).not.toHaveBeenCalled();

    // v2 file written to the standard .peaks/sc/slice-decomposition path.
    const outPath = join(
      workdir,
      '.peaks',
      'sc',
      'slice-decomposition',
      'rid-gran.json'
    );
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, 'utf8')) as {
      schemaVersion?: string;
    };
    expect(written.schemaVersion).toBe('v2');

    // v2 nextActions hint surfaces the SchemaRouter-aware consumer warning.
    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      data?: { schemaVersion?: string };
      nextActions?: string[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.schemaVersion).toBe('v2');
    expect(envelope.nextActions?.some((a) => /SchemaRouter-aware consumers/.test(a))).toBe(true);
  });

  it('returns SLICE_DECOMPOSE_FAILED with allowed-values hint when --granularity is invalid', async () => {
    const program = new Command();
    registerSliceCommands(program, {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t)
    });

    await program.parseAsync([
      'node', 'peaks', 'slice', 'decompose', 'rid-gran',
      '--project', workdir,
      '--granularity', 'bogus',
      '--json'
    ]);

    // Both code paths must remain untouched on invalid input.
    expect(multiPassDecompose).not.toHaveBeenCalled();
    expect(decomposeSlices).not.toHaveBeenCalled();

    // Error envelope emitted on stdout (--json mode), with all 4 allowed values
    // listed in nextActions so the user can self-correct.
    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      code?: string;
      message?: string;
      nextActions?: string[];
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SLICE_DECOMPOSE_FAILED');
    expect(envelope.message).toContain('bogus');
    const hintText = (envelope.nextActions ?? []).join('\n');
    for (const allowed of ['service', 'file', 'both', 'auto']) {
      expect(hintText).toContain(allowed);
    }

    // Exit code set so shells / CI can detect failure.
    expect(process.exitCode).toBe(1);
  });

  it('keeps the existing v1 path when --granularity is not specified (regression guard)', async () => {
    const v1Result = {
      rid: 'rid-gran',
      generatedAt: '2026-06-25T00:00:00.000Z',
      codegraph: {
        nodes: 0,
        edges: 0,
        dbMB: 0,
        freshness: 'unindexed' as const,
        affectedCrossFile: false,
        note: 'mock-v1'
      },
      understandAnything: {
        kgNodes: 0,
        kgEdges: 0,
        available: false,
        fallback: 'structural-only' as const,
        note: 'mock-v1'
      },
      workUnits: [
        {
          id: 'W1',
          label: 'w1',
          files: ['src/a.ts'],
          loc: 10,
          testsAdded: 0,
          filePath: 'src/a.ts',
          candidates: []
        }
      ],
      dependencyDAG: { edges: [] },
      sccAnalysis: {
        sccCount: 1,
        trivialSCCs: ['W1'],
        nonTrivialSCCs: [],
        condensationEdges: 0
      },
      criticalPath: {
        nodes: ['W1'],
        edges: [],
        totalLoc: 10,
        totalDeltaLoc: 0,
        rationale: ''
      },
      minCutResult: {
        algorithm: 'stoer-wagner' as const,
        cutEdges: [],
        partitions: []
      },
      parallelBatches: [
        {
          batch: 1,
          dependsOn: [],
          slices: [],
          parallelizableWithinBatch: true
        }
      ]
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(decomposeSlices).mockResolvedValue(v1Result as any);

    const program = new Command();
    registerSliceCommands(program, {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t)
    });

    await program.parseAsync([
      'node', 'peaks', 'slice', 'decompose', 'rid-gran',
      '--project', workdir,
      '--json'
    ]);

    // No flag → v1 path: decomposeSlices called, multiPassDecompose NOT called.
    expect(decomposeSlices).toHaveBeenCalledTimes(1);
    expect(multiPassDecompose).not.toHaveBeenCalled();

    // Output file is a v1 envelope (no `schemaVersion` field).
    const outPath = join(
      workdir,
      '.peaks',
      'sc',
      'slice-decomposition',
      'rid-gran.json'
    );
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, 'utf8')) as {
      schemaVersion?: string;
    };
    expect(written.schemaVersion).toBeUndefined();

    // Success envelope (no SchemaRouter hint expected on the v1 path).
    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      data?: { schemaVersion?: string };
      nextActions?: string[];
    };
    expect(envelope.ok).toBe(true);
    expect(
      envelope.nextActions?.some((a) => /SchemaRouter-aware consumers/.test(a))
    ).toBe(false);
  });
});