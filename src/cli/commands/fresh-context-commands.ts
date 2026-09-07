/**
 * `peaks fresh-context preflight` CLI — deterministic trigger scan for the
 * search-first preflight (slice 2026-09-07-search-first-preflight).
 *
 * This command is the shared, deterministic surface every peaks-* orchestrator
 * calls at orchestration-start, BEFORE the first planning action, to decide
 * whether to search fresh context (Context7 → WebSearch) and synthesize binding
 * directives. The actual search + synthesis is done by the LLM per the shared
 * `skills/peaks-code/references/fresh-context-preflight.md`; this command only
 * runs the pure trigger scan (`services/fresh-context/trigger-scan.ts`) and the
 * kill-switch read (`services/fresh-context/config.ts`).
 */
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { scanFreshContextTrigger } from '../../services/fresh-context/trigger-scan.js';
import { isFreshContextEnabled } from '../../services/fresh-context/config.js';

type FreshContextPreflightOptions = {
  prompt?: string;
  json?: boolean;
};

export function registerFreshContextCommands(program: Command, io: ProgramIO): void {
  const freshContext = program
    .command('fresh-context')
    .description('Search-first preflight for the orchestration layer (hedge training-data lag)');

  addJsonOption(
    freshContext
      .command('preflight')
      .description('Deterministic signal scan: report whether the prompt triggers a fresh-context search')
      .requiredOption('--prompt <text>', 'the user request text to scan for trigger keywords')
      .option('--project <root>', 'target project root (accepted for surface parity; the scan is text + config only)')
  ).action((options: FreshContextPreflightOptions) => {
    try {
      const enabled = isFreshContextEnabled();
      const result = scanFreshContextTrigger(options.prompt ?? '', enabled);
      printResult(io, ok('fresh-context.preflight', result), options.json);
    } catch (error) {
      printResult(
        io,
        fail('fresh-context.preflight', 'PREFLIGHT_FAILED', getErrorMessage(error), {}, ['Verify ~/.peaks/config.json is valid JSON']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
