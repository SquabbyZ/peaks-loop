/**
 * P2-a Theme G — catalog governance.
 *
 * Two enforcers: catalog size must grow to ≥ 40 (the P2-a target),
 * and the prose-only ratio must stay ≤ 5% (per spec §10.2 L2
 * acceptance). Both fire on the catalog's static state — no file
 * scan, just the catalog itself.
 */
import type { LintHit, SkillFile } from './lint-style.js';

export const CATALOG_SIZE_TARGET = 40;
export const PROSE_ONLY_RATIO_TARGET = 0.05;

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
 * P2-a; this slice tightens to ≤ 5%.
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
    'Catalog governance: prose-only ratio must stay ≤ 5% (per §10.2 L2 acceptance)',
    `(prose-only ratio ${(ratio * 100).toFixed(1)}% > target ${PROSE_ONLY_RATIO_TARGET * 100}%; ${proseOnlyCount}/${catalogSize})`,
  )];
}
