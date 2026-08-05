/**
 * Slice 2 — `peaks code [--fast] <change-id>` (peaks-code fast mode).
 *
 * The `peaks-code` SKILL orchestrates an LLM-side workflow:
 *   load-memory -> standards-preflight -> rd-cycle -> qa-cycle -> emit-txt
 *
 * The CLI surface here is intentionally narrow: it builds a CodePlan and
 * runs it via `runCodeFast`. Fast mode skips memory full-load, standards
 * preflight, and the QA repair loop. Round-trip KPI: ≤ 30s.
 *
 * No new service layer — the orchestrator is the in-file `runCodeFast`
 * function. Hooks are injected so tests can mock at the boundary.
 *
 * v2.11.0 Group F (Tier 9) — D5 / D7 additions:
 *   - `peaks code should-pause --step <step> --mode <mode>` (D5)
 *   - `peaks code post-compact-detect --project <path>` (D7)
 *
 * rid-024: 7 sub-commands extracted into 3 sibling files:
 *   - code-mode-gate-commands.ts (plan + should-pause)
 *   - code-job-shape-commands.ts (detect-job + read-job-shape)
 *   - code-runtime-commands.ts (post-compact-detect + auto-compact + context-now + gate-step-08 + emit-handoff)
 * This file keeps the public API: types, buildCodePlan, runCodeFast,
 * registerCodeCommands (now a thin orchestrator).
 */

import type { Command } from 'commander';

import type { ProgramIO } from '../cli-helpers.js';

import { registerCodeRunCommand } from './code-run-command.js';
import { registerCodeModeGateCommands } from './code-mode-gate-commands.js';
import { registerCodeJobShapeCommands } from './code-job-shape-commands.js';
import { registerCodeRuntimeCommands } from './code-runtime-commands.js';
import { registerCodeOrchestratorCanDoCommand } from './code-orchestrator-can-do.js';

export type CodeStepKind = 'memory' | 'preflight' | 'rd' | 'qa' | 'emit';
export interface CodeStep {
  readonly id: 'load-memory' | 'standards-preflight' | 'rd-cycle' | 'qa-cycle' | 'emit-txt';
  readonly kind: CodeStepKind;
  readonly skipped: boolean;
  /** QA-only: when true, qa hook retries on failure up to N rounds. */
  readonly repairLoop?: boolean;
}

export interface CodePlan {
  readonly sessionId: string;
  readonly steps: readonly CodeStep[];
}

export interface CodeHooks {
  readonly memory: (ctx: { sessionId: string }) => Promise<unknown>;
  readonly preflight: (ctx: { sessionId: string }) => Promise<unknown>;
  readonly rd: (ctx: { sessionId: string }) => Promise<unknown>;
  readonly qa: (ctx: { sessionId: string; repairLoop: boolean }) => Promise<unknown>;
  readonly emit: (ctx: { sessionId: string }) => Promise<unknown>;
}

export interface CodeRunResult {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly steps: readonly CodeStep[];
  readonly skipped: readonly string[];
  readonly elapsedMs: number;
}

const STEP_ORDER: readonly CodeStep['id'][] = [
  'load-memory',
  'standards-preflight',
  'rd-cycle',
  'qa-cycle',
  'emit-txt'
];

const STEP_KIND: Record<CodeStep['id'], CodeStepKind> = {
  'load-memory': 'memory',
  'standards-preflight': 'preflight',
  'rd-cycle': 'rd',
  'qa-cycle': 'qa',
  'emit-txt': 'emit'
};

/**
 * Build a CodePlan. `fast=true` marks memory + preflight as skipped and
 * disables the QA repair loop. Step order is fixed; emit-txt always last.
 */
export function buildCodePlan(opts: { sessionId: string; fast: boolean }): CodePlan {
  const steps: CodeStep[] = STEP_ORDER.map((id) => {
    const isSkippable = id === 'load-memory' || id === 'standards-preflight';
    const step: CodeStep = {
      id,
      kind: STEP_KIND[id],
      skipped: opts.fast && isSkippable
    };
    if (id === 'qa-cycle') {
      return { ...step, repairLoop: !opts.fast };
    }
    return step;
  });

  return { sessionId: opts.sessionId, steps };
}

/**
 * Run the CodePlan. Skipped steps do NOT invoke their hook; emit-txt is
 * always invoked last. Returns timing + skipped ids for KPI measurement.
 */
export async function runCodeFast(opts: {
  sessionId: string;
  plan: CodePlan;
  hooks: CodeHooks;
}): Promise<CodeRunResult> {
  const start = Date.now();
  const skipped: string[] = [];
  const { sessionId, plan, hooks } = opts;

  for (const step of plan.steps) {
    if (step.skipped) {
      skipped.push(step.id);
      continue;
    }
    switch (step.id) {
      case 'load-memory':
        await hooks.memory({ sessionId });
        break;
      case 'standards-preflight':
        await hooks.preflight({ sessionId });
        break;
      case 'rd-cycle':
        await hooks.rd({ sessionId });
        break;
      case 'qa-cycle':
        await hooks.qa({ sessionId, repairLoop: step.repairLoop === true });
        break;
      case 'emit-txt':
        await hooks.emit({ sessionId });
        break;
    }
  }

  return {
    sessionId,
    ok: true,
    steps: plan.steps,
    skipped,
    elapsedMs: Date.now() - start
  };
}

/**
 * Register the `peaks code [--fast] <change-id>` command. The actual
 * LLM-side orchestration is driven by the SKILL.md (LLM-side), so this
 * CLI command is a thin surface that builds the plan and emits a JSON
 * envelope for downstream tooling.
 *
 * rid-024: this function is now a thin orchestrator that delegates to 3
 * sibling register functions + the rid-020b run register.
 */
export function registerCodeCommands(program: Command, io: ProgramIO): void {
  const code = program
    .command('code', { hidden: true })
    .description('peaks-code LLM-side workflow planner (slice 2 fast mode)');

  registerCodeModeGateCommands(code, io);
  registerCodeJobShapeCommands(code, io);
  registerCodeRuntimeCommands(code, io);
  registerCodeOrchestratorCanDoCommand(code, io);
  registerCodeRunCommand(code, io);
}