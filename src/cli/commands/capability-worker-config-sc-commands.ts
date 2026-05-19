import { Command } from 'commander';
import { registerCapabilityCommands } from './capability-commands.js';
import { registerConfigCommands } from './config-commands.js';
import { registerSCCommands } from './sc-commands.js';
import { registerWorkerCommands } from './worker-commands.js';
import type { ProgramIO } from '../cli-helpers.js';

export function registerCapabilityWorkerConfigAndSCCommands(program: Command, io: ProgramIO): void {
  registerCapabilityCommands(program, io);
  registerWorkerCommands(program, io);
  registerConfigCommands(program, io);
  registerSCCommands(program, io);
}
