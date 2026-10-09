import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fetchContextLayer, isContextLayer, type LayerPayload } from './context-layer-fetchers.js';

type LayerOptions = {
  project: string;
  level: string;
  query?: string;
  json?: boolean;
};

/** The two advisory `nextActions` a loaded layer reports. */
function layerActions(payload: LayerPayload): string[] {
  return [
    `${payload.layer} loaded: ${payload.byteSize} bytes across ${payload.files.length} file(s)`,
    payload.warnings.length > 0
      ? `${payload.warnings.length} warning(s); see envelope.warnings`
      : null
  ].filter((x): x is string => typeof x === 'string');
}

export function registerContextLayerCommand(context: Command, io: ProgramIO): void {
  addJsonOption(
    context
      .command('layer')
      .description(
        'Fetch a context layer (L0 = full SKILL.md; L1 = first paragraph; L2 = index; L3 = fuzzy search by --query)'
      )
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--level <L0|L1|L2|L3>', 'context layer to load')
      .option('--query <text>', 'fuzzy search query (required for L3)')
  ).action(async (options: LayerOptions) => {
    try {
      if (!isContextLayer(options.level)) {
        printResult(
          io,
          fail(
            'context.layer',
            'INVALID_LEVEL',
            `level must be one of L0, L1, L2, L3 (got ${options.level})`,
            { provided: options.level },
            ['Pass --level L0|L1|L2|L3']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const payload = await fetchContextLayer(options.level, options.project, options.query ?? '');
      printResult(io, ok('context.layer', payload, [], layerActions(payload)), options.json);
    } catch (error) {
      printResult(
        io,
        fail(
          'context.layer',
          'CONTEXT_LAYER_FAILED',
          getErrorMessage(error),
          { projectRoot: options.project },
          ['Verify the project path and --level value']
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
