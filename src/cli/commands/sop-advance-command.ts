// src/cli/commands/sop-advance-command.ts
//
// `peaks sop advance` — advance a SOP to a phase, enforcing the gate-bypass
// policy. Split out of `sop-commands.ts`; every refusal code, message, `data`
// field, next-action string and exit code is unchanged.

import type { Command } from 'commander';
import { mkdirSync } from 'node:fs';
import {
  advanceSop,
  SopAdvanceError,
  SopGateBlockedError,
  SopPhaseSkipError
} from '../../services/sop/sop-advance-service.js';
import { sopStateDir } from '../../services/sop/sop-paths.js';
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';
import {
  isBypassLimitReached,
  MAX_BYPASSES_PER_SESSION,
  recordBypass
} from '../../services/mode/bypass-tracker.js';
import { addJsonOption, getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import { printSopFailure, printSopOk } from './sop-command-shared.js';

type SopAdvanceCliOptions = {
  id: string;
  to: string;
  project: string;
  allowCommands?: boolean;
  allowIncomplete?: boolean;
  reason?: string;
  confirm?: boolean;
  forceConfirm?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

/**
 * The bypass policy `request transition` also runs: a bypass needs a reason,
 * and in assisted/strict mode (resolved from the target project) it needs an
 * explicit `--confirm` and counts against the per-SOP bypass cap.
 *
 * Returns false when a refusal envelope was printed and the caller must stop.
 */
function enforceBypassPolicy(io: ProgramIO, options: SopAdvanceCliOptions): boolean {
  if (options.allowIncomplete !== true) return true;
  if (options.reason === undefined || options.reason.trim().length === 0) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.advance',
      code: 'BYPASS_REASON_REQUIRED',
      message: '--allow-incomplete requires --reason explaining why the gates are skipped',
      data: { id: options.id, to: options.to },
      nextActions: ['Add --reason "<short justification>" or satisfy the gates']
    });
    return false;
  }
  if (options.forceConfirm === true) return true;

  const presence = getSkillPresence(options.project);
  if (presence?.mode !== 'assisted' && presence?.mode !== 'strict') return true;
  if (options.confirm !== true) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.advance',
      code: 'ALLOW_INCOMPLETE_RESTRICTED',
      message: `--allow-incomplete requires --confirm in ${presence.mode} mode`,
      data: { id: options.id, mode: presence.mode },
      nextActions: ['Add --confirm to bypass non-interactively']
    });
    return false;
  }

  // The bypass counter is keyed to the per-project SOP run-state dir (not a
  // session); the shared cap constant is reused. Keying it per-project means a
  // bypass in one project never consumes another project's budget. The state
  // dir may not exist yet (no successful advance has written state.json), so
  // ensure it before the counter writes its file.
  const bypassRoot = sopStateDir(options.project, options.id);
  mkdirSync(bypassRoot, { recursive: true });
  if (isBypassLimitReached(bypassRoot)) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.advance',
      code: 'BYPASS_LIMIT_REACHED',
      message: `gate bypass limit reached (${MAX_BYPASSES_PER_SESSION} bypasses per SOP)`,
      data: { id: options.id, limit: MAX_BYPASSES_PER_SESSION },
      nextActions: ['Satisfy the gates instead of bypassing']
    });
    return false;
  }
  // A dry-run preview must not consume a bypass.
  if (options.dryRun !== true) {
    recordBypass(bypassRoot);
  }
  return true;
}

/** The three typed refusals `advanceSop` can raise, then the generic one. */
function emitAdvanceError(io: ProgramIO, options: SopAdvanceCliOptions, error: unknown): void {
  if (error instanceof SopGateBlockedError) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.advance',
      code: error.code,
      message: error.message,
      data: { id: options.id, to: options.to, blockedGates: error.blockedGates },
      nextActions: [
        'Satisfy the blocking gates, or bypass with --allow-incomplete --reason "<why>"'
      ]
    });
    return;
  }
  if (error instanceof SopPhaseSkipError) {
    printSopFailure(io, {
      json: options.json,
      command: 'sop.advance',
      code: error.code,
      message: error.message,
      data: {
        id: options.id,
        to: options.to,
        fromPhase: error.fromPhase,
        expectedNext: error.expectedNext
      },
      nextActions: [
        `Advance to "${error.expectedNext}" first, or bypass with --allow-incomplete --reason "<why>"`
      ]
    });
    return;
  }
  printSopFailure(io, {
    json: options.json,
    command: 'sop.advance',
    code: error instanceof SopAdvanceError ? error.code : 'SOP_ADVANCE_FAILED',
    message: getErrorMessage(error),
    data: { id: options.id, to: options.to },
    nextActions: ['Verify the SOP id and phase with peaks sop lint']
  });
}

async function runSopAdvance(io: ProgramIO, options: SopAdvanceCliOptions): Promise<void> {
  try {
    if (!enforceBypassPolicy(io, options)) return;

    const advanceOptions: Parameters<typeof advanceSop>[0] = {
      projectRoot: options.project,
      id: options.id,
      toPhase: options.to
    };
    if (options.allowCommands === true) advanceOptions.allowCommands = true;
    if (options.allowIncomplete === true) advanceOptions.allowIncomplete = true;
    if (options.reason !== undefined) advanceOptions.reason = options.reason;
    if (options.dryRun === true) advanceOptions.dryRun = true;

    const result = await advanceSop(advanceOptions);
    printSopOk(io, {
      json: options.json,
      command: 'sop.advance',
      data: result,
      nextActions: result.applied
        ? []
        : ['Gates passed; re-run without --dry-run to record the advance']
    });
  } catch (error) {
    emitAdvanceError(io, options, error);
  }
}

export function registerSopAdvanceCommand(sop: Command, io: ProgramIO): void {
  addJsonOption(
    sop
      .command('advance')
      .description(
        'Advance a SOP to a phase; gates guarding that phase must pass (or be explicitly bypassed)'
      )
      .requiredOption('--id <sop-id>', 'SOP id')
      .requiredOption('--to <phase>', 'phase to advance into')
      .option(
        '--project <path>',
        'project whose run-state advances (default: current directory)',
        '.'
      )
      .option('--allow-commands', 'permit evaluating command-type gates')
      .option(
        '--allow-incomplete',
        'bypass the phase gates AND phase-order check (requires --reason)'
      )
      .option('--reason <text>', 'justification recorded when bypassing gates')
      .option('--confirm', 'skip interactive confirmation for a bypass in assisted/strict mode')
      .option('--force-confirm', 'bypass mode-enforced confirmation (use with caution)')
      .option('--dry-run', 'evaluate gates without recording the advance in state.json')
  ).action((options: SopAdvanceCliOptions) => runSopAdvance(io, options));
}
