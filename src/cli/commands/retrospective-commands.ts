/**
 * `peaks retrospective` command group.
 *
 * C wave 4 split (leaf `c4w1-cli-c`): the index / show / search
 * subcommands moved VERBATIM into `retrospective-index-command.ts`,
 * `retrospective-show-command.ts` and `retrospective-search-command.ts`,
 * and their repeated project-root resolution into
 * `retrospective-project-root.ts`. This file keeps the group registration
 * plus the public surface — `registerRetrospectiveCommands` (the name
 * `_register.ts` imports), `runRetrospectiveSearch` and
 * `RetrospectiveSearchCommandOptions` are all still importable from this
 * path. Subcommands register in the same order as before (index, show,
 * search), so `--help` output is unchanged.
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerRetrospectiveIndexCommand } from './retrospective-index-command.js';
import { registerRetrospectiveSearchCommand } from './retrospective-search-command.js';
import { registerRetrospectiveShowCommand } from './retrospective-show-command.js';

export { runRetrospectiveSearch } from './retrospective-search-command.js';
export type { RetrospectiveSearchCommandOptions } from './retrospective-search-command.js';

export function registerRetrospectiveCommands(program: Command, io: ProgramIO): void {
  const retrospective = program
    .command('retrospective')
    .description(
      'Read the peaks retrospective index (R3: index.json, not the legacy <id>/ MD tree)'
    );

  registerRetrospectiveIndexCommand(retrospective, io);
  registerRetrospectiveShowCommand(retrospective, io);
  registerRetrospectiveSearchCommand(retrospective, io);
}
