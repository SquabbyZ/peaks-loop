/**
 * Ranked fixes for the S7 audit report (Task 4).
 *
 * The user's workflow is "fix the three most obvious, then re-audit", so the
 * report ranks by SEVERITY first (hard usability/accessibility before soft
 * aesthetic) and by hit count second. Identical findings — same dimension,
 * severity, value and expected — collapse into one fix with a count, because
 * `p-[13px]` in five places is one decision to fix, not five.
 *
 * `unmeasured` findings are NOT fixes: they are gaps the report names in its
 * own list, with their reasons, so "we could not judge this" is never silently
 * ranked away or scored as a violation.
 *
 * Split from `audit-scoring.ts` so the severity table and the score maths stay
 * one responsibility and the ranking rules another.
 */

import { capDetail, plainText } from '../evidence-text.js';
import type { AuditDimension, AuditFinding, AuditSeverity } from './audit-finding.js';

/** The user's workflow is "fix the three most obvious, then re-audit". */
export const TOP_FIX_LIMIT = 3;

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  hard: 0,
  soft: 1,
  unmeasured: 2
};

/** One ranked fix: identical findings collapsed into a hit count. */
export type TopFix = {
  dimension: AuditDimension;
  severity: 'hard' | 'soft';
  /** Page views of this defect (a shared component is seen once per page). */
  count: number;
  /** Distinct `file:line` sites, so `×49` is still readable as ONE defect (M4). */
  sites: number;
  humanText: string;
  techText: string;
};

type FixGroup = TopFix & { value: string; siteSet: Set<string> };

function compareFixes(left: FixGroup, right: FixGroup): number {
  const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severity !== 0) return severity;
  if (left.count !== right.count) return right.count - left.count;
  const dimension = left.dimension.localeCompare(right.dimension);
  return dimension !== 0 ? dimension : left.value.localeCompare(right.value);
}

function siteKey(finding: AuditFinding): string {
  return `${finding.file}:${finding.line}`;
}

/**
 * The three most obvious fixes: severity first, then hit count, then the
 * dimension and value so a snapshot is deterministic.
 *
 * The group key is the canonical defect (dimension, severity, value, expected),
 * not the page it was seen on: a shared component's `(hard)` defect is ONE fix
 * even though 49 pages render it. `sites` carries the distinct `file:line`
 * count so the report can show "×49 page views, 1 site" instead of implying 49
 * separate defects (review M4).
 */
export function topFixes(findings: readonly AuditFinding[]): TopFix[] {
  const groups = new Map<string, FixGroup>();
  for (const finding of findings) {
    if (finding.severity === 'unmeasured') continue;
    const key = [finding.dimension, finding.severity, finding.value, finding.expected].join(
      '\u0000'
    );
    const site = siteKey(finding);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.siteSet.add(site);
      continue;
    }
    groups.set(key, {
      dimension: finding.dimension,
      severity: finding.severity,
      count: 1,
      sites: 0,
      humanText: finding.humanText,
      techText: finding.techText,
      value: finding.value,
      siteSet: new Set([site])
    });
  }
  return [...groups.values()]
    .sort(compareFixes)
    .slice(0, TOP_FIX_LIMIT)
    .map((group) => ({
      dimension: group.dimension,
      severity: group.severity,
      count: group.count,
      sites: group.siteSet.size,
      humanText: group.humanText,
      techText: group.techText
    }));
}

/** One "we could not judge this" entry, with its reason already in the text. */
export type UnmeasuredItem = {
  dimension: AuditDimension;
  file: string;
  line: number;
  humanText: string;
  techText: string;
};

/**
 * Every unmeasured finding, ordered so the report is stable. Identical gaps are
 * collapsed: one shared component's gap is one entry, not one per page that
 * imports it (review M4).
 */
export function unmeasuredItems(findings: readonly AuditFinding[]): UnmeasuredItem[] {
  const seen = new Set<string>();
  const items: UnmeasuredItem[] = [];
  for (const finding of findings) {
    if (finding.severity !== 'unmeasured') continue;
    const key = [finding.dimension, finding.file, finding.line, finding.techText].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      dimension: finding.dimension,
      // `file` is a repository path, but the JSON envelope also prints it: strip
      // control bytes and bound it here, the one seam both outputs share.
      file: capDetail(plainText(finding.file)),
      line: finding.line,
      humanText: finding.humanText,
      techText: finding.techText
    });
  }
  return items.sort(
    (left, right) =>
      left.dimension.localeCompare(right.dimension) ||
      left.file.localeCompare(right.file) ||
      left.line - right.line
  );
}
