// Split out of `slice-commands.ts`: the PRD
// body reader and the two decomposition artifact writers `peaks slice decompose`
// uses. Kept apart from the command module so both stay well inside the
// 300-line file cap.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultStateRoot } from 'peaks-loop-workspace-runtime';
import type { DecompositionResult } from '../../services/slice/slice-decompose-types.js';
import { slugifyDescription } from '../../shared/incrementing-number.js';

export type BenchmarkMetrics = {
  totalMs: number;
  codegraphQueries: number;
  p50ConfidenceDistribution: { low: number; mid: number; high: number };
  inputApproxBytes: { prd: number };
  outputJsonBytes: number;
  capturedAt: string;
};

/**
 * The runtime root's non-session `benchmarks/` child. Named as a module
 * constant because the drift guard's reverse check keeps the registry entry
 * alive through a constant's VALUE — an inline literal is invisible to it once
 * the join no longer spells `'_runtime'`.
 */
const BENCHMARKS_DIR = 'benchmarks';

export function readPrdBody(rid: string, projectRoot: string): string {
  // Search all .peaks/**/prd/requests/*-<rid>.md and .peaks/**/prd/requests/<rid>.md
  const searchRoots = [
    join(projectRoot, '.peaks', '2026'),
    join(projectRoot, '.peaks'),
    defaultStateRoot(projectRoot)
  ];
  const matchInDir = (dir: string): string | null => {
    if (!existsSync(dir)) return null;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      return null;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      if (entry === `${rid}.md` || entry.endsWith(`-${slugifyDescription(rid)}.md`)) {
        return readFileSync(join(dir, entry), 'utf8');
      }
    }
    return null;
  };
  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    // 1) Direct prd/requests/ at this root
    const direct = matchInDir(join(root, 'prd', 'requests'));
    if (direct !== null) return direct;
    // 2) One level of subdirs (e.g. .peaks/_runtime/<sid>/prd/requests/)
    let subdirs: string[];
    try {
      subdirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const sub of subdirs) {
      const hit = matchInDir(join(root, sub, 'prd', 'requests'));
      if (hit !== null) return hit;
    }
  }
  throw new Error(
    `PRD body not found for rid=${rid}. Searched under .peaks/2026/prd/requests/, ` +
      `.peaks/prd/requests/, and .peaks/_runtime/*/prd/requests/. ` +
      `Create the PRD with: peaks request init --role prd --id ${rid} --apply --type refactor`
  );
}

export function writeDecompositionFile(
  rid: string,
  result: DecompositionResult,
  projectRoot: string
): string {
  const dir = join(projectRoot, '.peaks', 'sc', 'slice-decomposition');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const outPath = join(dir, `${rid}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  return outPath;
}

export function writeBenchmarkArtifact(
  rid: string,
  benchmark: unknown,
  projectRoot: string
): string {
  // Reuse the current session binding if present; otherwise fall back to
  // a deterministic local dir under the project root. The CLI may be
  // invoked from non-CLI contexts (skill layer); we don't require a session.
  const dir = join(defaultStateRoot(projectRoot), BENCHMARKS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const outPath = join(dir, `${rid}.benchmark.json`);
  writeFileSync(outPath, JSON.stringify(benchmark, null, 2), 'utf8');
  return outPath;
}
