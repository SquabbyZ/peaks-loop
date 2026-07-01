/**
 * W7 CC-β — Phase 6 Task 20: e2e integration test for slice topology.
 *
 * Runs `MultiPassOrchestrator.decompose()` against the real peaks-loop config
 * service (`src/services/config/`) and asserts the v2 output structure.
 * This is the smoke test for the slice-topology algorithm against a real,
 * non-fixture project — proves it works end-to-end on Windows file I/O.
 *
 * Real-path e2e strategy:
 *   - The PRD carries `## Acceptance Criteria` bullets that mention each
 *     config-service file by name. The 6-stage algorithm's AC extractor
 *     parses those bullets; `matchAcToHit` then matches each AC against
 *     codegraph `query` hits by file basename.
 *   - We inject a fake `codegraphRunner` whose `query(text, projectRoot)`
 *     returns the real `src/services/config/*.ts` files that match the
 *     keywords in `text`. This keeps the algorithm's real code path intact
 *     (PRD → ACs → codegraph → work-units → dependency DAG → v2 result)
 *     while avoiding a real `npx codegraph` shell-out (which would require
 *     a pre-initialised codegraph DB).
 *   - The default `importEdgeRunner` parses real `import ... from`
 *     statements from the actual source files — that's the part of the
 *     algorithm that genuinely touches the real codebase.
 *   - The default `understandRunner` reads `.understand-anything/` from
 *     disk and returns null when not indexed (the algorithm tolerates this).
 *   - The cross-pass edge merger (`merge`) runs unconditionally when there
 *     are ≥2 passes (W6 fix #1) and uses static detection only — no LLM
 *     runner is supplied so `llmArbitrations` stays empty.
 *
 * Spec: docs/superpowers/plans/2026-06-25-slice-topology-multipass-phase-6.md
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decompose } from '../../src/services/slice/multi-pass-orchestrator.js';
import type { CodegraphRunner } from '../../src/services/slice/slice-decompose-types.js';
import { configServiceDir } from './fixture-paths.js';

const E2E_TIMEOUT_MS = 30_000;

/**
 * Discover the real `src/services/config/*.ts` files at test time. Using
 * `readdirSync` keeps the test resilient to future additions of new config
 * files.
 */
function listConfigServiceFiles(): readonly string[] {
  return readdirSync(configServiceDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join('src/services/config', name));
}

/**
 * Build a fake `codegraphRunner` that maps an AC's text to one or more
 * real config-service files whose basename appears in the AC. The
 * `matchAcToHit` algorithm in the slice service lower-cases the AC and
 * checks if the basename of each hit is a substring of the AC — so we
 * return a hit per file whose basename appears in the query text.
 */
function buildCodegraphRunner(): CodegraphRunner {
  const allFilePaths = listConfigServiceFiles();

  return {
    async query(text, _projectRoot) {
      const lower = text.toLowerCase();
      const matches = allFilePaths.filter((rel) => {
        const base = basename(rel, '.ts').toLowerCase();
        return lower.includes(base);
      });
      return matches.map((rel, i) => {
        const abs = join(configServiceDir, basename(rel));
        const loc = existsSync(abs) ? readFileSync(abs, 'utf8').split('\n').length : 0;
        return {
          id: `file:${rel}`,
          kind: 'file',
          name: basename(rel, '.ts'),
          filePath: rel,
          score: 1 - i * 0.1,
          loc
        };
      });
    },
    async affected() {
      return {
        changedFiles: [],
        affectedTests: [],
        totalDependentsTraversed: 0
      };
    },
    async status() {
      return { indexed: true, nodes: 0, edges: 0, dbMB: 0, freshness: 'fake' };
    }
  };
}

/**
 * Realistic PRD with 3 acceptance criteria that map to 3 of the real
 * config-service files. This is what the algorithm will turn into 3
 * Pass-1 work units, then 3 Pass-2 (file-level) sub-slices.
 */
const PRD_WITH_ACS = `# Refactor config-service

## Acceptance Criteria

- audit config-service surface for unused exports
- inspect config-migration for legacy schema handling
- audit sidecar-store for atomic-write race conditions
`;

describe('slice-topology e2e', () => {
  it('produces v2 multi-pass output against the real peaks-loop config service', async () => {
    const codegraphRunner = buildCodegraphRunner();
    const result = await decompose(
      'e2e-slice-topology',
      PRD_WITH_ACS,
      configServiceDir,
      { granularity: 'both', codegraphRunner }
    );

    // v2 envelope contract
    expect(result.schemaVersion).toBe('v2');
    expect(result.rid).toBe('e2e-slice-topology');
    expect(result.partial).toBe(false);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // 'both' granularity → at least Pass 1 (service) must run.
    expect(result.passes.length).toBeGreaterThanOrEqual(1);

    // Pass 1 must be the service-level pass.
    expect(result.passes[0]?.granularity).toBe('service');

    // Every pass must have produced at least one slice and the slice ids
    // follow the v2 convention: Pass 1 → W1..Wn, Pass 2 → Wn.m children.
    for (const pass of result.passes) {
      expect(pass.slices.length).toBeGreaterThan(0);
      for (const slice of pass.slices) {
        expect(slice.granularity).toBe(pass.granularity);
        expect(slice.files.length).toBeGreaterThan(0);
        expect(slice.id).toMatch(/^W\d+(\.\d+)?$/);
        // LoC is computed by the algorithm; just assert it's a non-negative integer.
        expect(slice.loc).toBeGreaterThanOrEqual(0);
      }
    }

    // crossPassEdges and llmArbitrations are present (may be empty without an
    // llmRunner — but the arrays must exist and be readonly).
    expect(Array.isArray(result.crossPassEdges)).toBe(true);
    expect(Array.isArray(result.llmArbitrations)).toBe(true);

    // Codegraph + understand-anything envelopes are populated.
    expect(result.codegraph).toBeDefined();
    expect(result.understandAnything).toBeDefined();
  }, E2E_TIMEOUT_MS);

  it('returns a single service-level pass when granularity=service', async () => {
    const codegraphRunner = buildCodegraphRunner();
    const result = await decompose(
      'e2e-service-only',
      PRD_WITH_ACS,
      configServiceDir,
      { granularity: 'service', codegraphRunner }
    );

    expect(result.schemaVersion).toBe('v2');
    expect(result.rid).toBe('e2e-service-only');
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0]?.granularity).toBe('service');
    expect(result.passes[0]?.slices.length).toBeGreaterThan(0);
    // No cross-pass edges possible with a single pass.
    expect(result.crossPassEdges).toHaveLength(0);
  }, E2E_TIMEOUT_MS);

  it('returns a single file-level pass when granularity=file', async () => {
    const codegraphRunner = buildCodegraphRunner();
    const result = await decompose(
      'e2e-file-only',
      PRD_WITH_ACS,
      configServiceDir,
      { granularity: 'file', codegraphRunner }
    );

    expect(result.schemaVersion).toBe('v2');
    expect(result.rid).toBe('e2e-file-only');
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0]?.granularity).toBe('file');
    expect(result.passes[0]?.slices.length).toBeGreaterThan(0);
    // Every file-level slice has a null parent (no Pass 1 ancestor).
    for (const slice of result.passes[0]?.slices ?? []) {
      expect(slice.parentSliceId).toBeNull();
    }
    expect(result.crossPassEdges).toHaveLength(0);
  }, E2E_TIMEOUT_MS);
});
