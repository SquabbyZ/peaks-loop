/**
 * Production Stryker invoker. Uses @stryker-mutator/core programmatic API.
 * Note: this is a thin wrapper — actual Stryker invocation requires the
 * Stryker config in `stryker.conf.js` to live at the project root.
 */
import { relative, isAbsolute } from 'node:path';
import type { StrykerInvoker, StrykerRawResult } from './mut-runner.js';

// Stryker 8 MutantResult is the structural shape returned by
// `stryker.runMutationTest()` (see @stryker-mutator/core Stryker type).
// We only consume a narrow subset, so re-declare it locally to avoid
// pulling @stryker-mutator/api as a direct dependency.
interface StrykerMutant {
  readonly fileName: string;
  readonly status: 'Killed' | 'Survived' | 'Timeout' | 'NoCoverage' | 'CompileError' | 'RuntimeError' | 'Ignored' | 'Pending';
  readonly replacement: string;
  readonly location: { readonly start: { readonly line: number } };
  readonly statusReason?: string;
}

export function createProductionStrykerInvoker(): StrykerInvoker {
  return async ({ project, testFiles: _testFiles }) => {
    // Lazy-load Stryker so unit tests don't need it installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stryker = (await import('@stryker-mutator/core')).Stryker;
    // Mutation surface is owned by stryker.conf.js. testFiles is a runtime
    // hint (consumed by the configured testRunner, not by Stryker's `mutate`
    // field — `mutate` is source files to mutate, never test paths).
    const stryker = new Stryker({});
    const mutants = (await stryker.runMutationTest()) as ReadonlyArray<StrykerMutant>;
    return normalize(mutants, project);
  };
}

function normalize(mutants: ReadonlyArray<StrykerMutant>, project: string): StrykerRawResult {
  let mutantsKilled = 0;
  let mutantsSurvived = 0;
  let mutantsTimeout = 0;
  for (const m of mutants) {
    if (m.status === 'Killed') mutantsKilled++;
    else if (m.status === 'Survived') mutantsSurvived++;
    else if (m.status === 'Timeout') mutantsTimeout++;
  }

  // Bucket mutants by fileName to populate perFile. deriveFollowups iterates
  // m.byFile to emit per-file followups (e.g. low_kill_rate) — leaving this
  // empty (as v0 did) silently swallowed those followups in production.
  const byFile = new Map<
    string,
    {
      killed: number;
      survived: number;
      survivedEntries: Array<{ line: number; mutation: string; survivedBecause: string }>;
    }
  >();
  for (const m of mutants) {
    // Stryker 8 returns absolute paths in MutantResult.fileName. Strip the
    // project root so byFile[].file is repo-relative (e.g. "src/services/loop/...").
    // path.relative falls back to the absolute path when input is outside
    // project, which is the safest failure mode.
    const file = isAbsolute(m.fileName) && m.fileName.startsWith(project)
      ? relative(project, m.fileName)
      : m.fileName;
    let bucket = byFile.get(file);
    if (!bucket) {
      bucket = { killed: 0, survived: 0, survivedEntries: [] };
      byFile.set(file, bucket);
    }
    if (m.status === 'Killed') bucket.killed++;
    else if (m.status === 'Survived') {
      bucket.survived++;
      bucket.survivedEntries.push({
        line: m.location.start.line + 1, // Stryker is 0-based; reports are 1-based.
        mutation: m.replacement,
        survivedBecause: m.statusReason ?? '',
      });
    }
  }

  const perFile = [...byFile.entries()]
    .map(([file, b]) => {
      const total = b.killed + b.survived;
      const killRate = total === 0 ? 0 : b.killed / total;
      return { file, killRate, survived: b.survivedEntries };
    })
    // Stable order for MUT.sig / reports.
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    mutantsTotal: mutants.length,
    mutantsKilled,
    mutantsSurvived,
    mutantsTimeout,
    perFile,
  };
}
