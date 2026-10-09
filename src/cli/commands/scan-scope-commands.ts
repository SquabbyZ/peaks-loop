// The four scope-check subcommands: `scan request-type-sanity`,
// `scan acceptance-coverage`, `scan diff-vs-scope` and `scan file-size`. Each
// `.action()` body is a module-level named runner here; the next-action
// builders and lookup-failure envelopes they use live in scan-scope-helpers.ts.

import { InvalidArgumentError, type Command } from 'commander';

import { fail, ok } from 'peaks-loop-shared/result';

import {
  getAcceptanceCoverage,
  isAcceptanceCoverageError
} from '../../services/scan/acceptance-coverage-service.js';
import { checkTypeSanity } from '../../services/scan/type-sanity-service.js';
import { getDiffVsScope, isDiffScopeError } from '../../services/scan/diff-scope-service.js';
import { scanFileSize } from '../../services/scan/file-size-scan.js';
import {
  FILE_SIZE_CAP_DEFAULT,
  FILE_SIZE_CAP_TESTS
} from '../../services/scan/file-size-policy.js';
import { VALID_REQUEST_TYPES } from '../../services/artifacts/artifact-prerequisites.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  parseOptionalNonNegativeInt,
  parseRequestType,
  type AcceptanceCoverageOptions,
  type DiffVsScopeOptions,
  type FileSizeScanOptions,
  type RequestTypeSanityOptions
} from './scan-command-shared.js';
import {
  acceptanceCoverageNextActions,
  diffVsScopeNextActions,
  printAcceptanceCoverageLookupFailure,
  printDiffVsScopeLookupFailure
} from './scan-scope-helpers.js';

const REQUEST_TYPE_SANITY_DESCRIPTION =
  'Cross-verify a declared --type against the actual git diff file mix (catches "feature mis-declared as docs" workflow violations)';

const ACCEPTANCE_COVERAGE_DESCRIPTION =
  'Verify every PRD "Acceptance criteria" item has at least one linked QA test case (via `- **Acceptance:** A1, A2` field in qa/test-cases/<rid>.md)';

const DIFF_VS_SCOPE_DESCRIPTION =
  'Verify every file in the git diff matches the RD artifact "Red-line scope" patterns; flags out-of-scope writes and unclassified files';

const FILE_SIZE_DESCRIPTION =
  'Check git diff for files exceeding a line count threshold (karpathy-skills "Simplicity First"; tool output, lockfiles and append-only records such as CHANGELOG.md excluded)';

function runScanRequestTypeSanity(options: RequestTypeSanityOptions, io: ProgramIO): void {
  try {
    const serviceOptions: Parameters<typeof checkTypeSanity>[0] = {
      projectRoot: options.project,
      declaredType: options.type
    };
    if (options.baseRef !== undefined) {
      serviceOptions.baseRef = options.baseRef;
    }
    const report = checkTypeSanity(serviceOptions);
    const nextActions: string[] = [];
    if (!report.consistent) {
      nextActions.push(
        `Re-classify the request — likely correct type: ${report.suggestedTypes.join(' | ')}`
      );
      nextActions.push(
        'Or, if the declared type is correct, surface the mismatch reason to the user in the TXT handoff.'
      );
    }
    if (!report.gitAvailable) {
      nextActions.push('git not available; manual cross-check required.');
    }
    printResult(io, ok('scan.request-type-sanity', report, [], nextActions), options.json);
    if (!report.consistent) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof InvalidArgumentError) throw error;
    printResult(
      io,
      fail(
        'scan.request-type-sanity',
        'REQUEST_TYPE_SANITY_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project, type: options.type },
        ['Verify the project path is a git repository or omit the check']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

async function runScanAcceptanceCoverage(
  options: AcceptanceCoverageOptions,
  io: ProgramIO
): Promise<void> {
  try {
    const coverageOptions: Parameters<typeof getAcceptanceCoverage>[0] = {
      projectRoot: options.project,
      requestId: options.rid
    };
    if (options.sessionId !== undefined) {
      coverageOptions.sessionId = options.sessionId;
    }
    const result = await getAcceptanceCoverage(coverageOptions);
    if (isAcceptanceCoverageError(result)) {
      printAcceptanceCoverageLookupFailure(io, options, result);
      return;
    }
    const nextActions = acceptanceCoverageNextActions(result);
    printResult(io, ok('scan.acceptance-coverage', result, [], nextActions), options.json);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      fail(
        'scan.acceptance-coverage',
        'ACCEPTANCE_COVERAGE_FAILED',
        getErrorMessage(error),
        { requestId: options.rid },
        ['Verify the project path and artifacts before retrying']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

async function runScanDiffVsScope(options: DiffVsScopeOptions, io: ProgramIO): Promise<void> {
  try {
    const scopeOptions: Parameters<typeof getDiffVsScope>[0] = {
      projectRoot: options.project,
      requestId: options.rid
    };
    if (options.sessionId !== undefined) scopeOptions.sessionId = options.sessionId;
    if (options.baseRef !== undefined) scopeOptions.baseRef = options.baseRef;
    const result = await getDiffVsScope(scopeOptions);
    if (isDiffScopeError(result)) {
      printDiffVsScopeLookupFailure(io, options);
      return;
    }
    const nextActions = diffVsScopeNextActions(result);
    printResult(io, ok('scan.diff-vs-scope', result, [], nextActions), options.json);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      fail(
        'scan.diff-vs-scope',
        'DIFF_VS_SCOPE_FAILED',
        getErrorMessage(error),
        { requestId: options.rid },
        ['Verify the project path is a git repository and the RD artifact exists']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

function runScanFileSize(options: FileSizeScanOptions, io: ProgramIO): void {
  try {
    const threshold = parseOptionalNonNegativeInt(options.threshold);
    const result = scanFileSize({
      projectRoot: options.project,
      ...(options.baseRef !== undefined ? { baseRef: options.baseRef } : {}),
      ...(threshold !== undefined ? { threshold } : {})
    });
    const nextActions: string[] = [];
    if (!result.ok) {
      nextActions.push(
        `${result.violations.length} file(s) exceed their file-size cap. Split into smaller modules.`
      );
    }
    printResult(io, ok('scan.file-size', result, [], nextActions), options.json);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      fail(
        'scan.file-size',
        'FILE_SIZE_SCAN_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Verify the project path is a git repository']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerScanScopeCommands(scan: Command, io: ProgramIO): void {
  addJsonOption(
    scan
      .command('request-type-sanity')
      .description(REQUEST_TYPE_SANITY_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .requiredOption(
        '--type <type>',
        `declared request type (${VALID_REQUEST_TYPES.join(' | ')})`,
        parseRequestType
      )
      .option('--base-ref <ref>', 'compare working tree against this git ref (default: HEAD)')
  ).action((options: RequestTypeSanityOptions) => runScanRequestTypeSanity(options, io));

  addJsonOption(
    scan
      .command('acceptance-coverage')
      .description(ACCEPTANCE_COVERAGE_DESCRIPTION)
      .requiredOption('--rid <request-id>', 'request id')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
  ).action((options: AcceptanceCoverageOptions) => runScanAcceptanceCoverage(options, io));

  addJsonOption(
    scan
      .command('diff-vs-scope')
      .description(DIFF_VS_SCOPE_DESCRIPTION)
      .requiredOption('--rid <request-id>', 'request id')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
      .option('--base-ref <ref>', 'compare working tree against this git ref (default: HEAD)')
  ).action((options: DiffVsScopeOptions) => runScanDiffVsScope(options, io));

  addJsonOption(
    scan
      .command('file-size')
      .description(FILE_SIZE_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--base-ref <ref>', 'compare working tree against this git ref (default: HEAD)')
      .option(
        '--threshold <n>',
        `line count applied to EVERY file (default: the file-size policy's per-directory cap — ${FILE_SIZE_CAP_DEFAULT} raw lines, ${FILE_SIZE_CAP_TESTS} under root tests/)`
      )
  ).action((options: FileSizeScanOptions) => runScanFileSize(options, io));
}
