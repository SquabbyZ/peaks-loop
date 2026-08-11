import { Command, InvalidArgumentError } from 'commander';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  defaultCodegraphInitGuard,
  writeCodegraphMarker,
  CodegraphInitConflictError,
  type CodegraphInvocationOptions
} from '../../services/codegraph/codegraph-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { getErrorMessage, printResult, redactSensitiveErrorMessage, type ProgramIO } from '../cli-helpers.js';

interface CommonCodegraphOptions {
  project: string;
  peaksJson?: boolean;
}

interface CodegraphInitOptions extends CommonCodegraphOptions {
  yes?: boolean;
}

interface CodegraphIndexOptions extends CommonCodegraphOptions {
  force?: boolean;
  quiet?: boolean;
}

interface CodegraphQueryOptions extends CommonCodegraphOptions {
  json?: boolean;
  limit?: number;
}

interface CodegraphFilesOptions extends CommonCodegraphOptions {
  json?: boolean;
  maxDepth?: number;
}

interface CodegraphAffectedOptions extends CommonCodegraphOptions {
  json?: boolean;
}

function addPeaksJsonOption(command: Command): Command {
  return command.option('--peaks-json', 'print Peaks error envelope as machine-readable JSON');
}

function addProjectOption(command: Command): Command {
  return addPeaksJsonOption(command.requiredOption('--project <path>', 'target project root'));
}

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  return parsed;
}

function printCodegraphFailure(io: ProgramIO, command: string, error: unknown, asJson?: boolean, exitCode = 1): void {
  printResult(
    io,
    fail(command, 'CODEGRAPH_COMMAND_FAILED', redactSensitiveErrorMessage(getErrorMessage(error)), {}, ['Check the codegraph command options and project path before retrying']),
    asJson
  );
  process.exitCode = exitCode;
}

async function runCodegraphCommand(io: ProgramIO, command: string, options: CodegraphInvocationOptions, asJson?: boolean): Promise<void> {
  try {
    const invocation = createCodegraphInvocation(options);
    const result = await executeCodegraphInvocation(invocation);

    if (result.exitCode !== null && result.exitCode !== 0 && asJson === true) {
      printCodegraphFailure(io, command, new Error(result.stderr || result.stdout || `codegraph exited with code ${result.exitCode}`), true, result.exitCode);
      return;
    }

    const didFail = result.exitCode !== null && result.exitCode !== 0;

    if (result.stdout.length > 0) {
      io.stdout((didFail ? redactSensitiveErrorMessage(result.stdout) : result.stdout).trimEnd());
    }

    if (result.stderr.length > 0) {
      io.stderr((didFail ? redactSensitiveErrorMessage(result.stderr) : result.stderr).trimEnd());
    }

    if (didFail) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    printCodegraphFailure(io, command, error, asJson);
  }
}

/**
 * rid-CG-006 — init conflict guard. Resolves the project root and
 * probes `.codegraph/` for the peaks-loop marker before invoking the
 * upstream binary.
 *
 *   - fresh                          → proceed to upstream init
 *   - noop-already-peaks-loop        → skip upstream, emit warning
 *   - conflict-foreign-schema        → exit 73 + CODEGRAPH_INIT_CONFLICT envelope
 *
 * On a successful upstream init, write the marker so the next run
 * hits the noop branch instead of the conflict branch.
 */
async function runCodegraphInitCommand(io: ProgramIO, options: CodegraphInitOptions, asJson?: boolean): Promise<void> {
  let projectRoot: string;
  try {
    const candidate = resolve(options.project);
    if (!statSync(candidate).isDirectory()) {
      throw new Error('Project path must exist and be a directory');
    }
    projectRoot = candidate;
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.init', error, asJson);
    return;
  }

  const guardOutcome = defaultCodegraphInitGuard(projectRoot);

  if (guardOutcome.status === 'noop-already-peaks-loop') {
    printResult(
      io,
      ok(
        'codegraph.init',
        {
          guard: guardOutcome.status,
          codegraphDir: guardOutcome.codegraphDir,
          markerPresent: true
        },
        [`.codegraph/ is already managed by peaks-loop; init is a no-op. Marker: ${guardOutcome.codegraphDir}/.peaks-loop-marker`],
        ['Run `peaks codegraph index` to (re)build the index without touching the schema.']
      ),
      asJson
    );
    return;
  }

  if (guardOutcome.status === 'conflict-foreign-schema') {
    const conflict = new CodegraphInitConflictError(
      `Refusing to init: ${guardOutcome.codegraphDir} already exists with a non-peaks-loop schema. ` +
        'Move or rename the foreign directory, then re-run `peaks codegraph init`.',
      guardOutcome.codegraphDir
    );
    printResult(
      io,
      fail('codegraph.init', conflict.code, conflict.message, { codegraphDir: conflict.codegraphDir }, [
        'Move or rename the foreign .codegraph/ directory before retrying.',
        'Or remove .codegraph/ if you are sure no other tool owns it.',
        'Or run `peaks codegraph init --project <path> --force` once the foreign-tool safety flag ships (tracked in rid-CG-006).'
      ]),
      asJson
    );
    process.exitCode = conflict.exitCode;
    return;
  }

  // guardOutcome.status === 'fresh' — proceed.
  try {
    const invocation = createCodegraphInvocation({
      subcommand: 'init',
      project: options.project,
      ...(options.yes === true ? { yes: true } : {})
    });
    const result = await executeCodegraphInvocation(invocation);
    const didFail = result.exitCode !== null && result.exitCode !== 0;

    if (result.stdout.length > 0) {
      io.stdout((didFail ? redactSensitiveErrorMessage(result.stdout) : result.stdout).trimEnd());
    }
    if (result.stderr.length > 0) {
      io.stderr((didFail ? redactSensitiveErrorMessage(result.stderr) : result.stderr).trimEnd());
    }

    if (didFail) {
      if (asJson === true) {
        printCodegraphFailure(
          io,
          'codegraph.init',
          new Error(result.stderr || result.stdout || `codegraph exited with code ${result.exitCode}`),
          true,
          result.exitCode ?? 1
        );
      }
      process.exitCode = result.exitCode ?? 1;
      return;
    }

    // Upstream succeeded — stamp the marker so the next run hits the
    // noop branch. Best-effort: a marker-write failure must NOT undo
    // the upstream init (peaks-loop still owns the schema logically).
    try {
      writeCodegraphMarker(guardOutcome.codegraphDir);
    } catch {
      // intentionally swallowed — surface as warning below
    }
    printResult(
      io,
      ok(
        'codegraph.init',
        { guard: guardOutcome.status, codegraphDir: guardOutcome.codegraphDir, markerWritten: true },
        [],
        [`Stamped peaks-loop marker at ${guardOutcome.codegraphDir}/.peaks-loop-marker`]
      ),
      asJson
    );
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.init', error, asJson);
  }
}

export function registerCodegraphCommands(program: Command, io: ProgramIO): void {
  const codegraph = program.command('codegraph').description('Run upstream codegraph commands through the Peaks launcher');

  addProjectOption(codegraph.command('status').description('Show codegraph status')).action((options: CommonCodegraphOptions) =>
    runCodegraphCommand(io, 'codegraph.status', { subcommand: 'status', project: options.project }, options.peaksJson)
  );

  addProjectOption(codegraph.command('init').description('Initialize codegraph for a project').option('--yes', 'answer yes to upstream prompts')).action(
    (options: CodegraphInitOptions) => runCodegraphInitCommand(io, options, options.peaksJson)
  );

  addProjectOption(
    codegraph
      .command('index')
      .description('Index a project with codegraph')
      .option('--force', 'force reindexing')
      .option('--quiet', 'reduce upstream output')
  ).action((options: CodegraphIndexOptions) =>
    runCodegraphCommand(
      io,
      'codegraph.index',
      {
        subcommand: 'index',
        project: options.project,
        ...(options.force === true ? { force: true } : {}),
        ...(options.quiet === true ? { quiet: true } : {})
      },
      options.peaksJson
    )
  );

  addProjectOption(
    codegraph
      .command('query')
      .description('Query codegraph')
      .argument('<search>', 'search text')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--limit <n>', 'maximum result count', parsePositiveInteger)
  ).action((search: string, options: CodegraphQueryOptions) =>
    runCodegraphCommand(
      io,
      'codegraph.query',
      {
        subcommand: 'query',
        project: options.project,
        search,
        ...(options.json === true ? { json: true } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {})
      },
      options.peaksJson
    )
  );

  addProjectOption(
    codegraph
      .command('files')
      .description('List codegraph files')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--max-depth <n>', 'maximum traversal depth', parsePositiveInteger)
  ).action((options: CodegraphFilesOptions) =>
    runCodegraphCommand(
      io,
      'codegraph.files',
      {
        subcommand: 'files',
        project: options.project,
        ...(options.json === true ? { json: true } : {}),
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {})
      },
      options.peaksJson
    )
  );

  addProjectOption(codegraph.command('context').description('Build task context with codegraph').argument('<task>', 'task text')).action(
    (task: string, options: CommonCodegraphOptions) =>
      runCodegraphCommand(io, 'codegraph.context', { subcommand: 'context', project: options.project, task }, options.peaksJson)
  );

  addProjectOption(
    codegraph
      .command('affected')
      .description('Find code affected by files')
      .argument('<files...>', 'project-relative file paths')
      .option('--json', 'forward JSON output flag to upstream codegraph')
  ).action((files: string[], options: CodegraphAffectedOptions) =>
    runCodegraphCommand(
      io,
      'codegraph.affected',
      {
        subcommand: 'affected',
        project: options.project,
        files,
        ...(options.json === true ? { json: true } : {})
      },
      options.peaksJson
    )
  );
}
