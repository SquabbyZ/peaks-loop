// src/cli/commands/asset-crystallize-command.ts
//
// The commander registration for `peaks asset crystallize` — the parent
// command, its 28 options in their original order, and the action binding.
// Split out of `asset-commands.ts`; the verb name, every option's flag and
// description, and the envelope shape are unchanged. The action body lives in
// `asset-crystallize-runner.ts` and the payload builders in
// `asset-crystallize-payload.ts`.

import type { Command } from 'commander';
import { CRYSTALLIZATION_TRIGGERS } from '../../services/crystallization/index.js';
import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { collectRepeatable } from './asset-command-shared.js';
import { runAssetCrystallize } from './asset-crystallize-runner.js';
import type { CrystallizeOptions } from './asset-crystallize-payload.js';

const CRYSTALLIZE_DESCRIPTION =
  'M5: persist a new loop_release + main_bee_release + loop_bee_relation + crystallization_event in a single transaction. Enforces the pre-run gate (task_status=completed AND gates_passed=true AND evidence_collected=true; AC-4 / RL-2) and the brief-section guard (all 4 sections required; AC-15 / RL-7).';

/** `--from-task` … `--loop-version`: the task + loop_release half. */
function addLoopPolicyOptions(cmd: Command): Command {
  return cmd
    .requiredOption(
      '--from-task <id>',
      "the candidate task id (must be 'completed' with gates_passed + evidence_collected)"
    )
    .requiredOption('--loop-id <id>', 'kebab-case loop id, e.g. loop-onboarding-research')
    .requiredOption('--loop-name <name>', 'NL display name')
    .requiredOption(
      '--loop-scenario <text>',
      'long-form scenario text (what real problem the loop solves)'
    )
    .requiredOption('--loop-trigger-policy <text>', 'trigger policy (NL intent match)')
    .requiredOption(
      '--loop-interaction-policy <text>',
      'interaction policy (Human-NL-Choice-Only is the default)'
    )
    .requiredOption(
      '--loop-feedback-policy <text>',
      'feedback policy (what feedback enters long-term memory)'
    )
    .requiredOption(
      '--loop-evolution-policy <text>',
      'evolution policy (Darwin-style ratchet rules)'
    )
    .requiredOption(
      '--loop-success-criterion <text>',
      'declarative success criterion (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .requiredOption(
      '--loop-evaluator-policy <text>',
      'evaluator policy line (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .requiredOption('--loop-version <semver>', 'loop version (e.g. 0.1.0)');
}

/** `--bee-name` … `--brief-what-action`: the main bee and the 4 brief sections. */
function addBeeAndBriefOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--bee-name <name>', 'main bee name (kebab-case)')
    .requiredOption('--bee-version <semver>', 'bee version (e.g. 0.1.0)')
    .requiredOption('--bee-description <text>', 'main bee description (manifest-level)')
    .requiredOption('--bee-relation-reason <text>', 'NL reason for the main bee relation')
    .requiredOption(
      '--brief-what-happened <text>',
      'brief section: what_happened (1-2 sentence factual account)'
    )
    .requiredOption(
      '--brief-why-it-matters <text>',
      'brief section: why_it_matters (1-2 sentence explanation)'
    )
    .requiredOption(
      '--brief-what-learned <text>',
      'brief section: what_learned (1-2 sentence learning)'
    )
    .requiredOption(
      '--brief-what-action <text>',
      'brief section: what_action (1 sentence recommended action)'
    );
}

/** `--brief-bullet` … `--project`: the repeatable extras and the trigger. */
function addCrystallizeExtras(cmd: Command): Command {
  return cmd
    .option(
      '--brief-bullet <bullet>',
      'structured bullet supporting the brief (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option(
      '--source-trace <id>',
      'workflow trace id backing the brief (repeatable)',
      collectRepeatable,
      [] as string[]
    )
    .option('--evaluator-summary <text>', 'evaluator one-liner (independent scorers)', '')
    .option('--user-decision-summary <text>', 'user decision summary (NL)', '')
    .option('--bee-intent-raw <text>', 'optional bee user_intent_raw')
    .option('--bee-parent-version <semver>', 'optional parent_version')
    .option('--bee-changelog <text>', 'optional changelog')
    .option(
      '--trigger <name>',
      `crystallization trigger (one of: ${CRYSTALLIZATION_TRIGGERS.join('|')})`,
      'user_explicit'
    )
    .option('--project <path>', 'project root (default: cwd)');
}

export function registerAssetCrystallizeCommand(asset: Command, io: ProgramIO): void {
  const cmd = asset.command('crystallize').description(CRYSTALLIZE_DESCRIPTION);
  addLoopPolicyOptions(cmd);
  addBeeAndBriefOptions(cmd);
  addCrystallizeExtras(cmd);
  addJsonOption(cmd).action((options: CrystallizeOptions) => runAssetCrystallize(io, options));
}
