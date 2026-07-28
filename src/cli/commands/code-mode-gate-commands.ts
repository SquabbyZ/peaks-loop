/**
 * Slice rid-024 — `peaks code plan` + `peaks code should-pause` (mode-gate).
 *
 * Extracted from code-commands.ts (rid-024 split).
 * Owns: `plan` (build+print CodePlan), `should-pause` (D5 mode-gate).
 */

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  GATED_STEPS,
  isHardFloorCategory,
  isCodeMode,
  isCommitBoundaryAction,
  shouldPauseAtGate,
  formatAutoProceedLogLine
} from '../../services/code/mode-gate.js';
import { checkStalePresence } from '../../services/skills/skill-presence-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { emitObservabilityEvent } from '../../services/observability/observability-service.js';
import { buildCodePlan } from './code-commands.js';

export function registerCodeModeGateCommands(code: Command, io: ProgramIO): void {
  code
    .command('plan')
    .description('Build and print a CodePlan without executing it')
    .argument('<change-id>', 'change id to plan against')
    .option('--fast', 'fast mode: skip memory full-load, standards preflight, and QA repair loop', false)
    .option('--json', 'emit JSON envelope')
    .action((sessionId: string, opts: { fast?: boolean; json?: boolean }) => {
      const plan = buildCodePlan({ sessionId, fast: opts.fast === true });
      if (opts.json === true) {
        process.stdout.write(JSON.stringify({ ok: true, data: plan }) + '\n');
      } else {
        process.stdout.write(`change-id: ${plan.sessionId}\n`);
        for (const step of plan.steps) {
          const flag = step.skipped ? 'SKIP' : 'RUN ';
          const repair = step.id === 'qa-cycle' ? ` repair=${step.repairLoop === true ? 'on' : 'off'}` : '';
          process.stdout.write(`  [${flag}] ${step.id}${repair}\n`);
        }
      }
    });

  addJsonOption(
    code
      .command('should-pause')
      .description(
        'v2.11.0 D5: ask the mode-gate whether the LLM should pause for an AskUserQuestion at a given step. ' +
          'full-auto / swarm auto-proceed (recommended = chosen); assisted / strict pause. ' +
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
      .option('--mode <mode>', 'one of: full-auto, assisted, swarm, strict. Defaults to full-auto when omitted (Step 1 chicken-and-egg fix).')
      .option('--hard-floor <category>', 'optional hard-floor override (irreversible-external-side-effect | authentication-credential | multi-day-investment | commit-boundary-side-effect)')
      .option('--recommended <option>', 'recommended option label to log when auto-proceeding', 'recommended-option')
      .option('--project <path>', 'v2.15.0 slice 002 AC-2: project root for presence:check-stale. Default: cwd. Pass only when step=step-1-mode-select.')
      .option('--ignore-stale-presence', 'v2.15.0 slice 002 AC-2: skip the stale-presence check (test seam). Default false.')
      .option('--commit-boundary-action <id>', 'v2.15.0 slice 002 AC-4 CLI seam (slice 002 repair): when the LLM is about to run a commit-boundary action (git push / tag / npm publish / global install), pass the action id here to force the hard-floor pause. Valid: git-push | git-tag | npm-publish | npm-install-global | peaks-global-install. Default: omitted (no override).')
  ).action(
    (opts: {
      step: string;
      mode: string;
      hardFloor?: string;
      recommended?: string;
      project?: string;
      ignoreStalePresence?: boolean;
      commitBoundaryAction?: string;
      json?: boolean;
    }) => {
      try {
        // v2.18.4 slice 002-fix-first-run-step-gates (Bug 2):
        // --mode is optional. Default to 'full-auto' when omitted
        // so step-1-mode-select can run without forcing the caller
        // to know the mode up front. The gate's hard-pause on
        // step-1-mode-select will still pause regardless.
        const mode = opts.mode ?? 'full-auto';
        if (!isCodeMode(mode)) {
          printResult(
            io,
            fail('code.should-pause', 'INVALID_MODE', `mode must be one of full-auto, assisted, swarm, strict (got "${mode}")`, { provided: mode }, ['Pass --mode full-auto | assisted | swarm | strict']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        if (!(GATED_STEPS as readonly string[]).includes(opts.step)) {
          printResult(
            io,
            fail('code.should-pause', 'INVALID_STEP', `step must be one of the 14 GATED_STEPS (got "${opts.step}")`, { provided: opts.step, allowed: [...GATED_STEPS] }, ['Pass --step <one of the 14 GATED_STEPS>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const hardFloor = opts.hardFloor;
        if (hardFloor !== undefined && !isHardFloorCategory(hardFloor)) {
          printResult(
            io,
            fail('code.should-pause', 'INVALID_HARD_FLOOR', `hard-floor must be one of: irreversible-external-side-effect | authentication-credential | multi-day-investment | commit-boundary-side-effect (got "${hardFloor}")`, { provided: hardFloor }, ['Omit --hard-floor or pass a valid category']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        // v2.15.0 slice 002 repair (QA blocker): validate the
        // --commit-boundary-action flag at the CLI boundary. The
        // service-layer `shouldPauseAtGate` accepts a boolean
        // `commitBoundaryAction: true`; this flag tells the CLI to
        // pass it through. An unknown action id is rejected here
        // (not silently ignored) so typos fail loud.
        const commitBoundaryActionId = opts.commitBoundaryAction;
        if (commitBoundaryActionId !== undefined && !isCommitBoundaryAction(commitBoundaryActionId)) {
          printResult(
            io,
            fail('code.should-pause', 'INVALID_COMMIT_BOUNDARY_ACTION', `--commit-boundary-action must be one of: git-push | git-tag | npm-publish | npm-install-global | peaks-global-install (got "${commitBoundaryActionId}")`, { provided: commitBoundaryActionId }, ['Omit --commit-boundary-action or pass a valid action id']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const step = opts.step as typeof GATED_STEPS[number];

        // Slice 002 (v2.15.0) AC-2: when the caller is asking about
        // Step 1 AND the recorded presence is stale, OVERRIDE the
        // gate decision to PAUSE with reason='stale-presence'. The
        // hard-pause on step-1-mode-select (defect #1 fix from
        // 2026-06-28-code-mode-bypass-fix) is already in effect, so
        // this only adds the structured `stale` reason + an
        // envelope-level `stalePresence` field so downstream tooling
        // (statusline, sub-agent dispatch) can act on it.
        let stalePresence: ReturnType<typeof checkStalePresence> | null = null;
        if (opts.step === 'step-1-mode-select' && opts.ignoreStalePresence !== true) {
          const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
          stalePresence = checkStalePresence({ projectRootOverride: projectRoot });
        }
        if (stalePresence !== null && stalePresence.stale) {
          // Build the envelope manually so we can attach the extra
          // structured fields (stalePresence, logLine) and emit a
          // dedicated observability event tagged with reason='stale-presence'.
          const sid = readActiveSidForModeGate(opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd()) ?? '';
          if (sid.length > 0) {
            emitObservabilityEvent({
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
            }, { projectRoot: opts.project ?? process.cwd() });
          }
          printResult(
            io,
            ok('code.should-pause', {
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
            }, [], [
              `Recorded outer session id "${stalePresence.recordedOuterSessionId ?? '?'}" does not match current outer session id "${stalePresence.currentOuterSessionId ?? '?'}".`,
              `peaks-code Step 1 must AskUserQuestion to confirm the mode for THIS session (slice 002 AC-2).`
            ]),
            opts.json
          );
          return;
        }

        const decision = shouldPauseAtGate({
          mode: mode,
          step,
          hardFloorCategory: hardFloor,
          // v2.15.0 slice 002 repair (QA blocker): translate the CLI
          // --commit-boundary-action flag into the service-layer
          // boolean. The CLI accepts the action id (e.g. "git-push")
          // for ergonomic machine consumption; the service layer only
          // cares that *some* commit-boundary action triggered the
          // override. The actual action id is echoed in the JSON
          // envelope below.
          commitBoundaryAction: commitBoundaryActionId !== undefined
        });
        // Slice C of v2.11.1 — observability hook #4/7. Fire-and-forget
        // per PRD Q4 (full-auto must never fail-loud). projectRoot
        // resolution mirrors observability-commands.ts (findProjectRoot
        // → cwd fallback).
        const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
        const sid = readActiveSidForModeGate(projectRoot) ?? '';
        if (sid.length > 0) {
          emitObservabilityEvent({
            schemaVersion: 1,
            ts: new Date().toISOString(),
            sessionId: sid,
            category: 'mode-gate',
            detail: {
              mode: mode,
              step,
              shouldPause: decision.shouldPause,
              reason: decision.reason,
              ...(decision.hardFloorCategory !== undefined ? { hardFloorCategory: decision.hardFloorCategory } : {})
            }
          }, { projectRoot });
        }
        const logLine = formatAutoProceedLogLine({
          mode: mode,
          step,
          recommendedOption: opts.recommended ?? 'recommended-option',
          hardFloorCategory: hardFloor
        });
        printResult(
          io,
          // v2.15.0 slice 002 repair: include the commit-boundary
          // action id in the envelope (when provided) so the LLM-side
          // caller can echo which boundary was checked. Null when no
          // --commit-boundary-action flag was passed.
          ok('code.should-pause', {
            ...decision,
            logLine,
            ...(commitBoundaryActionId !== undefined ? { commitBoundaryAction: commitBoundaryActionId } : {})
          }, [], [
            decision.shouldPause
              ? `Mode ${mode} + step ${opts.step} → PAUSE for AskUserQuestion${commitBoundaryActionId !== undefined ? ` (commit-boundary: ${commitBoundaryActionId})` : ''}`
              : `Mode ${mode} + step ${opts.step} → AUTO-PROCEED with recommended option`
          ]),
          opts.json
        );
      } catch (err) {
        printResult(
          io,
          fail('code.should-pause', 'SHOULD_PAUSE_FAILED', getErrorMessage(err), null, ['Re-run with --json for envelope shape']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );
}

// Local helper (was `readActiveSid` in code-commands.ts before rid-024 split).
// The mode-gate stale-presence check needs the active sid for the
// observability event; we re-import getSkillPresence here to avoid the
// cross-file helper import.
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';
function readActiveSidForModeGate(projectRoot: string): string | null {
  try {
    const presence = getSkillPresence(projectRoot);
    if (presence === null || presence === undefined) return null;
    return presence.sessionId ?? null;
  } catch {
    return null;
  }
}