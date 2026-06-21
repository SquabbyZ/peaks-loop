/**
 * Production Stryker invoker. Uses @stryker-mutator/core programmatic API.
 * Note: this is a thin wrapper — actual Stryker invocation requires the
 * Stryker config in `stryker.conf.js` to live at the project root.
 */
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

// Stryker accepts PartialStrykerOptions (DeepPartial<StrykerOptions>) where
// StrykerOptions.mutate is `string[]`. ReadonlyArray<string> from
// StrykerInvoker.testFiles is structurally assignable to string[], so the
// spread below is the only conversion needed — no cast at the call site.
type StrykerOptionsSubset = { mutate: string[] };

export function createProductionStrykerInvoker(): StrykerInvoker {
  return async ({ project, testFiles }) => {
    // Lazy-load Stryker so unit tests don't need it installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stryker = (await import('@stryker-mutator/core')).Stryker;
    const options: StrykerOptionsSubset = {
      // Project-rooted config; explicit overrides here are minimal.
      mutate: [...testFiles],
    };
    // Single cast derives from Stryker's actual constructor signature.
    // Stryker 8's MutantResult extends our local StrykerMutant structurally.
    const stryker = new Stryker(options as ConstructorParameters<typeof Stryker>[0]);
    const mutants = (await stryker.runMutationTest()) as ReadonlyArray<StrykerMutant>;
    return normalize(mutants, project);
  };
}

function normalize(mutants: ReadonlyArray<StrykerMutant>, _project: string): StrykerRawResult {
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
    const file = m.fileName;
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
