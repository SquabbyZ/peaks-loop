/**
 * `peaks code should-pause` — the "print a decision" half of the mode-gate
 * CLI seam.
 *
 * Extracted VERBATIM from `code-mode-gate-commands.ts` (job
 * strict-remediation-abc, slice c1-eslint-family-sweep, leaf c4w1-cli-b).
 * This module holds the two envelope builders — the stale-presence override
 * branch and the normal-decision branch — plus the observability event emit
 * each performs. The registration + validation lives in
 * `code-mode-gate-should-pause-command.ts`.
 *
 * The envelope contents (reason / gateKind / logLine / stalePresence field /
 * nextActions hints), the `emitObservabilityEvent` `detail` shape (mode +
 * step + shouldPause + reason and the optional `hardFloorCategory` spread),
 * the "only emit when the sid is non-empty" guard, and the two hint strings
 * on the stale branch all came directly from HEAD. Nothing here swallows
 * anything: the try/catch that answers SHOULD_PAUSE_FAILED stayed in
 * `code-mode-gate-commands.ts`.
 */
import { ok } from 'peaks-loop-shared/result';

import {
  formatAutoProceedLogLine,
  shouldPauseAtGate,
  type CodeMode,
  type CommitBoundaryActionId,
  type GatedStepId,
  type HardFloorCategory
} from '../../services/code/mode-gate.js';
import type { checkStalePresence } from '../../services/skills/skill-presence-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { emitObservabilityEvent } from '../../services/observability/observability-service.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';

/** The mode-gate `should-pause` action's option bag (verbatim commander shape). */
export type ShouldPauseOptions = {
  step: string;
  mode: string;
  hardFloor?: string;
  recommended?: string;
  project?: string;
  ignoreStalePresence?: boolean;
  commitBoundaryAction?: string;
  json?: boolean;
};

/** Reader for the active session id (module-private to `code-mode-gate-commands.ts`). */
export type ReadActiveSid = (projectRoot: string) => string | null;

/** The `checkStalePresence` return the caller narrowed to `.stale === true`. */
export type StalePresence = ReturnType<typeof checkStalePresence>;

/** The mode-gate decision this file renders. */
export type ShouldPauseDecision = ReturnType<typeof shouldPauseAtGate>;

/** The values the action's validation branch handed down to the envelope builders. */
export type ShouldPauseValidated = {
  mode: CodeMode;
  step: GatedStepId;
  hardFloor: HardFloorCategory | undefined;
  commitBoundaryActionId: CommitBoundaryActionId | undefined;
};

type HandleStaleArgs = {
  io: ProgramIO;
  opts: ShouldPauseOptions;
  mode: CodeMode;
  step: GatedStepId;
  readActiveSid: ReadActiveSid;
};

/**
 * Build the envelope manually so we can attach the extra structured fields
 * (stalePresence, logLine) and emit a dedicated observability event tagged
 * with reason='stale-presence'.
 */
export function handleStalePresence(args: HandleStaleArgs, stalePresence: StalePresence): void {
  const { io, opts, mode, step, readActiveSid } = args;
  const sid = readActiveSid(opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd()) ?? '';
  if (sid.length > 0) {
    emitStalePresenceEvent({ sid, opts, mode, step, stalePresence });
  }
  printStalePresenceEnvelope({ io, opts, mode, step, stalePresence });
}

function emitStalePresenceEvent(args: {
  sid: string;
  opts: ShouldPauseOptions;
  mode: CodeMode;
  step: GatedStepId;
  stalePresence: StalePresence;
}): void {
  const { sid, opts, mode, step, stalePresence } = args;
  emitObservabilityEvent(
    {
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: sid,
      category: 'mode-gate',
      detail: {
        mode: mode,
        step,
        shouldPause: true,
        reason: 'stale-presence',
        staleReason: stalePresence.reason,
        recordedOuterSessionId: stalePresence.recordedOuterSessionId,
        currentOuterSessionId: stalePresence.currentOuterSessionId
      }
    },
    { projectRoot: opts.project ?? process.cwd() }
  );
}

function printStalePresenceEnvelope(args: {
  io: ProgramIO;
  opts: ShouldPauseOptions;
  mode: CodeMode;
  step: GatedStepId;
  stalePresence: StalePresence;
}): void {
  const { io, opts, mode, step, stalePresence } = args;
  printResult(
    io,
    ok(
      'code.should-pause',
      {
        shouldPause: true,
        reason: `stale-presence — re-ask Step 1 (${stalePresence.reason}; recorded outer session id does not match current)`,
        gateKind: 'mode-selection-itself',
        logLine: `auto-pause (${mode}, stale-presence:${stalePresence.reason}): ${step} → re-ask`,
        stalePresence: {
          stale: true,
          reason: stalePresence.reason,
          recordedOuterSessionId: stalePresence.recordedOuterSessionId,
          currentOuterSessionId: stalePresence.currentOuterSessionId
        }
      },
      [],
      [
        `Recorded outer session id "${stalePresence.recordedOuterSessionId ?? '?'}" does not match current outer session id "${stalePresence.currentOuterSessionId ?? '?'}".`,
        `peaks-code Step 1 must AskUserQuestion to confirm the mode for THIS session (slice 002 AC-2).`
      ]
    ),
    opts.json
  );
}

type HandleDecisionArgs = {
  io: ProgramIO;
  opts: ShouldPauseOptions;
  validated: ShouldPauseValidated;
  readActiveSid: ReadActiveSid;
};

/**
 * Slice C of v2.11.1 — observability hook #4/7. Fire-and-forget per PRD Q4
 * (full-auto must never fail-loud). projectRoot resolution mirrors
 * observability-commands.ts (findProjectRoot → cwd fallback).
 *
 * v2.15.0 slice 002 repair (QA blocker): translate the CLI
 * --commit-boundary-action flag into the service-layer boolean. The CLI accepts
 * the action id (e.g. "git-push") for ergonomic machine consumption; the
 * service layer only cares that *some* commit-boundary action triggered the
 * override. The actual action id is echoed in the JSON envelope below.
 */
export function handleDecision(args: HandleDecisionArgs): void {
  const { io, opts, validated, readActiveSid } = args;
  const { mode, step, hardFloor, commitBoundaryActionId } = validated;
  const decision = shouldPauseAtGate({
    mode: mode,
    step,
    hardFloorCategory: hardFloor,
    commitBoundaryAction: commitBoundaryActionId !== undefined
  });
  const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
  const sid = readActiveSid(projectRoot) ?? '';
  if (sid.length > 0) {
    emitModeGateDecision({ sid, projectRoot, mode, step, decision });
  }
  const logLine = formatAutoProceedLogLine({
    mode: mode,
    step,
    recommendedOption: opts.recommended ?? 'recommended-option',
    hardFloorCategory: hardFloor
  });
  printDecisionEnvelope({ io, opts, mode, decision, logLine, commitBoundaryActionId });
}

function emitModeGateDecision(args: {
  sid: string;
  projectRoot: string;
  mode: CodeMode;
  step: GatedStepId;
  decision: ShouldPauseDecision;
}): void {
  const { sid, projectRoot, mode, step, decision } = args;
  emitObservabilityEvent(
    {
      schemaVersion: 1,
      ts: new Date().toISOString(),
      sessionId: sid,
      category: 'mode-gate',
      detail: {
        mode: mode,
        step,
        shouldPause: decision.shouldPause,
        reason: decision.reason,
        ...(decision.hardFloorCategory !== undefined
          ? { hardFloorCategory: decision.hardFloorCategory }
          : {})
      }
    },
    { projectRoot }
  );
}

/**
 * v2.15.0 slice 002 repair: include the commit-boundary
 * action id in the envelope (when provided) so the LLM-side
 * caller can echo which boundary was checked. Null when no
 * --commit-boundary-action flag was passed.
 */
function printDecisionEnvelope(args: {
  io: ProgramIO;
  opts: ShouldPauseOptions;
  mode: CodeMode;
  decision: ShouldPauseDecision;
  logLine: string;
  commitBoundaryActionId: CommitBoundaryActionId | undefined;
}): void {
  const { io, opts, mode, decision, logLine, commitBoundaryActionId } = args;
  printResult(
    io,
    ok(
      'code.should-pause',
      {
        ...decision,
        logLine,
        ...(commitBoundaryActionId !== undefined
          ? { commitBoundaryAction: commitBoundaryActionId }
          : {})
      },
      [],
      [
        decision.shouldPause
          ? `Mode ${mode} + step ${opts.step} → PAUSE for AskUserQuestion${commitBoundaryActionId !== undefined ? ` (commit-boundary: ${commitBoundaryActionId})` : ''}`
          : `Mode ${mode} + step ${opts.step} → AUTO-PROCEED with recommended option`
      ]
    ),
    opts.json
  );
}
