/**
 * peaks-code multi-signal verdict aggregator (v2.13.1 Group A).
 *
 * Implements the 4 aggregation rules documented in
 * `.peaks/project-scan/audit-output-schema.md:66-78` plus 3rd-party
 * inputs (karpathy / peaks-mut / peaks-qa). The 5 envelopes are
 * heterogeneous on purpose — v2.13.1 ships precedence, NOT a schema
 * unification (that's v2.14).
 *
 * 4 aggregation rules (verbatim from audit-output-schema.md):
 *   1. Verdict precedence — `block` > `warn` > `pass`. Top-level
 *      verdict is the highest input verdict.
 *   2. CRITICAL count — sum of CRITICAL markers across inputs.
 *   3. Required fix deduplication — identical `(file, line, hint)`
 *      tuples from different audits are merged.
 *   4. Handoff hash consistency — handled by the audit skills
 *      upstream; the aggregator consumes already-verified envelopes.
 *
 * Top-level precedence: `block` > `return-to-rd` > `warn` > `pass`.
 *
 * The aggregator is intentionally pure (no I/O, no clock, no
 * filesystem). v2.13.1 wires the result into micro-cycle.md as the
 * "re-run reason" payload; v2.14 will wire it into a CLI subcommand.
 *
 * Karpathy §1 — Simplicity First:
 *   - single file, no new imports beyond the existing
 *     SecurityAuditEnvelope / PerfAuditEnvelope type re-exports.
 *   - hard precedence; no scoring, no weighting, no RFC voting.
 */
import type { SecurityAuditEnvelope } from 'peaks-loop-audit-independent';
import type { PerfAuditEnvelope } from 'peaks-loop-audit-independent';
import type { ThresholdViolation } from 'peaks-loop-mut';

// v2.13.1 — karpathy / mut / qa envelope types are defined locally
// (surgeon change). v2.14 will move them to a shared
// `services/verdict/envelopes.ts` if a unification pass lands.

export interface KarpathyViolation {
  readonly guideline:
    | 'think-before-coding'
    | 'simplicity-first'
    | 'surgical-changes'
    | 'goal-driven-execution';
  readonly severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
  readonly file: string;
  readonly line: number;
  readonly hint: string;
}

export interface KarpathyEnvelope {
  readonly passed: boolean;
  readonly violations: ReadonlyArray<KarpathyViolation>;
  readonly gateAction: 'pass' | 'warn' | 'block';
}

export interface MutEnvelope {
  readonly passed: boolean;
  readonly killRate: number;
  readonly weakRate: number;
  readonly violations: ReadonlyArray<ThresholdViolation>;
}

export interface QaEnvelope {
  readonly verdict: 'pass' | 'return-to-rd' | 'blocked';
  readonly reportPath?: string;
}

export interface AggregatorInput {
  readonly security?: SecurityAuditEnvelope;
  readonly perf?: PerfAuditEnvelope;
  readonly karpathy?: KarpathyEnvelope;
  readonly mut?: MutEnvelope;
  readonly qa?: QaEnvelope;
}

export type AggregatorVerdict = 'pass' | 'warn' | 'block' | 'return-to-rd';

export type VerdictSource =
  | 'security-audit'
  | 'perf-audit'
  | 'karpathy-reviewer'
  | 'peaks-mut'
  | 'peaks-qa';

export interface VerdictReason {
  /**
   * Primary source — kept for the single-source case. When multiple
   * sources report the same (file,line,hint) tuple, `sources` carries
   * the full list and `source` is the first source that triggered the
   * reason entry (deterministic: security → perf → karpathy order).
   */
  readonly source: VerdictSource;
  /**
   * v2.13.2 — multi-source carrier. Always non-empty when the reason
   * was deduped across sources; equals `[source]` for single-source
   * entries. The dedup key uses (file,line,hint) only — not `source` —
   * per `.peaks/project-scan/audit-output-schema.md:73`.
   */
  readonly sources: ReadonlyArray<VerdictSource>;
  readonly signal: AggregatorVerdict | 'blocked';
  readonly severity?: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
  readonly file?: string;
  readonly line?: number;
  readonly hint?: string;
  readonly kind?: string;
  readonly actual?: number;
  readonly threshold?: number;
  readonly reportPath?: string;
}

export interface AggregatorResult {
  readonly verdict: AggregatorVerdict;
  readonly reasons: ReadonlyArray<VerdictReason>;
}

export const VERDICT_PRECEDENCE: ReadonlyArray<AggregatorVerdict> = [
  'pass',
  'warn',
  'return-to-rd',
  'block'
];

function bucketOf(v: AggregatorVerdict): number {
  if (v === 'block') return 4;
  if (v === 'return-to-rd') return 3;
  if (v === 'warn') return 2;
  return 1; // pass
}

/**
 * Common (file, line, hint) carrier — security / perf / karpathy
 * violations all share this shape. peaks-mut / peaks-qa don't carry
 * (file, line, hint) and skip dedup.
 */
interface FixLocation {
  readonly file: string;
  readonly line: number;
  readonly hint: string;
}

interface DedupState {
  readonly reasons: VerdictReason[];
  readonly seen: Set<string>;
  /**
   * v2.13.2 — maps dedup key → existing reason index in `reasons`.
   * On a hit we mutate the existing reason's `sources` array to
   * append the new source (idempotent — duplicates collapsed).
   */
  readonly indexByKey: Map<string, number>;
}

function pushFix(
  state: DedupState,
  proposed: VerdictReason,
  loc: FixLocation
): void {
  // v2.13.2 BLOCKER fix: dedup key is `(file, line, hint)` only,
  // per `.peaks/project-scan/audit-output-schema.md:73`. The previous
  // key `${source}|${file}|${line}|${hint}` over-segmented the
  // reasons list when two audits flagged the same line.
  const key = `${loc.file}|${loc.line}|${loc.hint}`;
  const existingIdx = state.indexByKey.get(key);
  if (existingIdx === undefined) {
    state.indexByKey.set(key, state.reasons.length);
    state.reasons.push({
      ...proposed,
      sources: proposed.sources.length > 0 ? [...proposed.sources] : [proposed.source]
    });
    return;
  }
  const existing = state.reasons[existingIdx]!;
  const mergedSources = mergeSources(existing.sources, proposed.source);
  state.reasons[existingIdx] = { ...existing, sources: mergedSources };
}

function mergeSources(
  existing: ReadonlyArray<VerdictSource>,
  next: VerdictSource
): ReadonlyArray<VerdictSource> {
  if (existing.includes(next)) return existing;
  return [...existing, next];
}

export function aggregateVerdict(input: AggregatorInput): AggregatorResult {
  const state: DedupState = { reasons: [], seen: new Set(), indexByKey: new Map() };
  let top: AggregatorVerdict = 'pass';
  const elevate = (candidate: AggregatorVerdict): void => {
    if (bucketOf(candidate) > bucketOf(top)) top = candidate;
  };

  // 1. Security audit envelope (v2.12.0 schema — preserved).
  if (input.security !== undefined && input.security.verdict !== 'pass') {
    const env = input.security;
    elevate(env.verdict);
    for (const v of env.violations) {
      pushFix(
        state,
        { source: 'security-audit', sources: ['security-audit'], signal: env.verdict, severity: v.severity, file: v.file, line: v.line, hint: v.hint },
        { file: v.file, line: v.line, hint: v.hint }
      );
    }
  }

  // 2. Perf audit envelope (v2.12.0 schema — preserved).
  if (input.perf !== undefined && input.perf.verdict !== 'pass') {
    const env = input.perf;
    elevate(env.verdict);
    for (const v of env.violations) {
      pushFix(
        state,
        { source: 'perf-audit', sources: ['perf-audit'], signal: env.verdict, severity: v.severity, file: v.file, line: v.line, hint: v.hint },
        { file: v.file, line: v.line, hint: v.hint }
      );
    }
  }

  // 3. Karpathy reviewer — gateAction drives precedence.
  if (input.karpathy !== undefined && input.karpathy.gateAction !== 'pass') {
    const env = input.karpathy;
    elevate(env.gateAction);
    for (const v of env.violations) {
      pushFix(
        state,
        { source: 'karpathy-reviewer', sources: ['karpathy-reviewer'], signal: env.gateAction, severity: v.severity, file: v.file, line: v.line, hint: v.hint },
        { file: v.file, line: v.line, hint: v.hint }
      );
    }
  }

  // 4. peaks-mut — passed:false → block with per-violation reason.
  if (input.mut !== undefined && !input.mut.passed) {
    elevate('block');
    for (const violation of input.mut.violations) {
      state.reasons.push({
        source: 'peaks-mut',
        sources: ['peaks-mut'],
        signal: 'block',
        kind: violation.kind,
        actual: violation.actual,
        threshold: violation.threshold,
        hint:
          violation.kind === 'mutationKillRateMin'
            ? `kill rate ${violation.actual.toFixed(3)} < ${violation.threshold.toFixed(3)}`
            : `weak-assert rate ${violation.actual.toFixed(3)} > ${violation.threshold.toFixed(3)}`
      });
    }
  }

  // 5. peaks-qa — verdict drives precedence.
  if (input.qa !== undefined && input.qa.verdict !== 'pass') {
    const env = input.qa;
    if (env.verdict === 'blocked') {
      elevate('block');
      state.reasons.push({
        source: 'peaks-qa',
        sources: ['peaks-qa'],
        signal: 'blocked',
        ...(env.reportPath !== undefined ? { reportPath: env.reportPath } : {})
      });
    } else {
      // 'return-to-rd'
      elevate('return-to-rd');
      state.reasons.push({
        source: 'peaks-qa',
        sources: ['peaks-qa'],
        signal: 'return-to-rd',
        ...(env.reportPath !== undefined ? { reportPath: env.reportPath } : {})
      });
    }
  }

  return { verdict: top, reasons: state.reasons };
}