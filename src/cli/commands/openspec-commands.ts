import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { loadOpenSpecChange, scanOpenSpec, type OpenSpecScanOptions } from '../../services/openspec/openspec-scan-service.js';
import { projectOpenSpecToRdInput } from '../../services/openspec/openspec-bridge-service.js';
import { renderOpenSpecChange, type OpenSpecRenderOptions, type OpenSpecRenderRequest } from '../../services/openspec/openspec-render-service.js';
import { validateOpenSpecChange, type OpenSpecValidateOptions } from '../../services/openspec/openspec-validate-service.js';
import { archiveOpenSpecChange, type OpenSpecArchiveOptions } from '../../services/openspec/openspec-archive-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type OpenSpecListOptions = {
  project?: string;
  json?: boolean;
};

type OpenSpecShowOptions = OpenSpecListOptions;
type OpenSpecToRdOptions = OpenSpecListOptions;
type OpenSpecRenderCommandOptions = OpenSpecListOptions & {
  request: string;
  apply?: boolean;
  overwrite?: boolean;
};

type OpenSpecValidateCommandOptions = OpenSpecListOptions & {
  preferExternal?: boolean;
};

type OpenSpecArchiveCommandOptions = OpenSpecListOptions & {
  apply?: boolean;
  archiveDir?: string;
};

function resolveScanOptions(project: string | undefined): OpenSpecScanOptions {
  if (project === undefined) {
    return {};
  }
  return { openspecRoot: `${project.replace(/\\/g, '/').replace(/\/$/, '')}/openspec` };
}

async function loadRenderRequest(requestPath: string): Promise<OpenSpecRenderRequest> {
  const raw = await readFile(requestPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Render request file must contain a JSON object');
  }
  return parsed as OpenSpecRenderRequest;
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

  addJsonOption(
    openspec
      .command('to-rd')
      .description('Project an OpenSpec change into an RD/SC input shape (acceptance, what-changes, commit boundaries)')
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
  ).action(async (changeId: string, options: OpenSpecToRdOptions) => {
    try {
      const projection = await projectOpenSpecToRdInput(changeId, resolveScanOptions(options.project));
      if (projection === null) {
        printResult(
          io,
          fail('openspec.to-rd', 'OPENSPEC_CHANGE_NOT_FOUND', `OpenSpec change ${changeId} was not found`, { changeId }, [`Verify openspec/changes/${changeId}/ exists`]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('openspec.to-rd', projection), options.json);
    } catch (error) {
      printResult(
        io,
        fail('openspec.to-rd', 'OPENSPEC_TO_RD_FAILED', getErrorMessage(error), { changeId }, ['Check the project path and openspec/ layout before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    openspec
      .command('render')
      .description('Render an OpenSpec change pack from a JSON request file (dry-run by default)')
      .requiredOption('--request <path>', 'path to a JSON file describing the render request')
      .option('--project <path>', 'project root containing an openspec/ directory')
      .option('--apply', 'write the rendered files into openspec/changes/<id>/')
      .option('--overwrite', 'overwrite an existing change directory when --apply is set')
  ).action(async (options: OpenSpecRenderCommandOptions) => {
    try {
      const request = await loadRenderRequest(options.request);
      const scan = resolveScanOptions(options.project);
      const renderOptions: OpenSpecRenderOptions = {};
      if (scan.openspecRoot !== undefined) {
        renderOptions.openspecRoot = scan.openspecRoot;
      }
      if (options.apply === true) {
        renderOptions.apply = true;
      }
      if (options.overwrite === true) {
        renderOptions.overwrite = true;
      }
      const result = await renderOpenSpecChange(request, renderOptions);
      printResult(io, ok('openspec.render', result), options.json);
    } catch (error) {
      printResult(
        io,
        fail('openspec.render', 'OPENSPEC_RENDER_FAILED', getErrorMessage(error), { requestPath: options.request }, ['Check the request JSON shape and the openspec root before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    openspec
      .command('validate')
      .description('Validate an OpenSpec change against internal lint rules (and optionally the external openspec CLI)')
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
      .option('--prefer-external', 'use the external openspec CLI when available, fall back to internal lint')
  ).action(async (changeId: string, options: OpenSpecValidateCommandOptions) => {
    try {
      const scan = resolveScanOptions(options.project);
      const validateOptions: OpenSpecValidateOptions = {};
      if (scan.openspecRoot !== undefined) {
        validateOptions.openspecRoot = scan.openspecRoot;
      }
      if (options.preferExternal === true) {
        validateOptions.preferExternal = true;
      }
      const result = await validateOpenSpecChange(changeId, validateOptions);
      if (result === null) {
        printResult(
          io,
          fail('openspec.validate', 'OPENSPEC_CHANGE_NOT_FOUND', `OpenSpec change ${changeId} was not found`, { changeId }, [`Verify openspec/changes/${changeId}/ exists`]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (!result.valid) {
        printResult(
          io,
          fail('openspec.validate', 'OPENSPEC_VALIDATE_INVALID', `OpenSpec change ${changeId} failed validation`, result, result.issues.map((issue) => `${issue.level}: ${issue.rule}: ${issue.message}`)),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('openspec.validate', result, result.issues.filter((issue) => issue.level === 'warning').map((issue) => `${issue.rule}: ${issue.message}`)), options.json);
    } catch (error) {
      printResult(
        io,
        fail('openspec.validate', 'OPENSPEC_VALIDATE_FAILED', getErrorMessage(error), { changeId }, ['Check the project path and openspec/ layout before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    openspec
      .command('archive')
      .description('Move an OpenSpec change under openspec/changes/<archiveDir>/<id>/ (dry-run by default)')
      .argument('<changeId>', 'OpenSpec change directory name under openspec/changes')
      .option('--project <path>', 'project root containing an openspec/ directory')
      .option('--apply', 'actually move the change directory')
      .option('--archive-dir <name>', 'archive subdirectory name (default: archive)')
  ).action(async (changeId: string, options: OpenSpecArchiveCommandOptions) => {
    try {
      const scan = resolveScanOptions(options.project);
      const archiveOptions: OpenSpecArchiveOptions = {};
      if (scan.openspecRoot !== undefined) {
        archiveOptions.openspecRoot = scan.openspecRoot;
      }
      if (options.apply === true) {
        archiveOptions.apply = true;
      }
      if (options.archiveDir !== undefined) {
        archiveOptions.archiveDirName = options.archiveDir;
      }
      const result = await archiveOpenSpecChange(changeId, archiveOptions);
      if (result === null) {
        printResult(
          io,
          fail('openspec.archive', 'OPENSPEC_CHANGE_NOT_FOUND', `OpenSpec change ${changeId} was not found`, { changeId }, [`Verify openspec/changes/${changeId}/ exists`]),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('openspec.archive', result, [], result.applied ? [] : [`Re-run with --apply to move ${result.from} → ${result.to}`]), options.json);
    } catch (error) {
      printResult(
        io,
        fail('openspec.archive', 'OPENSPEC_ARCHIVE_FAILED', getErrorMessage(error), { changeId }, ['Check the project path and openspec/ layout before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
