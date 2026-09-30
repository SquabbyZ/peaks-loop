/**
 * Monotonic-runner type + constant surface — moved VERBATIM out of
 * `monotonic-runner.ts` for the 300-raw-line cap (slice
 * `b1-filesplit-campaign`, wave 3C). The only code is
 * `classifyFsError`, a pure error-tag helper carried across verbatim; beside
 * it sit the local IO result union, the cycle-line tag/type, the
 * walked-evaluator set, and the public options/result interfaces.
 * `monotonic-runner.ts` re-exports the public names, so existing import
 * paths keep working.
 */
import type { MonotonicReport, MonotonicScoreRow } from './monotonic-guard.js';

/** Local discriminated result for IO. Internal callers coalesce
 *  `ok: false` to `null` so the public `loadPreviousCycle`
 *  signature stays `MonotonicCycle | null` (BC — see
 *  `monotonic-guard.test.ts:199`). */
export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'NOT_FOUND' | 'IO_ERROR' | 'PARSE_ERROR' };

export function classifyFsError(err: unknown): 'NOT_FOUND' | 'IO_ERROR' {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'NOT_FOUND';
  return 'IO_ERROR';
}

/** Tag for cycle lines in the jsonl-store. */
export const MONOTONIC_CYCLE_KIND = 'monotonic-cycle';

export interface MonotonicCycleLine {
  readonly kind: typeof MONOTONIC_CYCLE_KIND;
  readonly rid: string;
  readonly cycle: number;
  readonly persistedAt: string;
  readonly scores: readonly MonotonicScoreRow[];
}

/** Set of evaluator kinds the loop walker actually scores — keeps the
 *  guard surface tight (the verdict-aggregate is the cross-source merge
 *  and not a per-cycle input). */
export const WALKED_EVALUATORS = [
  'karpathy',
  'code-review',
  'security-review',
  'perf-baseline'
] as const;
export type WalkedKind = (typeof WALKED_EVALUATORS)[number];

export interface RunMonotonicOptions {
  readonly projectRoot: string;
  readonly sid: string;
  readonly rid: string;
  /** Threshold (0..1 scale). Default 0.05 (5%). */
  readonly threshold?: number;
  /** When set, write the current cycle score rows to disk (default: true). */
  readonly persist?: boolean;
  /** When set, override the auto-derived cycle index. */
  readonly cycle?: number;
  /** Override the peaks binary path (default: `node bin/peaks.js`). */
  readonly peaksBin?: string;
}

export interface RunMonotonicResult {
  readonly projectRoot: string;
  readonly sid: string;
  readonly rid: string;
  readonly currentCycle: number;
  readonly previousCycle: number | null;
  readonly persistedAt: string | null;
  readonly rows: readonly MonotonicScoreRow[];
  readonly report: MonotonicReport;
  /** Additive surface for non-fatal persistence warnings (e.g. append
   *  failure). Optional so existing destructures keep compiling. */
  readonly warnings?: readonly string[];
}
