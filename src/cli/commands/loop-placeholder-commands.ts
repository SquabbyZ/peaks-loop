// src/cli/commands/loop-placeholder-commands.ts
//
// `peaks loop preflight|detect-pattern|check-consistency` — the three 14.x
// placeholder facades. They differ only in their verb, the list of things the
// LLM-side UX layer should run instead, and the one-line note on the envelope;
// three copies of the same builder is what pushed `registerLoopCommands` past
// the per-function line cap. Extracted from `loop-commands.ts` as one table;
// every registered name, description, option and envelope is unchanged.

import type { Command } from 'commander';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import type { LoopPlaceholderOptions } from './loop-command-shared.js';

interface PlaceholderSpec {
  /** The subcommand name under `peaks loop`, and the `data.nextSteps` envelope it emits. */
  readonly verb: string;
  readonly command: string;
  readonly description: string;
  readonly nextSteps: readonly string[];
  readonly summary: string;
}

const PLACEHOLDERS: readonly PlaceholderSpec[] = [
  {
    verb: 'preflight',
    command: 'loop.preflight',
    description:
      '14.2: pre-run sanity checks (placeholder; future slice runs peaks doctor + peaks audit before each loop iter)',
    nextSteps: [
      'For each L4 loop iteration, call peaks doctor + peaks audit to surface regressions.',
      'A future slice will inline the preflight checks (not just placeholder).'
    ],
    summary:
      'loop.preflight is a thin facade; the LLM-side UX layer composes peaks doctor + peaks audit.'
  },
  {
    verb: 'detect-pattern',
    command: 'loop.detect-pattern',
    description:
      '14.3: detect repeating patterns across past sessions (placeholder; future slice uses peaks retrospective search)',
    nextSteps: [
      'Run peaks retrospective search --limit 50 to surface high-frequency patterns.',
      'A future slice will rank by frequency + LLM confidence.'
    ],
    summary:
      'loop.detect-pattern is a thin facade; the LLM-side UX layer composes peaks retrospective search.'
  },
  {
    verb: 'check-consistency',
    command: 'loop.check-consistency',
    description:
      '14.4: verify state consistency (placeholder; future slice compares .peaks/_runtime across sessions)',
    nextSteps: [
      'Compare .peaks/_runtime/<sid>/session.json across recent sessions for drift.',
      'A future slice will report drift with severity (warn / fail).'
    ],
    summary:
      'loop.check-consistency is a thin facade; the LLM-side UX layer composes the drift scan.'
  }
];

export function registerLoopPlaceholderCommands(loop: Command, io: ProgramIO): void {
  for (const spec of PLACEHOLDERS) {
    addJsonOption(
      loop
        .command(spec.verb)
        .description(spec.description)
        .requiredOption('--project <path>', 'target project root')
    ).action((options: LoopPlaceholderOptions) => {
      printResult(
        io,
        ok(
          spec.command,
          { project: options.project, status: 'placeholder', nextSteps: [...spec.nextSteps] },
          [],
          [spec.summary]
        ),
        options.json
      );
    });
  }
}
