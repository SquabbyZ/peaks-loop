/**
 * peaks-loop v3.0.0 — Slice C.2
 *
 * Runtime for the `monotonic-improvement` evaluator. Walks the prior
 * cycle's score rows (per evaluator), invokes each evaluator against
 * the current rid + project, then compares adjacent cycles.
 *
 *  - current cycle score rows are stored at
 *      .peaks/_runtime/<sid>/loop/<rid>/cycle-<N>.json
 *  - previous cycle rows are loaded from the same directory
 *    (or from `.peaks/_sub_agents/<sid>/shared/cycle-<M>.json`
 *    if the slice directory is empty).
 *  - missing previous cycle → skip (not abort).
 *
 * Karpathy §2 Simplicity First: shell-out to existing
 * `dispatchEvaluator`, persist JSON to disk; no new deps.
 *
 * File budget: ≤ 800 lines (Karpathy §2).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dispatchEvaluator, type EvaluatorVerdictEnvelope } from './evaluator-dispatcher.js';
import {
  checkMonotonicImprovement,
  toScoreRow,
  DEFAULT_MONOTONIC_THRESHOLD,
  type MonotonicCycle,
  type MonotonicScoreRow,
  type MonotonicReport
} from './monotonic-guard.js';
import { findProjectRoot } from '../config/config-safety.js';

/** Local discriminated result for slice-dir IO. Internal callers
 *  coalesce `ok: false` to `null` so the public `loadPreviousCycle`
 *  signature stays `MonotonicCycle | null` (BC — see
 *  `monotonic-guard.test.ts:199`). */
type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'NOT_FOUND' | 'IO_ERROR' | 'PARSE_ERROR' };

function classifyFsError(err: unknown): 'NOT_FOUND' | 'IO_ERROR' {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'NOT_FOUND';
  return 'IO_ERROR';
}

/** Set of evaluator kinds the loop walker actually scores — keeps the
 *  guard surface tight (the verdict-aggregate is the cross-source merge
 *  and not a per-cycle input). */
const WALKED_EVALUATORS = [
  'karpathy',
  'code-review',
  'security-review',
  'perf-baseline'
] as const;
type WalkedKind = (typeof WALKED_EVALUATORS)[number];

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
  /** Additive surface for non-fatal persistence warnings (e.g. mkdir
   *  failure). Optional so existing destructures keep compiling. */
  readonly warnings?: readonly string[];
}

/** Resolve the slice dir used by both writer + reader — keeps tests
 *  insulated from real sessions. */
export function sliceDir(projectRoot: string, sid: string, rid: string): string {
  return join(projectRoot, '.peaks', '_runtime', sid, 'loop', rid);
}

/** Load the most recent prior cycle (highest-N `cycle-N.json`) for
 *  `(sid, rid)` from the slice dir; falls back to the
 *  `.peaks/_sub_agents/<sid>/shared/` dir when no slice-level prior
 *  cycle exists. Returns `null` on any read error. */
export function loadPreviousCycle(
  projectRoot: string,
  sid: string,
  rid: string
): MonotonicCycle | null {
  return loadMostRecentCycle(sliceDir(projectRoot, sid, rid))
    ?? loadMostRecentCycleFromSubAgents(projectRoot, sid);
}

function loadMostRecentCycleFromSubAgents(projectRoot: string, sid: string): MonotonicCycle | null {
  const dir = join(projectRoot, '.peaks', '_sub_agents', sid, 'shared');
  return loadMostRecentCycle(dir);
}

function loadMostRecentCycle(dir: string): MonotonicCycle | null {
  if (!existsSync(dir)) return null;
  const readdir: LoadResult<string[]> = (() => {
    try {
      return { ok: true, value: require('node:fs').readdirSync(dir) as string[] };
    } catch (err) {
      return { ok: false, reason: classifyFsError(err) };
    }
  })();
  if (!readdir.ok) return null;
  const entries = readdir.value;
  let bestCycle: number | null = null;
  for (const entry of entries) {
    const m = entry.match(/^cycle-(\d+)\.json$/);
    if (m === null) continue;
    const n = parseInt(m[1] ?? '0', 10);
    if (bestCycle === null || n > bestCycle) bestCycle = n;
  }
  if (bestCycle === null) return null;
  const target = join(dir, `cycle-${bestCycle}.json`);
  const readFile: LoadResult<string> = (() => {
    try {
      return { ok: true, value: readFileSync(target, 'utf8') };
    } catch (err) {
      return { ok: false, reason: classifyFsError(err) };
    }
  })();
  if (!readFile.ok) return null;
  return parseCycle(readFile.value, bestCycle);
}

function parseCycle(raw: string, fallbackCycle: number): MonotonicCycle | null {
  const parse: LoadResult<unknown> = (() => {
    try {
      return { ok: true, value: JSON.parse(raw) };
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

/** Determine the next cycle index — `max(prior) + 1`, or `1` when none exist. */
export function nextCycleIndex(projectRoot: string, sid: string, rid: string): number {
  const prev = loadPreviousCycle(projectRoot, sid, rid);
  if (prev === null) return 1;
  return prev.cycle + 1;
}

/** Run the guard end-to-end: walk the 4 evaluators, persist the current
 *  cycle score rows, compare against the prior cycle, return a
 *  structured report. */
export function runMonotonicCheck(options: RunMonotonicOptions): RunMonotonicResult {
  const threshold = options.threshold ?? DEFAULT_MONOTONIC_THRESHOLD;
  const persist = options.persist !== false;
  const cycle = options.cycle ?? nextCycleIndex(options.projectRoot, options.sid, options.rid);

  const rows: MonotonicScoreRow[] = [];
  for (const kind of WALKED_EVALUATORS) {
    let env: EvaluatorVerdictEnvelope;
    try {
      env = dispatchEvaluator(kind, {
        projectRoot: options.projectRoot,
        rid: options.rid,
        ...(options.peaksBin !== undefined ? { peaksBin: options.peaksBin } : {})
      });
    } catch {
      // Per-evaluator failures never abort the loop — degrade to warn,
      // score 0.25, degraded=true, observed-at=now.
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
    rows.push(toScoreRow(env.kind, env.gateAction, env.degraded, new Date().toISOString()));
  }

  const currentCycle: MonotonicCycle = { cycle, scores: rows };
  const previousCycle = loadPreviousCycle(options.projectRoot, options.sid, options.rid);
  const report = checkMonotonicImprovement(previousCycle, currentCycle, { threshold });

  let persistedAt: string | null = null;
  const envelopeWarns: string[] = [];
  if (persist) {
    const dir = sliceDir(options.projectRoot, options.sid, options.rid);
    const mkdir: LoadResult<void> = (() => {
      try {
        mkdirSync(dir, { recursive: true });
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, reason: classifyFsError(err) };
      }
    })();
    if (!mkdir.ok) {
      envelopeWarns.push(`mkdir-failed: ${dir} (${mkdir.reason})`);
    }
    const path = join(dir, `cycle-${cycle}.json`);
    const payload = JSON.stringify({
      cycle,
      rid: options.rid,
      sid: options.sid,
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
    if (writeFile.ok) {
      persistedAt = path;
    } else {
      persistedAt = null;
      envelopeWarns.push(`write-failed: ${path} (${writeFile.reason})`);
    }
  }

  return {
    projectRoot: options.projectRoot,
    sid: options.sid,
    rid: options.rid,
    currentCycle: cycle,
    previousCycle: previousCycle === null ? null : previousCycle.cycle,
    persistedAt,
    rows,
    report,
    ...(envelopeWarns.length > 0 ? { warnings: envelopeWarns } : {})
  };
}

/** Helper for tests + CLI — resolve project root + sid consistently. */
export function resolveMonotonicContext(opts: {
  project?: string;
  session: string;
  rid: string;
}): { projectRoot: string; sid: string; rid: string } {
  const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  return { projectRoot, sid: opts.session, rid: opts.rid };
}

/** Suppress unused-import lint when only the typedefs are exported. */
export type { WalkedKind };
