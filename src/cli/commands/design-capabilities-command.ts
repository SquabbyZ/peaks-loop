/**
 * `peaks design capabilities` — read-only: report the paved road's
 * `componentCapabilities` manifest and its validation verdict. There is no
 * write verb: the manifest is authored by the LLM from the component sources,
 * and the user never hand-types JSON.
 */

import { join, resolve } from 'node:path';

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { readComponentCapabilities } from '../../services/design/component-capabilities.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

const COMMAND = 'design.capabilities';

const FIX_ACTIONS = ['Fix design/paved-road.json componentCapabilities, or remove the section.'];

export type DesignCapabilitiesCliOptions = {
  project: string;
  app?: string;
  json?: boolean;
};

export function runDesignCapabilities(options: DesignCapabilitiesCliOptions, io: ProgramIO): void {
  const projectRoot = resolve(options.project);
  const verdict = readComponentCapabilities(join(projectRoot, options.app ?? '', 'design'));
  if (!verdict.ok) {
    printResult(
      io,
      fail(COMMAND, verdict.failure.code, verdict.failure.message, { projectRoot }, FIX_ACTIONS),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  const { capabilities } = verdict;
  printResult(
    io,
    ok(COMMAND, {
      projectRoot,
      declared: capabilities !== null,
      componentCount: capabilities === null ? 0 : Object.keys(capabilities).length,
      capabilities
    }),
    options.json === true
  );
}

export function registerDesignCapabilitiesCommand(program: Command, io: ProgramIO): void {
  // Mount on the existing `design` parent, never a bare second `design` group.
  const design = program.commands.find((command) => command.name() === 'design');
  if (design === undefined) {
    throw new Error(
      'registerDesignCapabilitiesCommand: no `design` command on this program — ' +
        'design-commands must be registered first'
    );
  }
  addJsonOption(
    design
      .command('capabilities')
      .description(
        'Report the paved road componentCapabilities manifest and its validation verdict'
      )
      .requiredOption('--project <path>', 'project root')
      .option('--app <path>', 'app root when several frontends exist')
  ).action((options: DesignCapabilitiesCliOptions) => runDesignCapabilities(options, io));
}
