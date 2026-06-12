/**
 * Unit tests for P2-a Theme G — catalog governance enforcers.
 *
 * Two enforcers: catalog size must grow to ≥ 40 (the P2-a
 * target) and prose-only ratio must stay ≤ 5% (per §10.2 L2
 * acceptance).
 */
import { describe, it, expect } from 'vitest';
import {
  lintCatalogSize,
  lintCatalogProseOnlyRatio,
  CATALOG_SIZE_TARGET,
  PROSE_ONLY_RATIO_TARGET,
} from '../../../../../src/services/audit/enforcers/lint-catalog-governance.js';

describe('lint-catalog-governance — Theme G', () => {
  it('returns no hit when the catalog is at or above the size target', () => {
    expect(lintCatalogSize(CATALOG_SIZE_TARGET)).toEqual([]);
    expect(lintCatalogSize(CATALOG_SIZE_TARGET + 5)).toEqual([]);
  });

  it('returns a hit when the catalog is below the size target', () => {
    const hits = lintCatalogSize(CATALOG_SIZE_TARGET - 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-catalog-total-001');
  });

  it('passes the prose-only ratio when the ratio is at or below the target', () => {
    // 5% target — at 5% exactly we pass
    expect(lintCatalogProseOnlyRatio(40, Math.floor(40 * PROSE_ONLY_RATIO_TARGET))).toEqual([]);
    // 0 prose-only entries trivially passes
    expect(lintCatalogProseOnlyRatio(40, 0)).toEqual([]);
  });

  it('returns a hit when the prose-only ratio exceeds the target', () => {
    // 10% prose-only — should fire
    const hits = lintCatalogProseOnlyRatio(40, 4);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-catalog-prose-only-ratio-001');
  });

  it('returns no hit when the catalog is empty (avoids divide-by-zero)', () => {
    expect(lintCatalogProseOnlyRatio(0, 0)).toEqual([]);
  });
});
