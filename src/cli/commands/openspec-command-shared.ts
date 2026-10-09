// src/cli/commands/openspec-command-shared.ts
//
// The option shapes, flag translation and envelope printers shared by every
// `peaks openspec <verb>` subcommand module. Split out of
// `openspec-commands.ts` so each verb can live in its own file without
// repeating the `fail(...)` boilerplate eight times.

import { readFile } from 'node:fs/promises';
import type { OpenSpecScanOptions } from '../../services/openspec/openspec-scan-service.js';
import type {
  OpenSpecArchiveError,
  OpenSpecArchiveOptions
} from '../../services/openspec/openspec-archive-service.js';
import type {
  OpenSpecRenderOptions,
  OpenSpecRenderRequest
} from '../../services/openspec/openspec-render-service.js';
import type { OpenSpecValidateOptions } from '../../services/openspec/openspec-validate-service.js';

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { normalizePath } from '../../shared/path-utils.js';
import { fail } from 'peaks-loop-shared/result';

export type OpenSpecListOptions = {
  project?: string;
  json?: boolean;
};

export type OpenSpecShowOptions = OpenSpecListOptions;
export type OpenSpecToRdOptions = OpenSpecListOptions;
export type OpenSpecRenderCommandOptions = OpenSpecListOptions & {
  request: string;
  apply?: boolean;
  overwrite?: boolean;
};

export type OpenSpecValidateCommandOptions = OpenSpecListOptions & {
  preferExternal?: boolean;
};

export type OpenSpecArchiveCommandOptions = OpenSpecListOptions & {
  apply?: boolean;
  force?: boolean;
  coverageSummary?: string;
  archiveDir?: string;
};

export type OpenSpecInitCommandOptions = {
  project: string;
  apply?: boolean;
  json?: boolean;
};

/** The next action every path/layout failure carries. */
export const OPENSPEC_PATH_HINT: string[] = [
  'Check the project path and openspec/ layout before retrying'
];

/** Everything a verb-specific catch needs to build its failure envelope. */
export type OpenSpecFailure = {
  readonly code: string;
  readonly error: unknown;
  readonly nextActions: string[];
  readonly json: boolean | undefined;
  readonly data?: Record<string, unknown>;
};

export function resolveScanOptions(project: string | undefined): OpenSpecScanOptions {
  if (project === undefined) {
    return {};
  }
  return { openspecRoot: `${normalizePath(project).replace(/\/$/, '')}/openspec` };
}

export async function loadRenderRequest(requestPath: string): Promise<OpenSpecRenderRequest> {
  const raw = await readFile(requestPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Render request file must contain a JSON object');
  }
  return parsed as OpenSpecRenderRequest;
}

/** Print a verb failure and mark the run failed. One call site per catch. */
export function failOpenSpec(io: ProgramIO, command: string, failure: OpenSpecFailure): void {
  printResult(
    io,
    fail(
      command,
      failure.code,
      getErrorMessage(failure.error),
      failure.data ?? {},
      failure.nextActions
    ),
    failure.json
  );
  process.exitCode = 1;
}

/** The `<changeId>` resolution every change-scoped verb shares. */
export function printChangeNotFound(
  io: ProgramIO,
  command: string,
  changeId: string,
  json: boolean | undefined
): void {
  printResult(
    io,
    fail(
      command,
      'OPENSPEC_CHANGE_NOT_FOUND',
      `OpenSpec change ${changeId} was not found`,
      { changeId },
      [`Verify openspec/changes/${changeId}/ exists`]
    ),
    json
  );
  process.exitCode = 1;
}

const ROOT_KEY = 'openspecRoot';

/**
 * Translate `--project` into the service option shape, carrying only the flags
 * the caller actually set (a `false`/`undefined` flag must stay absent, not be
 * written as `false`).
 */
export function toRenderOptions(
  project: string | undefined,
  options: OpenSpecRenderCommandOptions
): OpenSpecRenderOptions {
  const renderOptions: OpenSpecRenderOptions = {};
  const scan = resolveScanOptions(project);
  if (scan.openspecRoot !== undefined) {
    renderOptions[ROOT_KEY] = scan.openspecRoot;
  }
  if (options.apply === true) {
    renderOptions.apply = true;
  }
  if (options.overwrite === true) {
    renderOptions.overwrite = true;
  }
  return renderOptions;
}

export function toValidateOptions(
  project: string | undefined,
  options: OpenSpecValidateCommandOptions
): OpenSpecValidateOptions {
  const validateOptions: OpenSpecValidateOptions = {};
  const scan = resolveScanOptions(project);
  if (scan.openspecRoot !== undefined) {
    validateOptions[ROOT_KEY] = scan.openspecRoot;
  }
  if (options.preferExternal === true) {
    validateOptions.preferExternal = true;
  }
  return validateOptions;
}

export function toArchiveOptions(
  project: string | undefined,
  options: OpenSpecArchiveCommandOptions
): OpenSpecArchiveOptions {
  const archiveOptions: OpenSpecArchiveOptions = {};
  const scan = resolveScanOptions(project);
  if (scan.openspecRoot !== undefined) {
    archiveOptions[ROOT_KEY] = scan.openspecRoot;
  }
  if (options.apply === true) {
    archiveOptions.apply = true;
  }
  if (options.force === true) {
    archiveOptions.force = true;
  }
  if (options.coverageSummary !== undefined) {
    archiveOptions.coverageSummaryPath = options.coverageSummary;
  }
  if (options.archiveDir !== undefined) {
    archiveOptions.archiveDirName = options.archiveDir;
  }
  return archiveOptions;
}

/**
 * Per-error-code remediation hints for the archive gate.
 * Centralized here so the catch block stays readable and the next-actions
 * can be reviewed in isolation.
 */
export function nextActionsForArchiveError(code: OpenSpecArchiveError['code']): string[] {
  switch (code) {
    case 'OPENSPEC_COVERAGE_GATE_PARTIAL':
      return [
        'Update the Coverage Evidence table to mark each failing requirement as covered',
        'Or re-run with --force to bypass the gate after confirming the gap is acceptable'
      ];
    case 'OPENSPEC_COVERAGE_GATE_FAILED':
      return [
        'Add the missing Coverage Evidence or Capability Mapping block to proposal.md (see error.message)',
        'Or re-run with --force to bypass the gate after confirming the gap is acceptable'
      ];
    case 'OPENSPEC_COVERAGE_EVIDENCE_MALFORMED':
      return [
        'Fix the proposal.md Coverage Evidence table — the heading exists but no parsable rows were found',
        'Expected shape: | capability | requirement | status | testAnchor | with status in {covered, partial, uncovered}'
      ];
    case 'OPENSPEC_COVERAGE_EVIDENCE_MISSING':
      return [
        'Run `pnpm test:coverage` (which invokes scripts/coverage-c8.mjs) to generate coverage-summary.json',
        'Or pass --coverage-summary <path> to point at an existing summary',
        'Or re-run with --force to bypass the gate'
      ];
    case 'OPENSPEC_COVERAGE_EVIDENCE_STALE':
      return [
        'Re-run `pnpm test:coverage` to refresh coverage-summary.json',
        'Or re-run with --force to bypass the gate after confirming the source delta is acceptable'
      ];
    case 'OPENSPEC_COVERAGE_EVIDENCE_MISMATCH':
      return [
        'Inspect error.detail.mismatches[] — each entry lists the failing capability, file, and actual pct',
        'Close the coverage gap (add tests or update the Capability Mapping block in proposal.md)',
        'Or re-run with --force to bypass the gate after confirming the gap is acceptable'
      ];
  }
}

/** The `openspec.archive` failure envelope for the gate's own error class. */
export function printArchiveError(
  io: ProgramIO,
  error: OpenSpecArchiveError,
  json: boolean | undefined
): void {
  printResult(
    io,
    fail(
      'openspec.archive',
      error.code,
      getErrorMessage(error),
      error.detail,
      nextActionsForArchiveError(error.code)
    ),
    json
  );
  process.exitCode = 1;
}
