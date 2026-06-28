/**
 * P2-b Theme L — Audit regression enforcers.
 *
 * Slice #7 L2.4. These four enforcers run during the audit
 * and check the audit framework's own integrity. They are
 * the "gating" layer that `peaks slice check`'s new
 * audit-regression stage asserts.
 *
 * Four checks:
 *   1. catalog-stability       — catalog size has not grown >20% in 90 days
 *   2. no-orphan-enforcer      — every enforcerRef points to a real file
 *   3. no-orphan-catalog       — every catalog entry has a non-null enforcerRef
 *   4. runtime-budget          — audit completes in < 2s on a 100-reference project
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RED_LINE_CATALOG } from '../red-line-catalog.js';
import type { LintHit } from './lint-style.js';

export const CATALOG_STABILITY_GROWTH_CAP = 0.20;
export const CATALOG_STABILITY_WINDOW_DAYS = 90;
export const RUNTIME_BUDGET_MS = 2000;

const fakeCatalogPath = 'src/services/audit/red-line-catalog.ts';

function syntheticHit(catalogId: string, rule: string, detail: string): LintHit {
  return {
    catalogId,
    rule,
    file: fakeCatalogPath,
    line: 1,
    matchedText: detail,
  };
}

export interface CatalogStabilityInput {
  /** Current catalog size (entries.length). */
  readonly currentSize: number;
  /** Catalog size 90 days ago, or null if no history available. */
  readonly sizeNinetyDaysAgo: number | null;
}

export function lintCatalogStability(input: CatalogStabilityInput): readonly LintHit[] {
  if (input.sizeNinetyDaysAgo === null || input.sizeNinetyDaysAgo === 0) {
    // No historical data — can't check stability. Treat as a
    // soft pass (the catalog-stability enforcer is
    // non-blocking when the data is missing).
    return [];
  }
  const growth = (input.currentSize - input.sizeNinetyDaysAgo) / input.sizeNinetyDaysAgo;
  if (growth <= CATALOG_STABILITY_GROWTH_CAP) return [];
  return [syntheticHit(
    'rl-audit-catalog-stability-001',
    'catalog size has not grown > 20% in the last 90 days',
    `(growth ${(growth * 100).toFixed(1)}% over 90 days; currentSize=${input.currentSize}, priorSize=${input.sizeNinetyDaysAgo})`,
  )];
}

export function lintNoOrphanEnforcer(projectRoot: string): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (const entry of RED_LINE_CATALOG) {
    if (!entry.enforcerRef) continue;
    const absPath = join(projectRoot, entry.enforcerRef);
    if (!existsSync(absPath)) {
      hits.push(syntheticHit(
        'rl-audit-no-orphan-enforcer-001',
        'every enforcerRef points to a real file',
        `(enforcerRef "${entry.enforcerRef}" for ${entry.id} does not exist on disk)`,
      ));
    }
  }
  return hits;
}

export function lintNoOrphanCatalog(): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (const entry of RED_LINE_CATALOG) {
    if (entry.enforcerRef === null) {
      hits.push(syntheticHit(
        'rl-audit-no-orphan-catalog-001',
        'every catalog entry has a non-null enforcerRef (or a documented reason)',
        `(catalog entry ${entry.id} has enforcerRef: null)`,
      ));
    }
  }
  return hits;
}

export function lintRuntimeBudget(
  projectRoot: string,
  observedMs: number
): readonly LintHit[] {
  if (observedMs <= RUNTIME_BUDGET_MS) return [];
  return [syntheticHit(
    'rl-audit-runtime-budget-001',
    `peaks audit red-lines completes in < ${RUNTIME_BUDGET_MS}ms on a 100-reference project`,
    `(observed ${observedMs}ms > budget ${RUNTIME_BUDGET_MS}ms)`,
  )];
}

/**
 * Read the catalog-stability history file (if it exists). The
 * file is a small JSON document maintained by the release
 * pipeline; absent → null. We do not invent the historical
 * data; absent data means "soft pass".
 */
export function readCatalogHistory(projectRoot: string): number | null {
  const path = join(projectRoot, '.peaks', 'audit-catalog-history.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sizeNinetyDaysAgo?: number };
    return typeof raw.sizeNinetyDaysAgo === 'number' ? raw.sizeNinetyDaysAgo : null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}
