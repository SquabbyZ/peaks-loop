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
 */

import type { Command } from 'commander';

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
export function registerSoloCommands(program: Command): void {
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
}
