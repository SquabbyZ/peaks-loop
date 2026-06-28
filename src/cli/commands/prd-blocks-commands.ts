/**
 * v2.15.0 follow-up — G3: prd 4 必填块 CLI.
 *
 *   - `peaks prd check-blocks <request-id>` — validate the prd artifact
 *     contains the 4 mandatory sections (业务场景 / 边界 case /
 *     UI 装配意图 / 上游基线). Complements `peaks request lint`
 *     (which checks placeholders) by checking the design quality
 *     lock-down at the prd stage.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { checkPrdBlocks } from '../../services/prd/prd-blocks-checker.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerPrdBlocksCommands(program: Command, io: ProgramIO): void {
  const prd = program
    .command('prd')
    .description('v2.15.0 follow-up G3: PRD design-quality gates. (Note: this is a sub-command; full PRD commands live under `peaks request --role prd`.)');

  addJsonOption(
    prd
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
