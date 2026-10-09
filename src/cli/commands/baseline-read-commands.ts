// src/cli/commands/baseline-read-commands.ts
//
// `peaks baseline list` / `show` / `diff` — the three read-only projections of
// the frozen baseline. Split out of `baseline-commands.ts`; every envelope
// command name, code and data field is unchanged.

import type { Command } from 'commander';
import { readBaselineFile } from '../../services/capability-baseline/store.js';
import type { JourneyId } from '../../services/capability-baseline/types.js';
import type { ProgramIO } from '../cli-helpers.js';
import { fail, ok, type BaselineOptions } from './baseline-command-shared.js';

function runList(io: ProgramIO, opts: BaselineOptions): void {
  const projectRoot = opts.project ?? '.';
  const r = readBaselineFile(projectRoot);
  if (!r.ok) {
    fail(io, r.error.code, r.error.message);
    return;
  }
  const rows = r.file.rows.map((row) => ({
    journeyId: row.journeyId,
    intent: row.intent,
    invariantCount: row.invariants.length
  }));
  ok(io, 'baseline.list', { version: r.file.version, signedAt: r.file.signedAt, rows });
}

function runShow(io: ProgramIO, journeyId: string, opts: BaselineOptions): void {
  const projectRoot = opts.project ?? '.';
  const r = readBaselineFile(projectRoot);
  if (!r.ok) {
    fail(io, r.error.code, r.error.message);
    return;
  }
  const row = r.file.rows.find((x) => x.journeyId === (journeyId as JourneyId));
  if (!row) {
    fail(io, 'BASELINE_ROW_SHAPE_INVALID', `row ${journeyId} not found`);
    return;
  }
  ok(io, 'baseline.show', row as unknown as Record<string, unknown>);
}

function runDiff(io: ProgramIO, opts: BaselineOptions): void {
  const projectRoot = opts.project ?? '.';
  const r = readBaselineFile(projectRoot);
  if (!r.ok) {
    fail(io, r.error.code, r.error.message);
    return;
  }
  ok(io, 'baseline.diff', {
    version: r.file.version,
    signedAt: r.file.signedAt,
    rowsCount: r.file.rows.length
  });
}

export function registerBaselineListCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('list')
    .description('List the 15 P0 journey rows in the frozen baseline.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: BaselineOptions) => runList(io, opts));
}

export function registerBaselineShowCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('show <journeyId>')
    .description('Show one journey row.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((journeyId: string, opts: BaselineOptions) => runShow(io, journeyId, opts));
}

export function registerBaselineDiffCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('diff')
    .description('Show current implementation vs. frozen baseline.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: BaselineOptions) => runDiff(io, opts));
}
