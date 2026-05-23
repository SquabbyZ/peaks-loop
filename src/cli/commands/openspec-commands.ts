import { Command } from 'commander';
import { loadOpenSpecChange, scanOpenSpec, type OpenSpecScanOptions } from '../../services/openspec/openspec-scan-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type OpenSpecListOptions = {
  project?: string;
  json?: boolean;
};

type OpenSpecShowOptions = OpenSpecListOptions;

function resolveScanOptions(project: string | undefined): OpenSpecScanOptions {
  if (project === undefined) {
    return {};
  }
  return { openspecRoot: `${project.replace(/\\/g, '/').replace(/\/$/, '')}/openspec` };
}

export function registerOpenSpecCommands(program: Command, io: ProgramIO): void {
  const openspec = program.command('openspec').description('Inspect OpenSpec changes inside the target project');

  addJsonOption(
    openspec
      .command('list')
      .description('List OpenSpec changes detected under <project>/openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
  ).action(async (options: OpenSpecListOptions) => {
    try {
      const report = await scanOpenSpec(resolveScanOptions(options.project));
      printResult(io, ok('openspec.list', report), options.json);
    } catch (error) {
      printResult(
        io,
        fail('openspec.list', 'OPENSPEC_LIST_FAILED', getErrorMessage(error), {}, ['Check the project path and openspec/ layout before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    openspec
      .command('show')
      .description('Show parsed proposal and tasks progress for a single OpenSpec change')
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
  ).action(async (changeId: string, options: OpenSpecShowOptions) => {
    try {
      const detail = await loadOpenSpecChange(changeId, resolveScanOptions(options.project));
      if (detail === null) {
        printResult(
          io,
          fail('openspec.show', 'OPENSPEC_CHANGE_NOT_FOUND', `OpenSpec change ${changeId} was not found`, { changeId }, [`Verify openspec/changes/${changeId}/ exists`]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('openspec.show', detail), options.json);
    } catch (error) {
      printResult(
        io,
        fail('openspec.show', 'OPENSPEC_SHOW_FAILED', getErrorMessage(error), { changeId }, ['Check the project path and openspec/ layout before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
