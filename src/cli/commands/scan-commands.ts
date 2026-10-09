// `peaks scan` — the deterministic project scans. This file owns the parent
// command only; each group of subcommands lives in its own sibling module:
//
//   scan-project-commands.ts   archetype, existing-system
//   scan-scope-commands.ts     request-type-sanity, acceptance-coverage,
//                              diff-vs-scope, file-size
//   scan-inventory-commands.ts libraries, api-surface
//   scan-structural-commands.ts orphan, karpathy
//
// The group registrars are called IN THE ORIGINAL SUBCOMMAND ORDER below.
// Commander lists `--help` entries in registration order, so that order is part
// of the command's observable output.
//
// Every runner takes its parsed options plus the ProgramIO, so these modules
// hold no shared mutable state.

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';
import { registerScanInventoryCommands } from './scan-inventory-commands.js';
import { registerScanProjectCommands } from './scan-project-commands.js';
import { registerScanScopeCommands } from './scan-scope-commands.js';
import { registerScanStructuralCommands } from './scan-structural-commands.js';

export type {
  AcceptanceCoverageOptions,
  ApiSurfaceOptions,
  ArchetypeOptions,
  DiffVsScopeOptions,
  ExistingSystemOptions,
  FileSizeScanOptions,
  KarpathyOptions,
  KarpathyScope,
  OrphanOptions,
  OrphanScope,
  RequestTypeSanityOptions,
  ScanLibrariesOptions,
  ScanOutputFormat,
  ScanReportOutput
} from './scan-command-shared.js';

export function registerScanCommands(program: Command, io: ProgramIO): void {
  const scan = program
    .command('scan')
    .description('Deterministic project scans (archetype, existing system) for Peaks workflows');

  registerScanProjectCommands(scan, io);
  registerScanScopeCommands(scan, io);
  registerScanInventoryCommands(scan, io);
  registerScanStructuralCommands(scan, io);
}
