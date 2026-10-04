/**
 * `peaks code should-pause` — v2.11.0 D5 mode-gate CLI seam.
 *
 * Extracted VERBATIM from `code-mode-gate-commands.ts` (job
 * strict-remediation-abc, slice c1-eslint-family-sweep, leaf c4w1-cli-b) so
 * the registration file clears the 300-line cap and the
 * `max-lines-per-function` / `complexity` findings that sat on the giant
 * commander action arrow fall with it.
 *
 * The order of the four validation rejects (mode → step → hard-floor →
 * commit-boundary-action), each `process.exitCode = 1`, the stale-presence
 * override on `step-1-mode-select` (which prints an `ok(...)` envelope with
 * `shouldPause: true` and reason `stale-presence — re-ask Step 1 (...)`), the
 * outer try/catch that answers with SHOULD_PAUSE_FAILED +
 * `process.exitCode = 1` — every one of those is the code that was already
 * there. The envelope builders themselves live in
 * `code-mode-gate-should-pause-envelope.ts`; `readActiveSidForModeGate` was
 * kept in the registration file (a callback parameter here) so its
 * catch-return-null grace frame keeps counting under the same path.
 */
import type { Command } from 'commander';

import { fail, type ResultEnvelope } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  GATED_STEPS,
  isCodeMode,
  isCommitBoundaryAction,
  isHardFloorCategory,
  type CodeMode,
  type CommitBoundaryActionId,
  type GatedStepId,
  type HardFloorCategory
} from '../../services/code/mode-gate.js';
import { checkStalePresence } from '../../services/skills/skill-presence-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

import {
  handleDecision,
  handleStalePresence,
  type ReadActiveSid,
  type ShouldPauseOptions,
  type ShouldPauseValidated,
  type StalePresence
} from './code-mode-gate-should-pause-envelope.js';

type ShouldPauseValidation =
  { ok: true; validated: ShouldPauseValidated } | { ok: false; envelope: ResultEnvelope<unknown> };

export function registerCodeModeShouldPause(
  code: Command,
  io: ProgramIO,
  readActiveSid: ReadActiveSid
): void {
  addJsonOption(
    code
      .command('should-pause')
      .description(
        'v2.11.0 D5: ask the mode-gate whether the LLM should pause for an AskUserQuestion at a given step. ' +
          'full-auto / 24h auto-proceed (recommended = chosen); assisted / strict pause. ' +
          'The 3 hard-floor categories always pause regardless of mode. ' +
          'v2.15.0 slice 002 AC-2: when --step step-1-mode-select AND the recorded skill presence is stale ' +
          '(outer-session-mismatch / no-presence), the gate returns shouldPause: true with reason "stale-presence" ' +
          'even if the user passed --mode full-auto. The re-ask is mandatory — sticky-mode from a previous ' +
          'session is NOT authoritative.'
      )
      .requiredOption('--step <step>', `one of: ${GATED_STEPS.join(', ')}`)
      // v2.18.4 slice 002-fix-first-run-step-gates (Bug 2):
      // `--mode` is now OPTIONAL. Step 1's SEMANTIC is "ask the user
      // what mode to use" — requiring --mode to ask mode is a
      // chicken-and-egg. When --mode is omitted, default to
      // 'full-auto' so the gate can still evaluate; the gate's hard-
      // pause on `step-1-mode-select` (mode-selection-itself) will
      // pause regardless, and the LLM-side caller can present
      // AskUserQuestion without first knowing the mode.
      .option(
        '--mode <mode>',
        'one of: full-auto, assisted, strict, 24h. Defaults to full-auto when omitted (Step 1 chicken-and-egg fix).'
      )
      .option(
        '--hard-floor <category>',
        'optional hard-floor override (irreversible-external-side-effect | authentication-credential | multi-day-investment | commit-boundary-side-effect)'
      )
      .option(
        '--recommended <option>',
        'recommended option label to log when auto-proceeding',
        'recommended-option'
      )
      .option(
        '--project <path>',
        'v2.15.0 slice 002 AC-2: project root for presence:check-stale. Default: cwd. Pass only when step=step-1-mode-select.'
      )
      .option(
        '--ignore-stale-presence',
        'v2.15.0 slice 002 AC-2: skip the stale-presence check (test seam). Default false.'
      )
      .option(
        '--commit-boundary-action <id>',
        'v2.15.0 slice 002 AC-4 CLI seam (slice 002 repair): when the LLM is about to run a commit-boundary action (git push / tag / npm publish / global install), pass the action id here to force the hard-floor pause. Valid: git-push | git-tag | npm-publish | npm-install-global | peaks-global-install. Default: omitted (no override).'
      )
  ).action((opts: ShouldPauseOptions) => {
    runShouldPauseAction(io, opts, readActiveSid);
  });
}

/**
 * Run the four validation rejects in the exact order HEAD ran them, narrowing
 * `mode` / `hardFloor` / `commitBoundaryActionId` to their service-layer
 * unions. The first failure returns the envelope to print; the caller then
 * prints it, sets `process.exitCode = 1`, and returns — same observable
 * sequence as HEAD.
 */
function validateShouldPause(opts: ShouldPauseOptions): ShouldPauseValidation {
  const modeAndStep = validateModeAndStep(opts);
  if (!modeAndStep.ok) return modeAndStep;
  const floors = validateHardFloorAndCommitBoundary(opts);
  if (!floors.ok) return floors;
  return {
    ok: true,
    validated: {
      mode: modeAndStep.mode,
      step: modeAndStep.step,
      hardFloor: floors.hardFloor,
      commitBoundaryActionId: floors.commitBoundaryActionId
    }
  };
}

type ModeAndStepValidation =
  | { ok: true; mode: CodeMode; step: GatedStepId }
  | { ok: false; envelope: ResultEnvelope<unknown> };

function validateModeAndStep(opts: ShouldPauseOptions): ModeAndStepValidation {
  const mode = opts.mode ?? 'full-auto';
  if (!isCodeMode(mode)) {
    return {
      ok: false,
      envelope: fail(
        'code.should-pause',
        'INVALID_MODE',
        `mode must be one of full-auto, assisted, strict, 24h (got "${mode}")`,
        { provided: mode },
        ['Pass --mode full-auto | assisted | strict | 24h']
      )
    };
  }
  if (!(GATED_STEPS as readonly string[]).includes(opts.step)) {
    return {
      ok: false,
      envelope: fail(
        'code.should-pause',
        'INVALID_STEP',
        `step must be one of the ${GATED_STEPS.length} GATED_STEPS (got "${opts.step}")`,
        { provided: opts.step, allowed: [...GATED_STEPS] },
        [`Pass --step <one of the ${GATED_STEPS.length} GATED_STEPS>`]
      )
    };
  }
  return { ok: true, mode, step: opts.step as GatedStepId };
}

type FloorsValidation =
  | {
      ok: true;
      hardFloor: HardFloorCategory | undefined;
      commitBoundaryActionId: CommitBoundaryActionId | undefined;
    }
  | { ok: false; envelope: ResultEnvelope<unknown> };

function validateHardFloorAndCommitBoundary(opts: ShouldPauseOptions): FloorsValidation {
  const hardFloor = opts.hardFloor;
  if (hardFloor !== undefined && !isHardFloorCategory(hardFloor)) {
    return {
      ok: false,
      envelope: fail(
        'code.should-pause',
        'INVALID_HARD_FLOOR',
        `hard-floor must be one of: irreversible-external-side-effect | authentication-credential | multi-day-investment | commit-boundary-side-effect (got "${hardFloor}")`,
        { provided: hardFloor },
        ['Omit --hard-floor or pass a valid category']
      )
    };
  }
  // v2.15.0 slice 002 repair (QA blocker): validate the
  // --commit-boundary-action flag at the CLI boundary. The
  // service-layer `shouldPauseAtGate` accepts a boolean
  // `commitBoundaryAction: true`; this flag tells the CLI to
  // pass it through. An unknown action id is rejected here
  // (not silently ignored) so typos fail loud.
  const commitBoundaryActionId = opts.commitBoundaryAction;
  if (commitBoundaryActionId !== undefined && !isCommitBoundaryAction(commitBoundaryActionId)) {
    return {
      ok: false,
      envelope: fail(
        'code.should-pause',
        'INVALID_COMMIT_BOUNDARY_ACTION',
        `--commit-boundary-action must be one of: git-push | git-tag | npm-publish | npm-install-global | peaks-global-install (got "${commitBoundaryActionId}")`,
        { provided: commitBoundaryActionId },
        ['Omit --commit-boundary-action or pass a valid action id']
      )
    };
  }
  return { ok: true, hardFloor, commitBoundaryActionId };
}

/**
 * Slice 002 (v2.15.0) AC-2: when the caller is asking about Step 1 AND the
 * recorded presence is stale, the CLI overrides the gate decision to PAUSE.
 * Returns `null` when the check does not apply (not a swallow — no catch, no
 * error path, just the branch HEAD did not take).
 */
function resolveStalePresence(opts: ShouldPauseOptions): StalePresence | null {
  if (opts.step === 'step-1-mode-select' && opts.ignoreStalePresence !== true) {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    return checkStalePresence({ projectRootOverride: projectRoot });
  }
  return null;
}

function runShouldPauseAction(
  io: ProgramIO,
  opts: ShouldPauseOptions,
  readActiveSid: ReadActiveSid
): void {
  try {
    // v2.18.4 slice 002-fix-first-run-step-gates (Bug 2):
    // --mode is optional. Default to 'full-auto' when omitted
    // so step-1-mode-select can run without forcing the caller
    // to know the mode up front. The gate's hard-pause on
    // step-1-mode-select will still pause regardless.
    const check = validateShouldPause(opts);
    if (!check.ok) {
      printResult(io, check.envelope, opts.json);
      process.exitCode = 1;
      return;
    }
    const stalePresence = resolveStalePresence(opts);
    if (stalePresence !== null && stalePresence.stale) {
      handleStalePresence(
        { io, opts, mode: check.validated.mode, step: check.validated.step, readActiveSid },
        stalePresence
      );
      return;
    }
    handleDecision({ io, opts, validated: check.validated, readActiveSid });
  } catch (err) {
    printResult(
      io,
      fail('code.should-pause', 'SHOULD_PAUSE_FAILED', getErrorMessage(err), null, [
        'Re-run with --json for envelope shape'
      ]),
      opts.json
    );
    process.exitCode = 1;
  }
}
