/**
 * peaks-cli v2.13.3 — Envelope unification (AC-1: real markdown parse).
 *
 * The 5 input envelopes feeding `aggregateVerdict()` have always been
 * heterogeneous (peaks-security-audit / peaks-perf-audit / karpathy /
 * peaks-mut / peaks-qa). v2.13.1 shipped precedence wiring without
 * touching the on-disk shapes. v2.13.2 introduced a discriminated-union
 * type projection `AnyEnvelope` and 5 pure parser functions.
 *
 * v2.13.3 dogfood bug #1: parseSecurity/Perf previously only supported
 * a JSON.parse path. The real v2.12.0 audit files at
 * `.peaks/_runtime/<sid>/audit/security.md` and `audit/perf.md` are
 * YAML frontmatter + markdown body — NOT JSON. The fix preserves
 * the JSON.parse path (back-compat for unit tests + any consumer that
 * passed JSON explicitly) and adds a markdown fallback that extracts
 * `verdict:` from the frontmatter and parses `## Findings` bullets.
 *
 * Karpathy §2 (Simplicity First):
 *   - single file, ~210 lines, zero new IO.
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

/**
 * v2.13.3 AC-1 — parse real v2.12.0 audit markdown.
 *
 * Strategy (per PRD AC-1 mitigation):
 *   1. Try JSON.parse first (back-compat with prior unit tests + any
 *      consumer that passes a JSON string explicitly).
 *   2. Fall back to markdown parse: extract `verdict:` from YAML
 *      frontmatter, parse `## Findings` bullets in the body, return
 *      a SecurityAuditEnvelope.
 *   3. Return null when neither path yields a valid envelope.
 */
export function parseSecurityEnvelope(md: string): SecurityAuditEnvelope | null {
  if (typeof md !== 'string' || md.length === 0) return null;
  // Path 1: JSON (legacy / back-compat)
  try {
    const jsonValue = JSON.parse(md) as unknown;
    if (isSecurityAuditEnvelope(jsonValue)) return jsonValue;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // not JSON — fall through to markdown parse
  }
  // Path 2: real v2.12.0 markdown (YAML frontmatter + body)
  return parseAuditMarkdown(md, isSecurityAuditEnvelope);
}

export function parsePerfEnvelope(md: string): PerfAuditEnvelope | null {
  if (typeof md !== 'string' || md.length === 0) return null;
  // Path 1: JSON (legacy / back-compat)
  try {
    const jsonValue = JSON.parse(md) as unknown;
    if (isPerfAuditEnvelope(jsonValue)) return jsonValue;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // not JSON — fall through to markdown parse
  }
  // Path 2: real v2.12.0 markdown (YAML frontmatter + body)
  return parseAuditMarkdown(md, isPerfAuditEnvelope);
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

// ─── internal: v2.13.3 AC-1 markdown parser ─────────────────────────────

type AuditEnvelopeGuard<T> = (v: unknown) => v is T;

/**
 * Parse a v2.12.0 audit markdown file:
 *   ---
 *   schemaVersion: 1
 *   verdict: warn
 *   violationsCount: 1
 *   ---
 *   ## Summary
 *   Test security envelope for dogfood.
 *
 *   ## Findings
 *   - HIGH: hardcoded password in src/auth.ts:42
 *
 *   ## Verdict
 *   verdict: warn
 *   CRITICAL: 0
 *
 * Strategy:
 *   1. Strip YAML frontmatter (`---\n...\n---\n`). The frontmatter
 *      `verdict:` line is the source of truth — the body's `## Verdict`
 *      block is corroborating.
 *   2. Pull `verdict` from frontmatter (regex, line-anchored).
 *   3. Parse `## Findings` bullets — accept 3 real v2.12.0 shapes:
 *        a. `- [SEV] dim @ file:line — hint` (rendered by renderSecurityAuditArtifact)
 *        b. `- HIGH: hint in file:line` (real dogfood fixture shape)
 *        c. `- (none)` — empty
 *   4. Build a candidate envelope and run through the strict-shape
 *      guard. Return null if the guard rejects (per the parser
 *      contract: parsers never throw).
 */
function parseAuditMarkdown<T>(
  md: string,
  guard: AuditEnvelopeGuard<T>
): T | null {
  const frontmatterMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  // The v2.12.0 audit artifact contract is YAML frontmatter + body.
  // The CLI also writes a body-only variant (no frontmatter) when the
  // test fixture author writes `## Verdict\nverdict: warn` directly.
  // We accept both: frontmatter takes precedence; the body fallback
  // scans `## Verdict` and its `verdict:` line.
  let verdict: 'pass' | 'warn' | 'block' | null = null;
  let body = md;
  if (frontmatterMatch !== null) {
    const frontmatterRaw = frontmatterMatch[1]!;
    body = frontmatterMatch[2]!;
    const fm = frontmatterRaw.match(/^\s*verdict\s*:\s*(pass|warn|block)\s*$/m);
    if (fm !== null) verdict = fm[1] as 'pass' | 'warn' | 'block';
  }
  if (verdict === null) {
    // Body fallback — pull `verdict:` from the `## Verdict` block (or
    // the first line-anchored hit, whichever comes first).
    const verdictSection = body.split(/^##\s+Verdict\s*$/m)[1] ?? body;
    const vm = verdictSection.match(/^\s*verdict\s*:\s*(pass|warn|block)\s*$/m);
    if (vm !== null) verdict = vm[1] as 'pass' | 'warn' | 'block';
  }
  if (verdict === null) return null;

  const summary = extractSection(body, 'Summary') ?? '';
  const violations = parseFindingBullets(body);

  const candidate = {
    verdict,
    violations,
    summary
  };

  return guard(candidate) ? candidate : null;
}

/** Extract the body of a `## Heading` section (text up to the next
 *  `## ` heading or EOF). Returns null when the heading is absent. */
function extractSection(body: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'm');
  const sectionStart = body.search(re);
  if (sectionStart === -1) return null;
  const afterHeading = body.slice(sectionStart).split('\n');
  // skip the heading line
  afterHeading.shift();
  // collect lines until next `## ` heading
  const lines: string[] = [];
  for (const line of afterHeading) {
    if (/^##\s+/.test(line)) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

/** Parse `## Findings` bullets. Accepts the 3 real v2.12.0 shapes. */
function parseFindingBullets(body: string): Array<{ dimension: string; severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW'; file: string; line: number; hint: string }> {
  const section = body.split(/^##\s+Findings\s*$/m)[1];
  if (section === undefined) return [];
  const lines = section.split('\n').filter((l) => l.trim().startsWith('- '));
  const out: Array<{ dimension: string; severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW'; file: string; line: number; hint: string }> = [];
  for (const line of lines) {
    const v = parseFindingBullet(line);
    if (v !== null) out.push(v);
  }
  return out;
}

/** Parse a single finding bullet. Returns null on malformed input. */
function parseFindingBullet(line: string): { dimension: string; severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW'; file: string; line: number; hint: string } | null {
  // Shape A (rendered by renderSecurityAuditArtifact): `- [SEV] dim @ file:line — hint`
  const a = line.match(/^\s*-\s*\[(CRITICAL|HIGH|MED|LOW)\]\s+(\S+)\s+@\s+([^:\s]+):(\d+)\s+[—-]\s+(.+)$/);
  if (a !== null) {
    const [, severity, dimension, file, lineNo, hint] = a;
    if (severity === undefined || dimension === undefined || file === undefined || lineNo === undefined || hint === undefined) return null;
    return {
      severity: severity as 'CRITICAL' | 'HIGH' | 'MED' | 'LOW',
      dimension,
      file,
      line: parseInt(lineNo, 10),
      hint: hint.trim()
    };
  }
  // Shape B (real dogfood fixture): `- SEVERITY: hint in file:line`
  const b = line.match(/^\s*-\s*(CRITICAL|HIGH|MED|LOW)\s*:\s+(.+?)\s+in\s+([^:\s]+):(\d+)\s*$/);
  if (b !== null) {
    const [, severity, hint, file, lineNo] = b;
    if (severity === undefined || hint === undefined || file === undefined || lineNo === undefined) return null;
    return {
      severity: severity as 'CRITICAL' | 'HIGH' | 'MED' | 'LOW',
      // dogfood fixtures omit dimension — fall back to severity. The
      // aggregator does not surface the dimension string in its output
      // (it uses `(security-audit|perf-audit)` as the source), so a
      // generic fallback is sufficient for the legacy real-file path.
      dimension: severity.toLowerCase(),
      file,
      line: parseInt(lineNo, 10),
      hint: hint.trim()
    };
  }
  // Shape C (real dogfood fixture, no dimension): `- HIGH: hardcoded password in src/auth.ts:42`
  // — same regex as Shape B; kept as a separate branch only for the
  // future dimension-extraction contract. Already covered above.
  return null;
}

function matchEnum(md: string, regex: RegExp): string | null {
  const m = md.match(regex);
  return m === null ? null : m[1]!;
}