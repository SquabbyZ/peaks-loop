/**
 * `src/cli/commands/observability-commands-baseline.ts`
 *
 * WHY THIS MODULE EXISTS. `peaks observability baseline` is the ONE
 * observability command that writes: `--write` regenerates the tracked
 * results-layer baseline at `.peaks/observability/results-baseline.json`. It
 * lives in its own module because the sibling query module is at the
 * file-size cap, and because a writing command wants its own readable
 * surface rather than being folded into a read-only one.
 *
 * The tracked artifact is NOT CI-enforceable — its source data is gitignored
 * session state — so `--check` never reports a false pass: a missing tracked
 * artifact and a machine with no session data are both failures, because in
 * both cases nothing was compared.
 */

import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import {
  RESULTS_BASELINE_RELATIVE_PATH,
  computeResultsBaseline,
  type ResultsBaseline
} from '../../services/observability/results-baseline.js';
import {
  compareResultsBaseline,
  readTrackedResultsBaseline,
  writeResultsBaseline
} from '../../services/observability/results-baseline-artifact.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveProjectRoot } from './observability-commands-queries.js';

type BaselineCheckData = {
  mode: 'check';
  trackedPath: string;
  drifts: ReturnType<typeof compareResultsBaseline>;
  baseline: ResultsBaseline;
};

/**
 * The `--check` verdict. It NEVER reports a false pass: a missing tracked
 * artifact and a machine with no session data are both failures, because in
 * both cases there is nothing to compare and nothing was verified.
 */
function baselineCheckResult(
  projectRoot: string,
  baseline: ResultsBaseline
): ResultEnvelope<BaselineCheckData> {
  const tracked = readTrackedResultsBaseline(projectRoot);
  if (tracked === null) {
    return fail(
      'observability.baseline',
      'RESULTS_BASELINE_MISSING',
      `No tracked results baseline at ${RESULTS_BASELINE_RELATIVE_PATH} — there is nothing to compare against.`,
      { mode: 'check', trackedPath: RESULTS_BASELINE_RELATIVE_PATH, drifts: [], baseline },
      ['Run `peaks observability baseline --write` to create the tracked artifact.']
    );
  }
  if (baseline.population.sliceCount === 0) {
    return fail(
      'observability.baseline',
      'RESULTS_BASELINE_NO_SESSION_DATA',
      'No observability session data found in this project, so the baseline could not be compared. ' +
        'This is NOT a pass: the source data lives in gitignored session state that a CI runner does not have.',
      { mode: 'check', trackedPath: RESULTS_BASELINE_RELATIVE_PATH, drifts: [], baseline },
      ['Run this check on a machine that has recorded session data.']
    );
  }
  const drifts = compareResultsBaseline(baseline, tracked);
  if (drifts.length > 0) {
    return fail(
      'observability.baseline',
      'RESULTS_BASELINE_DRIFT',
      `${drifts.length} baseline row(s) drifted past the documented tolerance.`,
      { mode: 'check', trackedPath: RESULTS_BASELINE_RELATIVE_PATH, drifts, baseline },
      [
        'Review the drift, then regenerate with `peaks observability baseline --write` if it is intended.'
      ]
    );
  }
  return ok(
    'observability.baseline',
    { mode: 'check', trackedPath: RESULTS_BASELINE_RELATIVE_PATH, drifts, baseline },
    []
  );
}

/**
 * `peaks observability baseline` — print / write / check the tracked
 * results-layer baseline.
 */
export function runBaseline(
  io: ProgramIO,
  options: { project?: string; json?: boolean; write?: boolean; check?: boolean }
): void {
  const projectRoot = resolveProjectRoot(options.project);
  try {
    const baseline = computeResultsBaseline(projectRoot);
    if (options.write === true) {
      const path = writeResultsBaseline(projectRoot, baseline);
      printResult(
        io,
        ok('observability.baseline', { mode: 'write', path, baseline }, []),
        options.json
      );
      return;
    }
    if (options.check === true) {
      const result = baselineCheckResult(projectRoot, baseline);
      printResult(io, result, options.json);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const warnings =
      baseline.population.sliceCount === 0
        ? [
            'No observability session data found — the computed baseline is empty and is NOT a meaningful measurement.'
          ]
        : [];
    printResult(
      io,
      ok('observability.baseline', { mode: 'print', baseline }, warnings),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'observability.baseline',
        'OBSERVABILITY_BASELINE_FAILED',
        getErrorMessage(error),
        { projectRoot },
        []
      ),
      options.json
    );
    process.exitCode = 1;
  }
}
