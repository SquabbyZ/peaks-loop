import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { skillsDir } from '../shared/paths.js';
import { CLI_VERSION } from '../shared/version.js';
import { registerCoreAndArtifactCommands } from './commands/core-artifact-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerCapabilityWorkerConfigAndSCCommands } from './commands/capability-worker-config-sc-commands.js';
import { registerCodegraphCommands } from './commands/codegraph-commands.js';
import { registerMcpCommands } from './commands/mcp-commands.js';
import { registerOpenSpecCommands } from './commands/openspec-commands.js';
import { registerPerfCommands } from './commands/perf-commands.js';
import { registerProgressCommands } from './commands/progress-commands.js';
import { registerProjectCommands } from './commands/project-commands.js';
import { registerRequestCommands } from './commands/request-commands.js';
import { registerScanCommands } from './commands/scan-commands.js';
import { registerShadcnCommands } from './commands/shadcn-commands.js';
import { registerSliceCommands } from './commands/slice-commands.js';
import { registerSopCommands } from './commands/sop-commands.js';
import { registerGateCommands } from './commands/gate-commands.js';
import { registerHooksCommands } from './commands/hooks-commands.js';
import { registerStatusLineCommands } from './commands/statusline-commands.js';
import { registerUnderstandCommands } from './commands/understand-commands.js';
import { registerWorkspaceCommands } from './commands/workspace-commands.js';
import type { ProgramIO } from './cli-helpers.js';

export { printResult, type ProgramIO } from './cli-helpers.js';
export function createProgram(io: ProgramIO = { stdout: (text) => console.log(text), stderr: (text) => console.error(text) }): Command {
  const program = new Command();
  program
    .name('peaks')
    .description(`Peaks CLI ${CLI_VERSION} — workflow-gating CLI + skill family for Claude Code

Run peaks (no arguments) for a quickstart. You likely want one of:
  peaks doctor     check your environment
  peaks skill      list or manage skills
  peaks slice      boundary check (tsc + vitest + 3-way + verify-pipeline)
  peaks workflow   plan workflow routing dry-run graphs
  peaks sop        author your own workflow gates
  peaks hooks      install the un-bypassable gate-enforcement hook
  peaks gate       enforce/bypass SOP gates on Bash commands`)
    .configureOutput({
      writeOut: (text) => io.stdout(text.trimEnd()),
      writeErr: (text) => io.stderr(text.trimEnd())
    })
    .version(CLI_VERSION, '-v, --version')
    .option('-V', 'output the version number')
    .action(() => {
      const opts = program.opts<{ V?: boolean }>();
      if (opts.V) {
        io.stdout(CLI_VERSION);
        return;
      }

      // Count bundled skills by reading the skills dir directly (synchronous so
      // the quickstart renders instantly — no import/async overhead on startup).
      let skillCount = 0;
      const skillsPath = skillsDir;
      try {
        if (existsSync(skillsPath)) {
          skillCount = readdirSync(skillsPath, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .filter((entry) => existsSync(join(skillsPath, entry.name, 'SKILL.md')))
            .length;
        }
      } catch { /* disk read is best-effort; zero skills is still truthful */ }

      io.stdout(`Peaks CLI ${CLI_VERSION}  ·  ${skillCount} skills ready

  Peaks is a workflow-gating CLI + skill family for Claude Code.
  It turns "don't skip steps" into hard enforcement — gates that block
  advancement in-conversation, un-bypassably.

  Before diving into a project, two things worth doing now:

    peaks doctor             check your environment in one glance
    peaks-sop                <<< ask this skill to author your first SOP

  Or jump straight in:
    peaks sop init --id my-flow --apply && peaks hooks install
`);
    })
    .exitOverride();

  registerCoreAndArtifactCommands(program, io);
  registerWorkflowCommands(program, io);
  registerCapabilityWorkerConfigAndSCCommands(program, io);
  registerCodegraphCommands(program, io);
  registerMcpCommands(program, io);
  registerOpenSpecCommands(program, io);
  registerPerfCommands(program, io);
  registerProgressCommands(program, io);
  registerProjectCommands(program, io);
  registerRequestCommands(program, io);
  registerScanCommands(program, io);
  registerShadcnCommands(program, io);
  registerSliceCommands(program, io);
  registerSopCommands(program, io);
  registerGateCommands(program, io);
  registerHooksCommands(program, io);
  registerStatusLineCommands(program, io);
  registerUnderstandCommands(program, io);
  registerWorkspaceCommands(program, io);

  return program;
}
