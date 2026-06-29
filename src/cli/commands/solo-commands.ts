/**
 * Slice 2 — `peaks solo [--fast] <change-id>` (peaks-solo fast mode).
 *
 * The `peaks-solo` SKILL orchestrates an LLM-side workflow:
 *   load-memory -> standards-preflight -> rd-cycle -> qa-cycle -> emit-txt
 *
 * The CLI surface here is intentionally narrow: it builds a SoloPlan and
 * runs it via `runSoloFast`. Fast mode skips memory full-load, standards
 * preflight, and the QA repair loop. Round-trip KPI: ≤ 30s.
 *
 * No new service layer — the orchestrator is the in-file `runSoloFast`
 * function. Hooks are injected so tests can mock at the boundary.
 *
 * v2.11.0 Group F (Tier 9) — D5 / D7 additions:
 *   - `peaks solo should-pause --step <step> --mode <mode>` (D5)
 *   - `peaks solo post-compact-detect --project <path>` (D7)
 */

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';
import { emitObservabilityEvent } from '../../services/observability/observability-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  GATED_STEPS,
  isHardFloorCategory,
  isSoloMode,
  isCommitBoundaryAction,
  shouldPauseAtGate,
  formatAutoProceedLogLine
} from '../../services/solo/mode-gate.js';
import { getSkillPresence, checkStalePresence } from '../../services/skills/skill-presence-service.js';
import {
  detectPostCompactResume,
  formatPostCompactResumeLogLine
} from '../../services/solo/post-compact-detector.js';
import { runAutoCompact } from '../../services/solo/auto-compact-orchestrator.js';

export type SoloStepKind = 'memory' | 'preflight' | 'rd' | 'qa' | 'emit';
export interface SoloStep {
  readonly id: 'load-memory' | 'standards-preflight' | 'rd-cycle' | 'qa-cycle' | 'emit-txt';
  readonly kind: SoloStepKind;
  readonly skipped: boolean;
  /** QA-only: when true, qa hook retries on failure up to N rounds. */
  readonly repairLoop?: boolean;
}

export interface SoloPlan {
  readonly changeId: string;
  readonly steps: readonly SoloStep[];
}

export interface SoloHooks {
  readonly memory: (ctx: { changeId: string }) => Promise<unknown>;
  readonly preflight: (ctx: { changeId: string }) => Promise<unknown>;
  readonly rd: (ctx: { changeId: string }) => Promise<unknown>;
  readonly qa: (ctx: { changeId: string; repairLoop: boolean }) => Promise<unknown>;
  readonly emit: (ctx: { changeId: string }) => Promise<unknown>;
}

export interface SoloRunResult {
  readonly changeId: string;
  readonly ok: boolean;
  readonly steps: readonly SoloStep[];
  readonly skipped: readonly string[];
  readonly elapsedMs: number;
}

const STEP_ORDER: readonly SoloStep['id'][] = [
  'load-memory',
  'standards-preflight',
  'rd-cycle',
  'qa-cycle',
  'emit-txt'
];

const STEP_KIND: Record<SoloStep['id'], SoloStepKind> = {
  'load-memory': 'memory',
  'standards-preflight': 'preflight',
  'rd-cycle': 'rd',
  'qa-cycle': 'qa',
  'emit-txt': 'emit'
};

/**
 * Build a SoloPlan. `fast=true` marks memory + preflight as skipped and
 * disables the QA repair loop. Step order is fixed; emit-txt always last.
 */
export function buildSoloPlan(opts: { changeId: string; fast: boolean }): SoloPlan {
  const steps: SoloStep[] = STEP_ORDER.map((id) => {
    const isSkippable = id === 'load-memory' || id === 'standards-preflight';
    const step: SoloStep = {
      id,
      kind: STEP_KIND[id],
      skipped: opts.fast && isSkippable
    };
    if (id === 'qa-cycle') {
      return { ...step, repairLoop: !opts.fast };
    }
    return step;
  });

  return { changeId: opts.changeId, steps };
}

/**
 * Run the SoloPlan. Skipped steps do NOT invoke their hook; emit-txt is
 * always invoked last. Returns timing + skipped ids for KPI measurement.
 */
export async function runSoloFast(opts: {
  changeId: string;
  plan: SoloPlan;
  hooks: SoloHooks;
}): Promise<SoloRunResult> {
  const start = Date.now();
  const skipped: string[] = [];
  const { changeId, plan, hooks } = opts;

  for (const step of plan.steps) {
    if (step.skipped) {
      skipped.push(step.id);
      continue;
    }
    switch (step.id) {
      case 'load-memory':
        await hooks.memory({ changeId });
        break;
      case 'standards-preflight':
        await hooks.preflight({ changeId });
        break;
      case 'rd-cycle':
        await hooks.rd({ changeId });
        break;
      case 'qa-cycle':
        await hooks.qa({ changeId, repairLoop: step.repairLoop === true });
        break;
      case 'emit-txt':
        await hooks.emit({ changeId });
        break;
    }
  }

  return {
    changeId,
    ok: true,
    steps: plan.steps,
    skipped,
    elapsedMs: Date.now() - start
  };
}

/**
 * Register the `peaks solo [--fast] <change-id>` command. The actual
 * LLM-side orchestration is driven by the SKILL.md (LLM-side), so this
 * CLI command is a thin surface that builds the plan and emits a JSON
 * envelope for downstream tooling.
 */
export function registerSoloCommands(program: Command, io: ProgramIO): void {
  const solo = program
    .command('solo')
    .description('peaks-solo LLM-side workflow planner (slice 2 fast mode)');

  solo
    .command('plan')
    .description('Build and print a SoloPlan without executing it')
    .argument('<change-id>', 'change id to plan against')
    .option('--fast', 'fast mode: skip memory full-load, standards preflight, and QA repair loop', false)
    .option('--json', 'emit JSON envelope')
    .action((changeId: string, opts: { fast?: boolean; json?: boolean }) => {
      const plan = buildSoloPlan({ changeId, fast: opts.fast === true });
      if (opts.json === true) {
        process.stdout.write(JSON.stringify({ ok: true, data: plan }) + '\n');
      } else {
        process.stdout.write(`change-id: ${plan.changeId}\n`);
        for (const step of plan.steps) {
          const flag = step.skipped ? 'SKIP' : 'RUN ';
          const repair = step.id === 'qa-cycle' ? ` repair=${step.repairLoop === true ? 'on' : 'off'}` : '';
          process.stdout.write(`  [${flag}] ${step.id}${repair}\n`);
        }
      }
    });

  addJsonOption(
    solo
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
        if (!isSoloMode(mode)) {
          printResult(
            io,
            fail('solo.should-pause', 'INVALID_MODE', `mode must be one of full-auto, assisted, swarm, strict (got "${mode}")`, { provided: mode }, ['Pass --mode full-auto | assisted | swarm | strict']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        if (!(GATED_STEPS as readonly string[]).includes(opts.step)) {
          printResult(
            io,
            fail('solo.should-pause', 'INVALID_STEP', `step must be one of the 14 GATED_STEPS (got "${opts.step}")`, { provided: opts.step, allowed: [...GATED_STEPS] }, ['Pass --step <one of the 14 GATED_STEPS>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const hardFloor = opts.hardFloor;
        if (hardFloor !== undefined && !isHardFloorCategory(hardFloor)) {
          printResult(
            io,
            fail('solo.should-pause', 'INVALID_HARD_FLOOR', `hard-floor must be one of: irreversible-external-side-effect | authentication-credential | multi-day-investment | commit-boundary-side-effect (got "${hardFloor}")`, { provided: hardFloor }, ['Omit --hard-floor or pass a valid category']),
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
            fail('solo.should-pause', 'INVALID_COMMIT_BOUNDARY_ACTION', `--commit-boundary-action must be one of: git-push | git-tag | npm-publish | npm-install-global | peaks-global-install (got "${commitBoundaryActionId}")`, { provided: commitBoundaryActionId }, ['Omit --commit-boundary-action or pass a valid action id']),
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
        // 2026-06-28-solo-mode-bypass-fix) is already in effect, so
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
          const sid = readActiveSid(opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd()) ?? '';
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
            ok('solo.should-pause', {
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
              `peaks-solo Step 1 must AskUserQuestion to confirm the mode for THIS session (slice 002 AC-2).`
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
        const sid = readActiveSid(projectRoot) ?? '';
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
          ok('solo.should-pause', {
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
          fail('solo.should-pause', 'SHOULD_PAUSE_FAILED', getErrorMessage(err), null, ['Re-run with --json for envelope shape']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    solo
      .command('post-compact-detect')
      .description(
        'v2.11.0 D7: detect whether the current invocation is a same-day post-compact resume. ' +
          'Auto-resumes (no AskUserQuestion) when the most-recent checkpoint is from today, has a mode field, ' +
          'and the active skill is peaks-solo. Falls through to the normal Step 0.7 flow otherwise.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--active-skill <skill>', 'override active skill (test seam; default: read from presence)')
  ).action(
    async (opts: { project: string; sessionId?: string; activeSkill?: string; json?: boolean }) => {
      try {
        const sessionId = opts.sessionId ?? readActiveSid(opts.project);
        if (sessionId === null) {
          printResult(
            io,
            fail('solo.post-compact-detect', 'NO_ACTIVE_SESSION', 'no active session id; pass --session-id or set presence via `peaks skill presence:set peaks-solo`', null, ['Re-run with --session-id <sid>']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const probe = await detectPostCompactResume({
          sessionId,
          projectRoot: opts.project,
          activeSkill: opts.activeSkill
        });
        const logLine = formatPostCompactResumeLogLine(probe);
        printResult(
          io,
          ok('solo.post-compact-detect', { ...probe, logLine }, [...probe.warnings], [
            probe.shouldAutoResume
              ? `Post-compact match → auto-resume mode=${probe.mode ?? '?'} checkpoint=${probe.checkpointPath ?? '?'}`
              : `No auto-resume: ${probe.reason}`
          ]),
          opts.json
        );
      } catch (err) {
        printResult(
          io,
          fail('solo.post-compact-detect', 'POST_COMPACT_DETECT_FAILED', getErrorMessage(err), null, ['Verify the project path and try again']),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    solo
      .command('auto-compact')
      .description(
        'v2.13.0 AC-4: zero-human-intervention auto-compact. Probes current ' +
          'context-fill % via the active IDE adapter; ≥ 0.85 writes a pre-compact ' +
          'checkpoint + convergence plan + auto-decisions log; ≥ 0.95 forces ' +
          'synchronous IDE-side compact. The LLM / runner keeps working with ' +
          'context < 95% without human intervention. pair with `peaks context ' +
          'now` (AC-1) which feeds the ratio into this command.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--in-flight-batch', 'defer if a sub-agent batch is in flight (D6.e)')
      .option('--force', 'force compact at any ratio (test seam)')
      .option('--bypass-red-line', 'skip the 95% red-line gate (test seam; never true in production)')
  ).action(
    async (opts: {
      project: string;
      sessionId?: string;
      inFlightBatch?: boolean;
      force?: boolean;
      bypassRedLine?: boolean;
      json?: boolean;
    }) => {
      try {
        const result = await runAutoCompact({
          projectRoot: opts.project,
          sessionId: opts.sessionId ?? readActiveSid(opts.project) ?? undefined,
          inFlightBatch: opts.inFlightBatch === true
            ? { hasInFlightBatch: true }
            : undefined,
          force: opts.force === true,
          bypassRedLine: opts.bypassRedLine === true
        });
        const code = result.code;
        const exitOk = result.ok || code === 'AUTO_COMPACT_SKIP' || code === 'AUTO_COMPACT_WAIT';
        // Adapt AutoCompactResult → ResultEnvelope so printResult's
        // generic accepts it. The orchestrator envelope carries
        // `data` on success-path and `nextActions` on the error
        // path; surface both directly to the user.
        const data = 'data' in result ? result.data : null;
        const nextActions = 'nextActions' in result ? result.nextActions : [];
        const envelope = result.ok
          ? ok(`solo.auto-compact`, data ?? {}, [], [result.message, ...nextActions])
          : fail(`solo.auto-compact`, code, result.message, data, [...nextActions]);
        printResult(io, envelope, opts.json);
        if (!exitOk) process.exitCode = 1;
      } catch (err) {
        printResult(
          io,
          fail('solo.auto-compact', 'AUTO_COMPACT_FAILED', getErrorMessage(err), null, [
            'Verify the project path + session id and try again'
          ]),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );

  addJsonOption(
    solo
      .command('context-now')
      .description(
        'v2.13.0 AC-1: read the active IDE adapter\'s context-fill % ' +
          'without requiring the LLM to pass --prompt-size <bytes> manually. ' +
          'Adapter-driven (no hard-coded IDE names): Claude Code is the MVP ' +
          'implementation; trae / codex / cursor / qoder / tongyi-lingma / ' +
          'hermes / openclaw register their own env-var via IdeAdapter.compact.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
  ).action(
    async (opts: { project: string; sessionId?: string; json?: boolean }) => {
      try {
        const { readContextPercent } = await import('../../services/context/auto-compact-reader.js');
        const probe = readContextPercent({
          projectRoot: opts.project,
          sessionId: opts.sessionId ?? readActiveSid(opts.project) ?? 'unknown',
          env: process.env
        });
        const ratioPct = (probe.ratio * 100).toFixed(1);
        const verdict =
          probe.ratio >= 0.95 ? 'red-line'
            : probe.ratio >= 0.85 ? 'pre-compact'
            : probe.ratio >= 0.5 ? 'soft-warn'
            : 'ok';
        printResult(
          io,
          ok('solo.context-now', {
            ratio: probe.ratio,
            ratioPct: `${ratioPct}%`,
            verdict,
            source: probe.source,
            ide: probe.ide,
            capacityBytes: probe.capacityBytes,
            rawBytes: probe.rawBytes ?? null,
            capturedAt: probe.capturedAt
          }, [], [
            verdict === 'red-line'
              ? `RED LINE: ≥ 95%. Run \`peaks solo auto-compact\` immediately (next sub-agent dispatch will be blocked).`
              : verdict === 'pre-compact'
                ? `Pre-compact zone (85–95%). Run \`peaks solo auto-compact\` to converge now.`
                : verdict === 'soft-warn'
                  ? `Soft warn (50–85%). Continue working; the next \`peaks context now\` will re-check.`
                  : `Below 50%. No action required.`
          ]),
          true
        );
      } catch (err) {
        printResult(
          io,
          fail('solo.context-now', 'CONTEXT_NOW_FAILED', getErrorMessage(err), null, [
            'Verify the project path and try again'
          ]),
          opts.json
        );
        process.exitCode = 1;
      }
    }
  );
}

function readActiveSid(projectRoot: string): string | null {
  try {
    const presence = getSkillPresence(projectRoot);
    if (presence === null || presence === undefined) return null;
    return presence.sessionId ?? null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}
