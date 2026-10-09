// `peaks scan orphan` and `peaks scan karpathy` — the structural scans that
// report orphan kinds and Karpathy-guideline coverage. Both `.action()` bodies
// are module-level named runners; the format/json/markdown output tail is the
// shared emitScanReport.

import { InvalidArgumentError, type Command } from 'commander';

import { fail } from 'peaks-loop-shared/result';

import {
  scanOrphans,
  formatOrphanMarkdown,
  type OrphanReport
} from '../../services/scan/orphan-service.js';
import {
  scanKarpathy,
  formatKarpathyMarkdown,
  type KarpathyScanReport
} from '../../services/scan/karpathy-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  emitScanReport,
  parseKarpathyScope,
  parseOrphanScope,
  parseScanOutputFormat,
  type KarpathyOptions,
  type OrphanOptions
} from './scan-command-shared.js';

const ORPHAN_DESCRIPTION =
  'Detect 4 kinds of orphans (export / import / CLI subcommand / doc endpoint) — karpathy §3 Surgical Changes';

const KARPATHY_DESCRIPTION =
  'Surface-level scan of rd/karpathy-review.md for the 4 Karpathy guidelines (Think / Simplicity / Surgical / Goal) — karpathy §1 + §3';

function orphanNextActions(report: OrphanReport): string[] {
  const nextActions: string[] = [];
  const totalOrphans =
    report.counts.export +
    report.counts.import +
    report.counts.cliSubcommand +
    report.counts.docEndpoint;
  if (totalOrphans === 0) {
    nextActions.push('No orphans detected in the requested scope. RD may proceed to commit.');
  } else {
    nextActions.push(
      `Found ${totalOrphans} orphan(s): export=${report.counts.export} import=${report.counts.import} cliSubcommand=${report.counts.cliSubcommand} docEndpoint=${report.counts.docEndpoint}.`
    );
    nextActions.push(
      'Clean up before commit (karpathy §3 — remove what your changes made unused).'
    );
    nextActions.push('Re-run `peaks scan orphan --project <path>` after cleanup to confirm zero.');
  }
  return nextActions;
}

function karpathyNextActions(report: KarpathyScanReport): string[] {
  const nextActions: string[] = [];
  if (report.gateAction === 'block') {
    nextActions.push(
      'Karpathy review file missing under scope=all. Per karpathy §1 Think Before Coding, the rd:qa-handoff gate wants rd/karpathy-review-<rid>.md; this scanner has no rid and reads only the back-compat name rd/karpathy-review.md, so it cannot go green on the rid-scoped name alone. `peaks request transition --state qa-handoff` is the authoritative gate.'
    );
  } else if (report.gateAction === 'warn') {
    nextActions.push(
      `Karpathy review emitted ${report.totalViolations} violation(s). Review the warnings and re-run after cleanup (karpathy §3 Surgical Changes).`
    );
  } else {
    nextActions.push(
      'Karpathy-Gate passes. All 4 guideline sections present and no anti-patterns detected.'
    );
  }
  return nextActions;
}

async function runScanOrphan(options: OrphanOptions, io: ProgramIO): Promise<void> {
  try {
    const report: OrphanReport = await scanOrphans({
      projectRoot: options.project,
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(options.strict !== undefined ? { strict: options.strict } : {})
    });
    emitScanReport(io, {
      command: 'scan.orphan',
      format: options.format,
      json: options.json,
      report,
      nextActions: orphanNextActions(report),
      renderMarkdown: () => formatOrphanMarkdown(report, {})
    });
  } catch (error) {
    if (error instanceof InvalidArgumentError) throw error;
    printResult(
      io,
      fail(
        'scan.orphan',
        'SCAN_ORPHAN_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        [
          'Verify the project path exists and is readable',
          'Verify the project is a git repository (working-tree scope)'
        ]
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

async function runScanKarpathy(options: KarpathyOptions, io: ProgramIO): Promise<void> {
  try {
    const report: KarpathyScanReport = await scanKarpathy({
      projectRoot: options.project,
      ...(options.scope !== undefined ? { scope: options.scope } : {})
    });
    emitScanReport(io, {
      command: 'scan.karpathy',
      format: options.format,
      json: options.json,
      report,
      nextActions: karpathyNextActions(report),
      renderMarkdown: () => formatKarpathyMarkdown(report, {})
    });
  } catch (error) {
    if (error instanceof InvalidArgumentError) throw error;
    printResult(
      io,
      fail(
        'scan.karpathy',
        'SCAN_KARPATHY_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        [
          'Verify the project path exists and is readable',
          'Verify the project is a readable directory'
        ]
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerScanStructuralCommands(scan: Command, io: ProgramIO): void {
  // Slice 4/6 — karpathy-enforcement orphan-scan-cli
  // Detects 4 kinds of orphans: export / import / CLI subcommand / doc
  // endpoint. Read-only; never writes. karpathy §3 Surgical Changes.
  addJsonOption(
    scan
      .command('orphan')
      .description(ORPHAN_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--format <fmt>', 'output format: md (default) | json', parseScanOutputFormat)
      .option('--scope <scope>', 'scope: working-tree (default) | git-diff | all', parseOrphanScope)
      .option('--strict', 'strict mode: report exportOrphans even outside working tree', false)
  ).action((options: OrphanOptions) => runScanOrphan(options, io));

  // Karpathy structural scan (Slice 5/6 — karpathy-enforcement 5-way fanout +
  // hard Karpathy-Gate). Detects violation counts and section coverage for
  // the 4 Karpathy-guidelines. Read-only; never writes. karpathy §3.
  addJsonOption(
    scan
      .command('karpathy')
      .description(KARPATHY_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--format <fmt>', 'output format: md (default) | json', parseScanOutputFormat)
      .option('--scope <scope>', 'scope: working-tree (default) | all', parseKarpathyScope)
  ).action((options: KarpathyOptions) => runScanKarpathy(options, io));
}
