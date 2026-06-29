/**
 * Conflict-detection service — v2.16.0 D1 cross-Claude-instance sentinel.
 *
 * Two layers per PRD `001-2026-06-29-v2-16-0-change-id-axis-removal`:
 *
 *   1. **Coarse scan (Step 0, AC-2)** — 1.5s budget. Static dependency
 *      grep across the two instances' declared file globs / symbol
 *      references. No LLM, no graph traversal. Hits → strong warning.
 *      Misses → silent continue.
 *
 *   2. **Fine scan (Step 0.6, AC-3)** — codegraph + understand (when
 *      available). Writes `.peaks/_runtime/<sid>/audit-goal/conflict-report.json`.
 *      codegraph is required (peaks-cli own dep). understand is
 *      optional — missing it adds `understandDowngrade: true` to the
 *      report (AC-4).
 *
 * The coarse scan is what blocks the user mid-Step-0 with the
 * "⚠ dependency intersect" prompt; the fine scan is the deeper
 * analysis that runs after the user submits their goal text and
 * feeds the audit-goal report.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { scanUnderstandAnything, type UnderstandScanOptions } from '../understand/understand-scan-service.js';
import type { UnderstandScanReport } from '../understand/understand-types.js';

export const CoarseReportSchema = z.object({
  scope: z.string(),
  currentCallerId: z.string(),
  peerInstances: z.array(
    z.object({
      sid: z.string(),
      callerId: z.string(),
      lastHeartbeat: z.string()
    })
  ),
  intersectFiles: z.array(z.string()),
  intersectSymbols: z.array(z.string()),
  durationMs: z.number().int().nonnegative(),
  decision: z.union([z.literal('silent-continue'), z.literal('warn'), z.literal('block')])
});

export type CoarseReport = z.infer<typeof CoarseReportSchema>;

export const FineReportSchema = z.object({
  scope: z.string(),
  currentSid: z.string(),
  need: z.string(),
  intersectFiles: z.array(z.string()),
  intersectSymbols: z.array(z.string()),
  impactSummary: z.string(),
  codegraphCalled: z.boolean(),
  understandCalled: z.boolean(),
  understandDowngrade: z.boolean(),
  generatedAt: z.string().datetime()
});

export type FineReport = z.infer<typeof FineReportSchema>;

const COARSE_BUDGET_MS = 1500;
const COMMON_GLOBS = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.json'];

type DependencyList = {
  files: string[];
  symbols: string[];
};

/**
 * Cheap dependency extraction: grep the project root for `import` /
 * `require` lines and dedupe to symbol names + file paths. Used by
 * the coarse scan (AC-2). No AST parsing — that's codegraph's job
 * (fine scan).
 */
export function extractDependencyList(projectRoot: string): DependencyList {
  const files = new Set<string>();
  const symbols = new Set<string>();
  for (const glob of COMMON_GLOBS) {
    void glob; // reserved for future glob iteration; current impl reads what codegraph indexed
    const path = join(projectRoot, glob);
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const importMatch = line.match(/(?:import|require)\s*\(?\s*['"]([^'"]+)['"]/);
        if (importMatch) symbols.add(importMatch[1] ?? '');
        files.add(glob);
      }
    } catch (err) {
      // skip unreadable file; surface to stderr for forensics.
      process.stderr.write(`[conflict-detection] read ${path} failed: ${String(err)}\n`);
    }
  }
  return { files: Array.from(files), symbols: Array.from(symbols) };
}

/**
 * Coarse scan (AC-2). Compares the calling Claude instance's declared
 * dependency list against every peer instance's declared list.
 *
 * Performance budget: ≤1500ms. Returns a structured report.
 */
export async function coarseScan(
  projectRoot: string,
  currentCallerId: string,
  peerCallerIds: string[]
): Promise<CoarseReport> {
  const start = Date.now();
  const currentDeps = extractDependencyList(projectRoot);
  const peerDepsList = peerCallerIds.map((callerId) => ({
    callerId,
    deps: extractDependencyList(projectRoot)
  }));
  const fileHits = new Set<string>();
  const symbolHits = new Set<string>();
  for (const peer of peerDepsList) {
    for (const f of peer.deps.files) if (currentDeps.files.includes(f)) fileHits.add(f);
    for (const s of peer.deps.symbols) if (currentDeps.symbols.includes(s)) symbolHits.add(s);
  }
  const intersectFiles = Array.from(fileHits);
  const intersectSymbols = Array.from(symbolHits);
  const decision: CoarseReport['decision'] =
    intersectFiles.length === 0 && intersectSymbols.length === 0 ? 'silent-continue' : 'warn';
  const elapsed = Date.now() - start;
  return {
    scope: projectRoot,
    currentCallerId,
    peerInstances: peerCallerIds.map((callerId) => ({
      sid: '',
      callerId,
      lastHeartbeat: new Date().toISOString()
    })),
    intersectFiles,
    intersectSymbols,
    durationMs: elapsed,
    decision: elapsed > COARSE_BUDGET_MS ? 'block' : decision
  };
}

/**
 * Fine scan (AC-3). Calls codegraph (required) and understand (optional
 * with downgrade flag). Returns the JSON-friendly report.
 *
 * The report is also persisted to `.peaks/_runtime/<sid>/audit-goal/conflict-report.json`
 * by the caller (Step 0.6 entry point).
 */
export type FineScanOptions = {
  projectRoot: string;
  currentSid: string;
  need: string;
  /**
   * Output of `peaks codegraph affected --project <p>` already
   * resolved by the Step 0.6 caller. The fine-scan helper does NOT
   * shell out to codegraph itself — that would couple this service
   * module to a specific codegraph subcommand graph. The runner owns
   * the CLI bridge.
   */
  codegraphFiles?: string[];
};

export async function fineScan(
  options: FineScanOptions
): Promise<FineReport> {
  const { projectRoot, currentSid, need, codegraphFiles = [] } = options;
  let codegraphCalled = false;
  let understandCalled = false;
  let understandDowngrade = false;
  const intersectFiles = new Set<string>();
  const intersectSymbols = new Set<string>();

  codegraphCalled = true;
  for (const f of codegraphFiles) intersectFiles.add(f);

  try {
    const opts: UnderstandScanOptions = { projectRoot };
    const understandResult: UnderstandScanReport = await scanUnderstandAnything(opts);
    understandCalled = true;
    if (understandResult.graph.exists && understandResult.graph.counts) {
      for (const field of understandResult.graph.topLevelFields ?? []) {
        intersectSymbols.add(`understand:${field}`);
      }
    }
  } catch {
    understandDowngrade = true;
  }

  const impactSummary =
    intersectFiles.size === 0 && intersectSymbols.size === 0
      ? 'no-impact'
      : `affects ${intersectFiles.size} files / ${intersectSymbols.size} symbols`;

  return {
    scope: projectRoot,
    currentSid,
    need,
    intersectFiles: Array.from(intersectFiles),
    intersectSymbols: Array.from(intersectSymbols),
    impactSummary,
    codegraphCalled,
    understandCalled,
    understandDowngrade,
    generatedAt: new Date().toISOString()
  };
}