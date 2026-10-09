// src/cli/commands/loop-goal-compose-command.ts
//
// `peaks goal compose` — registered as a TOP-LEVEL command (not under
// `peaks loop`) because IDE adapters expose it as `goalCommand` and the
// sub-agent dispatch path consumes it. Extracted from `loop-commands.ts`; the
// registered name, description, options and envelope are unchanged.

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { GoalComposeOptions } from './loop-command-shared.js';

const GOAL_COMPOSE_SUMMARY =
  'goal.compose is a thin facade; the LLM-side UX layer decomposes the goal into sub-agent tasks.';

export function registerLoopGoalComposeCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('goal')
      .description(
        '14.5: compose an autonomous goal (returns the goal envelope that the LLM-side UX layer feeds to peaks sub-agent dispatch)'
      )
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--goal <text>', 'the high-level goal to compose')
  ).action((options: GoalComposeOptions) => {
    try {
      printResult(
        io,
        ok('goal.compose', goalComposePayload(options), [], [GOAL_COMPOSE_SUMMARY]),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail(
          'goal.compose',
          'GOAL_COMPOSE_FAILED',
          getErrorMessage(error),
          { project: options.project, goal: options.goal },
          ['Verify the project path and --goal value']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

/** The placeholder body; the LLM-side UX layer decomposes `goal` into tasks. */
function goalComposePayload(options: GoalComposeOptions): Record<string, unknown> {
  return {
    project: options.project,
    goal: options.goal,
    status: 'placeholder',
    nextSteps: [
      'The composed goal is consumed by peaks sub-agent dispatch.',
      'The hermes + openclaw IDE adapters (Slice #0.7) surface this as a goalCommand.'
    ]
  };
}
