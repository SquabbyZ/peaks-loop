// Next-action builders and "artifact not found" envelopes for the scope-check
// subcommands (`scan acceptance-coverage`, `scan diff-vs-scope`). They live in
// their own module so the command/runners file stays a declaration + runner
// file: every message here is a pure function of the report it is handed.

import { fail } from 'peaks-loop-shared/result';

import type {
  AcceptanceCoverageError,
  AcceptanceCoverageReport
} from '../../services/scan/acceptance-coverage-service.js';
import type { DiffScopeReport } from '../../services/scan/diff-scope-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import type { AcceptanceCoverageOptions, DiffVsScopeOptions } from './scan-command-shared.js';

export function acceptanceCoverageNextActions(result: AcceptanceCoverageReport): string[] {
  const nextActions: string[] = [];
  if (result.acceptanceItems.length === 0) {
    nextActions.push(
      'PRD has no "## Acceptance criteria" bullets. Fill them in before running the coverage check.'
    );
  }
  if (result.uncovered.length > 0) {
    nextActions.push(
      `${result.uncovered.length} acceptance item(s) have no linked test case. Add a "- **Acceptance:** ${result.uncovered.map((u) => u.id).join(', ')}" field to the relevant test cases.`
    );
  }
  if (result.invalidReferences.length > 0) {
    nextActions.push(
      `${result.invalidReferences.length} test case(s) reference an acceptance id that does not exist in the PRD. Fix or remove these references.`
    );
  }
  if (result.unlinkedTestCases.length > 0) {
    nextActions.push(
      `${result.unlinkedTestCases.length} test case(s) have no Acceptance: field. Link them to acceptance items, or document why they exist (e.g. defense-in-depth regressions).`
    );
  }
  return nextActions;
}

export function printAcceptanceCoverageLookupFailure(
  io: ProgramIO,
  options: AcceptanceCoverageOptions,
  result: AcceptanceCoverageError
): void {
  const code = result.kind === 'prd-not-found' ? 'PRD_NOT_FOUND' : 'TEST_CASES_NOT_FOUND';
  const message =
    result.kind === 'prd-not-found'
      ? `PRD artifact for requestId=${options.rid} not found`
      : `QA test-cases file not found at ${result.expectedPath}`;
  printResult(
    io,
    fail('scan.acceptance-coverage', code, message, { requestId: options.rid }, [
      result.kind === 'prd-not-found'
        ? 'Run `peaks request init --role prd --id <rid> --apply --type <type>` first.'
        : 'Generate qa/test-cases/<rid>.md before running this check.'
    ]),
    options.json
  );
  process.exitCode = 1;
}

export function diffVsScopeNextActions(result: DiffScopeReport): string[] {
  const nextActions: string[] = [];
  if (!result.gitAvailable) {
    nextActions.push('git not available; scope check skipped. Cross-check the diff manually.');
  }
  if (!result.patternsDeclared) {
    nextActions.push(
      'RD artifact has no in-scope or out-of-scope patterns under "## Red-line scope". Add concrete path/glob patterns (e.g. `src/services/login/**`) before re-running.'
    );
  }
  if (result.violations.length > 0) {
    nextActions.push(
      `${result.violations.length} file(s) match an explicit out-of-scope pattern. Revert these or expand the RD red-line scope with PRD approval.`
    );
  }
  if (result.unclassified.length > 0) {
    nextActions.push(
      `${result.unclassified.length} changed file(s) do not match any declared scope pattern. Either add them to the in-scope list (if intentional) or revert them.`
    );
  }
  return nextActions;
}

export function printDiffVsScopeLookupFailure(io: ProgramIO, options: DiffVsScopeOptions): void {
  printResult(
    io,
    fail(
      'scan.diff-vs-scope',
      'RD_NOT_FOUND',
      `RD artifact for requestId=${options.rid} not found`,
      { requestId: options.rid },
      ['Run `peaks request init --role rd --id <rid> --apply --type <type>` first.']
    ),
    options.json
  );
  process.exitCode = 1;
}
