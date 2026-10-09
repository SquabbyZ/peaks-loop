// src/cli/commands/memory-rotate-command.ts
//
// `peaks memory rotate` — tier-driven retention for `.peaks/memory/`
// (sediment pruning policy, tier 1: archive, never delete). Dry-run by default;
// `--apply` moves tier-C candidates into `archived/`. Extracted from
// `memory-commands.ts`; the envelope, the flags and the exported symbol name
// are unchanged.

import { fail, ok } from 'peaks-loop-shared/result';

import { executeMemoryRotate } from '../../services/memory/memory-rotate-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  memoryFailure,
  resolveMemoryProjectRoot,
  type MemoryRotateCommandOptions
} from './memory-command-shared.js';

export async function runMemoryRotate(
  io: ProgramIO,
  options: MemoryRotateCommandOptions
): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(
      io,
      fail(
        'memory.rotate',
        'INVALID_MEMORY_ROTATE_FLAGS',
        'Use either --dry-run or --apply, not both',
        {},
        [
          'Run without --apply to preview the rotation plan, or pass --apply to archive tier-C candidates'
        ]
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryRotate({ projectRoot, apply: options.apply === true });
    printResult(
      io,
      ok('memory.rotate', report, report.warnings, rotateNextActions(report, options)),
      options.json
    );
    if (report.refused) process.exitCode = 1;
  } catch (error) {
    printResult(
      io,
      memoryFailure({
        command: 'memory.rotate',
        fallbackCode: 'MEMORY_ROTATE_FAILED',
        error,
        projectRoot,
        suggestions: ['Check that the project has a readable .peaks/memory directory']
      }),
      options.json
    );
    process.exitCode = 1;
  }
}

/** The refusal / preview / exclusion / tier-D notices the plan earns, in order. */
function rotateNextActions(
  report: ReturnType<typeof executeMemoryRotate>,
  options: MemoryRotateCommandOptions
): string[] {
  const nextActions: string[] = [];
  if (report.refused) {
    nextActions.push(`Refused to apply: ${report.refusalReasons.join('; ')}`);
  } else if (options.apply !== true) {
    nextActions.push(
      'Preview only — re-run with --apply to move the tier-C candidates into archived/.'
    );
  }
  if (report.excluded.length > 0) {
    nextActions.push(
      `${report.excluded.length} candidate(s) excluded by a safety gate (see \`excluded\`).`
    );
  }
  const deleteCandidates = report.candidates.filter(
    (candidate) => candidate.action === 'delete-candidate'
  );
  if (deleteCandidates.length > 0) {
    nextActions.push(
      `${deleteCandidates.length} tier-D file(s) are delete-candidates only; peaks never deletes them — remove by hand if you are sure.`
    );
  }
  return nextActions;
}
