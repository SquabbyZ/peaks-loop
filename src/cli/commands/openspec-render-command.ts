// src/cli/commands/openspec-render-command.ts
//
// `peaks openspec render --request <path>`. Extracted from
// `openspec-commands.ts`; the registered name, description, options and
// envelopes are unchanged.

import type { Command } from 'commander';
import { renderOpenSpecChange } from '../../services/openspec/openspec-render-service.js';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  failOpenSpec,
  loadRenderRequest,
  toRenderOptions,
  type OpenSpecRenderCommandOptions
} from './openspec-command-shared.js';

export function registerOpenSpecRenderCommand(openspec: Command, io: ProgramIO): void {
  addJsonOption(
    openspec
      .command('render')
      .description('Render an OpenSpec change pack from a JSON request file (dry-run by default)')
      .requiredOption('--request <path>', 'path to a JSON file describing the render request')
      .option('--project <path>', 'project root containing an openspec/ directory')
      .option('--apply', 'write the rendered files into openspec/changes/<id>/')
      .option('--overwrite', 'overwrite an existing change directory when --apply is set')
  ).action(async (options: OpenSpecRenderCommandOptions) => {
    try {
      const request = await loadRenderRequest(options.request);
      const result = await renderOpenSpecChange(request, toRenderOptions(options.project, options));
      printResult(io, ok('openspec.render', result), options.json);
    } catch (error) {
      failOpenSpec(io, 'openspec.render', {
        code: 'OPENSPEC_RENDER_FAILED',
        error,
        data: { requestPath: options.request },
        nextActions: ['Check the request JSON shape and the openspec root before retrying'],
        json: options.json
      });
    }
  });
}
