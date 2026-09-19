/**
 * P2-a Theme G — catalog governance.
 *
 * Two enforcers: catalog size must grow to ≥ 40 (the P2-a target),
 * and the prose-only ratio must stay ≤ 7% (per spec §10.2 L2
 * acceptance). Both fire on the state the classifier produced — no
 * extra file scan beyond what the audit already did.
 *
 * C6 of the 2026-09-15 diagnosis: this gate and
 * `prose-ratio-calculator.computeProseRatio` (behind
 * `peaks audit prose-ratio`) are the two "prose-only ratio" gates, and
 * they used to disagree. The calculator excluded `informational` rows
 * from its numerator; this one excluded `informational` rows from *its*
 * numerator by a different route (red-lines-service passed it a
 * `proseOnlyCount` that had already been filtered). Both now measure the
 * same quantity, identically defined:
 *
 *   numerator   = rows classified `backing === 'prose-only'`, all of them
 *   denominator = every classified row (`entries.length`)
 *
 * They still carry different *thresholds* — 7% here, 5% as the
 * `peaks audit prose-ratio` default — which is a policy difference, not
 * an accounting one. Nothing redefines what is being counted.
 */
import type { LintHit, SkillFile } from './lint-style.js';

export const CATALOG_SIZE_TARGET = 40;
// The v2.12.1 reform left this at 7% by demoting discovered advisory
// rows out of the numerator. S3 of the 2026-09-15 diagnosis-remediation
// job removed that demotion, so the observed ratio is 66% (101/153) —
// the gate now fires, which is the intended outcome: the number was
// always this bad, it was just being reported as 0%.
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
    lines: []
  };
  return {
    catalogId,
    rule,
    file: fake.path,
    line: 1,
    matchedText: matched
  };
}

export function lintCatalogSize(actualSize: number): readonly LintHit[] {
  if (actualSize >= CATALOG_SIZE_TARGET) return [];
  return [
    syntheticHit(
      'rl-catalog-total-001',
      'Catalog governance: catalog size must grow to ≥ 40 (L2.3 P2-a target)',
      `(catalog size ${actualSize} < target ${CATALOG_SIZE_TARGET})`
    )
  ];
}

/**
 * Prose-only ratio: rows the classifier tagged `prose-only`, divided by
 * every row the classifier produced. `catalogSize` is a slight misnomer
 * — it is `entries.length`, the count of classified rows, not the size of
 * the hand-maintained catalog. Same numerator and denominator as
 * `computeProseRatio`; see the module docstring above.
 */
export function lintCatalogProseOnlyRatio(
  catalogSize: number,
  proseOnlyCount: number
): readonly LintHit[] {
  if (catalogSize === 0) return [];
  const ratio = proseOnlyCount / catalogSize;
  if (ratio <= PROSE_ONLY_RATIO_TARGET) return [];
  return [
    syntheticHit(
      'rl-catalog-prose-only-ratio-001',
      'Catalog governance: prose-only ratio must stay ≤ 7% (v2.12.1 catalog governance; §10.2 L2 acceptance)',
      `(prose-only ratio ${(ratio * 100).toFixed(1)}% > target ${PROSE_ONLY_RATIO_TARGET * 100}%; ${proseOnlyCount}/${catalogSize})`
    )
  ];
}
