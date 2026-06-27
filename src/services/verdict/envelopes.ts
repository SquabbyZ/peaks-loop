/**
 * peaks-cli v2.13.2 — Envelope unification (AC-3).
 *
 * The 5 input envelopes feeding `aggregateVerdict()` have always been
 * heterogeneous (peaks-security-audit / peaks-perf-audit / karpathy /
 * peaks-mut / peaks-qa). v2.13.1 shipped precedence wiring without
 * touching the on-disk shapes. v2.13.2 introduces a discriminated-union
 * type projection `AnyEnvelope` and 5 pure parser functions — the file
 * contents are NOT modified; only the TS type layer becomes uniform.
 *
 * Karpathy §2 (Simplicity First):
 *   - single file, ~140 lines, zero new IO.
 *   - re-uses existing strict-shape guards (isSecurityAuditEnvelope /
 *     isPerfAuditEnvelope) — no duplicate validation logic.
 *   - parsers return `null` on malformed input (mirrors loadMutReport's
 *     "missing → null" contract). Callers can detect "envelope missing"
 *     without throwing.
 */
import { isSecurityAuditEnvelope, type SecurityAuditEnvelope } from '../audit-independent/security-audit-service.js';
import { isPerfAuditEnvelope, type PerfAuditEnvelope } from '../audit-independent/perf-audit-service.js';
import {
  type KarpathyEnvelope,
  type MutEnvelope,
  type QaEnvelope,
  type AggregatorInput
} from './verdict-aggregator.js';

// ─── Discriminated union projection ────────────────────────────────────

/**
 * `kind` is the discriminator. The on-disk file format is unchanged;
 * this field exists only in the TS type projection. The aggregator
 * accepts both the legacy `{security, perf, ...}` shape and the new
 * union via a thin adapter (`aggregateFromEnvelopes`).
 */
export type AnyEnvelope =
  | { kind: 'security'; envelope: SecurityAuditEnvelope }
  | { kind: 'perf'; envelope: PerfAuditEnvelope }
  | { kind: 'karpathy'; envelope: KarpathyEnvelope }
  | { kind: 'mut'; envelope: MutEnvelope }
  | { kind: 'qa'; envelope: QaEnvelope };

// ─── 5 parsers (pure, never throw) ─────────────────────────────────────

export function parseSecurityEnvelope(md: string): SecurityAuditEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(md);
  } catch {
    return null;
  }
  return isSecurityAuditEnvelope(value) ? value : null;
}

export function parsePerfEnvelope(md: string): PerfAuditEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(md);
  } catch {
    return null;
  }
  return isPerfAuditEnvelope(value) ? value : null;
}

/**
 * Karpathy review is stored as markdown (`.peaks/_runtime/<sid>/rd/karpathy-review.md`).
 * We parse the 3 state lines that drive the aggregator:
 *   - `gateAction: pass | warn | block`
 *   - `verdict: pass | warn | block`  (alias for gateAction)
 *   - `passed: true | false`
 * Plus the violations list under a `## Violations` heading, where each
 * bullet begins with `[SEVERITY] file:line — hint` and declares a
 * guideline tag like `(simplicity-first)`.
 */
export function parseKarpathyEnvelope(md: string): KarpathyEnvelope | null {
  if (typeof md !== 'string' || md.length === 0) return null;
  const gateAction = matchEnum(md, /^\s*(?:gateAction|verdict)\s*:\s*(pass|warn|block)\s*$/m) as 'pass' | 'warn' | 'block' | null;
  const passedMatch = md.match(/^\s*passed\s*:\s*(true|false)\s*$/m);
  if (gateAction === null || passedMatch === null) return null;
  const violations = parseKarpathyViolations(md);
  return {
    passed: passedMatch[1] === 'true',
    violations,
    gateAction
  };
}

const KARPATHY_GUIDELINES = [
  'think-before-coding',
  'simplicity-first',
  'surgical-changes',
  'goal-driven-execution'
] as const;

const KARPATHY_SEVERITIES = ['CRITICAL', 'HIGH', 'MED', 'LOW'] as const;

function parseKarpathyViolations(md: string): KarpathyEnvelope['violations'] {
  const section = md.split(/^##\s+Violations\s*$/m)[1];
  if (section === undefined) return [];
  const lines = section.split('\n').filter((l) => l.trim().startsWith('- '));
  type KarpathyV = KarpathyEnvelope['violations'][number];
const out: KarpathyV[] = [];
  for (const line of lines) {
    const m = line.match(
      /\[(CRITICAL|HIGH|MED|LOW)\]\s+([^:\s]+):(\d+)\s+[—-]\s+(.+?)\s+\((\w[\w-]*)\)/
    );
    if (m === null) continue;
    const [, severity, file, lineNo, hint, guideline] = m;
    if (severity === undefined || file === undefined || lineNo === undefined || hint === undefined || guideline === undefined) continue;
    if (!(KARPATHY_SEVERITIES as ReadonlyArray<string>).includes(severity)) continue;
    if (!(KARPATHY_GUIDELINES as ReadonlyArray<string>).includes(guideline)) continue;
    out.push({
      guideline: guideline as KarpathyV['guideline'],
      severity: severity as KarpathyV['severity'],
      file,
      line: parseInt(lineNo, 10),
      hint: hint.trim()
    });
  }
  return out;
}

/**
 * Mut envelope is JSON. Mirrors `loadMutReport`'s contract: missing
 * fields → null. The strict shape matches `MutReportJson` in
 * `services/mut/types.ts`.
 */
export function parseMutEnvelope(json: unknown): MutEnvelope | null {
  if (json === null || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.passed !== 'boolean') return null;
  if (typeof obj.killRate !== 'number' || !Number.isFinite(obj.killRate)) return null;
  if (typeof obj.weakRate !== 'number' || !Number.isFinite(obj.weakRate)) return null;
  if (!Array.isArray(obj.violations)) return null;
  type MutV = MutEnvelope['violations'][number];
const violations: MutV[] = [];
  for (const v of obj.violations) {
    if (v === null || typeof v !== 'object') return null;
    const vo = v as Record<string, unknown>;
    if (typeof vo.kind !== 'string') return null;
    if (typeof vo.actual !== 'number' || typeof vo.threshold !== 'number') return null;
    violations.push({
      kind: vo.kind as MutV['kind'],
      actual: vo.actual,
      threshold: vo.threshold
    });
  }
  return {
    passed: obj.passed,
    killRate: obj.killRate,
    weakRate: obj.weakRate,
    violations
  };
}

/**
 * QA test report is markdown under `qa/test-reports/<rid>.md`.
 * The verdict line is `verdict: pass | return-to-rd | blocked` and
 * optionally carries a `reportPath:` line. Anything else → null.
 */
export function parseQaEnvelope(md: string): QaEnvelope | null {
  if (typeof md !== 'string' || md.length === 0) return null;
  const verdict = matchEnum(md, /^\s*verdict\s*:\s*(pass|return-to-rd|blocked)\s*$/m) as 'pass' | 'return-to-rd' | 'blocked' | null;
  if (verdict === null) return null;
  const reportPathMatch = md.match(/^\s*reportPath\s*:\s*(.+?)\s*$/m);
  return {
    verdict,
    ...(reportPathMatch !== null ? { reportPath: reportPathMatch[1]!.trim() } : {})
  };
}

// ─── Adapter: union → AggregatorInput (zero call-site churn) ──────────

/**
 * Convert a partial list of `AnyEnvelope` values to the legacy
 * `AggregatorInput` shape. `null` envelopes are skipped (a missing
 * envelope is treated as "audit not run" — same semantics as
 * `AggregatorInput` without that key).
 */
export function envelopesToAggregatorInput(
  list: ReadonlyArray<AnyEnvelope | null>
): AggregatorInput {
  const out = {} as AggregatorInput;
  for (const item of list) {
    if (item === null) continue;
    if (item.kind === 'security') (out as { security?: typeof item.envelope }).security = item.envelope;
    else if (item.kind === 'perf') (out as { perf?: typeof item.envelope }).perf = item.envelope;
    else if (item.kind === 'karpathy') (out as { karpathy?: typeof item.envelope }).karpathy = item.envelope;
    else if (item.kind === 'mut') (out as { mut?: typeof item.envelope }).mut = item.envelope;
    else if (item.kind === 'qa') (out as { qa?: typeof item.envelope }).qa = item.envelope;
  }
  return out;
}

// ─── internal ──────────────────────────────────────────────────────────

function matchEnum(md: string, regex: RegExp): string | null {
  const m = md.match(regex);
  return m === null ? null : m[1]!;
}