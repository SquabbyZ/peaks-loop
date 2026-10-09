import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { evaluateMainSessionThreshold } from '../../services/context/main-session-monitor.js';
import { detectIdeFromEnv } from '../../services/context/ide-detect.js';

export type ContextThresholdOptions = {
  promptSize: string;
  capacity?: string;
  inFlightBatch?: boolean;
  autoTrigger?: boolean;
  json?: boolean;
};

/** `--capacity` override, or `undefined` to let the monitor use its default. */
export function capacityOf(opts: ContextThresholdOptions): number | undefined {
  return opts.capacity !== undefined ? Number(opts.capacity) : undefined;
}

/**
 * Parse `--prompt-size`, refusing a non-finite or negative value; `null` once
 * the refusal envelope for `command` has been printed.
 */
export function requirePromptSize(
  command: string,
  opts: ContextThresholdOptions,
  io: ProgramIO
): number | null {
  const promptSize = Number(opts.promptSize);
  if (Number.isFinite(promptSize) && promptSize >= 0) return promptSize;
  printResult(
    io,
    fail(
      command,
      'INVALID_PROMPT_SIZE',
      `prompt-size must be a non-negative number (got "${opts.promptSize}")`,
      { provided: opts.promptSize },
      ['Pass --prompt-size <bytes>']
    ),
    opts.json
  );
  process.exitCode = 1;
  return null;
}

export function registerContextStatusCommand(context: Command, io: ProgramIO): void {
  addJsonOption(
    context
      .command('status')
      .description(
        'v2.11.0 D6: report main-session threshold tier for a given prompt size (no trigger dispatched). Useful for `--json` probes before invoking `peaks context check --auto-trigger`.'
      )
      .requiredOption('--prompt-size <bytes>', 'estimated prompt size in bytes')
      .option('--capacity <bytes>', 'override the 256K default capacity (test seam)', '262144')
  ).action((opts: ContextThresholdOptions) => {
    try {
      const promptSize = requirePromptSize('context.status', opts, io);
      if (promptSize === null) return;
      const evaluation = evaluateMainSessionThreshold(promptSize, capacityOf(opts));
      printResult(
        io,
        ok(
          'context.status',
          { ...evaluation, ide: detectIdeFromEnv() },
          [...evaluation.warnings],
          [`Main-session tier=${evaluation.tier} (${(evaluation.ratio * 100).toFixed(0)}%)`]
        ),
        opts.json
      );
    } catch (err) {
      printResult(
        io,
        fail('context.status', 'CONTEXT_STATUS_FAILED', getErrorMessage(err), null, [
          'Verify --prompt-size is a non-negative number'
        ]),
        opts.json
      );
      process.exitCode = 1;
    }
  });
}
