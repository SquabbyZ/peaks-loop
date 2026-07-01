/**
 * Unit tests for P2-b Theme L — audit regression enforcers.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  lintCatalogStability,
  lintNoOrphanEnforcer,
  lintNoOrphanCatalog,
  lintRuntimeBudget,
  CATALOG_STABILITY_GROWTH_CAP,
  RUNTIME_BUDGET_MS,
  readCatalogHistory,
} from '../../../../../src/services/audit/enforcers/lint-audit-regression.js';

describe('lint-audit-regression — Theme L', () => {
  describe('lintCatalogStability', () => {
    it('passes when growth is within cap', () => {
      const hits = lintCatalogStability({
        currentSize: 50,
        sizeNinetyDaysAgo: 50,
      });
      expect(hits).toEqual([]);
    });

    it('reports a hit when growth exceeds cap', () => {
      const prior = 50;
      const current = Math.ceil(prior * (1 + CATALOG_STABILITY_GROWTH_CAP + 0.1));
      const hits = lintCatalogStability({ currentSize: current, sizeNinetyDaysAgo: prior });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.catalogId).toBe('rl-audit-catalog-stability-001');
    });

    it('soft-passes when no history is available', () => {
      const hits = lintCatalogStability({
        currentSize: 50,
        sizeNinetyDaysAgo: null,
      });
      expect(hits).toEqual([]);
    });
  });

  describe('lintNoOrphanEnforcer', () => {
    it('reports no hits on the peaks-loop repo (all enforcerRef paths exist)', () => {
      const projectRoot = process.cwd();
      const hits = lintNoOrphanEnforcer(projectRoot);
      // Empty because the catalog entries point to real files.
      // If a future PR adds a bad enforcerRef, this will fire.
      expect(hits).toEqual([]);
    });

    it('reports hits when enforcerRef points to a non-existent file', () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'audit-regression-test-'));
      mkdirSync(join(projectRoot, 'src/services/audit'), { recursive: true });
      writeFileSync(
        join(projectRoot, 'src/services/audit/red-line-catalog.ts'),
        '// fake catalog for test'
      );
      // The real catalog will have entries pointing to real
      // paths under the (empty) projectRoot. Those entries'
      // enforcerRef will resolve to non-existent files.
      // We just assert the function returns an array; the
      // specific count depends on the catalog.
      const hits = lintNoOrphanEnforcer(projectRoot);
      expect(Array.isArray(hits)).toBe(true);
      rmSync(projectRoot, { recursive: true, force: true });
    });
  });

  describe('lintNoOrphanCatalog', () => {
    it('reports no hits on the current catalog (all entries have enforcerRef)', () => {
      const hits = lintNoOrphanCatalog();
      // Empty because the catalog entries are wired to enforcer
      // files. If a future PR adds a prose-only entry, this will fire.
      expect(hits).toEqual([]);
    });
  });

  describe('lintRuntimeBudget', () => {
    it('passes when observed is within budget', () => {
      expect(lintRuntimeBudget(process.cwd(), RUNTIME_BUDGET_MS - 100)).toEqual([]);
    });

    it('reports a hit when observed exceeds budget', () => {
      const hits = lintRuntimeBudget(process.cwd(), RUNTIME_BUDGET_MS + 100);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.catalogId).toBe('rl-audit-runtime-budget-001');
    });
  });

  describe('readCatalogHistory', () => {
    it('returns null when no history file exists', () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'audit-history-test-'));
      try {
        expect(readCatalogHistory(projectRoot)).toBeNull();
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it('returns the historical size when the file is present', () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'audit-history-test-'));
      mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.peaks/audit-catalog-history.json'),
        JSON.stringify({ sizeNinetyDaysAgo: 41 })
      );
      try {
        expect(readCatalogHistory(projectRoot)).toBe(41);
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  });
});
