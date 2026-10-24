/**
 * Shaping of a Stryker mutation result into the report's own shape.
 *
 * Two things happen here and nowhere else:
 *
 *   - the per-file buckets (`byFile`) are built, with the per-file kill rate
 *     and the surviving mutants' locations;
 *   - the file names are made PROJECT-RELATIVE and their separators are
 *     normalized to `/`, so the report — and therefore `MUT.sig`, which is a
 *     digest of the report — is identical on Windows and on POSIX.
 */
import { isAbsolute, relative, sep } from 'node:path';

import type { StrykerRawResult } from './mut-runner.js';

/** Stryker 9 MutantResult, re-declared locally so this package does not
 * depend on @stryker-mutator/api (the house convention, see types.ts). */
export interface StrykerMutant {
  readonly fileName: string;
  readonly status:
    | 'Killed'
    | 'Survived'
    | 'Timeout'
    | 'NoCoverage'
    | 'CompileError'
    | 'RuntimeError'
    | 'Ignored'
    | 'Pending';
  readonly replacement: string;
  readonly location: { readonly start: { readonly line: number } };
  readonly statusReason?: string;
}

/** The mutants Stryker produced, as this module reads them. */
type Mutants = ReadonlyArray<StrykerMutant>;

/**
 * Normalize the mutants Stryker produced into the invoker's result shape.
 */
export function normalizeMutants(mutants: Mutants, project: string): StrykerRawResult {
  const { mutantsKilled, mutantsSurvived, mutantsTimeout } = countStatuses(mutants);

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
    // Stryker returns absolute paths in MutantResult.fileName. Strip the
    // project root so byFile[].file is repo-relative (e.g. "src/services/loop/...").
    // path.relative falls back to the absolute path when input is outside
    // project, which is the safest failure mode. The separators are
    // normalized to "/" so the report — and therefore MUT.sig, which is a
    // digest of the report — is identical on Windows and on POSIX.
    const file =
      isAbsolute(m.fileName) && m.fileName.startsWith(project)
        ? relative(project, m.fileName).split(sep).join('/')
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
        survivedBecause: m.statusReason ?? ''
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
    perFile
  };
}

function countStatuses(mutants: Mutants): {
  mutantsKilled: number;
  mutantsSurvived: number;
  mutantsTimeout: number;
} {
  let mutantsKilled = 0;
  let mutantsSurvived = 0;
  let mutantsTimeout = 0;
  for (const m of mutants) {
    if (m.status === 'Killed') mutantsKilled++;
    else if (m.status === 'Survived') mutantsSurvived++;
    else if (m.status === 'Timeout') mutantsTimeout++;
  }
  return { mutantsKilled, mutantsSurvived, mutantsTimeout };
}
