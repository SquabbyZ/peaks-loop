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
  shouldPauseAtGate,
  formatAutoProceedLogLine
} from '../../services/solo/mode-gate.js';
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';
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
          'The 3 hard-floor categories always pause regardless of mode.'
      )
      .requiredOption('--step <step>', `one of: ${GATED_STEPS.join(', ')}`)
      .requiredOption('--mode <mode>', 'one of: full-auto, assisted, swarm, strict')
      .option('--hard-floor <category>', 'optional hard-floor override (irreversible-external-side-effect | authentication-credential | multi-day-investment)')
      .option('--recommended <option>', 'recommended option label to log when auto-proceeding', 'recommended-option')
  ).action(
    (opts: {
      step: string;
      mode: string;
      hardFloor?: string;
      recommended?: string;
      json?: boolean;
    }) => {
      try {
        if (!isSoloMode(opts.mode)) {
          printResult(
            io,
            fail('solo.should-pause', 'INVALID_MODE', `mode must be one of full-auto, assisted, swarm, strict (got "${opts.mode}")`, { provided: opts.mode }, ['Pass --mode full-auto | assisted | swarm | strict']),
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
            fail('solo.should-pause', 'INVALID_HARD_FLOOR', `hard-floor must be one of: irreversible-external-side-effect | authentication-credential | multi-day-investment (got "${hardFloor}")`, { provided: hardFloor }, ['Omit --hard-floor or pass a valid category']),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        const step = opts.step as typeof GATED_STEPS[number];
        const decision = shouldPauseAtGate({
          mode: opts.mode,
          step,
          hardFloorCategory: hardFloor
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
              mode: opts.mode,
              step,
              shouldPause: decision.shouldPause,
              reason: decision.reason,
              ...(decision.hardFloorCategory !== undefined ? { hardFloorCategory: decision.hardFloorCategory } : {})
            }
          }, { projectRoot });
        }
        const logLine = formatAutoProceedLogLine({
          mode: opts.mode,
          step,
          recommendedOption: opts.recommended ?? 'recommended-option',
          hardFloorCategory: hardFloor
        });
        printResult(
          io,
          ok('solo.should-pause', { ...decision, logLine }, [], [
            decision.shouldPause
              ? `Mode ${opts.mode} + step ${opts.step} → PAUSE for AskUserQuestion`
              : `Mode ${opts.mode} + step ${opts.step} → AUTO-PROCEED with recommended option`
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
  } catch {
    return null;
  }
}
