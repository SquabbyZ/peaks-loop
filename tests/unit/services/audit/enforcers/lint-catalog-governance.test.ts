/**
 * Unit tests for P2-a Theme G — catalog governance enforcers.
 *
 * Two enforcers: catalog size must grow to ≥ 40 (the P2-a
 * target) and prose-only ratio must stay ≤ 7% (v2.12.1
 * catalog governance — tightened from the pre-reform 5%
 * target; see `.peaks/memory/2026-06-27-prose-only-catalog-
 * followup.md`).
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
    // 7% target — at 7% exactly we pass
    expect(lintCatalogProseOnlyRatio(100, Math.floor(100 * PROSE_ONLY_RATIO_TARGET))).toEqual([]);
    // 0 prose-only entries trivially passes
    expect(lintCatalogProseOnlyRatio(100, 0)).toEqual([]);
  });

  it('returns a hit when the prose-only ratio exceeds the target', () => {
    // 8% prose-only (8/100) — should fire (above 7%)
    const hits = lintCatalogProseOnlyRatio(100, 8);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-catalog-prose-only-ratio-001');
  });

  it('returns no hit when the catalog is empty (avoids divide-by-zero)', () => {
    expect(lintCatalogProseOnlyRatio(0, 0)).toEqual([]);
  });

  it('v2.12.1 baseline: peaks-cli catalog at 9/148 = 6.1% passes the 7% gate', () => {
    // Post-reform baseline: 9 prose-only entries out of 148 total red lines.
    expect(lintCatalogProseOnlyRatio(148, 9)).toEqual([]);
  });
});
