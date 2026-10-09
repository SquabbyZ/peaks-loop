// The `peaks loop run` result presenter: the run-driver's terminal code mapped to a
// process exit code, and to the prose a caller reads after a failed run.
import { MONOTONIC_TERMINATION } from '../../services/loop/spec-service.js';

/** Map a run-driver code to a process exit code. */
export function mapRunDriverCodeToExit(code: string): number {
  if (code === 'RUN_OK' || code === 'RUN_OK_REGRESSION') return 0;
  return 1;
}

export function nextActionsForCode(
  code: string,
  rid: string,
  sid: string,
  summary: { reachedMaxCycles: boolean; regressionCount: number; totalCycles: number }
): string[] {
  switch (code) {
    case 'SPEC_NOT_FOUND':
      return [`Create a spec with \`peaks loop spec bootstrap ${rid} --session ${sid}\`.`];
    case 'SPEC_INVALID':
      return [`Re-run \`peaks loop spec lint <path>\` to see the schema errors.`];
    case 'UNKNOWN_TERMINATION_STRATEGY':
      return [
        `Edit the spec.yaml and set termination.strategy to one of: ${MONOTONIC_TERMINATION}, max-cycles, manual.`
      ];
    case 'MONOTONICITY_VIOLATION':
      return [
        'Inspect the regression rows in the cycles output and the previous cycle row at .peaks/_runtime/' +
          sid +
          '/loop/' +
          rid +
          '/cycles/.',
        'Fix the regression in the next iteration and re-run.'
      ];
    case 'LOCKED':
      return ['Wait for the in-flight loop run to complete, or pick a different rid.'];
    case 'RUN_OK_REGRESSION':
      return ['A regression was observed; the run captured it for operator review.'];
    case 'RUN_OK':
      return [
        `Loop completed ${summary.totalCycles} cycle(s); ${summary.regressionCount} regression(s).`
      ];
    default:
      return ['Inspect the run-driver output above.'];
  }
}
