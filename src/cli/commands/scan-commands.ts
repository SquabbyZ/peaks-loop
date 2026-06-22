import { Command, InvalidArgumentError } from 'commander';
import { scanArchetype } from '../../services/scan/archetype-service.js';
import { scanExistingSystem } from '../../services/scan/existing-system-service.js';
import { checkTypeSanity } from '../../services/scan/type-sanity-service.js';
import { getAcceptanceCoverage, isAcceptanceCoverageError } from '../../services/scan/acceptance-coverage-service.js';
import { getDiffVsScope, isDiffScopeError } from '../../services/scan/diff-scope-service.js';
import { scanFileSize, DEFAULT_FILE_SIZE_THRESHOLD } from '../../services/scan/file-size-scan.js';
import { scanLibraries } from '../../services/scan/libraries-service.js';
import { scanApiSurface, formatApiSurfaceMarkdown, type ApiSurfaceReport } from '../../services/scan/api-surface-service.js';
import { scanOrphans, formatOrphanMarkdown, type OrphanReport } from '../../services/scan/orphan-service.js';
import { scanKarpathy, formatKarpathyMarkdown, type KarpathyScanReport } from '../../services/scan/karpathy-service.js';
import { isRequestType, VALID_REQUEST_TYPES, type RequestType } from '../../services/artifacts/artifact-prerequisites.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

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

  // Slice 3/6 — `peaks scan api-surface`. Feeds the tech-doc "Existing API /
  // Component Inventory" section with a structured inventory of CLI
  // subcommands + service-level public exports. Read-only; never writes.
  addJsonOption(
    scan
      .command('api-surface')
      .description("Enumerate CLI subcommands + service-level public exports for tech-doc 'Existing API / Component Inventory' section")
      .requiredOption('--project <path>', 'target project root')
      .option('--format <fmt>', 'output format: md (default) | json', (v) => {
        if (v !== 'md' && v !== 'json') {
          throw new InvalidArgumentError('must be md or json');
        }
        return v;
      })
      .option('--include-dirs <globs>', 'comma-separated dirs to scan (default: src/cli,src/services)')
      .option('--max-per-kind <n>', 'cap entries per kind (default: no cap)', (v) => {
        if (!/^\d+$/.test(v)) {
          throw new InvalidArgumentError('must be a non-negative integer');
        }
        return Number(v);
      })
  ).action(async (options: {
    project: string;
    format?: 'md' | 'json';
    includeDirs?: string;
    maxPerKind?: number;
    json?: boolean;
  }) => {
    try {
      const report: ApiSurfaceReport = await scanApiSurface({
        projectRoot: options.project,
        ...(options.includeDirs !== undefined ? { includeDirs: options.includeDirs } : {}),
        ...(options.maxPerKind !== undefined ? { maxPerKind: options.maxPerKind } : {})
      });
      const nextActions: string[] = [];
      if (report.counts.cli === 0 && report.counts.service === 0) {
        nextActions.push('No CLI subcommands or service exports found — verify --include-dirs points at the right paths.');
      } else {
        nextActions.push('Paste the `--format md` output under `## API surface inventory` in .peaks/<sid>/rd/tech-doc.md.');
        nextActions.push('Use the inventory to fill the tech-doc "Existing API / Component Inventory" section (karpathy §1 — reuse before create).');
      }
      if (options.format === 'json' && !options.json) {
        // Raw JSON without the ok/data/code envelope.
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
      }
      if (options.format === 'json') {
        printResult(io, ok('scan.api-surface', report, [], nextActions), options.json);
        return;
      }
      // Default: markdown block
      const truncated = options.maxPerKind !== undefined
        ? {
            cli: report.counts.cli,
            service: report.counts.service,
            type: report.counts.type,
            constant: report.counts.constant
          }
        : undefined;
      const md = formatApiSurfaceMarkdown(
        report,
        options.maxPerKind !== undefined
          ? { maxPerKind: options.maxPerKind, truncatedCounts: truncated! }
          : {}
      );
      if (options.json) {
        printResult(io, ok('scan.api-surface', { markdown: md, report }, [], nextActions), options.json);
      } else {
        process.stdout.write(md + '\n');
        if (nextActions.length > 0) {
          process.stderr.write('\nNext actions:\n' + nextActions.map((a) => '  - ' + a).join('\n') + '\n');
        }
      }
    } catch (error) {
      if (error instanceof InvalidArgumentError) throw error;
      printResult(
        io,
        fail('scan.api-surface', 'SCAN_API_SURFACE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is readable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Slice 4/6 — karpathy-enforcement orphan-scan-cli
  // Detects 4 kinds of orphans: export / import / CLI subcommand / doc
  // endpoint. Read-only; never writes. karpathy §3 Surgical Changes.
  addJsonOption(
    scan
      .command('orphan')
      .description("Detect 4 kinds of orphans (export / import / CLI subcommand / doc endpoint) — karpathy §3 Surgical Changes")
      .requiredOption('--project <path>', 'target project root')
      .option('--format <fmt>', 'output format: md (default) | json', (v) => {
        if (v !== 'md' && v !== 'json') {
          throw new InvalidArgumentError('must be md or json');
        }
        return v;
      })
      .option('--scope <scope>', 'scope: working-tree (default) | git-diff | all', (v) => {
        if (v !== 'working-tree' && v !== 'git-diff' && v !== 'all') {
          throw new InvalidArgumentError('must be working-tree, git-diff, or all');
        }
        return v;
      })
      .option('--strict', 'strict mode: report exportOrphans even outside working tree', false)
  ).action(async (options: {
    project: string;
    format?: 'md' | 'json';
    scope?: 'working-tree' | 'git-diff' | 'all';
    strict?: boolean;
    json?: boolean;
  }) => {
    try {
      const report: OrphanReport = await scanOrphans({
        projectRoot: options.project,
        ...(options.scope !== undefined ? { scope: options.scope } : {}),
        ...(options.strict !== undefined ? { strict: options.strict } : {})
      });
      const nextActions: string[] = [];
      const totalOrphans = report.counts.export + report.counts.import + report.counts.cliSubcommand + report.counts.docEndpoint;
      if (totalOrphans === 0) {
        nextActions.push('No orphans detected in the requested scope. RD may proceed to commit.');
      } else {
        nextActions.push(`Found ${totalOrphans} orphan(s): export=${report.counts.export} import=${report.counts.import} cliSubcommand=${report.counts.cliSubcommand} docEndpoint=${report.counts.docEndpoint}.`);
        nextActions.push('Clean up before commit (karpathy §3 — remove what your changes made unused).');
        nextActions.push('Re-run `peaks scan orphan --project <path>` after cleanup to confirm zero.');
      }
      if (options.format === 'json' && !options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
      }
      if (options.format === 'json') {
        printResult(io, ok('scan.orphan', report, [], nextActions), options.json);
        return;
      }
      const md = formatOrphanMarkdown(report, {});
      if (options.json) {
        printResult(io, ok('scan.orphan', { markdown: md, report }, [], nextActions), options.json);
      } else {
        process.stdout.write(md + '\n');
        if (nextActions.length > 0) {
          process.stderr.write('\nNext actions:\n' + nextActions.map((a) => '  - ' + a).join('\n') + '\n');
        }
      }
    } catch (error) {
      if (error instanceof InvalidArgumentError) throw error;
      printResult(
        io,
        fail('scan.orphan', 'SCAN_ORPHAN_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is readable', 'Verify the project is a git repository (working-tree scope)']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Karpathy structural scan (Slice 5/6 — karpathy-enforcement 5-way fanout +
  // hard Karpathy-Gate). Detects violation counts and section coverage for
  // the 4 Karpathy-guidelines. Read-only; never writes. karpathy §3.
  addJsonOption(
    scan
      .command('karpathy')
      .description("Surface-level scan of rd/karpathy-review.md for the 4 Karpathy guidelines (Think / Simplicity / Surgical / Goal) — karpathy §1 + §3")
      .requiredOption('--project <path>', 'target project root')
      .option('--format <fmt>', 'output format: md (default) | json', (v) => {
        if (v !== 'md' && v !== 'json') {
          throw new InvalidArgumentError('must be md or json');
        }
        return v;
      })
      .option('--scope <scope>', 'scope: working-tree (default) | all', (v) => {
        if (v !== 'working-tree' && v !== 'all') {
          throw new InvalidArgumentError('must be working-tree or all');
        }
        return v;
      })
  ).action(async (options: {
    project: string;
    format?: 'md' | 'json';
    scope?: 'working-tree' | 'all';
    json?: boolean;
  }) => {
    try {
      const report: KarpathyScanReport = await scanKarpathy({
        projectRoot: options.project,
        ...(options.scope !== undefined ? { scope: options.scope } : {})
      });
      const nextActions: string[] = [];
      if (report.gateAction === 'block') {
        nextActions.push('Karpathy review file missing under scope=all. Per karpathy §1 Think Before Coding, create rd/karpathy-review.md before requesting qa-handoff.');
      } else if (report.gateAction === 'warn') {
        nextActions.push(`Karpathy review emitted ${report.totalViolations} violation(s). Review the warnings and re-run after cleanup (karpathy §3 Surgical Changes).`);
      } else {
        nextActions.push('Karpathy-Gate passes. All 4 guideline sections present and no anti-patterns detected.');
      }
      if (options.format === 'json' && !options.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
      }
      if (options.format === 'json') {
        printResult(io, ok('scan.karpathy', report, [], nextActions), options.json);
        return;
      }
      const md = formatKarpathyMarkdown(report, {});
      if (options.json) {
        printResult(io, ok('scan.karpathy', { markdown: md, report }, [], nextActions), options.json);
      } else {
        process.stdout.write(md + '\n');
        if (nextActions.length > 0) {
          process.stderr.write('\nNext actions:\n' + nextActions.map((a) => '  - ' + a).join('\n') + '\n');
        }
      }
    } catch (error) {
      if (error instanceof InvalidArgumentError) throw error;
      printResult(
        io,
        fail('scan.karpathy', 'SCAN_KARPATHY_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is readable', 'Verify the project is a readable directory']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
