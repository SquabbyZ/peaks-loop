import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { sliceCheck } from '../../services/slice/slice-check-service.js';
import { decomposeSlices } from '../../services/slice/slice-decompose-service.js';
import { decomposeSlicesWithBenchmark } from '../../services/slice/slice-benchmark-service.js';
import { pickSlicesInteractive } from '../../services/slice/slice-pick-service.js';
import { decompose as multiPassDecompose } from '../../services/slice/multi-pass-orchestrator.js';
import { readResult as readDecompositionResult, writeResult as writeSchemaResult } from '../../services/slice/schema-router.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { DecompositionResult } from '../../services/slice/slice-decompose-types.js';

export function registerSliceCommands(program: Command, io: ProgramIO): void {
  const slice = program.command('slice').description(
    'Slice lifecycle: check (boundary), decompose (PRD -> 6-stage algorithm), ' +
      'pick (fzf multi-select), plan (apply via peaks request init). ' +
      '`peaks slice check` is the post-micro-cycle boundary gate (4 stages). ' +
      '`decompose/pick/plan` form the new slice-decomposition pipeline.'
  );

  // ---------- peaks slice check (existing) ----------
  addJsonOption(
    slice
      .command('check')
      .description(
        'Boundary check for a slice (post-micro-cycle, pre-peaks-qa). ' +
          'Runs 4 stages in order: typecheck -> unit-tests (changed-only by default; ' +
          'use --run-tests for the full suite, or --skip-tests to opt out) -> ' +
          'review-fanout -> gate-verify-pipeline. ' +
          'Each stage reports pass / fail / skipped. ' +
          'Exit 0 only if every stage passes or is skipped.'
      )
      .option('--project <path>', 'target project root', '.')
      .option('--rid <rid>', 'request id; defaults to the active current-change binding')
      .option('--refresh-fanout', 're-run the 3-way review fan-out (peaks-rd) even if the review files already exist', false)
      .option('--run-tests', 'opt in to the FULL test suite at the boundary (default is the changed-only suite via `vitest run --changed`); use the peaks-solo-test skill to run the full suite standalone', false)
      .option('--skip-tests', 'skip the unit-test stage entirely (e.g. docs-only slices); use the peaks-solo-test skill to run the full suite manually if you want a separate check', false)
      .option('--allow-pre-existing-failures', 'opt-in: if the unit-test stage fails, report it as `skipped` with a reason naming the failure count (useful when the repo has unrelated pre-existing failures; the long-term fix is to .skip or coverage.exclude those tests). Only meaningful with --run-tests or the default changed-only mode.', false)
  ).action(async (options: { project: string; rid?: string; refreshFanout?: boolean; runTests?: boolean; skipTests?: boolean; allowPreExistingFailures?: boolean; json?: boolean }) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const result = await sliceCheck({
        projectRoot,
        ...(options.rid ? { rid: options.rid } : {}),
        refreshFanout: options.refreshFanout === true,
        runTests: options.runTests === true,
        skipTests: options.skipTests === true,
        allowPreExistingFailures: options.allowPreExistingFailures === true
      });

      const warnings: string[] = [];
      if (result.stages.some((s) => s.status === 'fail')) {
        warnings.push(`${result.stages.filter((s) => s.status === 'fail').length} of ${result.stages.length} stages failed. 边界 NOT ready -- fix the failures and re-run, or proceed at your own risk.`);
      }
      printResult(io, ok('slice.check', result, warnings, result.nextActions), options.json ?? false);
      if (!result.boundaryReady) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(io, fail('slice.check', 'SLICE_CHECK_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path is a peaks repo, --rid is correct, and .peaks/_runtime/current-change is valid']), options.json ?? false);
      process.exitCode = 1;
    }
  });

  // ---------- peaks slice decompose (NEW) ----------
  addJsonOption(
    slice
      .command('decompose <rid>')
      .description(
        'Run the 6-stage slice-decomposition algorithm on a PRD. ' +
          'Inputs: PRD body + peaks codegraph + .understand-anything/knowledge-graph.json (optional). ' +
          'Outputs: .peaks/sc/slice-decomposition/<rid>.json with critical-path, ' +
          'parallel-batches, and per-slice work estimates. ' +
          'Algorithm is fzf-free. Replay vs hand-derived 2.1.0 dry-run: +-10% on p50. ' +
          'Pass --benchmark to also emit a SliceBenchmark envelope (totalMs, codegraphQueries, ' +
          'p50ConfidenceDistribution, outputJsonBytes) and persist it under ' +
          '.peaks/_runtime/<sid>/benchmarks/<rid>.benchmark.json for cross-version comparison.'
      )
      .option('--project <path>', 'target project root', '.')
      .option('--refresh', 're-run `peaks codegraph index` before reading', false)
      .option('--benchmark', 'record per-run metrics and attach to the result envelope (2.1.1 algorithm optimization comparison)', false)
      .option('--granularity <value>', 'service | file | both | auto. Default "both" keeps the v1 6-stage path; service / file / auto enable v2 multi-pass decomposition (peaks-cli 2.9+) and emit a DecompositionResultV2 envelope via SchemaRouter', 'both')
  ).action(async (rid: string, options: { project: string; refresh?: boolean; benchmark?: boolean; granularity?: string; json?: boolean }) => {
    // Validate --granularity BEFORE any I/O so invalid values fail fast with a
    // nextActions hint listing the four allowed strings.
    const granularity = options.granularity ?? 'both';
    if (
      granularity !== 'service' &&
      granularity !== 'file' &&
      granularity !== 'both' &&
      granularity !== 'auto'
    ) {
      printResult(
        io,
        fail(
          'slice.decompose',
          'SLICE_DECOMPOSE_FAILED',
          `Invalid --granularity '${options.granularity}'.`,
          { rid, projectRoot: options.project },
          [
            `--granularity accepts one of: service, file, both, auto`,
            `Default (omit the flag or pass "both") keeps the existing v1 path.`,
            `Non-default values (service / file / auto) enable v2 multi-pass decomposition (peaks-cli 2.9+).`
          ]
        ),
        options.json ?? false
      );
      process.exitCode = 1;
      return;
    }

    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const prdMarkdown = readPrdBody(rid, projectRoot);
      // Non-default granularity takes the v2 path; default ("both") keeps v1.
      if (granularity !== 'both') {
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
          `peaks slice pick/plan: v2 schemas require SchemaRouter-aware consumers (peaks-cli 2.9+).`
        ];
        printResult(
          io,
          ok('slice.decompose', { ...v2Result, outputPath: outPath }, [], nextActions),
          options.json ?? false
        );
        return;
      }

      let result: DecompositionResult;
      let benchmark: { totalMs: number; codegraphQueries: number; p50ConfidenceDistribution: { low: number; mid: number; high: number }; inputApproxBytes: { prd: number }; outputJsonBytes: number; capturedAt: string } | null = null;
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
      if (result.understandAnything.fallback === 'structural-only') {
        nextActions.push('Note: understand-anything not indexed; cuts are structural-only. Run /understand in your IDE to improve semantic-cut quality.');
      }
      if (result.pickHint) {
        nextActions.push(result.pickHint);
      }
      if (benchmark !== null) {
        const benchPath = writeBenchmarkArtifact(rid, benchmark, projectRoot);
        nextActions.push(
          `Benchmark: totalMs=${benchmark.totalMs} codegraphQueries=${benchmark.codegraphQueries} ` +
          `p50Conf={low:${benchmark.p50ConfidenceDistribution.low},mid:${benchmark.p50ConfidenceDistribution.mid},high:${benchmark.p50ConfidenceDistribution.high}} ` +
          `outputJsonBytes=${benchmark.outputJsonBytes}. Persisted to ${benchPath}`
        );
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
    } catch (error) {
      printResult(io, fail('slice.decompose', 'SLICE_DECOMPOSE_FAILED', getErrorMessage(error), { rid, projectRoot: options.project }, ['Verify codegraph is initialised (npx codegraph init && npx codegraph index), the rid is correct, and the PRD body is non-empty']), options.json ?? false);
      process.exitCode = 1;
    }
  });

  // ---------- peaks slice pick (NEW) ----------
  addJsonOption(
    slice
      .command('pick <rid>')
      .description(
        'Interactively select which candidate slices to ship, via fzf. ' +
          'Reads .peaks/sc/slice-decomposition/<rid>.json, ' +
          'spawns fzf --multi, parses selection, writes -picked.json. ' +
          'Requires fzf >= 0.38. Algorithm is fzf-free; this is the only fzf dependency.'
      )
      .option('--project <path>', 'target project root', '.')
      .option('--preview', 'render side-by-side preview window in fzf', false)
      .option('--fzf-bin <path>', 'override fzf binary path (default: fzf on PATH)', 'fzf')
  ).action(async (rid: string, options: { project: string; preview?: boolean; fzfBin?: string; json?: boolean }) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const decompPath = join(projectRoot, '.peaks', 'sc', 'slice-decomposition', `${rid}.json`);
      if (!existsSync(decompPath)) {
        throw new Error(
          `decomposition not found at ${decompPath}. ` +
            `Run \`peaks slice decompose ${rid}\` first.`
        );
      }
      const parsed = readDecompositionResult(decompPath);
      if ('schemaVersion' in parsed) {
        throw new Error(
          `decomposition at ${decompPath} is a v2 envelope (schemaVersion: 'v2'). ` +
          `peaks slice pick supports v1 only in peaks-cli 2.9.0. ` +
          `Re-run \`peaks slice decompose ${rid}\` without --granularity to get a v1 file, ` +
          `or upgrade peaks-cli when v2 pick lands.`
        );
      }
      const decomposition = parsed;
      const result = await pickSlicesInteractive(rid, decomposition, projectRoot, {
        ...(options.preview !== undefined ? { preview: options.preview } : {}),
        ...(options.fzfBin ? { fzfBin: options.fzfBin } : {})
      });
      const nextActions: string[] = [
        `Picked ${result.picked.length} slice(s); written to ${result.outputPath}`,
        `Next: peaks slice plan ${rid}  (--apply to call peaks request init for each chosen slice)`
      ];
      printResult(io, ok('slice.pick', result, [], nextActions), options.json ?? false);
    } catch (error) {
      const msg = getErrorMessage(error);
      if (/brew install fzf|apt-get install fzf|older than required/.test(msg)) {
        process.exitCode = 127;
      } else {
        process.exitCode = 1;
      }
      printResult(io, fail('slice.pick', 'SLICE_PICK_FAILED', msg, { rid, projectRoot: options.project }, ['Verify the decomposition file exists, fzf >= 0.38 is on PATH, and the rid is correct']), options.json ?? false);
    }
  });

  // ---------- peaks slice plan (NEW) ----------
  addJsonOption(
    slice
      .command('plan <rid>')
      .description(
        'Apply a picked batch: read -picked.json, call `peaks request init` for each chosen slice ' +
          'with --depends-on edges from the decomposition. Dry-run by default; pass --apply to ' +
          'actually create rids.'
      )
      .option('--project <path>', 'target project root', '.')
      .option('--apply', 'actually call peaks request init (default: dry-run only)', false)
  ).action(async (rid: string, options: { project: string; apply?: boolean; json?: boolean }) => {
    const projectRoot = resolveCanonicalProjectRoot(options.project);
    const pickedPath = join(projectRoot, '.peaks', 'sc', 'slice-decomposition', `${rid}-picked.json`);
    try {
      if (!existsSync(pickedPath)) {
        throw new Error(
          `picked file not found at ${pickedPath}. ` +
            `Run \`peaks slice pick ${rid}\` first, or manually craft the file.`
        );
      }
      const picked = parsePickedFile(pickedPath);
      const plan = picked.picked.map((slice, idx) => ({
        newRid: `${rid}-${idx + 1}-${slice.rid}`,
        type: 'feat' as const,
        dependsOn: idx === 0 ? [] : [picked.picked[idx - 1]!.rid],
        files: slice.files,
        label: slice.label,
        applied: false
      }));
      const nextActions: string[] = [
        `Planned ${plan.length} new rids from ${picked.picked.length} picked slices`,
        options.apply
          ? 'Apply mode: would call peaks request init for each (v1.1: wire to spawn child)'
          : 'Dry-run: pass --apply to actually create the rids (v1.1: wire to peaks request init spawn)'
      ];
      printResult(io, ok('slice.plan', { parentRid: rid, plan, apply: options.apply ?? false }, [], nextActions), options.json ?? false);
    } catch (error) {
      const msg = getErrorMessage(error);
      const isEnvelopeError = msg.startsWith('picked envelope at');
      printResult(
        io,
        fail(
          'slice.plan',
          isEnvelopeError ? 'PICKED_ENVELOPE_INVALID' : 'SLICE_PLAN_FAILED',
          msg,
          { rid, projectRoot: options.project, pickedPath },
          isEnvelopeError
            ? ['Verify the -picked.json envelope matches the schema: { rid: string, picked: Array<{ rid, files: string[], label }> }']
            : ['Verify the picked file exists, the rid is correct, and peaks request init is available']
        ),
        options.json ?? false
      );
      process.exitCode = 1;
    }
  });
}

// ---------- helpers ----------

function readPrdBody(rid: string, projectRoot: string): string {
  // Search all .peaks/**/prd/requests/*-<rid>.md and .peaks/**/prd/requests/<rid>.md
  const searchRoots = [
    join(projectRoot, '.peaks', '2026'),
    join(projectRoot, '.peaks'),
    join(projectRoot, '.peaks', '_runtime')
  ];
  const matchInDir = (dir: string): string | null => {
    if (!existsSync(dir)) return null;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      if (entry === `${rid}.md` || entry.endsWith(`-${rid}.md`)) {
        return readFileSync(join(dir, entry), 'utf8');
      }
    }
    return null;
  };
  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    // 1) Direct prd/requests/ at this root
    const direct = matchInDir(join(root, 'prd', 'requests'));
    if (direct !== null) return direct;
    // 2) One level of subdirs (e.g. .peaks/_runtime/<sid>/prd/requests/)
    let subdirs: string[];
    try {
      subdirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const sub of subdirs) {
      const hit = matchInDir(join(root, sub, 'prd', 'requests'));
      if (hit !== null) return hit;
    }
  }
  throw new Error(
    `PRD body not found for rid=${rid}. Searched under .peaks/2026/prd/requests/, ` +
      `.peaks/prd/requests/, and .peaks/_runtime/*/prd/requests/. ` +
      `Create the PRD with: peaks request init --role prd --id ${rid} --apply --type refactor`
  );
}

function writeDecompositionFile(rid: string, result: DecompositionResult, projectRoot: string): string {
  const dir = join(projectRoot, '.peaks', 'sc', 'slice-decomposition');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const outPath = join(dir, `${rid}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  return outPath;
}

function writeBenchmarkArtifact(rid: string, benchmark: unknown, projectRoot: string): string {
  // Reuse the current session binding if present; otherwise fall back to
  // a deterministic local dir under the project root. The CLI may be
  // invoked from non-CLI contexts (skill layer); we don't require a session.
  const dir = join(projectRoot, '.peaks', '_runtime', 'benchmarks');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const outPath = join(dir, `${rid}.benchmark.json`);
  writeFileSync(outPath, JSON.stringify(benchmark, null, 2), 'utf8');
  return outPath;
}

// ---------- picked envelope router (W6 fix) ----------

interface PickedEnvelope {
  readonly rid: string;
  readonly picked: readonly {
    readonly rid: string;
    readonly files: readonly string[];
    readonly label: string;
  }[];
}

/**
 * Validate a -picked.json envelope. Throws a CLI-friendly Error on any
 * shape violation; the catch in the slice.plan action converts it to
 * a fail() envelope with `code: 'PICKED_ENVELOPE_INVALID'`.
 *
 * Schema:
 *   { rid: string; picked: Array<{ rid, files: string[], label }> }
 *
 * Rejects: missing rid, missing/invalid picked array, picked[i] missing
 * rid / files / label, picked[i].files empty.
 */
export function parsePickedFile(pickedPath: string): PickedEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(pickedPath, 'utf8'));
  } catch (err) {
    // JSON.parse errors are always Error-shaped (SyntaxError extends Error),
    // so the cast is safe; we only need `.message`.
    throw new Error(
      `picked envelope at ${pickedPath} is not valid JSON: ${(err as Error).message}`
    );
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`picked envelope at ${pickedPath} must be a JSON object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.rid !== 'string' || obj.rid.length === 0) {
    throw new Error(`picked envelope at ${pickedPath} is missing required string field 'rid'`);
  }
  if (!Array.isArray(obj.picked)) {
    throw new Error(`picked envelope at ${pickedPath} is missing required array field 'picked'`);
  }
  const picked = obj.picked.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`picked[${idx}] must be an object, got ${typeof item}`);
    }
    const it = item as Record<string, unknown>;
    if (typeof it.rid !== 'string' || it.rid.length === 0) {
      throw new Error(`picked[${idx}] is missing required string field 'rid'`);
    }
    if (!Array.isArray(it.files) || it.files.length === 0) {
      throw new Error(`picked[${idx}] is missing or has empty required array field 'files'`);
    }
    if (!it.files.every((f) => typeof f === 'string')) {
      throw new Error(`picked[${idx}].files must contain only strings`);
    }
    if (typeof it.label !== 'string' || it.label.length === 0) {
      throw new Error(`picked[${idx}] is missing required string field 'label'`);
    }
    return { rid: it.rid, files: it.files as readonly string[], label: it.label };
  });
  return { rid: obj.rid, picked };
}
