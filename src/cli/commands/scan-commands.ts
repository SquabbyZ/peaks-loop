import { Command, InvalidArgumentError } from 'commander';
import { scanArchetype } from '../../services/scan/archetype-service.js';
import { scanExistingSystem } from '../../services/scan/existing-system-service.js';
import { checkTypeSanity } from '../../services/scan/type-sanity-service.js';
import { getAcceptanceCoverage, isAcceptanceCoverageError } from '../../services/scan/acceptance-coverage-service.js';
import { getDiffVsScope, isDiffScopeError } from '../../services/scan/diff-scope-service.js';
import { scanFileSize, DEFAULT_FILE_SIZE_THRESHOLD } from '../../services/scan/file-size-scan.js';
import { scanLibraries } from '../../services/scan/libraries-service.js';
import { isRequestType, VALID_REQUEST_TYPES, type RequestType } from '../../services/artifacts/artifact-prerequisites.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { probeCcConnect } from '../../services/companion/cc-connect-resolver.js';
import { binaryPathCacheFile, readBinaryPathCache } from '../../services/companion/binary-cache.js';
import { readCcConnectState } from '../../services/companion/state-parser.js';

type ArchetypeOptions = {
  project: string;
  json?: boolean;
};

type ExistingSystemOptions = {
  project: string;
  maxTokens?: string;
  maxSamples?: string;
  json?: boolean;
};

type RequestTypeSanityOptions = {
  project: string;
  type: RequestType;
  baseRef?: string;
  json?: boolean;
};

type FileSizeScanOptions = {
  project: string;
  baseRef?: string;
  threshold?: string;
  json?: boolean;
};

type ScanLibrariesOptions = {
  project: string;
  json?: boolean;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRequestType(value: string): RequestType {
  if (!isRequestType(value)) {
    throw new InvalidArgumentError(`must be one of ${VALID_REQUEST_TYPES.join(', ')}`);
  }
  return value;
}

export function registerScanCommands(program: Command, io: ProgramIO): void {
  const scan = program.command('scan').description('Deterministic project scans (archetype, existing system) for Peaks workflows');

  addJsonOption(
    scan
      .command('archetype')
      .description('Detect project archetype, frontend-only mode, and supporting signals from the filesystem (read-only)')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: ArchetypeOptions) => {
    try {
      const report = await scanArchetype({ projectRoot: options.project });
      const nextActions: string[] = [];
      if (report.archetype === 'unknown') {
        nextActions.push('Archetype could not be determined; surface to user before proceeding.');
      } else if (report.archetype === 'legacy-frontend' || report.archetype === 'legacy-fullstack' || report.archetype === 'frontend-monorepo') {
        nextActions.push('Run `peaks scan existing-system --project <path>` to extract visual tokens and conventions.');
      }
      printResult(io, ok('scan.archetype', report, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('scan.archetype', 'SCAN_ARCHETYPE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is readable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    scan
      .command('existing-system')
      .description('Extract visual tokens (colors/spacing/typography/radii) and code conventions from a legacy project (read-only)')
      .requiredOption('--project <path>', 'target project root')
      .option('--max-tokens <n>', 'maximum tokens to return per category (default 40)')
      .option('--max-samples <n>', 'maximum convention samples per kind (default 5)')
  ).action(async (options: ExistingSystemOptions) => {
    try {
      const report = await scanExistingSystem({
        projectRoot: options.project,
        maxTokens: parsePositiveInt(options.maxTokens, 40),
        maxSamplesPerKind: parsePositiveInt(options.maxSamples, 5)
      });
      const nextActions: string[] = [];
      if (!report.scanned) {
        nextActions.push(report.scanSkippedReason ?? 'Extraction skipped.');
      } else if (report.inconsistencies.length > 0) {
        nextActions.push('Surface inconsistencies in the TXT handoff before proceeding.');
      }
      printResult(io, ok('scan.existing-system', report, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('scan.existing-system', 'SCAN_EXISTING_SYSTEM_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is readable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    scan
      .command('request-type-sanity')
      .description('Cross-verify a declared --type against the actual git diff file mix (catches "feature mis-declared as docs" workflow violations)')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--type <type>', `declared request type (${VALID_REQUEST_TYPES.join(' | ')})`, parseRequestType)
      .option('--base-ref <ref>', 'compare working tree against this git ref (default: HEAD)')
  ).action((options: RequestTypeSanityOptions) => {
    try {
      const serviceOptions: Parameters<typeof checkTypeSanity>[0] = { projectRoot: options.project, declaredType: options.type };
      if (options.baseRef !== undefined) {
        serviceOptions.baseRef = options.baseRef;
      }
      const report = checkTypeSanity(serviceOptions);
      const nextActions: string[] = [];
      if (!report.consistent) {
        nextActions.push(`Re-classify the request — likely correct type: ${report.suggestedTypes.join(' | ')}`);
        nextActions.push('Or, if the declared type is correct, surface the mismatch reason to the user in the TXT handoff.');
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
        fail('scan.request-type-sanity', 'REQUEST_TYPE_SANITY_FAILED', getErrorMessage(error), { projectRoot: options.project, type: options.type }, ['Verify the project path is a git repository or omit the check']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    scan
      .command('acceptance-coverage')
      .description('Verify every PRD "Acceptance criteria" item has at least one linked QA test case (via `- **Acceptance:** A1, A2` field in qa/test-cases/<rid>.md)')
      .requiredOption('--rid <request-id>', 'request id')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
  ).action(async (options: { rid: string; project: string; sessionId?: string; json?: boolean }) => {
    try {
      const coverageOptions: Parameters<typeof getAcceptanceCoverage>[0] = { projectRoot: options.project, requestId: options.rid };
      if (options.sessionId !== undefined) {
        coverageOptions.sessionId = options.sessionId;
      }
      const result = await getAcceptanceCoverage(coverageOptions);
      if (isAcceptanceCoverageError(result)) {
        const code = result.kind === 'prd-not-found' ? 'PRD_NOT_FOUND' : 'TEST_CASES_NOT_FOUND';
        const message = result.kind === 'prd-not-found'
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
        return;
      }
      const nextActions: string[] = [];
      if (result.acceptanceItems.length === 0) {
        nextActions.push('PRD has no "## Acceptance criteria" bullets. Fill them in before running the coverage check.');
      }
      if (result.uncovered.length > 0) {
        nextActions.push(`${result.uncovered.length} acceptance item(s) have no linked test case. Add a "- **Acceptance:** ${result.uncovered.map((u) => u.id).join(', ')}" field to the relevant test cases.`);
      }
      if (result.invalidReferences.length > 0) {
        nextActions.push(`${result.invalidReferences.length} test case(s) reference an acceptance id that does not exist in the PRD. Fix or remove these references.`);
      }
      if (result.unlinkedTestCases.length > 0) {
        nextActions.push(`${result.unlinkedTestCases.length} test case(s) have no Acceptance: field. Link them to acceptance items, or document why they exist (e.g. defense-in-depth regressions).`);
      }
      printResult(io, ok('scan.acceptance-coverage', result, [], nextActions), options.json);
      if (!result.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('scan.acceptance-coverage', 'ACCEPTANCE_COVERAGE_FAILED', getErrorMessage(error), { requestId: options.rid }, ['Verify the project path and artifacts before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    scan
      .command('diff-vs-scope')
      .description('Verify every file in the git diff matches the RD artifact "Red-line scope" patterns; flags out-of-scope writes and unclassified files')
      .requiredOption('--rid <request-id>', 'request id')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
      .option('--base-ref <ref>', 'compare working tree against this git ref (default: HEAD)')
  ).action(async (options: { rid: string; project: string; sessionId?: string; baseRef?: string; json?: boolean }) => {
    try {
      const scopeOptions: Parameters<typeof getDiffVsScope>[0] = { projectRoot: options.project, requestId: options.rid };
      if (options.sessionId !== undefined) scopeOptions.sessionId = options.sessionId;
      if (options.baseRef !== undefined) scopeOptions.baseRef = options.baseRef;
      const result = await getDiffVsScope(scopeOptions);
      if (isDiffScopeError(result)) {
        printResult(
          io,
          fail('scan.diff-vs-scope', 'RD_NOT_FOUND', `RD artifact for requestId=${options.rid} not found`, { requestId: options.rid }, ['Run `peaks request init --role rd --id <rid> --apply --type <type>` first.']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const nextActions: string[] = [];
      if (!result.gitAvailable) {
        nextActions.push('git not available; scope check skipped. Cross-check the diff manually.');
      }
      if (!result.patternsDeclared) {
        nextActions.push('RD artifact has no in-scope or out-of-scope patterns under "## Red-line scope". Add concrete path/glob patterns (e.g. `src/services/login/**`) before re-running.');
      }
      if (result.violations.length > 0) {
        nextActions.push(`${result.violations.length} file(s) match an explicit out-of-scope pattern. Revert these or expand the RD red-line scope with PRD approval.`);
      }
      if (result.unclassified.length > 0) {
        nextActions.push(`${result.unclassified.length} changed file(s) do not match any declared scope pattern. Either add them to the in-scope list (if intentional) or revert them.`);
      }
      printResult(io, ok('scan.diff-vs-scope', result, [], nextActions), options.json);
      if (!result.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('scan.diff-vs-scope', 'DIFF_VS_SCOPE_FAILED', getErrorMessage(error), { requestId: options.rid }, ['Verify the project path is a git repository and the RD artifact exists']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    scan
      .command('file-size')
      .description('Check git diff for files exceeding a line count threshold (karpathy-skills "Simplicity First")')
      .requiredOption('--project <path>', 'target project root')
      .option('--base-ref <ref>', 'compare working tree against this git ref (default: HEAD)')
      .option('--threshold <n>', `line count threshold (default: ${DEFAULT_FILE_SIZE_THRESHOLD})`)
  ).action((options: FileSizeScanOptions) => {
    try {
      const threshold = options.threshold !== undefined && /^\d+$/.test(options.threshold)
        ? Number(options.threshold)
        : undefined;
      const result = scanFileSize({
        projectRoot: options.project,
        ...(options.baseRef !== undefined ? { baseRef: options.baseRef } : {}),
        ...(threshold !== undefined ? { threshold } : {})
      });
      const nextActions: string[] = [];
      if (!result.ok) {
        nextActions.push(`${result.violations.length} file(s) exceed ${result.threshold} lines. Split into smaller modules.`);
      }
      printResult(io, ok('scan.file-size', result, [], nextActions), options.json);
      if (!result.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('scan.file-size', 'FILE_SIZE_SCAN_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path is a git repository']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    scan
      .command('libraries')
      .description('Enumerate every dependency + devDependency + peerDependency + optionalDependency in package.json with parsed major version (read-only). Output goes to ## Library versions in rd/project-scan.md.')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: ScanLibrariesOptions) => {
    try {
      const report = await scanLibraries({ projectRoot: options.project });
      const nextActions: string[] = [];
      if (report.libraries.length === 0) {
        nextActions.push('No dependencies found — verify package.json exists and is valid JSON.');
      } else {
        nextActions.push('Paste the report under `## Library versions` in .peaks/<sid>/rd/project-scan.md.');
        nextActions.push('peaks-rd preflight will cross-check diff imports against schemas/library-breaking-changes.data.json.');
      }
      printResult(io, ok('scan.libraries', report, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('scan.libraries', 'SCAN_LIBRARIES_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is readable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Slice 2026-06-14-cc-connect-weixin (slice 1): dry-run scan of the
  // cc-connect binary. The scan is read-only: it walks PATH, probes
  // `cc-connect --version` via spawn, and surfaces the cached path
  // + state.json summary. It does NOT install, configure, or write
  // anything. The slice 2 / 3 `peaks companion install|setup` commands
  // own side effects.
  addJsonOption(
    scan
      .command('companion-binary')
      .description('Dry-run scan of the cc-connect companion binary: resolve PATH, probe --version, and report cached path + state.json summary. Read-only — no install / config / spawn beyond --version.')
      .option('--no-probe', 'skip `cc-connect --version` spawn (PATH-only resolution)')
  ).action(async (options: { probe?: boolean; json?: boolean }) => {
    try {
      const probe = await probeCcConnect(options.probe === false ? { skipSpawn: true } : {});
      const cached = readBinaryPathCache();
      const state = readCcConnectState();
      const report = {
        probe: {
          binaryPath: probe.binaryPath,
          version: probe.version,
          ok: probe.ok,
          error: probe.error
        },
        cache: {
          file: binaryPathCacheFile(),
          record: cached
        },
        state: {
          file: state.statePath,
          pairing: state.state,
          accountId: state.accountId,
          lastLogin: state.lastLogin,
          error: state.error,
          mtimeMs: state.mtimeMs
        }
      };
      const nextActions: string[] = [];
      if (!probe.ok) {
        nextActions.push('cc-connect binary not resolved on PATH; run `peaks companion install` to install it (npm: cc-connect / brew: cc-connect).');
      }
      if (cached === null && probe.ok) {
        nextActions.push('cache is empty; `peaks companion install` will populate ~/.peaks/companion/cc-connect-binary-path.txt on success.');
      }
      if (state.state === 'unknown' && probe.ok) {
        nextActions.push('no pairing state yet; run `peaks companion setup` to render the iLink QR for WeChat pairing.');
      }
      printResult(io, ok('scan.companion-binary', report, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('scan.companion-binary', 'SCAN_COMPANION_BINARY_FAILED', getErrorMessage(error), {}, ['Verify the cc-connect binary is installed and reachable on PATH']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
