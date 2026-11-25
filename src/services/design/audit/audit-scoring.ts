/**
 * Scoring for the S7 design audit (Task 4, reshaped by Task 6a).
 *
 * The dimension vocabulary and its ONE severity table — `DIMENSION_RULES` —
 * live in `audit-dimensions.ts`; this module turns that table into page and
 * audit scores. The table classifies every `AuditDimension` as `hard`
 * (usability / accessibility), `soft` (aesthetic) or `unmeasured` (not
 * judgeable from source), and says whether its score is a value ratio or a
 * per-finding cost. Exhaustiveness is enforced twice:
 * `AUDIT_DIMENSIONS_EXHAUSTIVE` fails to compile when a new union member has no
 * row, and `audit-scoring.test.ts` walks the table at runtime.
 *
 * TWO SCORE SHAPES, by dimension kind:
 *
 *   - ratio (`spacing`, `type`, `color`) — the score is the share of the values
 *     the detector actually judged that stayed on-contract:
 *     `round(100 × onContract / measured)`. `unmeasured` values are excluded
 *     from BOTH sides (they are gaps, reported separately). A dimension whose
 *     values were all unmeasured scores `null` — never 100 by default.
 *   - cost (`contrast`, `surface`, `hierarchy`, `a11y`, `states`) — one hit is
 *     the whole signal, so the dimension starts at 100 and loses its documented
 *     cost per hard/soft finding, floored at 0. An `unmeasured` finding costs 0.
 *
 * A page scores the MINIMUM of its reported (non-null) dimension scores, and
 * the report's headline is the worst page's score — never an average, so adding
 * a clean page cannot raise it. A contract-level dimension (contrast) has no
 * owning page: it is scored once and competes in the same minimum.
 *
 * LOW SAMPLE. A value dimension that judged fewer than `MIN_MEASURED` values
 * still reports its ratio, but flags `lowSample: true` and is excluded from the
 * page score and the audit headline. The first pilot run proved why: 20 pages
 * scored 0 because ONE spacing literal happened to be off-ladder, which is an
 * accident of file size, not a page defect. The flag hides nothing — the ratio
 * stays in the row and in the JSON — it only stops a 1–2-value denominator from
 * setting `overall`.
 */

import {
  NO_JUDGEMENT,
  type AuditDimension,
  type AuditFinding,
  type DimensionJudgement
} from './audit-finding.js';
import { BASE_SCORE, DIMENSION_RULES } from './audit-dimensions.js';

export {
  AUDIT_COST_DIMENSIONS,
  AUDIT_DIMENSIONS,
  AUDIT_DIMENSIONS_EXHAUSTIVE,
  AUDIT_RATIO_DIMENSIONS,
  BASE_SCORE,
  DIMENSION_RULES
} from './audit-dimensions.js';
export type { DimensionRule } from './audit-dimensions.js';

/** A value denominator below this cannot set a page or audit score (Task 6b). */
const MIN_MEASURED = 5;

/** One dimension's score and value/finding counts on one page or across the audit. */
export type DimensionScore = {
  dimension: AuditDimension;
  /** `null` when a ratio judged only unmeasured values — or a cost row ran on nothing. */
  score: number | null;
  /**
   * False when the dimension had nothing it could judge (review K1): a cost row
   * with no input is "not judged", never a silent 100 that reads as a pass.
   */
  judged: boolean;
  /** Distinct `file:line` sites among this row's hard/soft findings (review M4). */
  distinctSites: number;
  /** Values judged (on-contract + off-contract); 0 for a cost dimension. */
  measured: number;
  /** Judged values that stayed on-contract; 0 for a cost dimension. */
  onContract: number;
  /** True when a ratio dimension's `score` rests on fewer than `MIN_MEASURED` values. */
  lowSample?: boolean;
  hard: number;
  soft: number;
  unmeasured: number;
};

/** One audited source unit: a page file, or a stylesheet its page roots read. */
export type PageAudit = {
  path: string;
  findings: readonly AuditFinding[];
  /** Per-dimension value counts the ratio score needs. */
  judgements?: Partial<Record<AuditDimension, DimensionJudgement>>;
  /** Which cost dimensions actually had input to judge (review K1). */
  judged?: Partial<Record<AuditDimension, boolean>>;
  /** True when the page's import closure stopped at its file bound (Task 6e). */
  truncated?: boolean;
};

/** One page's score, with only the dimensions it reported. */
export type PageScore = {
  path: string;
  score: number;
  dimensions: DimensionScore[];
  /** Present only when the page's import closure was truncated (Task 6e). */
  truncated?: boolean;
};

/** The whole audit's scores: per page, per dimension, and the worst overall. */
export type AuditScore = {
  pages: PageScore[];
  dimensions: DimensionScore[];
  /** The minimum of every page score and every non-null dimension score. */
  overall: number | null;
};

function countSeverity(findings: readonly AuditFinding[]): {
  hard: number;
  soft: number;
  unmeasured: number;
} {
  const counts = { hard: 0, soft: 0, unmeasured: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function ratioScore(judgement: DimensionJudgement): number | null {
  if (judgement.measured === 0) return null;
  const share = (BASE_SCORE * judgement.onContract) / judgement.measured;
  return Math.min(BASE_SCORE, Math.max(0, Math.round(share)));
}

/** A ratio row judged too few values to carry a page or audit score. */
export function isLowSample(rule: { kind: 'ratio' | 'cost' }, measured: number): boolean {
  return rule.kind === 'ratio' && measured > 0 && measured < MIN_MEASURED;
}

/** Distinct `file:line` sites among the hard/soft findings of one dimension row. */
export function distinctSites(findings: readonly AuditFinding[]): number {
  return new Set(
    findings
      .filter((finding) => finding.severity !== 'unmeasured')
      .map((finding) => `${finding.file}:${finding.line}`)
  ).size;
}

/** One dimension's score: an on-contract share, or 100 less cost per finding. */
export function scoreDimension(
  dimension: AuditDimension,
  findings: readonly AuditFinding[],
  judgement: DimensionJudgement = NO_JUDGEMENT,
  judged = true
): DimensionScore {
  const counts = countSeverity(findings);
  const sites = distinctSites(findings);
  const rule = DIMENSION_RULES[dimension];
  if (rule.kind === 'ratio') {
    const lowSample = isLowSample(rule, judgement.measured);
    return {
      dimension,
      score: ratioScore(judgement),
      judged: judgement.measured > 0 || findings.length > 0,
      distinctSites: sites,
      measured: judgement.measured,
      onContract: judgement.onContract,
      ...(lowSample ? { lowSample: true } : {}),
      ...counts
    };
  }
  const judgedCount = counts.hard + counts.soft;
  return {
    dimension,
    score: judged ? Math.max(0, BASE_SCORE - rule.cost * judgedCount) : null,
    judged,
    distinctSites: sites,
    measured: 0,
    onContract: 0,
    ...counts
  };
}
