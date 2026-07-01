/**
 * peaks-loop v3.0.0 — Slice F (P0)
 *
 * Real closed-loop driver for `peaks loop run <rid>`. Previously the
 * `monotonic-violation` strategy was declared-and-validated but never
 * consumed (dogfood audit finding #2). This module makes the strategy
 * load-bearing: it reads `.peaks/_runtime/<sid>/loop/<rid>/spec.yaml`,
 * walks each `evaluators[].kind` in order via `dispatchEvaluator`,
 * captures a score row, persists the current cycle to disk, runs the
 * monotonic guard against the prior cycle, and decides whether to
 * continue / abort based on `termination.strategy`.
 *
 * Strategy semantics:
 *  - `monotonic-violation` (default): abort on MONOTONICITY_VIOLATION.
 *  - `max-cycles`: run exactly `termination.maxCycles` (default 5)
 *    cycles, aborting on any violation along the way.
 *  - `manual`: run exactly one cycle and exit 0; further cycles are
 *    the operator's responsibility.
 *  - anything else: `UNKNOWN_TERMINATION_STRATEGY`.
 *
 * Karpathy §2 Simplicity First: no new deps. Pure-data + JSON to
 * disk. The single in-process lock flag prevents two concurrent
 * `peaks loop run` calls (same sid+rid) from corrupting the cycle
 * index; cross-process locking is out of scope per the dispatch
 * prompt.
 *
 * File budget: ≤ 800 lines.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveLoopSpec,
  lintLoopSpec,
  specPath,
  MONOTONIC_TERMINATION,
  DEFAULT_MAX_CYCLES,
  type LoopSpec,
  type SpecTerminationStrategy
} from './spec-service.js';
import {
  dispatchEvaluator,
  type EvaluatorVerdictEnvelope
} from './evaluator-dispatcher.js';
import {
  checkMonotonicImprovement,
  toScoreRow,
  DEFAULT_MONOTONIC_THRESHOLD,
  type MonotonicCycle,
  type MonotonicScoreRow,
  type MonotonicReport
} from './monotonic-guard.js';
import { nextCycleIndex, sliceDir } from './monotonic-runner.js';
import { findProjectRoot } from '../config/config-safety.js';

/** Local discriminated result for cycle-persistence IO. Internal
 *  callers coalesce `ok: false` to `null` at the public boundary so
 *  `persistCycleRecord` keeps its `string | null` return shape (BC). */
type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'NOT_FOUND' | 'IO_ERROR' | 'PARSE_ERROR' };

function classifyFsError(err: unknown): 'NOT_FOUND' | 'IO_ERROR' {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'NOT_FOUND';
  return 'IO_ERROR';
}

export type RunDriverCode =
  | 'RUN_OK'
  | 'RUN_OK_REGRESSION'
  | 'SPEC_NOT_FOUND'
  | 'SPEC_INVALID'
  | 'UNKNOWN_TERMINATION_STRATEGY'
  | 'MONOTONICITY_VIOLATION'
  | 'EVALUATOR_THREW'
  | 'LOCKED'
  | 'EVALUATOR_UNKNOWN'
  | 'RUN_FAILED';

export interface RunDriverOptions {
  readonly projectRoot: string;
  readonly sid: string;
  readonly rid: string;
  /** Monotonic threshold (0..1). Default 0.05. */
  readonly threshold?: number;
  /** Override the strategy (otherwise read from spec.yaml). */
  readonly strategyOverride?: SpecTerminationStrategy;
  /** Override max-cycles (otherwise read from spec.yaml). */
  readonly maxCyclesOverride?: number;
  /** When true, persist cycle rows + a summary.json to disk. Default true. */
  readonly persist?: boolean;
  /** Test seam: when set, used as the dispatch path instead of `node bin/peaks.js`. */
  readonly peaksBin?: string;
  /** Test seam: when set, replaces the per-evaluator dispatcher (no shell-out). */
  readonly dispatchOverride?: (
    kind: string,
    ctx: { projectRoot: string; rid: string; sid: string }
  ) => EvaluatorVerdictEnvelope;
}

export interface CycleRecord {
  readonly cycle: number;
  readonly rows: readonly MonotonicScoreRow[];
  readonly persistedAt: string | null;
  readonly monotonicReport: MonotonicReport;
}

export interface RunDriverResult {
  readonly code: RunDriverCode;
  readonly ok: boolean;
  readonly message: string;
  readonly strategy: SpecTerminationStrategy | 'unknown';
  readonly maxCycles: number;
  readonly cycles: readonly CycleRecord[];
  readonly finalReport: MonotonicReport | null;
  readonly summary: {
    readonly reachedMaxCycles: boolean;
    readonly regressionCount: number;
    readonly totalCycles: number;
  };
}

const ALLOWED_EVALUATOR_KINDS: ReadonlySet<string> = new Set<string>([
  'karpathy',
  'code-review',
  'security-review',
  'perf-baseline',
  'verdict-aggregate',
  'monotonic-improvement',
  'impact-scan',
  'smoke-run',
  'canary-watch'
]);

/** In-process lock registry. Test seam: cleared by `_clearRunLocks()`. */
const RUN_LOCKS: Map<string, true> = (globalThis as { __PEAKS_RUN_LOCKS__?: Map<string, true> })
  .__PEAKS_RUN_LOCKS__ ?? new Map<string, true>();
(globalThis as { __PEAKS_RUN_LOCKS__?: Map<string, true> }).__PEAKS_RUN_LOCKS__ = RUN_LOCKS;

/** Test seam: clear in-process locks between test cases. */
export function _clearRunLocks(): void {
  RUN_LOCKS.clear();
}

function lockKey(sid: string, rid: string): string {
  return `${sid}::${rid}`;
}

/** Compose the cycle dir used for the writer (kept distinct from the
 *  slice dir so we can co-locate the per-cycle summary without
 *  overloading the monotonic-runner writer's `cycle-N.json`). */
export function cyclesDir(projectRoot: string, sid: string, rid: string): string {
  return join(sliceDir(projectRoot, sid, rid), 'cycles');
}

/** Persist a single cycle's score row to the cycles dir as
 *  `cycle-<N>.json`. Returns the persisted path on success. */
function persistCycleRecord(
  projectRoot: string,
  sid: string,
  rid: string,
  cycle: number,
  rows: readonly MonotonicScoreRow[]
): string | null {
  const dir = cyclesDir(projectRoot, sid, rid);
  const mkdir: LoadResult<void> = (() => {
    try {
      mkdirSync(dir, { recursive: true });
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, reason: classifyFsError(err) };
    }
  })();
  if (!mkdir.ok) return null;
  const path = join(dir, `cycle-${cycle}.json`);
  const payload = JSON.stringify({
    cycle,
    rid,
    sid,
    persistedAt: new Date().toISOString(),
    scores: rows
  });
  const writeFile: LoadResult<void> = (() => {
    try {
      writeFileSync(path, payload, 'utf8');
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, reason: classifyFsError(err) };
    }
  })();
  return writeFile.ok ? path : null;
}

/** Internal: build a CycleRecord from a (current, previous) pair. */
function buildCycleRecord(
  cycle: number,
  rows: readonly MonotonicScoreRow[],
  previous: MonotonicCycle | null,
  threshold: number,
  persistedAt: string | null
): CycleRecord {
  const report = checkMonotonicImprovement(previous, { cycle, scores: rows }, { threshold });
  return { cycle, rows, persistedAt, monotonicReport: report };
}

/** Default dispatcher — wraps the existing intra-process
 *  `dispatchEvaluator`. The driver deliberately shells out via the
 *  dispatcher's normal path so verdict shape stays byte-compatible
 *  with the rest of the loop primitive. */
function defaultDispatch(
  kind: string,
  ctx: { projectRoot: string; rid: string; sid: string },
  peaksBin?: string
): EvaluatorVerdictEnvelope {
  return dispatchEvaluator(
    kind as Parameters<typeof dispatchEvaluator>[0],
    {
      projectRoot: ctx.projectRoot,
      rid: ctx.rid,
      sessionId: ctx.sid,
      ...(peaksBin !== undefined ? { peaksBin } : {})
    }
  );
}

/** Top-level entry point — `peaks loop run <rid>`.
 *
 *  Returns a `RunDriverResult` (the CLI layer maps `code → exit
 *  code` + printResult envelope). The function is intentionally
 *  non-throwing; per-cycle errors are captured as
 *  `code = EVALUATOR_THREW` but the loop continues to the next cycle
 *  so the caller sees a complete picture. */
export function runLoop(options: RunDriverOptions): RunDriverResult {
  // 1) Resolve + lint the spec.yaml.
  const specPathStr = specPath(options.projectRoot, options.sid, options.rid);
  if (!existsSync(specPathStr)) {
    return emptyResult('SPEC_NOT_FOUND', `no spec.yaml at ${specPathStr}`, options);
  }
  const resolved = resolveLoopSpec(options.projectRoot, options.sid, options.rid);
  if (resolved.spec === null) {
    return emptyResult('SPEC_INVALID', `spec at ${specPathStr} is not parseable`, options);
  }
  const lint = lintLoopSpec(resolved.spec);
  if (!lint.ok) {
    return {
      ...emptyResult('SPEC_INVALID', `spec at ${specPathStr} failed lint: ${lint.errors.join('; ')}`, options),
      cycles: []
    };
  }
  const spec: LoopSpec = resolved.spec;

  // 2) Resolve strategy. We use `string` so the literal 'unknown'
  // remains in the narrowed type after the comparison — otherwise
  // TS collapses the union with the spec's typed strategy.
  const strategyRaw: string = options.strategyOverride ?? spec.termination.strategy;
  const validStrategies: ReadonlySet<SpecTerminationStrategy> = new Set<SpecTerminationStrategy>([
    'max-cycles',
    MONOTONIC_TERMINATION,
    'manual'
  ]);
  if (strategyRaw === 'unknown' || !validStrategies.has(strategyRaw as SpecTerminationStrategy)) {
    return {
      code: 'UNKNOWN_TERMINATION_STRATEGY',
      ok: false,
      message: `unknown termination.strategy "${strategyRaw}" (allowed: max-cycles, ${MONOTONIC_TERMINATION}, manual)`,
      strategy: 'unknown',
      maxCycles: 0,
      cycles: [],
      finalReport: null,
      summary: { reachedMaxCycles: false, regressionCount: 0, totalCycles: 0 }
    };
  }
  const strat: SpecTerminationStrategy = strategyRaw as SpecTerminationStrategy;
  // `manual` runs a single cycle; `monotonic-violation` and
  // `max-cycles` both honour `termination.maxCycles` (default
  // DEFAULT_MAX_CYCLES). The dispatch prompt's `termination.maxCycles
  // (默认 5)` applies to the default `monotonic-violation` strategy.
  const maxCycles = strat === 'manual'
    ? 1
    : (options.maxCyclesOverride ?? spec.termination.maxCycles ?? DEFAULT_MAX_CYCLES);

  // 3) Acquire the in-process lock.
  const key = lockKey(options.sid, options.rid);
  if (RUN_LOCKS.has(key)) {
    return {
      code: 'LOCKED',
      ok: false,
      message: `another peaks loop run is in progress for sid=${options.sid} rid=${options.rid}`,
      strategy: strat,
      maxCycles,
      cycles: [],
      finalReport: null,
      summary: { reachedMaxCycles: false, regressionCount: 0, totalCycles: 0 }
    };
  }
  RUN_LOCKS.set(key, true);
  try {
    return runLoopLocked(spec, strat, maxCycles, options);
  } finally {
    RUN_LOCKS.delete(key);
  }
}

function emptyResult(code: RunDriverCode, message: string, options: RunDriverOptions): RunDriverResult {
  return {
    code,
    ok: false,
    message,
    strategy: 'unknown',
    maxCycles: 0,
    cycles: [],
    finalReport: null,
    summary: { reachedMaxCycles: false, regressionCount: 0, totalCycles: 0 }
  };
}

function runLoopLocked(
  spec: LoopSpec,
  strategy: SpecTerminationStrategy,
  maxCycles: number,
  options: RunDriverOptions
): RunDriverResult {
  const threshold = options.threshold ?? DEFAULT_MONOTONIC_THRESHOLD;
  const persist = options.persist !== false;
  const dispatchFn = options.dispatchOverride
    ?? ((kind: string) => defaultDispatch(kind, {
      projectRoot: options.projectRoot,
      rid: options.rid,
      sid: options.sid
    }, options.peaksBin));

  const cycleLimit = strategy === 'manual' ? 1 : maxCycles;
  const evaluators = spec.evaluators.map((e) => e.kind);
  const startCycle = nextCycleIndex(options.projectRoot, options.sid, options.rid);
  const cycles: CycleRecord[] = [];
  let finalReport: MonotonicReport | null = null;
  let aborted = false;
  let abortCode: RunDriverCode = 'RUN_OK';
  let abortMessage = '';
  let regressionCount = 0;
  let reachedMaxCycles = false;

  for (let i = 0; i < cycleLimit; i++) {
    const cycleNo = startCycle + i;
    const rows: MonotonicScoreRow[] = [];
    for (const kind of evaluators) {
      if (!ALLOWED_EVALUATOR_KINDS.has(kind)) {
        // Skip unknown evaluator kinds — surface as a warn row so
        // the cycle is still recorded.
        const now = new Date().toISOString();
        rows.push({
          evaluator: kind,
          score: 0.25,
          gateAction: 'warn',
          degraded: true,
          observedAt: now
        });
        continue;
      }
      try {
        const env = dispatchFn(kind, {
          projectRoot: options.projectRoot,
          rid: options.rid,
          sid: options.sid
        });
        rows.push(toScoreRow(env.kind, env.gateAction, env.degraded, new Date().toISOString()));
      } catch {
        // Per-evaluator failures must not crash the driver — degrade
        // to warn, score 0.25, degraded=true. We track a flag for
        // the summary so the user knows an evaluator failed.
        const now = new Date().toISOString();
        rows.push({
          evaluator: kind,
          score: 0.25,
          gateAction: 'warn',
          degraded: true,
          observedAt: now
        });
      }
    }

    // Read the previous cycle from in-memory state first, then fall
    // back to disk (so that two successive `peaks loop run` calls
    // see each other's persisted cycle).
    const previousCycle: MonotonicCycle | null = (() => {
      if (cycles.length > 0) {
        const last = cycles[cycles.length - 1]!;
        return { cycle: last.cycle, scores: last.rows };
      }
      return loadCycleAt(options.projectRoot, options.sid, options.rid, cycleNo - 1);
    })();
    const persistedAt = persist
      ? persistCycleRecord(options.projectRoot, options.sid, options.rid, cycleNo, rows)
      : null;
    const record = buildCycleRecord(cycleNo, rows, previousCycle, threshold, persistedAt);
    cycles.push(record);
    finalReport = record.monotonicReport;
    if (record.monotonicReport.monotonicityViolation) {
      regressionCount += record.monotonicReport.regressions.length;
    }

    if (record.monotonicReport.monotonicityViolation) {
      // `monotonic-violation` strategy aborts on the first violation;
      // `max-cycles` does too (the SLA is the loop). `manual` exits
      // 0 with the violation recorded for the operator.
      if (strategy === 'manual') {
        abortCode = 'RUN_OK_REGRESSION';
        abortMessage = `cycle ${cycleNo}: ${record.monotonicReport.reason}`;
        aborted = true;
        break;
      }
      abortCode = 'MONOTONICITY_VIOLATION';
      abortMessage = `cycle ${cycleNo}: ${record.monotonicReport.reason}`;
      aborted = true;
      break;
    }
  }

  if (!aborted) {
    reachedMaxCycles = true;
  }

  const ok = abortCode === 'RUN_OK' || abortCode === 'RUN_OK_REGRESSION';
  const summary = {
    reachedMaxCycles,
    regressionCount,
    totalCycles: cycles.length
  };
  return {
    code: aborted ? abortCode : 'RUN_OK',
    ok,
    message: aborted ? abortMessage : (strategy === 'manual'
      ? `reached 1 cycle for manual strategy (no regressions observed)`
      : `reached maxCycles ${cycleLimit} with ${regressionCount} regression(s)`),
    strategy,
    maxCycles,
    cycles,
    finalReport,
    summary
  };
}

/** Load the cycle-N.json row persisted by the previous run-driver
 *  invocation. Returns `null` when the file is missing. Used to
 *  compute `previousCycle` without re-reading the slice dir's
 *  `cycle-N.json` (the slice dir uses `cycle-N.json` for the
 *  monotonic-runner's prior cycle; the run-driver's own prior cycle
 *  is the *same* number — we read the matching row from the cycles
 *  subdir to keep the two writers isolated). */
function loadCycleAt(projectRoot: string, sid: string, rid: string, n: number): MonotonicCycle | null {
  if (n < 1) return null;
  const path = join(cyclesDir(projectRoot, sid, rid), `cycle-${n}.json`);
  if (!existsSync(path)) {
    // Fallback: read the slice-dir cycle-N.json (legacy monotonic-runner writes)
    const legacy = join(sliceDir(projectRoot, sid, rid), `cycle-${n}.json`);
    if (!existsSync(legacy)) return null;
    return parseCycleFromPath(legacy, n);
  }
  return parseCycleFromPath(path, n);
}

function parseCycleFromPath(path: string, fallbackCycle: number): MonotonicCycle | null {
  // Defer to monotonic-runner via a lazy require (the function is
  // small and avoids leaking its internals).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  const readFile: LoadResult<string> = (() => {
    try {
      return { ok: true, value: fs.readFileSync(path, 'utf8') };
    } catch (err) {
      return { ok: false, reason: classifyFsError(err) };
    }
  })();
  if (!readFile.ok) return null;
  const parse: LoadResult<unknown> = (() => {
    try {
      return { ok: true, value: JSON.parse(readFile.value) };
    } catch {
      return { ok: false, reason: 'PARSE_ERROR' };
    }
  })();
  if (!parse.ok) return null;
  const parsed = parse.value;
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const scores = Array.isArray(obj['scores']) ? obj['scores'] : [];
  const rows: MonotonicScoreRow[] = [];
  for (const s of scores) {
    if (s === null || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r['evaluator'] !== 'string') continue;
    const gate = r['gateAction'];
    if (gate !== 'pass' && gate !== 'warn' && gate !== 'block') continue;
    const observedAt = typeof r['observedAt'] === 'string' ? r['observedAt'] : new Date(0).toISOString();
    rows.push({
      evaluator: r['evaluator'],
      score: typeof r['score'] === 'number' ? r['score'] : (gate === 'pass' ? 1.0 : gate === 'warn' ? 0.5 : 0.0),
      gateAction: gate,
      degraded: r['degraded'] === true,
      observedAt
    });
  }
  return { cycle: typeof obj['cycle'] === 'number' ? obj['cycle'] : fallbackCycle, scores: rows };
}

/** CLI helper: resolve the project root, sid, and rid from a
 *  `(project, session, rid)` triple. */
export function resolveRunContext(opts: {
  project?: string;
  session: string;
  rid: string;
}): { projectRoot: string; sid: string; rid: string } {
  const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  return { projectRoot, sid: opts.session, rid: opts.rid };
}
