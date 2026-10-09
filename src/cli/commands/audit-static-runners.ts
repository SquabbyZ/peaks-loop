/**
 * `peaks audit static` and `peaks audit prose-ratio` runners.
 *
 * The two action bodies moved out of `audit-commands.ts` verbatim; the
 * registrar now only wires the commands and delegates. Every envelope, error
 * code and hint string is unchanged.
 */

import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import { runStaticAudit } from '../../services/audit/static-service.js';
import {
  type AuditDecisionRecord,
  writeAuditDecision
} from '../../services/audit/decision-writer.js';
import {
  computeProseRatio,
  type ProseRatioResult
} from '../../services/audit/prose-ratio-calculator.js';
import type { RedLineAudit } from '../../services/audit/types.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  PROJECT_PATH_HINT,
  SCANNER_HINT,
  validateProjectRoot,
  type ProseRatioOptions,
  type StaticAuditOptions,
  type StaticAuditData
} from './audit-command-shared.js';
import { emptyProseRatioResult, emptyStaticAuditData } from './audit-refusal-data.js';

export const STATIC_AUDIT_DESCRIPTION =
  'Run the static audit (peaks-loop lint only; the ECC AgentShield subprocess was removed in 4.0.0-beta.11). Per spec §5.3.';

export const PROSE_RATIO_DESCRIPTION =
  'Compute the prose-only ratio (informational entries excluded). Exits 1 if ratio > target (default 5%).';

const RID_REQUIRES_RECORD_MESSAGE =
  '`--rid` requires `--record` (decision slug disambiguator has no effect without persistence)';

const RID_REQUIRES_RECORD_HINT = 'Pass `--record` together with `--rid <id>`, or omit `--rid`';

type PersistedDecision = { decision?: AuditDecisionRecord; warning?: string };

/**
 * Persist the decision record when `--record` is set. The writer is idempotent
 * at the slug level (same date+rid → same file); repeated runs overwrite.
 * Failures here are surfaced as warnings so the primary audit JSON still
 * reaches the caller.
 */
function persistDecisionRecord(
  audit: RedLineAudit,
  projectRoot: string,
  rid?: string
): PersistedDecision {
  try {
    return {
      decision: writeAuditDecision(audit, {
        projectRoot,
        ...(rid ? { rid } : {})
      })
    };
  } catch (writeError) {
    return { warning: `Failed to write decision record: ${getErrorMessage(writeError)}` };
  }
}

function staticNextActions(decision: AuditDecisionRecord | undefined): string[] {
  const nextActions: string[] = [];
  // nextActions block was removed. `agentShield.installed` is a frozen
  // `false`, so the block printed on every run and pointed users at a
  // removed subprocess, removed flags, and a dead preference.
  if (decision) {
    nextActions.push(`Decision record written: ${decision.filePath}`);
    nextActions.push(
      `Index synced: ${decision.indexSynced ? 'yes' : 'no'} (memory hot.decision[] now includes this audit)`
    );
  }
  return nextActions;
}

function staticFailureEnvelope(
  code: string,
  message: string,
  nextAction: string
): ResultEnvelope<StaticAuditData> {
  return fail<StaticAuditData>('audit.static', code, message, emptyStaticAuditData(), [nextAction]);
}

/**
 * The `--project` / `--rid` preflight. Returns the validated project root, or
 * prints the refusal (and sets the exit code) and returns `undefined`.
 *
 * Slice K1: `--rid` is meaningful only with `--record`. Surface a 422
 * when the user passes `--rid` without `--record` so the CLI fails
 * loudly rather than silently ignoring the request id.
 */
function resolveStaticProjectRoot(options: StaticAuditOptions, io: ProgramIO): string | undefined {
  const validation = validateProjectRoot(options.project);
  if (!validation.ok) {
    printResult(
      io,
      staticFailureEnvelope(validation.code, validation.message, PROJECT_PATH_HINT),
      options.json
    );
    process.exitCode = 1;
    return undefined;
  }
  if (options.rid && !options.record) {
    printResult(
      io,
      staticFailureEnvelope(
        'FLAGS_CONFLICT',
        RID_REQUIRES_RECORD_MESSAGE,
        RID_REQUIRES_RECORD_HINT
      ),
      options.json
    );
    process.exitCode = 1;
    return undefined;
  }
  return validation.projectRoot;
}

export function runStaticAuditCommand(options: StaticAuditOptions, io: ProgramIO): void {
  const projectRoot = resolveStaticProjectRoot(options, io);
  if (projectRoot === undefined) {
    return;
  }

  try {
    const result = runStaticAudit({ projectRoot });
    const persisted: PersistedDecision = options.record
      ? persistDecisionRecord(result.audit, projectRoot, options.rid)
      : {};
    const data: StaticAuditData = {
      audit: result.audit,
      agentShield: result.agentShield,
      ...(persisted.decision ? { decision: persisted.decision } : {})
    };
    const warnings = [...result.warnings];
    if (persisted.warning) {
      warnings.push(persisted.warning);
    }
    const envelope: ResultEnvelope<StaticAuditData> = ok(
      'audit.static',
      data,
      warnings,
      staticNextActions(persisted.decision)
    );
    printResult(io, envelope, options.json);
  } catch (error) {
    printResult(
      io,
      staticFailureEnvelope('SCANNER_FAILED', getErrorMessage(error), SCANNER_HINT),
      options.json
    );
    process.exitCode = 1;
  }
}

function proseRatioNextActions(ratio: ProseRatioResult): string[] {
  return [
    ratio.exceeds
      ? `Prose-only ratio ${(ratio.ratio * 100).toFixed(2)}% exceeds target ${(ratio.target * 100).toFixed(2)}% (${ratio.proseOnly}/${ratio.totalRedLines})`
      : `Prose-only ratio ${(ratio.ratio * 100).toFixed(2)}% within target ${(ratio.target * 100).toFixed(2)}% (${ratio.proseOnly}/${ratio.totalRedLines})`
  ];
}

function proseRatioFailureEnvelope(
  code: string,
  message: string,
  nextAction: string
): ResultEnvelope<ProseRatioResult> {
  return fail<ProseRatioResult>('audit.prose-ratio', code, message, emptyProseRatioResult(), [
    nextAction
  ]);
}

export function runProseRatio(options: ProseRatioOptions, io: ProgramIO): void {
  const validation = validateProjectRoot(options.project);
  if (!validation.ok) {
    printResult(
      io,
      proseRatioFailureEnvelope(validation.code, validation.message, PROJECT_PATH_HINT),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  const target = Number.parseFloat(options.target);
  if (!Number.isFinite(target) || target < 0 || target > 1) {
    printResult(
      io,
      proseRatioFailureEnvelope(
        'INVALID_TARGET',
        `--target must be a number between 0 and 1 (got "${options.target}")`,
        'Pass --target 0.05 (default) or another number in [0, 1]'
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = runStaticAudit({ projectRoot: validation.projectRoot });
    const ratio = computeProseRatio(result.audit.audit, { target });
    const envelope: ResultEnvelope<ProseRatioResult> = ok(
      'audit.prose-ratio',
      ratio,
      [],
      proseRatioNextActions(ratio)
    );
    printResult(io, envelope, options.json);
    if (ratio.exceeds) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      proseRatioFailureEnvelope('SCANNER_FAILED', getErrorMessage(error), SCANNER_HINT),
      options.json
    );
    process.exitCode = 1;
  }
}
