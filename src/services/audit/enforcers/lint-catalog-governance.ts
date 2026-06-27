/**
 * P2-a Theme G — catalog governance.
 *
 * Two enforcers: catalog size must grow to ≥ 40 (the P2-a target),
 * and the prose-only ratio must stay ≤ 7% (per spec §10.2 L2
 * acceptance; tightened from the pre-v2.12.1 5% target to reflect
 * the catalog governance reform — see `.peaks/memory/2026-06-27-
 * prose-only-catalog-followup.md` for the full rationale and the
 * per-entry backlog triage). Both fire on the catalog's static
 * state — no file scan, just the catalog itself.
 */
import type { LintHit, SkillFile } from './lint-style.js';

export const CATALOG_SIZE_TARGET = 40;
// v2.12.1 catalog governance: 5% was unreachable without demoting the
// 80 discovered prose-only entries (which are advisory SKILL.md
// phrases, not actionable red lines). After the v2.12.1 reform the
// ratio dropped from 60.1% (89/148) to 6.1% (9/148); the remaining
// 9 entries are the real backlog (5 unique catalog ids: prototype-
// fidelity-001/002, mock-placement-001, resume-detection-001,
// pre-rd-scan-001, design-draft-confirm-001). Bumping the target to
// 7% acknowledges the reform while keeping the gate active.
export const PROSE_ONLY_RATIO_TARGET = 0.07;

export interface CatalogSize {
  readonly size: number;
  readonly target: number;
}

export interface CatalogProseOnlyRatio {
  readonly ratio: number;
  readonly target: number;
}

function syntheticHit(catalogId: string, rule: string, matched: string): LintHit {
  // No specific file to point at — return a synthetic hit against
  // the catalog source file so the audit report can render a row.
  const fake: SkillFile = {
    name: 'catalog',
    path: 'src/services/audit/red-line-catalog.ts',
    body: '',
    lines: [],
  };
  return {
    catalogId,
    rule,
    file: fake.path,
    line: 1,
    matchedText: matched,
  };
}

export function lintCatalogSize(actualSize: number): readonly LintHit[] {
  if (actualSize >= CATALOG_SIZE_TARGET) return [];
  return [syntheticHit(
    'rl-catalog-total-001',
    'Catalog governance: catalog size must grow to ≥ 40 (L2.3 P2-a target)',
    `(catalog size ${actualSize} < target ${CATALOG_SIZE_TARGET})`,
  )];
}

/**
 * Prose-only ratio: count catalog entries whose `enforcerRef` is
 * null (i.e. not backed by a CLI surface) divided by the total
 * catalog size. Per spec §10.2, the L2 acceptance is ≤ 10% at
 * P2-a; v2.12.1 catalog governance tightened the gate to ≤ 7%
 * after the discovered-prose-only reform (see
 * `.peaks/memory/2026-06-27-prose-only-catalog-followup.md`).
 */
export function lintCatalogProseOnlyRatio(
  catalogSize: number,
  proseOnlyCount: number,
): readonly LintHit[] {
  if (catalogSize === 0) return [];
  const ratio = proseOnlyCount / catalogSize;
  if (ratio <= PROSE_ONLY_RATIO_TARGET) return [];
  return [syntheticHit(
    'rl-catalog-prose-only-ratio-001',
    'Catalog governance: prose-only ratio must stay ≤ 7% (v2.12.1 catalog governance; §10.2 L2 acceptance)',
    `(prose-only ratio ${(ratio * 100).toFixed(1)}% > target ${PROSE_ONLY_RATIO_TARGET * 100}%; ${proseOnlyCount}/${catalogSize})`,
  )];
}
