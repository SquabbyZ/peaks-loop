// Split out of `slice-commands.ts`:
// `peaks slice decompose <rid>`, the 6-stage slice-decomposition pipeline, plus
// the PRD-body reader and the two artifact writers it uses. The action was 124
// code lines with a complexity of 20; the v1/v2 arms are separate functions.
import type { Command } from 'commander';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { decomposeSlices } from '../../services/slice/slice-decompose-service.js';
import { decomposeSlicesWithBenchmark } from '../../services/slice/slice-benchmark-service.js';
import { decompose as multiPassDecompose } from '../../services/slice/multi-pass-orchestrator.js';
import { writeResult as writeSchemaResult } from '../../services/slice/schema-router.js';
import type { DecompositionResult } from '../../services/slice/slice-decompose-types.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readPrdBody,
  writeBenchmarkArtifact,
  writeDecompositionFile,
  type BenchmarkMetrics
} from './slice-decompose-artifacts.js';

const DECOMPOSE_DESCRIPTION =
  'Run the 6-stage slice-decomposition algorithm on a PRD. ' +
  'Inputs: PRD body + peaks codegraph (project analysis is codegraph-first; structural import edges are the fallback). ' +
  'Outputs: .peaks/sc/slice-decomposition/<rid>.json with critical-path, ' +
  'parallel-batches, and per-slice work estimates. ' +
  'Algorithm is fzf-free. Replay vs hand-derived 2.1.0 dry-run: +-10% on p50. ' +
  'Pass --benchmark to also emit a SliceBenchmark envelope (totalMs, codegraphQueries, ' +
  'p50ConfidenceDistribution, outputJsonBytes) and persist it under ' +
  '.peaks/_runtime/<sid>/benchmarks/<rid>.benchmark.json for cross-version comparison.';
const DECOMPOSE_PROJECT_HELP = 'target project root';
const DECOMPOSE_REFRESH_HELP = 're-run `peaks codegraph index` before reading';
const DECOMPOSE_BENCHMARK_HELP =
  'record per-run metrics and attach to the result envelope (2.1.1 algorithm optimization comparison)';
const DECOMPOSE_GRANULARITY_HELP =
  'service | file | both | auto. Default "both" keeps the v1 6-stage path; service / file / auto enable v2 multi-pass decomposition (peaks-loop 2.9+) and emit a DecompositionResultV2 envelope via SchemaRouter';
const DECOMPOSE_FAILED_HINTS: string[] = [
  'Verify codegraph is initialised (npx codegraph init && npx codegraph index), the rid is correct, and the PRD body is non-empty'
];

type DecomposeGranularity = 'service' | 'file' | 'both' | 'auto';

type SliceDecomposeOptions = {
  project: string;
  refresh?: boolean;
  benchmark?: boolean;
  granularity?: string;
  json?: boolean;
};

function isValidGranularity(value: string): value is DecomposeGranularity {
  return value === 'service' || value === 'file' || value === 'both' || value === 'auto';
}

function failInvalidGranularity(
  io: ProgramIO,
  rid: string,
  options: SliceDecomposeOptions,
  granularity: string
): void {
  printResult(
    io,
    fail(
      'slice.decompose',
      'SLICE_DECOMPOSE_FAILED',
      `Invalid --granularity '${granularity}'.`,
      { rid, projectRoot: options.project },
      [
        `--granularity accepts one of: service, file, both, auto`,
        `Default (omit the flag or pass "both") keeps the existing v1 path.`,
        `Non-default values (service / file / auto) enable v2 multi-pass decomposition (peaks-loop 2.9+).`
      ]
    ),
    options.json ?? false
  );
  process.exitCode = 1;
}

type DecomposeContext = {
  rid: string;
  prdMarkdown: string;
  projectRoot: string;
  options: SliceDecomposeOptions;
  io: ProgramIO;
};

async function runDecomposeV2(
  ctx: DecomposeContext,
  granularity: 'service' | 'file' | 'auto'
): Promise<void> {
  const { rid, prdMarkdown, projectRoot, options, io } = ctx;
  const v2Result = await multiPassDecompose(rid, prdMarkdown, projectRoot, {
    ...(options.refresh ? { refresh: true } : {}),
    granularity
  });
  const outDir = join(projectRoot, '.peaks', 'sc', 'slice-decomposition');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const outPath = join(outDir, `${rid}.json`);
  writeSchemaResult(outPath, v2Result);
  const nextActions: string[] = [
    `Decomposition (v2) written to ${outPath}`,
    `peaks slice pick/plan: v2 schemas require SchemaRouter-aware consumers (peaks-loop 2.9+).`
  ];
  printResult(
    io,
    ok('slice.decompose', { ...v2Result, outputPath: outPath }, [], nextActions),
    options.json ?? false
  );
}

function benchmarkNextAction(
  rid: string,
  benchmark: BenchmarkMetrics,
  projectRoot: string
): string {
  const benchPath = writeBenchmarkArtifact(rid, benchmark, projectRoot);
  return (
    `Benchmark: totalMs=${benchmark.totalMs} codegraphQueries=${benchmark.codegraphQueries} ` +
    `p50Conf={low:${benchmark.p50ConfidenceDistribution.low},mid:${benchmark.p50ConfidenceDistribution.mid},high:${benchmark.p50ConfidenceDistribution.high}} ` +
    `outputJsonBytes=${benchmark.outputJsonBytes}. Persisted to ${benchPath}`
  );
}

async function runDecomposeV1(ctx: DecomposeContext): Promise<void> {
  const { rid, prdMarkdown, projectRoot, options, io } = ctx;
  let result: DecompositionResult;
  let benchmark: BenchmarkMetrics | null = null;
  if (options.benchmark === true) {
    const out = await decomposeSlicesWithBenchmark(rid, prdMarkdown, projectRoot, {
      ...(options.refresh ? { refresh: true } : {})
    });
    result = out.result;
    benchmark = out.benchmark;
  } else {
    result = await decomposeSlices(rid, prdMarkdown, projectRoot, {
      ...(options.refresh ? { refresh: true } : {})
    });
  }
  const outPath = writeDecompositionFile(rid, result, projectRoot);
  const nextActions: string[] = [
    `Decomposition written to ${outPath}`,
    `Next: peaks slice pick ${rid}  (requires fzf >= 0.38)`,
    `Or manually craft -picked.json from the JSON output, then peaks slice plan ${rid}`
  ];
  if (result.pickHint) {
    nextActions.push(result.pickHint);
  }
  if (benchmark !== null) {
    nextActions.push(benchmarkNextAction(rid, benchmark, projectRoot));
  }
  printResult(
    io,
    ok(
      'slice.decompose',
      { ...result, outputPath: outPath, ...(benchmark !== null ? { benchmark } : {}) },
      [],
      nextActions
    ),
    options.json ?? false
  );
}

async function runSliceDecompose(
  rid: string,
  options: SliceDecomposeOptions,
  io: ProgramIO
): Promise<void> {
  // Validate --granularity BEFORE any I/O so invalid values fail fast with a
  // nextActions hint listing the four allowed strings.
  const granularity = options.granularity ?? 'both';
  if (!isValidGranularity(granularity)) {
    failInvalidGranularity(io, rid, options, granularity);
    return;
  }

  try {
    const projectRoot = resolveCanonicalProjectRoot(options.project);
    const prdMarkdown = readPrdBody(rid, projectRoot);
    const ctx: DecomposeContext = { rid, prdMarkdown, projectRoot, options, io };
    // Non-default granularity takes the v2 path; default ("both") keeps v1.
    if (granularity !== 'both') {
      await runDecomposeV2(ctx, granularity);
      return;
    }
    await runDecomposeV1(ctx);
  } catch (error) {
    printResult(
      io,
      fail(
        'slice.decompose',
        'SLICE_DECOMPOSE_FAILED',
        getErrorMessage(error),
        { rid, projectRoot: options.project },
        DECOMPOSE_FAILED_HINTS
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

export function registerSliceDecomposeCommand(slice: Command, io: ProgramIO): void {
  addJsonOption(
    slice
      .command('decompose <rid>')
      .description(DECOMPOSE_DESCRIPTION)
      .option('--project <path>', DECOMPOSE_PROJECT_HELP, '.')
      .option('--refresh', DECOMPOSE_REFRESH_HELP, false)
      .option('--benchmark', DECOMPOSE_BENCHMARK_HELP, false)
      .option('--granularity <value>', DECOMPOSE_GRANULARITY_HELP, 'both')
  ).action((rid: string, options: SliceDecomposeOptions) => runSliceDecompose(rid, options, io));
}
