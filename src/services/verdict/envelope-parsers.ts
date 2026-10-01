/**
 * peaks-loop v2.13.3 — Envelope parsers (split from `envelopes.ts`).
 *
 * `envelopes.ts` exceeded the 300-raw-line file-size cap, so the
 * finding-free parser mass — the `AnyEnvelope` discriminated-union
 * projection, the security / perf / karpathy markdown parsers, the
 * `AnyEnvelope → AggregatorInput` adapter, and the two markdown
 * section / bullet readers — moved here verbatim. The finding-carrying
 * helpers (`parseAuditMarkdown`, `parseKarpathyViolations`, `matchEnum`,
 * `parseFindingBullet`) stay in `envelopes.ts`, which re-exports every
 * name below so `./envelopes.js` stays the public import path.
 *
 * Cycle note: `envelopes.ts` and this file import each other. That is
 * safe under `module: NodeNext` + `"type": "module"` because every
 * cross-boundary reference is a hoisted function declaration (resolved
 * at call time) or an erased `type` — neither module reads a value from
 * the other at evaluation time.
 */
import {
  isPerfAuditEnvelope,
  isSecurityAuditEnvelope,
  type PerfAuditEnvelope,
  type SecurityAuditEnvelope
} from '../audit-independent/index.js';
import {
  type KarpathyEnvelope,
  type MutEnvelope,
  type QaEnvelope,
  type AggregatorInput
} from './verdict-aggregator.js';
import {
  matchEnum,
  parseAuditMarkdown,
  parseFindingBullet,
  parseKarpathyViolations
} from './envelopes.js';

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
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
  const gateAction = matchEnum(md, /^\s*(?:gateAction|verdict)\s*:\s*(pass|warn|block)\s*$/m) as
    'pass' | 'warn' | 'block' | null;
  const passedMatch = md.match(/^\s*passed\s*:\s*(true|false)\s*$/m);
  if (gateAction === null || passedMatch === null) return null;
  const violations = parseKarpathyViolations(md);
  return {
    passed: passedMatch[1] === 'true',
    violations,
    gateAction
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
    if (item.kind === 'security')
      (out as { security?: typeof item.envelope }).security = item.envelope;
    else if (item.kind === 'perf') (out as { perf?: typeof item.envelope }).perf = item.envelope;
    else if (item.kind === 'karpathy')
      (out as { karpathy?: typeof item.envelope }).karpathy = item.envelope;
    else if (item.kind === 'mut') (out as { mut?: typeof item.envelope }).mut = item.envelope;
    else if (item.kind === 'qa') (out as { qa?: typeof item.envelope }).qa = item.envelope;
  }
  return out;
}

/** Extract the body of a `## Heading` section (text up to the next
 *  `## ` heading or EOF). Returns null when the heading is absent. */
export function extractSection(body: string, heading: string): string | null {
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
export function parseFindingBullets(body: string): Array<{
  dimension: string;
  severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
  file: string;
  line: number;
  hint: string;
}> {
  const section = body.split(/^##\s+Findings\s*$/m)[1];
  if (section === undefined) return [];
  const lines = section.split('\n').filter((l) => l.trim().startsWith('- '));
  const out: Array<{
    dimension: string;
    severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
    file: string;
    line: number;
    hint: string;
  }> = [];
  for (const line of lines) {
    const v = parseFindingBullet(line);
    if (v !== null) out.push(v);
  }
  return out;
}
