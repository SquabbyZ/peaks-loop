import { Command } from 'commander';
import { registerCoreAndArtifactCommands } from './commands/core-artifact-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerCapabilityWorkerConfigAndSCCommands } from './commands/capability-worker-config-sc-commands.js';
import type { ProgramIO } from './cli-helpers.js';

export { printResult, type ProgramIO } from './cli-helpers.js';

export function createProgram(io: ProgramIO = { stdout: (text) => console.log(text), stderr: (text) => console.error(text) }): Command {
  const program = new Command();
  program.name('peaks').description('Peaks CLI and short skill family runtime manager').version('0.1.0').exitOverride();

  registerCoreAndArtifactCommands(program, io);
  registerWorkflowCommands(program, io);
  registerCapabilityWorkerConfigAndSCCommands(program, io);

  return program;
}
