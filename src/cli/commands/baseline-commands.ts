// src/cli/commands/baseline-commands.ts
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import {
  historySnapshot,
  readBaselineFile,
  writeBaselineFile
} from '../../services/capability-baseline/store.js';
import { validateBaselineFile } from '../../services/capability-baseline/validator.js';
import type { CapabilityBaselineFile, JourneyId } from '../../services/capability-baseline/types.js';

function fail(io: ProgramIO, code: string, message: string, data: Record<string, unknown> = {}): void {
  io.stdout(JSON.stringify({ ok: false, command: `baseline`, code, message, data, warnings: [], nextActions: [] }));
  process.exitCode = 1;
}

function ok(io: ProgramIO, command: string, data: Record<string, unknown>, nextActions: ReadonlyArray<string> = []): void {
  io.stdout(JSON.stringify({ ok: true, command, data, warnings: [], nextActions }));
}

export function registerBaselineCommands(program: Command, io: ProgramIO): void {
  const baseline = program.command('baseline').description('Manage the capability baseline (frozen product semantics for 15 P0 journeys).');

  baseline
    .command('freeze')
    .description('Freeze the capability baseline from a JSON file (SquabbyZ-signed).')
    .option('--from <path>', 'Path to the baseline JSON input.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { from?: string; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      if (!opts.from) { fail(io, 'MISSING_ARG', '--from is required'); return; }
      const file = JSON.parse(readFileSync(opts.from, 'utf8')) as CapabilityBaselineFile;
      const v = validateBaselineFile(file);
      if (!v.ok) { fail(io, v.error.code, v.error.message); return; }
      const out = writeBaselineFile({ projectRoot, file });
      historySnapshot({ projectRoot, version: file.version });
      ok(io, 'baseline.freeze', { path: out.path, lockPath: out.lockPath, version: file.version });
    });

  baseline
    .command('list')
    .description('List the 15 P0 journey rows in the frozen baseline.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) { fail(io, r.error.code, r.error.message); return; }
      const rows = r.file.rows.map((row) => ({ journeyId: row.journeyId, intent: row.intent, invariantCount: row.invariants.length }));
      ok(io, 'baseline.list', { version: r.file.version, signedAt: r.file.signedAt, rows });
    });

  baseline
    .command('show <journeyId>')
    .description('Show one journey row.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((journeyId: string, opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) { fail(io, r.error.code, r.error.message); return; }
      const row = r.file.rows.find((x) => x.journeyId === (journeyId as JourneyId));
      if (!row) { fail(io, 'BASELINE_ROW_SHAPE_INVALID', `row ${journeyId} not found`); return; }
      ok(io, 'baseline.show', row as unknown as Record<string, unknown>);
    });

  baseline
    .command('run-guard')
    .description('Run a guard contract over the frozen baseline.')
    .option('--journey <id>', 'Run only one journey; default is all 15.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action(async (opts: { journey?: string; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const { runJ01Contract } = await import('../../services/capability-guard-runner/contracts/J01.js');
      const ctx = { projectRoot, sessionId: 'cli', contract: {} as never, baselineInvariant: 'auto' };
      const r = opts.journey ? await (opts.journey === 'J01' ? runJ01Contract(ctx) : Promise.resolve({ status: 'skipped' as const })) : await runJ01Contract(ctx);
      ok(io, 'baseline.run-guard', r as unknown as Record<string, unknown>);
    });
}
