/**
 * peaks audit * CLI surface — Slice L2.1.
 *
 * Registers the new `peaks audit` top-level command with the `red-lines`
 * subcommand. Per `peaks-cli-when-adding-a-new-subcommand-check-for-existing-top-level-first.md`
 * we verified that no `peaks audit` top-level exists; this is the only
 * file that owns the registration.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { runRedLinesAudit } from '../../services/audit/red-lines-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';
import type { RedLineAudit } from '../../services/audit/types.js';

type RedLinesOptions = {
  project: string;
  json?: boolean;
  noColor?: boolean;
};

function validateProjectRoot(projectArg: string): { ok: true; projectRoot: string } | { ok: false; code: string; message: string } {
  const projectRoot = resolve(projectArg);
  if (!existsSync(projectRoot)) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: `project path does not exist: ${projectArg}` };
  }
  let stat;
  try {
    stat = statSync(projectRoot);
  } catch (error) {
    return { ok: false, code: 'INVALID_PROJECT', message: getErrorMessage(error) };
  }
  if (!stat.isDirectory()) {
    return { ok: false, code: 'INVALID_PROJECT', message: `project path is not a directory: ${projectArg}` };
  }
  return { ok: true, projectRoot };
}

export function registerAuditCommands(program: Command, io: ProgramIO): void {
  const audit = program
    .command('audit')
    .description('Audit a project for compliance with peaks-cli red lines (P0 / P1 / P2 tiers)');

  addJsonOption(
    audit
      .command('red-lines')
      .description('Scan skills/, .claude/rules/, and openspec/changes/ for MANDATORY / BLOCKING / MUST NOT / RED LINE markers; classify each as cli-backed / partial / prose-only')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: RedLinesOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<RedLineAudit>('audit.red-lines', validation.code, validation.message, { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [] }, ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    try {
      const result = runRedLinesAudit({ projectRoot: validation.projectRoot });
      const nextActions: string[] = [];
      if (result.audit.proseOnly > 0) {
        nextActions.push(`${result.audit.proseOnly} prose-only red lines remain. Plan P1/P2 enforcers in L2.2-L2.4.`);
      }
      if (result.audit.cliBacked > 0) {
        nextActions.push(`${result.audit.cliBacked} red lines are now cli-backed. Re-run after each enforcer lands to track the prose-only ratio.`);
      }
      const envelope: ResultEnvelope<RedLineAudit> = ok('audit.red-lines', result.audit, result.warnings.map((w) => `${w.file}: ${w.message}`), nextActions);
      printResult(io, envelope, options.json);
    } catch (error) {
      printResult(
        io,
        fail<RedLineAudit>('audit.red-lines', 'SCANNER_FAILED', getErrorMessage(error), { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [] }, ['Inspect scanner logs and re-run with the same --project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
