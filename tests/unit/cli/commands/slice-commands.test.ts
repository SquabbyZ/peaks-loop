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

vi.mock('../../../../src/services/slice/slice-pick-service.js', () => ({
  pickSlicesInteractive: vi.fn()
}));

import { decomposeSlices } from '../../../../src/services/slice/slice-decompose-service.js';
import { decompose as multiPassDecompose } from '../../../../src/services/slice/multi-pass-orchestrator.js';
import { pickSlicesInteractive } from '../../../../src/services/slice/slice-pick-service.js';
import { registerSliceCommands, parsePickedFile } from '../../../../src/cli/commands/slice-commands.js';

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
  vi.mocked(pickSlicesInteractive).mockReset();
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

/**
 * Unit tests for `peaks slice pick` v1/v2 dual-read via SchemaRouter (W3 T11).
 *
 * Two cases under test:
 *   a. v1 file (no `schemaVersion` field) loads cleanly through
 *      `SchemaRouter.readResult` and `pickSlicesInteractive` runs to completion.
 *   b. v2 file (`schemaVersion: 'v2'`) is rejected with a clear migration
 *      hint pointing the user at `peaks slice decompose <rid>` without
 *      `--granularity`.
 *
 * Mocking strategy:
 *   - `pickSlicesInteractive` is stubbed via `vi.mock` so the pick action
 *     does not try to spawn fzf or write the -picked.json envelope.
 *   - The on-disk decomposition file is staged manually for each case.
 */
describe('peaks slice pick v1/v2 dual-read', () => {
  it('reads a v1 decomposition file successfully via SchemaRouter', async () => {
    const v1Envelope = {
      rid: 'rid-pick-v1',
      generatedAt: '2026-06-25T00:00:00.000Z',
      codegraph: {
        nodes: 0,
        edges: 0,
        dbMB: 0,
        freshness: 'unindexed',
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
      workUnits: [],
      dependencyDAG: { edges: [] },
      sccAnalysis: {
        sccCount: 1,
        trivialSCCs: [],
        nonTrivialSCCs: [],
        condensationEdges: 0
      },
      criticalPath: {
        nodes: [],
        edges: [],
        totalLoc: 0,
        totalDeltaLoc: 0,
        rationale: ''
      },
      minCutResult: { algorithm: 'stoer-wagner', cutEdges: [], partitions: [] },
      parallelBatches: [
        {
          batch: 1,
          dependsOn: [],
          slices: [
            {
              rid: 'S1',
              label: 'svc-1',
              files: ['src/a.ts'],
              estimate: {
                complexitySum: 1,
                testCount: 0,
                locSum: 10,
                minutesP50: 5,
                minutesP90: 10,
                confidence: 'medium',
                rationale: 'mock'
              },
              semanticAnchor: 'file:src/a.ts'
            }
          ],
          parallelizableWithinBatch: true
        }
      ]
    };
    const decompDir = join(workdir, '.peaks', 'sc', 'slice-decomposition');
    mkdirSync(decompDir, { recursive: true });
    writeFileSync(
      join(decompDir, 'rid-pick-v1.json'),
      JSON.stringify(v1Envelope),
      'utf8'
    );
    vi.mocked(pickSlicesInteractive).mockResolvedValue({
      picked: [
        {
          rid: 'S1',
          label: 'svc-1',
          files: ['src/a.ts'],
          estimate: {
            complexitySum: 1,
            testCount: 0,
            locSum: 10,
            minutesP50: 5,
            minutesP90: 10,
            confidence: 'medium',
            rationale: 'mock'
          },
          semanticAnchor: 'file:src/a.ts'
        }
      ],
      outputPath: join(decompDir, 'rid-pick-v1-picked.json'),
      fzfVersion: '0.55.0 (mock)'
    });

    const program = new Command();
    registerSliceCommands(program, {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t)
    });

    await program.parseAsync([
      'node', 'peaks', 'slice', 'pick', 'rid-pick-v1',
      '--project', workdir,
      '--json'
    ]);

    // v1 path: SchemaRouter narrowed to DecompositionResult, pick ran.
    expect(pickSlicesInteractive).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      data?: { picked: Array<{ rid: string }> };
      nextActions?: string[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.picked.map((s) => s.rid)).toEqual(['S1']);
    // Migration hint must NOT surface on the v1 success path.
    expect(
      envelope.nextActions?.some((a) => /v2 envelope/.test(a))
    ).toBe(false);
  });

  it('rejects a v2 decomposition file with a clear migration hint', async () => {
    const v2Envelope = {
      schemaVersion: 'v2',
      rid: 'rid-pick-v2',
      generatedAt: '2026-06-25T00:00:00.000Z',
      passes: [],
      crossPassEdges: [],
      llmArbitrations: [],
      codegraph: {
        nodes: 0,
        edges: 0,
        dbMB: 0,
        freshness: 'unindexed',
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
      partial: false
    };
    const decompDir = join(workdir, '.peaks', 'sc', 'slice-decomposition');
    mkdirSync(decompDir, { recursive: true });
    writeFileSync(
      join(decompDir, 'rid-pick-v2.json'),
      JSON.stringify(v2Envelope),
      'utf8'
    );

    const program = new Command();
    registerSliceCommands(program, {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t)
    });

    await program.parseAsync([
      'node', 'peaks', 'slice', 'pick', 'rid-pick-v2',
      '--project', workdir,
      '--json'
    ]);

    // v2 path: pick service MUST NOT be invoked.
    expect(pickSlicesInteractive).not.toHaveBeenCalled();

    // Error envelope surfaces both the v2 marker AND the migration hint.
    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      code?: string;
      message?: string;
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SLICE_PICK_FAILED');
    expect(envelope.message).toContain('v2 envelope');
    expect(envelope.message).toContain('without --granularity');

    // Exit code set so shells / CI can detect failure.
    expect(process.exitCode).toBe(1);
  });
});

/**
 * Unit tests for the W6 PickedFileRouter (`parsePickedFile`) extracted from
 * `peaks slice plan`. The previous code used a raw `JSON.parse(...)` + unchecked
 * `as { ... }` cast at slice-commands.ts:264, which let malformed envelopes
 * surface as opaque runtime errors. The new helper validates the envelope
 * shape and throws a CLI-friendly Error whose message always starts with
 * "picked envelope at" so the slice.plan catch can route the failure to
 * `PICKED_ENVELOPE_INVALID` instead of the generic `SLICE_PLAN_FAILED`.
 *
 * Two tiers of tests:
 *   1. Direct unit tests of `parsePickedFile` against staged fixtures.
 *   2. CLI integration tests that invoke `peaks slice plan <rid>` and assert
 *      the envelope code is `PICKED_ENVELOPE_INVALID` (malformed) or
 *      `ok: true` (valid).
 */
describe('parsePickedFile (W6 PickedFileRouter)', () => {
  let pickedRoot: string;

  beforeEach(() => {
    pickedRoot = mkdtempSync(join(tmpdir(), 'peaks-picked-router-'));
  });

  afterEach(() => {
    rmSync(pickedRoot, { recursive: true, force: true });
  });

  function writePickedJson(name: string, body: string | object): string {
    const path = join(pickedRoot, name);
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    return path;
  }

  it('parses a valid envelope and returns the matched object', () => {
    const path = writePickedJson('ok.json', {
      rid: 'rid-1',
      picked: [
        { rid: 'S1', files: ['src/a.ts', 'src/b.ts'], label: 'Slice 1' },
        { rid: 'S2', files: ['src/c.ts'], label: 'Slice 2' }
      ]
    });
    const result = parsePickedFile(path);
    expect(result.rid).toBe('rid-1');
    expect(result.picked).toHaveLength(2);
    expect(result.picked[0]?.rid).toBe('S1');
    expect(result.picked[0]?.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.picked[0]?.label).toBe('Slice 1');
    expect(result.picked[1]?.rid).toBe('S2');
  });

  it('throws when the envelope is missing the top-level rid field', () => {
    const path = writePickedJson('no-rid.json', {
      picked: [{ rid: 'S1', files: ['a.ts'], label: 'L' }]
    });
    expect(() => parsePickedFile(path)).Throw(/missing required string field 'rid'/);
  });

  it('throws when the envelope is missing the picked array', () => {
    const path = writePickedJson('no-picked.json', { rid: 'rid-1' });
    expect(() => parsePickedFile(path)).Throw(/missing required array field 'picked'/);
  });

  it('throws when picked is not an array', () => {
    const path = writePickedJson('picked-not-array.json', {
      rid: 'rid-1',
      picked: 'not-an-array'
    });
    expect(() => parsePickedFile(path)).Throw(/missing required array field 'picked'/);
  });

  it('throws when picked[i].files is empty', () => {
    const path = writePickedJson('empty-files.json', {
      rid: 'rid-1',
      picked: [{ rid: 'S1', files: [], label: 'L' }]
    });
    expect(() => parsePickedFile(path)).Throw(
      /missing or has empty required array field 'files'/
    );
  });

  it('throws when picked[i].files contains a non-string entry', () => {
    const path = writePickedJson('files-mixed.json', {
      rid: 'rid-1',
      picked: [{ rid: 'S1', files: ['a.ts', 42], label: 'L' }]
    });
    expect(() => parsePickedFile(path)).Throw(/must contain only strings/);
  });

  it('throws a JSON-parse-friendly error when the file is not valid JSON', () => {
    const path = writePickedJson('not-json.json', 'not-json{');
    expect(() => parsePickedFile(path)).Throw(/is not valid JSON/);
  });

  it('throws when the envelope is not a JSON object (e.g. a bare string)', () => {
    const path = writePickedJson('just-string.json', JSON.stringify('just a string'));
    expect(() => parsePickedFile(path)).Throw(/must be a JSON object/);
  });
});

/**
 * CLI integration tests for `peaks slice plan` after W6 PickedFileRouter.
 * Verifies the catch block in the slice.plan action routes malformed
 * envelopes to `PICKED_ENVELOPE_INVALID` and valid envelopes to a success
 * envelope with the planned entries.
 */
describe('peaks slice plan PickedFileRouter (CLI integration)', () => {
  it('returns PICKED_ENVELOPE_INVALID code and exit 1 for a malformed envelope', async () => {
    const decompDir = join(workdir, '.peaks', 'sc', 'slice-decomposition');
    mkdirSync(decompDir, { recursive: true });
    // Write a malformed -picked.json: missing the top-level `picked` array.
    // CLI looks for `<rid>-picked.json` (with the suffix).
    writeFileSync(
      join(decompDir, 'rid-bad-pick-picked.json'),
      JSON.stringify({ rid: 'rid-bad-pick' }),
      'utf8'
    );

    const program = new Command();
    registerSliceCommands(program, {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t)
    });

    await program.parseAsync([
      'node', 'peaks', 'slice', 'plan', 'rid-bad-pick',
      '--project', workdir,
      '--json'
    ]);

    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      code?: string;
      message?: string;
      nextActions?: string[];
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('PICKED_ENVELOPE_INVALID');
    expect(envelope.message).toContain('picked envelope at');
    // Targeted nextActions hint naming the expected schema shape.
    const hint = (envelope.nextActions ?? []).join('\n');
    expect(hint).toMatch(/picked\.json envelope matches the schema/);

    // Exit code set so shells / CI can detect failure.
    expect(process.exitCode).toBe(1);
  });

  it('returns ok:true and the planned entries for a valid envelope', async () => {
    const decompDir = join(workdir, '.peaks', 'sc', 'slice-decomposition');
    mkdirSync(decompDir, { recursive: true });
    writeFileSync(
      join(decompDir, 'rid-good-pick-picked.json'),
      JSON.stringify({
        rid: 'rid-good-pick',
        picked: [
          { rid: 'S1', files: ['src/a.ts'], label: 'Slice 1' },
          { rid: 'S2', files: ['src/b.ts', 'src/c.ts'], label: 'Slice 2' }
        ]
      }),
      'utf8'
    );

    const program = new Command();
    registerSliceCommands(program, {
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t)
    });

    await program.parseAsync([
      'node', 'peaks', 'slice', 'plan', 'rid-good-pick',
      '--project', workdir,
      '--json'
    ]);

    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      data?: {
        parentRid: string;
        plan: Array<{ newRid: string; type: string; files: string[]; label: string; dependsOn: string[] }>;
        apply: boolean;
      };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data?.parentRid).toBe('rid-good-pick');
    expect(envelope.data?.plan).toHaveLength(2);
    expect(envelope.data?.plan[0]?.newRid).toBe('rid-good-pick-1-S1');
    expect(envelope.data?.plan[0]?.files).toEqual(['src/a.ts']);
    expect(envelope.data?.plan[0]?.label).toBe('Slice 1');
    expect(envelope.data?.plan[0]?.dependsOn).toEqual([]);
    expect(envelope.data?.plan[1]?.dependsOn).toEqual(['S1']);
    expect(envelope.data?.apply).toBe(false);
  });
});