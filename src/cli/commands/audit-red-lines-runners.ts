/**
 * `peaks audit red-lines` runner — Slice L2.1.
 *
 * The action body moved out of `audit-commands.ts` verbatim; the registrar now
 * only wires the command and delegates. Every envelope, error code and hint
 * string is unchanged.
 */

import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import { runRedLinesAudit } from '../../services/audit/red-lines-service.js';
import type { RedLineAudit } from '../../services/audit/types.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  PROJECT_PATH_HINT,
  SCANNER_HINT,
  validateProjectRoot,
  type RedLinesOptions
} from './audit-command-shared.js';
import { emptyRedLineAudit } from './audit-refusal-data.js';

export const RED_LINES_DESCRIPTION =
  'Scan skills/, .claude/rules/, and openspec/changes/ for MANDATORY / BLOCKING / MUST NOT / RED LINE markers; classify each as cli-backed / partial / prose-only';

function redLinesNextActions(audit: RedLineAudit): string[] {
  const nextActions: string[] = [];
  if (audit.proseOnly > 0) {
    nextActions.push(
      `${audit.proseOnly} prose-only red lines remain. Plan P1/P2 enforcers in L2.2-L2.4.`
    );
  }
  if (audit.cliBacked > 0) {
    nextActions.push(
      `${audit.cliBacked} red lines are now cli-backed. Re-run after each enforcer lands to track the prose-only ratio.`
    );
  }
  return nextActions;
}

function redLinesFailureEnvelope(
  code: string,
  message: string,
  nextAction: string
): ResultEnvelope<RedLineAudit> {
  return fail<RedLineAudit>('audit.red-lines', code, message, emptyRedLineAudit(), [nextAction]);
}

export function runRedLines(options: RedLinesOptions, io: ProgramIO): void {
  const validation = validateProjectRoot(options.project);
  if (!validation.ok) {
    printResult(
      io,
      redLinesFailureEnvelope(validation.code, validation.message, PROJECT_PATH_HINT),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = runRedLinesAudit({ projectRoot: validation.projectRoot });
    const envelope: ResultEnvelope<RedLineAudit> = ok(
      'audit.red-lines',
      result.audit,
      result.warnings.map((w) => `${w.file}: ${w.message}`),
      redLinesNextActions(result.audit)
    );
    printResult(io, envelope, options.json);
  } catch (error) {
    printResult(
      io,
      redLinesFailureEnvelope('SCANNER_FAILED', getErrorMessage(error), SCANNER_HINT),
      options.json
    );
    process.exitCode = 1;
  }
}
