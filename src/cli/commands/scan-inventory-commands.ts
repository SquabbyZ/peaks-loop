// `peaks scan libraries` and `peaks scan api-surface` — the two inventory
// scans (package.json dependencies, then CLI subcommands + service exports).
// Both `.action()` bodies are module-level named runners; the api-surface
// output tail is shared with the structural scans through emitScanReport.

import { InvalidArgumentError, type Command } from 'commander';

import { fail, ok } from 'peaks-loop-shared/result';

import { scanLibraries } from '../../services/scan/libraries-service.js';
import {
  scanApiSurface,
  formatApiSurfaceMarkdown,
  type ApiSurfaceReport
} from '../../services/scan/api-surface-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  emitScanReport,
  parseNonNegativeIntOption,
  parseScanOutputFormat,
  type ApiSurfaceOptions,
  type ScanLibrariesOptions
} from './scan-command-shared.js';

const LIBRARIES_DESCRIPTION =
  'Enumerate every dependency + devDependency + peerDependency + optionalDependency in package.json with parsed major version (read-only). Output goes to ## Library versions in rd/project-scan.md.';

const API_SURFACE_DESCRIPTION =
  "Enumerate CLI subcommands + service-level public exports for tech-doc 'Existing API / Component Inventory' section";

async function runScanLibraries(options: ScanLibrariesOptions, io: ProgramIO): Promise<void> {
  try {
    const report = await scanLibraries({ projectRoot: options.project });
    const nextActions: string[] = [];
    if (report.libraries.length === 0) {
      nextActions.push('No dependencies found — verify package.json exists and is valid JSON.');
    } else {
      nextActions.push(
        'Paste the report under `## Library versions` in .peaks/_runtime/<sid>/rd/project-scan.md.'
      );
      nextActions.push(
        'peaks-rd preflight will cross-check diff imports against schemas/library-breaking-changes.data.json.'
      );
    }
    printResult(io, ok('scan.libraries', report, [], nextActions), options.json);
  } catch (error) {
    printResult(
      io,
      fail(
        'scan.libraries',
        'SCAN_LIBRARIES_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Verify the project path exists and is readable']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

function apiSurfaceNextActions(report: ApiSurfaceReport): string[] {
  const nextActions: string[] = [];
  if (report.counts.cli === 0 && report.counts.service === 0) {
    nextActions.push(
      'No CLI subcommands or service exports found — verify --include-dirs points at the right paths.'
    );
  } else {
    // (v2.11.0 Group A: rd/tech-doc.md removed; the immutable peaks-prd
    // handoff at prd/handoff.md is the new home for the inventory section.)
    nextActions.push(
      'Paste the `--format md` output under `## API surface inventory` in .peaks/_runtime/<sid>/prd/handoff.md.'
    );
    nextActions.push(
      'Use the inventory to fill the handoff "Existing API / Component Inventory" section (karpathy §1 — reuse before create).'
    );
  }
  return nextActions;
}

/** The markdown truncation arguments, or `{}` when no cap was requested. */
function apiSurfaceMarkdownArguments(
  report: ApiSurfaceReport,
  maxPerKind: number | undefined
): Parameters<typeof formatApiSurfaceMarkdown>[1] {
  if (maxPerKind === undefined) return {};
  return {
    maxPerKind,
    truncatedCounts: {
      cli: report.counts.cli,
      service: report.counts.service,
      type: report.counts.type,
      constant: report.counts.constant
    }
  };
}

async function runScanApiSurface(options: ApiSurfaceOptions, io: ProgramIO): Promise<void> {
  try {
    const report: ApiSurfaceReport = await scanApiSurface({
      projectRoot: options.project,
      ...(options.includeDirs !== undefined ? { includeDirs: options.includeDirs } : {}),
      ...(options.maxPerKind !== undefined ? { maxPerKind: options.maxPerKind } : {})
    });
    emitScanReport(io, {
      command: 'scan.api-surface',
      format: options.format,
      json: options.json,
      report,
      nextActions: apiSurfaceNextActions(report),
      renderMarkdown: () =>
        formatApiSurfaceMarkdown(report, apiSurfaceMarkdownArguments(report, options.maxPerKind))
    });
  } catch (error) {
    if (error instanceof InvalidArgumentError) throw error;
    printResult(
      io,
      fail(
        'scan.api-surface',
        'SCAN_API_SURFACE_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Verify the project path exists and is readable']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerScanInventoryCommands(scan: Command, io: ProgramIO): void {
  addJsonOption(
    scan
      .command('libraries')
      .description(LIBRARIES_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
  ).action((options: ScanLibrariesOptions) => runScanLibraries(options, io));

  // Slice 3/6 — `peaks scan api-surface`. Feeds the tech-doc "Existing API /
  // Component Inventory" section with a structured inventory of CLI
  // subcommands + service-level public exports. Read-only; never writes.
  addJsonOption(
    scan
      .command('api-surface')
      .description(API_SURFACE_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--format <fmt>', 'output format: md (default) | json', parseScanOutputFormat)
      .option(
        '--include-dirs <globs>',
        'comma-separated dirs to scan (default: src/cli,src/services)'
      )
      .option(
        '--max-per-kind <n>',
        'cap entries per kind (default: no cap)',
        parseNonNegativeIntOption
      )
  ).action((options: ApiSurfaceOptions) => runScanApiSurface(options, io));
}
