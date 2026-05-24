import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { defaultCodegraphProcessRunner } from './codegraph-process-runner.js';

const CODEGRAPH_PACKAGE_NAME = '@colbymchenry/codegraph';
const CODEGRAPH_PACKAGE_VERSION = '0.7.10';
const CODEGRAPH_EXECUTABLE = process.execPath;
const CODEGRAPH_BINARY_PATH = resolveCodegraphBinaryPath();
const POSITIONAL_ARGUMENT_PREFIX = '-';
const ALLOWED_SUBCOMMANDS = ['status', 'init', 'index', 'query', 'files', 'context', 'affected'] as const;
const NUMERIC_FLAG_NAMES = ['limit', 'maxDepth'] as const;
const COMMON_OPTION_KEYS = ['subcommand', 'project'] as const;
const ALLOWED_OPTIONS_BY_SUBCOMMAND = {
  status: [],
  init: ['yes'],
  index: ['force', 'quiet'],
  query: ['search', 'json', 'limit'],
  files: ['json', 'maxDepth'],
  context: ['task'],
  affected: ['files', 'json']
} as const satisfies Record<CodegraphSubcommand, readonly string[]>;

type CodegraphSubcommand = (typeof ALLOWED_SUBCOMMANDS)[number];
type NumericFlagName = (typeof NUMERIC_FLAG_NAMES)[number];

type BaseCodegraphInvocationOptions = {
  subcommand: CodegraphSubcommand;
  project: string;
  search?: string;
  files?: string[];
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
  force?: boolean;
  limit?: number;
  maxDepth?: number;
};

type ContextCodegraphInvocationOptions = Omit<BaseCodegraphInvocationOptions, 'subcommand'> & {
  subcommand: 'context';
  task: string;
};

type NonContextCodegraphInvocationOptions = BaseCodegraphInvocationOptions & {
  subcommand: Exclude<CodegraphSubcommand, 'context'>;
  task?: never;
};

export type CodegraphInvocationOptions = ContextCodegraphInvocationOptions | NonContextCodegraphInvocationOptions;

export type CodegraphInvocation = {
  executable: typeof CODEGRAPH_EXECUTABLE;
  args: string[];
  cwd: string;
  packageName: typeof CODEGRAPH_PACKAGE_NAME;
  packageVersion: typeof CODEGRAPH_PACKAGE_VERSION;
  subcommand: CodegraphSubcommand;
};

export type CodegraphExecutionResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type CodegraphProcessRunner = (invocation: CodegraphInvocation) => Promise<CodegraphExecutionResult>;

function resolveCodegraphBinaryPath(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@colbymchenry/codegraph/package.json');
  const binaryPath = resolve(dirname(packageJsonPath), 'dist', 'bin', 'codegraph.js');

  return binaryPath;
}

function assertSupportedSubcommand(subcommand: string): asserts subcommand is CodegraphSubcommand {
  if (!ALLOWED_SUBCOMMANDS.includes(subcommand as CodegraphSubcommand)) {
    throw new Error(`Unsupported codegraph subcommand: ${subcommand}`);
  }
}

function resolveProjectRoot(project: string): string {
  const projectRoot = resolve(project);

  try {
    if (!statSync(projectRoot).isDirectory()) {
      throw new Error('Project path must exist and be a directory');
    }

    return realpathSync.native(projectRoot);
  } catch {
    throw new Error('Project path must exist and be a directory');
  }
}

function assertPositiveInteger(value: number | undefined, flagName: NumericFlagName): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flagName} must be a positive integer`);
  }
}

function assertPositionalArgument(value: string, argumentName: string): void {
  if (value.startsWith(POSITIONAL_ARGUMENT_PREFIX)) {
    throw new Error(`${argumentName} must not start with -`);
  }
}

function assertSupportedOptions(options: CodegraphInvocationOptions): void {
  const allowedOptions = new Set<string>(ALLOWED_OPTIONS_BY_SUBCOMMAND[options.subcommand]);
  const presentOptionKeys = Object.keys(options).filter((key) => !COMMON_OPTION_KEYS.includes(key as (typeof COMMON_OPTION_KEYS)[number]));
  const unsupportedOption = presentOptionKeys.find((key) => !allowedOptions.has(key));

  if (unsupportedOption) {
    throw new Error(`Unsupported option ${unsupportedOption} for codegraph ${options.subcommand}`);
  }
}

function assertRequiredOptions(options: CodegraphInvocationOptions): void {
  if (options.subcommand === 'query' && (!options.search || options.search.trim() === '')) {
    throw new Error('search must be non-empty');
  }

  if (options.subcommand === 'query' && options.search) {
    assertPositionalArgument(options.search, 'search');
  }

  if (options.subcommand === 'context') {
    assertPositionalArgument(options.task, 'task');
  }
}

function assertInsideProject(projectRoot: string, absolutePath: string): void {
  const relativePath = relative(projectRoot, absolutePath);

  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Affected files must stay inside the project');
  }
}

function resolveExistingBoundary(absoluteFilePath: string): string {
  if (existsSync(absoluteFilePath)) {
    return absoluteFilePath;
  }

  let currentPath = dirname(absoluteFilePath);

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);

    currentPath = parentPath;
  }

  return currentPath;
}

function normalizeProjectRelativeFile(projectRoot: string, file: string): string {
  assertPositionalArgument(file, 'Affected files');
  const absoluteFilePath = resolve(projectRoot, file);
  assertInsideProject(projectRoot, absoluteFilePath);
  const realBoundary = realpathSync.native(resolveExistingBoundary(absoluteFilePath));
  assertInsideProject(projectRoot, realBoundary);

  return relative(projectRoot, absoluteFilePath).split(sep).join('/');
}

function buildAffectedFileArgs(projectRoot: string, files: string[] | undefined): string[] {
  if (!files || files.length < 1) {
    throw new Error('affected requires at least one file');
  }

  return files.map((file) => normalizeProjectRelativeFile(projectRoot, file));
}

function buildCommandArgs(options: CodegraphInvocationOptions, projectRoot: string): string[] {
  const args = [CODEGRAPH_BINARY_PATH, options.subcommand];

  if (options.subcommand === 'query' && options.search) {
    args.push(options.search);
  }

  if (options.subcommand === 'context') {
    if (options.task.trim() === '') {
      throw new Error('task must be non-empty');
    }

    args.push(options.task);
  }

  if (options.subcommand === 'affected') {
    args.push(...buildAffectedFileArgs(projectRoot, options.files));
  }

  if (options.yes === true) {
    args.push('--yes');
  }

  if (options.force === true) {
    args.push('--force');
  }

  if (options.json === true) {
    args.push('--json');
  }

  if (options.quiet === true) {
    args.push('--quiet');
  }

  if (options.limit !== undefined) {
    args.push('--limit', String(options.limit));
  }

  if (options.maxDepth !== undefined) {
    args.push('--max-depth', String(options.maxDepth));
  }

  return args;
}

export function createCodegraphInvocation(options: CodegraphInvocationOptions): CodegraphInvocation {
  assertSupportedSubcommand(options.subcommand);
  const projectRoot = resolveProjectRoot(options.project);

  assertSupportedOptions(options);
  assertRequiredOptions(options);
  assertPositiveInteger(options.limit, 'limit');
  assertPositiveInteger(options.maxDepth, 'maxDepth');

  return {
    executable: CODEGRAPH_EXECUTABLE,
    args: buildCommandArgs(options, projectRoot),
    cwd: projectRoot,
    packageName: CODEGRAPH_PACKAGE_NAME,
    packageVersion: CODEGRAPH_PACKAGE_VERSION,
    subcommand: options.subcommand
  };
}

export async function executeCodegraphInvocation(
  invocation: CodegraphInvocation,
  runner: CodegraphProcessRunner = defaultCodegraphProcessRunner
): Promise<CodegraphExecutionResult> {
  return runner(invocation);
}
