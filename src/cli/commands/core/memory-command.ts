import type { Command } from 'commander';

import type { ProgramIO } from '../../cli-helpers.js';
import { registerMemoryDelegatedVerbs } from './memory-delegated-verbs.js';
import { registerMemoryExtractCommand } from './memory-extract-command.js';
import { registerMemorySyncCommand } from './memory-sync-command.js';

export function registerMemoryCommand(program: Command, io: ProgramIO): void {
  const memory = program.command('memory').description('Manage project-local Peaks memory');
  registerMemoryExtractCommand(memory, io);
  registerMemorySyncCommand(memory, io);
  registerMemoryDelegatedVerbs(memory, io);
}
