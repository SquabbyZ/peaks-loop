import { Command } from 'commander';
import { scanUnderstandAnything } from '../../services/understand/understand-scan-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type UnderstandStatusOptions = {
  project: string;
  artifactDir?: string;
  json?: boolean;
};

const INSTALL_HINT = 'Install Understand Anything in Claude Code: `/plugin marketplace add Lum1104/Understand-Anything` then `/plugin install understand-anything`, then run `/understand` in the target project to generate .understand-anything/knowledge-graph.json.';

export function registerUnderstandCommands(program: Command, io: ProgramIO): void {
  const understand = program.command('understand').description('Inspect Understand Anything artifacts inside a project (read-only)');

  addJsonOption(
    understand
      .command('status')
      .description('Report whether Understand Anything has produced a knowledge graph in the target project')
      .requiredOption('--project <path>', 'target project root')
      .option('--artifact-dir <path>', 'override the default .understand-anything directory')
  ).action(async (options: UnderstandStatusOptions) => {
    try {
      const scanOptions: Parameters<typeof scanUnderstandAnything>[0] = { projectRoot: options.project };
      if (options.artifactDir !== undefined) {
        scanOptions.artifactDir = options.artifactDir;
      }
      const report = await scanUnderstandAnything(scanOptions);
      const nextActions: string[] = [];
      if (!report.exists) {
        nextActions.push(INSTALL_HINT);
      } else if (!report.graph.exists) {
        nextActions.push('Run `/understand` inside Claude Code on this project to generate .understand-anything/knowledge-graph.json.');
      } else if (report.graph.parseError !== undefined) {
        nextActions.push('Re-run `/understand` to regenerate the knowledge graph; the current file is not valid JSON.');
      }
      printResult(io, ok('understand.status', report, [], nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('understand.status', 'UNDERSTAND_STATUS_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .understand-anything directory before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
