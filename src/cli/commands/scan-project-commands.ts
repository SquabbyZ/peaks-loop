// `peaks scan archetype` and `peaks scan existing-system` — the two
// filesystem-only project scans. Each `.action()` body lives here as a
// module-level named runner; registerScanProjectCommands keeps the command
// declarations (names, options, help text) in their original order.

import type { Command } from 'commander';

import { fail, ok } from 'peaks-loop-shared/result';

import { scanArchetype } from '../../services/scan/archetype-service.js';
import { scanExistingSystem } from '../../services/scan/existing-system-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  parsePositiveInt,
  type ArchetypeOptions,
  type ExistingSystemOptions
} from './scan-command-shared.js';

const DEFAULT_MAX_TOKENS = 40;
const DEFAULT_MAX_SAMPLES = 5;

const ARCHETYPE_DESCRIPTION =
  'Detect project archetype, integration mode (three scenarios), frontend-only mode, and supporting signals from the filesystem (read-only)';

const EXISTING_SYSTEM_DESCRIPTION =
  'Extract visual tokens (colors/spacing/typography/radii) and code conventions from a legacy project (read-only)';

async function runScanArchetype(options: ArchetypeOptions, io: ProgramIO): Promise<void> {
  try {
    const report = await scanArchetype({ projectRoot: options.project });
    const nextActions: string[] = [];
    if (report.archetype === 'unknown') {
      nextActions.push('Archetype could not be determined; surface to user before proceeding.');
    } else if (
      report.archetype === 'legacy-frontend' ||
      report.archetype === 'legacy-fullstack' ||
      report.archetype === 'frontend-monorepo'
    ) {
      nextActions.push(
        'Run `peaks scan existing-system --project <path>` to extract visual tokens and conventions.'
      );
    }
    printResult(io, ok('scan.archetype', report, [], nextActions), options.json);
  } catch (error) {
    printResult(
      io,
      fail(
        'scan.archetype',
        'SCAN_ARCHETYPE_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Verify the project path exists and is readable']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

async function runScanExistingSystem(options: ExistingSystemOptions, io: ProgramIO): Promise<void> {
  try {
    const report = await scanExistingSystem({
      projectRoot: options.project,
      maxTokens: parsePositiveInt(options.maxTokens, DEFAULT_MAX_TOKENS),
      maxSamplesPerKind: parsePositiveInt(options.maxSamples, DEFAULT_MAX_SAMPLES)
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
      fail(
        'scan.existing-system',
        'SCAN_EXISTING_SYSTEM_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Verify the project path exists and is readable']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerScanProjectCommands(scan: Command, io: ProgramIO): void {
  addJsonOption(
    scan
      .command('archetype')
      .description(ARCHETYPE_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
  ).action((options: ArchetypeOptions) => runScanArchetype(options, io));

  addJsonOption(
    scan
      .command('existing-system')
      .description(EXISTING_SYSTEM_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--max-tokens <n>', 'maximum tokens to return per category (default 40)')
      .option('--max-samples <n>', 'maximum convention samples per kind (default 5)')
  ).action((options: ExistingSystemOptions) => runScanExistingSystem(options, io));
}
