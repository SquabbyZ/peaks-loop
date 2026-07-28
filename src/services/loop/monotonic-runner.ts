/**
 * peaks-loop v3.0.0 — Slice C.2
 *
 * Runtime for the `monotonic-improvement` evaluator. Walks the prior
 * cycle's score rows (per evaluator), invokes each evaluator against
 * the current rid + project, then compares adjacent cycles.
 *
 *  - current cycle score rows are appended to the per-session jsonl
 *    store at `.peaks/_runtime/<sid>/metrics/slices.jsonl` with the
 *    tag `{"kind":"monotonic-cycle","rid":"<rid>","cycle":N,"scores":[...]}`.
 *  - previous cycle rows are read from the same jsonl store (last
 *    matching tag, O(1) tail scan). When no jsonl record exists, the
 *    reader falls back to the legacy `.peaks/_sub_agents/<sid>/shared/`
 *    dir (still reads cycle-N.json) for cross-batch/session signal.
 *  - missing previous cycle → skip (not abort).
 *
 * Karpathy §2 Simplicity First: reuse `appendMetricLine` +
 * `readMetricLines` from `observability/jsonl-store.ts`. One append per
 * cycle replaces N cycle-N.json files; tail scan replaces readdirSync +
 * regex.
 *
 * File budget: ≤ 800 lines (Karpathy §2).
 */
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
import { appendMetricLine, readMetricLines } from '../observability/jsonl-store.js';
import { findProjectRoot } from '../config/config-safety.js';

/** Local discriminated result for IO. Internal callers coalesce
 *  `ok: false` to `null` so the public `loadPreviousCycle`
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

/** Tag for cycle lines in the jsonl-store. */
const MONOTONIC_CYCLE_KIND = 'monotonic-cycle';

interface MonotonicCycleLine {
  readonly kind: typeof MONOTONIC_CYCLE_KIND;
  readonly rid: string;
  readonly cycle: number;
  readonly persistedAt: string;
  readonly scores: readonly MonotonicScoreRow[];
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
  /** Additive surface for non-fatal persistence warnings (e.g. append
   *  failure). Optional so existing destructures keep compiling. */
  readonly warnings?: readonly string[];
}

/** Resolve the slice dir — kept for API/BC (run-driver.ts uses it to
 *  derive `cyclesDir`). The monotonic-runner writer no longer writes
 *  here; the jsonl-store is the new persistence layer. */
export function sliceDir(projectRoot: string, sid: string, rid: string): string {
  return join(projectRoot, '.peaks', '_runtime', sid, 'loop', rid);
}

/** Load the most recent prior cycle for `(sid, rid)` from the
 *  per-session jsonl store (tail scan, O(N) where N = total jsonl
 *  lines, ~50-100 for a 24h run). Falls back to the legacy
 *  `.peaks/_sub_agents/<sid>/shared/` dir for cross-session signal.
 *  Returns `null` on any read error. */
export function loadPreviousCycle(
  projectRoot: string,
  sid: string,
  rid: string
): MonotonicCycle | null {
  return loadMostRecentCycleFromJsonl(projectRoot, sid, rid)
    ?? loadMostRecentCycleFromSubAgents(projectRoot, sid, rid);
}

/** Scan the jsonl-store from tail backwards for the most recent
 *  `monotonic-cycle` line matching `rid`. Returns `null` when no
 *  matching line exists or any line is malformed. */
function loadMostRecentCycleFromJsonl(
  projectRoot: string,
  sid: string,
  rid: string
): MonotonicCycle | null {
  const lines = readMetricLines(projectRoot, sid);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    const parsed = parseCycleLine(line, rid);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseCycleLine(raw: string, rid: string): MonotonicCycle | null {
  let obj: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== 'object') return null;
    obj = v as Record<string, unknown>;
  } catch {
    return null;
  }
  if (obj['kind'] !== MONOTONIC_CYCLE_KIND) return null;
  if (typeof obj['rid'] !== 'string' || obj['rid'] !== rid) return null;
  const cycle = typeof obj['cycle'] === 'number' ? obj['cycle'] : 0;
  const scores = parseScoreRows(obj['scores']);
  return { cycle, scores };
}

function parseScoreRows(raw: unknown): MonotonicScoreRow[] {
  if (!Array.isArray(raw)) return [];
  const out: MonotonicScoreRow[] = [];
  for (const s of raw) {
    if (s === null || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r['evaluator'] !== 'string') continue;
    const gate = r['gateAction'];
    if (gate !== 'pass' && gate !== 'warn' && gate !== 'block') continue;
    const observedAt = typeof r['observedAt'] === 'string' ? r['observedAt'] : new Date(0).toISOString();
    out.push({
      evaluator: r['evaluator'],
      score: typeof r['score'] === 'number' ? r['score'] : (gate === 'pass' ? 1.0 : gate === 'warn' ? 0.5 : 0.0),
      gateAction: gate,
      degraded: r['degraded'] === true,
      observedAt
    });
  }
  return out;
}

/** Legacy fallback: read the most recent `cycle-N.json` from the
 *  `.peaks/_sub_agents/<sid>/shared/` dir (cross-session signal).
 *  Kept verbatim so existing cross-batch signals remain readable. */
function loadMostRecentCycleFromSubAgents(
  projectRoot: string,
  sid: string,
  rid: string
): MonotonicCycle | null {
  const dir = join(projectRoot, '.peaks', '_sub_agents', sid, 'shared');
  return loadMostRecentCycleFromDir(dir, rid);
}

function loadMostRecentCycleFromDir(dir: string, rid: string): MonotonicCycle | null {
  // Lazily import so unit tests in non-windows environments don't pull
  // node:fs through a static `import`.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  if (!fs.existsSync(dir)) return null;
  const readdir: LoadResult<string[]> = (() => {
    try {
      return { ok: true, value: fs.readdirSync(dir) as string[] };
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
      return { ok: true, value: fs.readFileSync(target, 'utf8') };
    } catch (err) {
      return { ok: false, reason: classifyFsError(err) };
    }
  })();
  if (!readFile.ok) return null;
  const parsed = parseLegacyCycleFile(readFile.value, bestCycle);
  // `rid` param retained for BC with the legacy dir shape (legacy
  // files are shared across rids); include it in the parsed object so
  // future cross-rid reads stay consistent.
  void rid;
  return parsed;
}

function parseLegacyCycleFile(raw: string, fallbackCycle: number): MonotonicCycle | null {
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
  const scores = parseScoreRows(obj['scores']);
  return { cycle: typeof obj['cycle'] === 'number' ? obj['cycle'] : fallbackCycle, scores };
}

/** Determine the next cycle index — reads the most recent jsonl
 *  cycle line's `cycle` field + 1 (or `1` when none exist). `rid`
 *  retained for API compatibility — the jsonl-store is per-session,
 *  but the line tag carries `rid` so the reader filters to this rid.
 */
export function nextCycleIndex(projectRoot: string, sid: string, rid: string): number {
  const prev = loadPreviousCycle(projectRoot, sid, rid);
  if (prev === null) return 1;
  return prev.cycle + 1;
}

/** Run the guard end-to-end: walk the 4 evaluators, persist the
 *  current cycle to the jsonl store, compare against the prior cycle,
 *  return a structured report. */
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
    const line: MonotonicCycleLine = {
      kind: MONOTONIC_CYCLE_KIND,
      rid: options.rid,
      cycle,
      persistedAt: new Date().toISOString(),
      scores: rows
    };
    const ok = appendMetricLine(options.projectRoot, options.sid, JSON.stringify(line));
    if (ok) {
      persistedAt = `jsonl:${options.sid}#cycle=${cycle}`;
    } else {
      persistedAt = null;
      envelopeWarns.push(`append-failed: jsonl-store for sid=${options.sid} cycle=${cycle}`);
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