/**
 * The audit-wide score table and the report's headline, split from
 * `audit-scoring.ts` when Task 6e added `judged` and `distinctSites` and the
 * per-row scorer crossed the module ceiling.
 *
 * `audit-scoring.ts` owns ONE row: the ratio share or the per-finding cost.
 * This module owns the TABLE: which rows a page reports, the audit-wide row for
 * a dimension, and the headline. It imports the row scorer one way, so there is
 * no cycle.
 *
 * TWO REVIEW RULES LIVE HERE:
 *   - M1: a low-sample ratio cannot set a page or the headline UNLESS it carries
 *     a hard finding; a hard defect always lowers the number, so a page never
 *     prints 100 beside its own `(hard)` finding.
 *   - K1: a cost dimension the audit had nothing to judge is `judged: false`
 *     with `score: null`, which the report renders "not judged" — never a
 *     silent 100 that reads as a pass.
 */

import { NO_JUDGEMENT, type AuditDimension, type AuditFinding } from './audit-finding.js';
import { AUDIT_DIMENSIONS, BASE_SCORE, DIMENSION_RULES } from './audit-dimensions.js';
import {
  distinctSites,
  isLowSample,
  ratioScore,
  scoreDimension,
  type AuditScore,
  type DimensionScore,
  type PageAudit,
  type PageScore
} from './audit-scoring.js';

function findingsByDimension(
  findings: readonly AuditFinding[]
): Map<AuditDimension, AuditFinding[]> {
  const groups = new Map<AuditDimension, AuditFinding[]>();
  for (const finding of findings) {
    const list = groups.get(finding.dimension) ?? [];
    list.push(finding);
    groups.set(finding.dimension, list);
  }
  return groups;
}

/**
 * A page's dimensions, in the table's order. A cost dimension is reported only
 * when it produced a finding OR its detector actually judged input; a ratio
 * dimension is reported when it judged a value OR produced a finding, so "all
 * unmeasured" still shows as `null`.
 */
function pageDimensions(page: PageAudit): DimensionScore[] {
  const groups = findingsByDimension(page.findings);
  const rows: DimensionScore[] = [];
  for (const dimension of AUDIT_DIMENSIONS) {
    const findings = groups.get(dimension) ?? [];
    const judgement = page.judgements?.[dimension] ?? NO_JUDGEMENT;
    const rule = DIMENSION_RULES[dimension];
    const judged = page.judged?.[dimension] === true || findings.length > 0;
    if (rule.kind === 'cost' && !judged) continue;
    if (rule.kind === 'ratio' && judgement.measured === 0 && findings.length === 0) continue;
    rows.push(scoreDimension(dimension, findings, judgement, judged));
  }
  return rows;
}

/**
 * A page score is the minimum of its reported numeric dimension scores. A
 * low-sample ratio is reported but cannot set the page score — UNLESS it carries
 * a hard finding (review M1): a hard defect always lowers the page, so a page
 * can never print 100 beside its own `(hard)` finding.
 */
function pageScore(dimensions: readonly DimensionScore[]): number {
  const scores = dimensions.flatMap((entry) => {
    if (entry.score === null) return [];
    if (entry.lowSample === true && entry.hard === 0) return [];
    return [entry.score];
  });
  return scores.length === 0 ? BASE_SCORE : Math.min(...scores);
}

function sumCounts(
  entries: readonly DimensionScore[]
): Pick<DimensionScore, 'hard' | 'soft' | 'unmeasured' | 'measured' | 'onContract'> {
  return entries.reduce(
    (sum, entry) => ({
      hard: sum.hard + entry.hard,
      soft: sum.soft + entry.soft,
      unmeasured: sum.unmeasured + entry.unmeasured,
      measured: sum.measured + entry.measured,
      onContract: sum.onContract + entry.onContract
    }),
    { hard: 0, soft: 0, unmeasured: 0, measured: 0, onContract: 0 }
  );
}

/** The counts one audit-wide row sums from its per-page and global scorers. */
type RowCounts = ReturnType<typeof sumCounts>;

/** Everything one audit-wide row needs, gathered once by `dimensionRow`. */
type RowContext = {
  dimension: AuditDimension;
  pages: readonly PageAudit[];
  perPage: readonly DimensionScore[];
  global: DimensionScore;
  all: readonly AuditFinding[];
  contractJudged: boolean;
  counts: RowCounts;
  sites: number;
};

/** The ratio row: the on-contract share over the summed audit denominator. */
function ratioRow(context: RowContext): DimensionScore {
  const { dimension, counts, sites } = context;
  const lowSample = isLowSample(DIMENSION_RULES[dimension], counts.measured);
  return {
    dimension,
    score: ratioScore(counts),
    judged: counts.measured > 0 || counts.hard + counts.soft + counts.unmeasured > 0,
    distinctSites: sites,
    ...counts,
    ...(lowSample ? { lowSample: true } : {})
  };
}

/** The cost row: the worst unit's score, or "not judged" when nothing ran. */
function costRow(context: RowContext): DimensionScore {
  const { dimension, pages, perPage, global, all, contractJudged, counts, sites } = context;
  // An `unmeasured` finding proves only that the audit COULD NOT judge, so it is
  // not a judgement (S7 final review): counting it flipped a contract with no
  // `pairs[]` — whose single finding is the missing-pairs gap — from "not
  // judged" to a silent judged 100 that reads as a pass.
  const globalJudged = global.hard + global.soft > 0;
  const judged =
    contractJudged ||
    globalJudged ||
    pages.some((page) => page.judged?.[dimension] === true) ||
    all.some((finding) => finding.severity !== 'unmeasured');
  const scores = [...perPage, ...(globalJudged ? [global] : [])].flatMap((entry) =>
    entry.score === null ? [] : [entry.score]
  );
  return {
    dimension,
    score: judged ? (scores.length === 0 ? BASE_SCORE : Math.min(...scores)) : null,
    judged,
    distinctSites: sites,
    ...counts
  };
}

/**
 * The audit-wide table row for one dimension. A ratio row is the share of ALL
 * judged values; a cost row is the worst unit's score (or the contract-level
 * contrast score), because one hit is the whole signal.
 */
function dimensionRow(
  dimension: AuditDimension,
  pages: readonly PageAudit[],
  globalFindings: readonly AuditFinding[],
  contractJudged: boolean
): DimensionScore {
  const perPage = pages.map((page) =>
    scoreDimension(
      dimension,
      page.findings.filter((finding) => finding.dimension === dimension),
      page.judgements?.[dimension] ?? NO_JUDGEMENT,
      page.judged?.[dimension] === true
    )
  );
  const global = scoreDimension(
    dimension,
    globalFindings.filter((finding) => finding.dimension === dimension)
  );
  const counts = sumCounts([...perPage, global]);
  const all = [
    ...pages.flatMap((page) => page.findings.filter((finding) => finding.dimension === dimension)),
    ...globalFindings.filter((finding) => finding.dimension === dimension)
  ];
  const context: RowContext = {
    dimension,
    pages,
    perPage,
    global,
    all,
    contractJudged,
    counts,
    sites: distinctSites(all)
  };
  return DIMENSION_RULES[dimension].kind === 'ratio' ? ratioRow(context) : costRow(context);
}

/**
 * Score every page and every dimension. The overall number is the minimum of
 * the page scores and the non-null dimension scores — the worst audited unit,
 * never an average. A low-sample ratio still cannot set it unless it carries a
 * hard finding (review M1). `contractJudged` marks a dimension the CONTRACT was
 * judged on without a page finding (contrast's declared pairs).
 */
export function scoreAudit(
  pages: readonly PageAudit[],
  globalFindings: readonly AuditFinding[] = [],
  contractJudged: Partial<Record<AuditDimension, boolean>> = {}
): AuditScore {
  const scoredPages: PageScore[] = pages.map((page) => {
    const dimensions = pageDimensions(page);
    return {
      path: page.path,
      score: pageScore(dimensions),
      dimensions,
      ...(page.truncated === true ? { truncated: true } : {})
    };
  });
  const dimensions = AUDIT_DIMENSIONS.map((dimension) =>
    dimensionRow(dimension, pages, globalFindings, contractJudged[dimension] === true)
  );
  const candidates = [
    ...scoredPages.map((page) => page.score),
    ...dimensions.flatMap((row) =>
      row.score === null || (row.lowSample === true && row.hard === 0) ? [] : [row.score]
    )
  ];
  return {
    pages: scoredPages,
    dimensions,
    overall: candidates.length === 0 ? null : Math.min(...candidates)
  };
}
