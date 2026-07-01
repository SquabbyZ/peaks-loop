/**
 * peaks-loop v3.0.0 — Slice C.1
 *
 * Monotonic-improvement guard for the loop runtime. Compares adjacent
 * cycles' per-evaluator scores (rescaled gateAction → 0..1) and
 * returns a structured envelope indicating:
 *
 *   - status: 'pass' | 'warn' | 'block' | 'skip'
 *   - regressions: per-evaluator score deltas where current < previous
 *   - reason: human-readable summary
 *
 * Karpathy §2 Simplicity First: pure function, no IO, no new deps.
 *
 * File budget: ≤ 800 lines (Karpathy §2).
 */

/** Score normalisation — gateAction maps to a 0..1 score:
 *    pass  → 1.0
 *    warn  → 0.5
 *    block → 0.0
 *
 *  `degraded` (evaluator fell back to stub) collapses to 0.25 so the
 *  guard never regresses past the boundary value; downstream callers
 *  can surface `degraded` separately.
 */
function gateActionToScore(
  gateAction: 'pass' | 'warn' | 'block',
  degraded: boolean
): number {
  if (degraded) return 0.25;
  if (gateAction === 'pass') return 1.0;
  if (gateAction === 'warn') return 0.5;
  return 0.0;
}

/** Strict-greater-than with a small epsilon to absorb FP rounding
 *  (e.g. 1.0 - 0.95 = 0.04999999…). The boundary at exactly
 *  threshold stays a pass. */
const DELTA_EPSILON = 1e-9;

/** Per-evaluator score row, derived from an `EvaluatorVerdictEnvelope`. */
export interface MonotonicScoreRow {
  readonly evaluator: string;
  readonly score: number;
  readonly gateAction: 'pass' | 'warn' | 'block';
  readonly degraded: boolean;
  /** ISO-8601 timestamp the verdict was recorded. */
  readonly observedAt: string;
}

/** Cycle index — a single attempt at the loop. */
export interface MonotonicCycle {
  readonly cycle: number;
  /** Per-evaluator score rows. Same evaluator appearing twice collapses
   *  to the last entry (BC: deterministic, no merging surprises). */
  readonly scores: readonly MonotonicScoreRow[];
}

export interface MonotonicRegression {
  readonly evaluator: string;
  readonly previousScore: number;
  readonly currentScore: number;
  readonly delta: number;
}

/** Result of a `checkMonotonicImprovement` call. */
export interface MonotonicReport {
  readonly status: 'pass' | 'warn' | 'block' | 'skip';
  readonly ok: boolean;
  readonly reason: string;
  readonly threshold: number;
  readonly previousCycle: number | null;
  readonly currentCycle: number;
  /** Per-evaluator regressions exceeding the threshold (sorted by |delta| desc). */
  readonly regressions: readonly MonotonicRegression[];
  /** Convenience boolean — true iff a regression exceeds the threshold. */
  readonly monotonicityViolation: boolean;
  /** Diagnostic hint surfaced as `MONOTONICITY_VIOLATION` in the CLI envelope. */
  readonly code: 'MONOTONIC_OK' | 'MONOTONIC_NO_PREVIOUS' | 'MONOTONIC_VIOLATION' | 'MONOTONIC_INCOMPARABLE_EVALUATORS';
}

/** Convert an envelope-shaped verdict row to `MonotonicScoreRow`.
 *  Pure helper, exported for the CLI layer. */
export function toScoreRow(
  evaluator: string,
  gateAction: 'pass' | 'warn' | 'block',
  degraded: boolean,
  observedAtIso = new Date(0).toISOString()
): MonotonicScoreRow {
  return {
    evaluator,
    score: gateActionToScore(gateAction, degraded),
    gateAction,
    degraded,
    observedAt: observedAtIso
  };
}

/** Default threshold = 5% of [0,1] scale → 0.05. */
export const DEFAULT_MONOTONIC_THRESHOLD = 0.05;

export interface CheckMonotonicOptions {
  /** Maximum regression permitted (in [0,1] scale). Default 0.05 (5%). */
  readonly threshold?: number;
  /** When provided, the guard logs the cycle id this report refers to. */
  readonly nowIso?: string;
}

/** Compare `previous` against `current` and report monotonicity.
 *
 *  Rules (reflected in `tests/unit/loop/monotonic-guard.test.ts`):
 *    - missing previous cycle → skip (`MONOTONIC_NO_PREVIOUS`)
 *    - evaluators not present in both cycles → skip that evaluator
 *    - score unchanged / up → ok
 *    - score ↓ ≤ threshold → ok
 *    - score ↓ > threshold → regression row + status 'block'
 *      with `code = MONOTONICITY_VIOLATION`.
 */
export function checkMonotonicImprovement(
  previous: MonotonicCycle | null,
  current: MonotonicCycle,
  options: CheckMonotonicOptions = {}
): MonotonicReport {
  const threshold = options.threshold ?? DEFAULT_MONOTONIC_THRESHOLD;
  const at = options.nowIso ?? new Date().toISOString();

  if (previous === null) {
    return {
      status: 'skip',
      ok: true,
      reason: 'no previous cycle recorded — monotonicity check is a no-op (first run is allowed to start anywhere)',
      threshold,
      previousCycle: null,
      currentCycle: current.cycle,
      regressions: [],
      monotonicityViolation: false,
      code: 'MONOTONIC_NO_PREVIOUS'
    };
  }

  // Build previous evaluator → score lookup.
  const prevMap = new Map<string, MonotonicScoreRow>();
  for (const row of previous.scores) prevMap.set(row.evaluator, row);

  const regressions: MonotonicRegression[] = [];
  let comparable = 0;
  for (const cur of current.scores) {
    const prev = prevMap.get(cur.evaluator);
    if (prev === undefined) continue; // incomparable evaluator → skip
    comparable++;
    const delta = prev.score - cur.score; // positive = regression
    if (delta > threshold + DELTA_EPSILON) {
      regressions.push({
        evaluator: cur.evaluator,
        previousScore: prev.score,
        currentScore: cur.score,
        delta: round4(delta)
      });
    }
  }

  regressions.sort((a, b) => b.delta - a.delta);

  if (comparable === 0) {
    return {
      status: 'skip',
      ok: true,
      reason: 'no evaluator appears in both the previous and current cycle — nothing to compare',
      threshold,
      previousCycle: previous.cycle,
      currentCycle: current.cycle,
      regressions: [],
      monotonicityViolation: false,
      code: 'MONOTONIC_INCOMPARABLE_EVALUATORS'
    };
  }

  if (regressions.length > 0) {
    const summary = regressions
      .map((r) => `${r.evaluator} ${r.previousScore.toFixed(4)}→${r.currentScore.toFixed(4)} (Δ=${r.delta.toFixed(4)})`)
      .join(', ');
    return {
      status: 'block',
      ok: false,
      reason: `MONOTONICITY_VIOLATION: ${regressions.length} evaluator(s) regressed beyond threshold ${threshold} (at ${at}): ${summary}`,
      threshold,
      previousCycle: previous.cycle,
      currentCycle: current.cycle,
      regressions,
      monotonicityViolation: true,
      code: 'MONOTONIC_VIOLATION'
    };
  }

  return {
    status: 'pass',
    ok: true,
    reason: `all ${comparable} evaluators held or improved (threshold ${threshold})`,
    threshold,
    previousCycle: previous.cycle,
    currentCycle: current.cycle,
    regressions: [],
    monotonicityViolation: false,
    code: 'MONOTONIC_OK'
  };
}

/** Local discriminated result for cross-session IO. Callers coalesce
 *  `ok: false` to `null` at the boundary so the public
 *  `loadCrossSessionSignal` signature stays `MonotonicCycle | null`
 *  (BC — `monotonic-guard.test.ts` asserts on `null` literally). */
type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'NOT_FOUND' | 'IO_ERROR' | 'PARSE_ERROR' };

function classifyFsError(err: unknown): 'NOT_FOUND' | 'IO_ERROR' {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'NOT_FOUND';
  return 'IO_ERROR';
}

/** Read `.peaks/_sub_agents/<sid>/shared/` cross-session signal — on
 *  any IO error, return `null` so the guard never crashes on missing
 *  cross-batch signal (per Slice C (b) case "跨 session 读
 *  .peaks/_sub_agents/<sid>/shared/ 跨批 signal → 不 crash").
 *  Pure helper; only present for the cross-session case. */
export function loadCrossSessionSignal(
  projectRoot: string,
  sid: string
): MonotonicCycle | null {
  // Lazily import so unit tests in non-windows environments don't pull
  // node:fs through a static `import` (test envs stay small).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const sharedDir = path.join(projectRoot, '.peaks', '_sub_agents', sid, 'shared');
  const readdir: LoadResult<string[]> = (() => {
    try {
      return { ok: true, value: fs.readdirSync(sharedDir) };
    } catch (err) {
      return { ok: false, reason: classifyFsError(err) };
    }
  })();
  if (!readdir.ok) return null; // missing dir or permission denied — both are no-ops.
  const entries = readdir.value;
  // Pick the highest cycle number from the filenames; tolerate garbage.
  let best: number | null = null;
  for (const entry of entries) {
    const m = entry.match(/^cycle-(\d+)\.json$/);
    if (m === null) continue;
    const cycle = parseInt(m[1] ?? '0', 10);
    if (best === null || cycle > best) best = cycle;
  }
  if (best === null) return null;
  const target = path.join(sharedDir, `cycle-${best}.json`);
  const readFile: LoadResult<string> = (() => {
    try {
      return { ok: true, value: fs.readFileSync(target, 'utf8') };
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
  const cycleNo = typeof obj['cycle'] === 'number' ? obj['cycle'] : best;
  const scoresRaw = Array.isArray(obj['scores']) ? obj['scores'] : [];
  const scores: MonotonicScoreRow[] = [];
  for (const s of scoresRaw) {
    if (s === null || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r['evaluator'] !== 'string') continue;
    const gate = r['gateAction'];
    if (gate !== 'pass' && gate !== 'warn' && gate !== 'block') continue;
    const observedAt = typeof r['observedAt'] === 'string' ? r['observedAt'] : new Date(0).toISOString();
    const degraded = r['degraded'] === true;
    scores.push({
      evaluator: r['evaluator'],
      score: typeof r['score'] === 'number' ? r['score'] : gateActionToScore(gate, degraded),
      gateAction: gate,
      degraded,
      observedAt
    });
  }
  return { cycle: cycleNo, scores };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
