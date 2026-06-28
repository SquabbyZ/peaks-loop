/**
 * v2.15.0 follow-up — G3: prd 4 必填块 CLI (sub-command under existing `peaks prd`).
 *
 *   - `peaks prd check-blocks <request-id>` — validate the prd artifact
 *     contains the 4 mandatory sections (业务场景 / 边界 case /
 *     UI 装配意图 / 上游基线). Complements `peaks request lint`
 *     (which checks placeholders) by checking the design quality
 *     lock-down at the prd stage.
 *
 * NOTE: lives under existing `peaks prd` (registered by
 * `prd-commands.ts`). This file does NOT create a new top-level
 * `peaks prd` — that would collide with the existing prd-commands
 * registration and break `peaks request transition --role prd` due
 * to Commander routing conflicts.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { checkPrdBlocks } from '../../services/prd/prd-blocks-checker.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerPrdBlocksCommands(program: Command, io: ProgramIO): void {
  // Find existing `prd` top-level command (registered by prd-commands.ts).
  // Do NOT create a new one — that collides with the existing prd role
  // command and breaks `peaks request transition --role prd`.
  const prd = program.commands.find((c) => c.name() === 'prd');
  if (prd === undefined) {
    // Fallback: create if missing. Should never trigger in normal startup.
    program
      .command('prd')
      .description('v2.15.0 follow-up G3: PRD design-quality gates.');
  }
  const target = prd ?? program.commands.find((c) => c.name() === 'prd')!;

  addJsonOption(
    target
      .command('check-blocks <request-id>')
      .description(
        'Validate the prd artifact body contains the 4 mandatory sections: ' +
          '业务场景 / 边界 case / UI 装配意图 / 上游基线 (latter required only for fork projects). ' +
          'Complements `peaks request lint`. Exits non-zero when any required block is missing or too short.'
      )
      .requiredOption('--project <path>', 'project root')
  ).action((requestId: string, opts: { project: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const report = checkPrdBlocks(projectRoot, requestId);
    printResult(io, ok('prd.check-blocks', report, [], report.ok
      ? []
      : [
          'Fix the missing / too-short required blocks above.',
          'The 12 Gaps positioning memory: prd design quality is the only lever — execution layer does not add quality.'
        ]), opts.json ?? false);
    if (!report.ok) {
      process.exitCode = 1;
    }
  });
}
