// src/cli/commands/codegraph-commands.ts
//
// The codegraph verbs that MUTATE or PROXY: `repair-exclude`, `repair-index`,
// `config-restore`, `init`, `affected`, plus the commander registration for
// every codegraph subcommand.
//
// The shared invocation runtime lives in `codegraph-command-runtime.ts`, the
// `status` integrity gate in `codegraph-status-command.ts`, the option shapes
// in `codegraph-command-options.ts`, the repair pair in
// `codegraph-repair-commands.ts`, `config-restore` in
// `codegraph-config-restore-command.ts`, and the upstream proxy verbs in
// `codegraph-proxy-commands.ts`.
//
// This path keeps its public surface: `registerCodegraphCommands` is defined
// here and `rewriteBareCodegraphHints` / `attributeUpstreamUpToDateLine` are
// re-exported below, so every existing importer still resolves.

import type { Command } from 'commander';
import { type CodegraphInitOptions, runCodegraphInitCommand } from './codegraph-init-command.js';
import type { ProgramIO } from '../cli-helpers.js';
import { addProjectOption } from './codegraph-command-options.js';
import type { CommonCodegraphOptions } from './codegraph-command-runtime.js';
import { runCodegraphStatusCommand } from './codegraph-status-command.js';
import { registerCodegraphRepairCommands } from './codegraph-repair-commands.js';
import { registerCodegraphConfigRestoreCommand } from './codegraph-config-restore-command.js';
import { registerCodegraphProxyCommands } from './codegraph-proxy-commands.js';

// Re-exported so the D1 split is invisible to importers of THIS path.
export { rewriteBareCodegraphHints } from './codegraph-command-runtime.js';
export { attributeUpstreamUpToDateLine } from './codegraph-status-command.js';

export function registerCodegraphCommands(program: Command, io: ProgramIO): void {
  const codegraph = program
    .command('codegraph')
    .description('Run upstream codegraph commands through the Peaks launcher');

  addProjectOption(
    codegraph
      .command('status')
      .description('Show codegraph status, including the exclude integrity gate')
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphStatusCommand(io, options, options.peaksJson)
  );

  registerCodegraphRepairCommands(codegraph, io);
  registerCodegraphConfigRestoreCommand(codegraph, io);

  addProjectOption(
    codegraph
      .command('init')
      .description('Initialize codegraph for a project')
      .option(
        '--force',
        'delete a foreign (non-peaks-loop) .codegraph/ directory and initialize fresh; never follows a link and never deletes a peaks-loop-managed index'
      )
  ).action((options: CodegraphInitOptions) =>
    runCodegraphInitCommand(io, options, options.peaksJson)
  );

  registerCodegraphProxyCommands(codegraph, io);
}
