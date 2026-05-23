import { Command } from 'commander';
import { CLI_VERSION } from '../shared/version.js';
import { registerCoreAndArtifactCommands } from './commands/core-artifact-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerCapabilityWorkerConfigAndSCCommands } from './commands/capability-worker-config-sc-commands.js';
import { registerCodegraphCommands } from './commands/codegraph-commands.js';
import { registerMcpCommands } from './commands/mcp-commands.js';
import { registerOpenSpecCommands } from './commands/openspec-commands.js';
import { registerProjectCommands } from './commands/project-commands.js';
import { registerRequestCommands } from './commands/request-commands.js';
import { registerShadcnCommands } from './commands/shadcn-commands.js';
import { registerUnderstandCommands } from './commands/understand-commands.js';
import type { ProgramIO } from './cli-helpers.js';

export { printResult, type ProgramIO } from './cli-helpers.js';
export function createProgram(io: ProgramIO = { stdout: (text) => console.log(text), stderr: (text) => console.error(text) }): Command {
  const program = new Command();
  program
    .name('peaks')
    .description('Peaks CLI and short skill family runtime manager')
    .configureOutput({
      writeOut: (text) => io.stdout(text.trimEnd()),
      writeErr: (text) => io.stderr(text.trimEnd())
    })
    .version(CLI_VERSION, '-v, --version')
    .option('-V', 'output the version number')
    .action(() => {
      if (program.opts<{ V?: boolean }>().V) {
        io.stdout(CLI_VERSION);
      }
    })
    .exitOverride();

  registerCoreAndArtifactCommands(program, io);
  registerWorkflowCommands(program, io);
  registerCapabilityWorkerConfigAndSCCommands(program, io);
  registerCodegraphCommands(program, io);
  registerMcpCommands(program, io);
  registerOpenSpecCommands(program, io);
  registerProjectCommands(program, io);
  registerRequestCommands(program, io);
  registerShadcnCommands(program, io);
  registerUnderstandCommands(program, io);

  return program;
}
