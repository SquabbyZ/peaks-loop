# Codegraph Skill Analysis Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add codegraph as a local project-analysis engine for Peaks skills, with `peaks codegraph` acting only as the safe pinned local `@colbymchenry/codegraph` execution boundary.

**Architecture:** Add a focused codegraph service that validates project scope and builds/runs allowed upstream invocations. Register a `peaks codegraph` command family that delegates to that service, then expose the capability through existing recommendation seed data and Peaks skill guidance. Keep codegraph as supporting evidence for RD/Solo/TXT/QA; Peaks gates remain authoritative.

**Tech Stack:** TypeScript, Commander, Vitest, Node `child_process`, Node filesystem/path utilities, existing Peaks result envelopes and capability seed catalog.

---

## File Structure

- Create `src/services/codegraph/codegraph-service.ts` — owns project validation, allowed subcommand validation, pinned local `@colbymchenry/codegraph` argument assembly, affected-file boundary checks, and process execution.
- Create `src/cli/commands/codegraph-commands.ts` — registers `peaks codegraph` subcommands and forwards each request to the codegraph service.
- Modify `src/cli/program.ts` — imports and registers the new command family.
- Modify `src/services/recommendations/capability-seed-sources.ts` — adds the `codegraph` source as `access-repo`.
- Modify `src/services/recommendations/capability-seed-items.ts` — adds the four item-level codegraph capabilities.
- Modify `src/services/recommendations/capability-seed-mappings.ts` — maps codegraph capabilities to `peaks-rd`, `peaks-solo`, `peaks-txt`, and `peaks-qa` as dry-run catalog guidance.
- Modify `skills/peaks-rd/SKILL.md` — documents codegraph as local evidence for RD scanning, planning, and impact analysis.
- Modify `skills/peaks-solo/SKILL.md` — documents Solo orchestration use of local context packs and affected-file summaries.
- Modify `skills/peaks-txt/SKILL.md` — documents TXT use of recorded codegraph context packs.
- Modify `skills/peaks-qa/SKILL.md` — documents QA use of affected output for regression focus only.
- Create `tests/unit/codegraph-service.test.ts` — tests invocation assembly, project validation, subcommand rejection, and path-escape rejection without running `npx`.
- Create `tests/unit/codegraph-commands.test.ts` — tests CLI command wiring with a mocked codegraph service.
- Modify `tests/unit/recommendation-service.test.ts` — adds seed catalog assertions for the codegraph source and four items.
- Modify `tests/unit/capability-map-service.test.ts` — adds landing assertions for all codegraph mappings and dry-run-only behavior.
- Create `tests/unit/codegraph-skill-integration.test.ts` — tests Peaks skill markdown guidance and installer/MCP guardrails.

---

### Task 1: Codegraph invocation service

**Files:**
- Create: `src/services/codegraph/codegraph-service.ts`
- Test: `tests/unit/codegraph-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tests/unit/codegraph-service.test.ts` with these tests:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphProcessRunner
} from '../../src/services/codegraph/codegraph-service.js';

function createProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-codegraph-'));
  writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
  return projectRoot;
}

describe('codegraph service', () => {
  test('assembles status invocation inside the project boundary', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({ subcommand: 'status', project: projectRoot });

    expect(invocation).toEqual({
      executable: 'npx',
      args: ['@colbymchenry/codegraph', 'status'],
      cwd: projectRoot,
      packageName: '@colbymchenry/codegraph',
      subcommand: 'status'
    });
  });

  test('assembles query invocation with search, json, and limit flags', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({
      subcommand: 'query',
      project: projectRoot,
      search: 'auth middleware',
      json: true,
      limit: 8
    });

    expect(invocation.args).toEqual(['@colbymchenry/codegraph', 'query', 'auth middleware', '--json', '--limit', '8']);
    expect(invocation.cwd).toBe(projectRoot);
  });

  test('assembles affected invocation and keeps files inside the project', () => {
    const projectRoot = createProject();

    const invocation = createCodegraphInvocation({
      subcommand: 'affected',
      project: projectRoot,
      files: ['src/index.ts'],
      json: true
    });

    expect(invocation.args).toEqual(['@colbymchenry/codegraph', 'affected', 'src/index.ts', '--json']);
  });

  test('rejects unsupported subcommands such as install', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'install' as never,
        project: projectRoot
      })
    ).toThrow('Unsupported codegraph subcommand: install');
  });

  test('requires an existing directory as project root', () => {
    const projectRoot = join(tmpdir(), 'peaks-codegraph-missing-project');

    expect(() => createCodegraphInvocation({ subcommand: 'status', project: projectRoot })).toThrow('Project path must exist and be a directory');
  });

  test('rejects affected files that escape the project root', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'affected',
        project: projectRoot,
        files: ['../outside.ts']
      })
    ).toThrow('Affected files must stay inside the project');
  });

  test('rejects invalid numeric flags before invoking upstream codegraph', () => {
    const projectRoot = createProject();

    expect(() =>
      createCodegraphInvocation({
        subcommand: 'files',
        project: projectRoot,
        maxDepth: 0
      })
    ).toThrow('maxDepth must be a positive integer');
  });

  test('executes through an injectable runner for CLI tests', async () => {
    const projectRoot = createProject();
    const invocation = createCodegraphInvocation({ subcommand: 'index', project: projectRoot, quiet: true });
    const runner: CodegraphProcessRunner = vi.fn(async (input) => ({
      exitCode: 0,
      stdout: `ran ${input.args.join(' ')}`,
      stderr: ''
    }));

    const result = await executeCodegraphInvocation(invocation, runner);

    expect(runner).toHaveBeenCalledWith(invocation);
    expect(result.stdout).toBe('ran @colbymchenry/codegraph index --quiet');
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run service tests to verify they fail**

Run:

```bash
npm test -- tests/unit/codegraph-service.test.ts
```

Expected: FAIL because `src/services/codegraph/codegraph-service.ts` does not exist.

- [ ] **Step 3: Implement the codegraph service**

Create `src/services/codegraph/codegraph-service.ts`:

```ts
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const CODEGRAPH_PACKAGE = '@colbymchenry/codegraph';
const CODEGRAPH_EXECUTABLE = 'npx';
const ALLOWED_SUBCOMMANDS = ['status', 'init', 'index', 'query', 'files', 'context', 'affected'] as const;

type AllowedSubcommand = (typeof ALLOWED_SUBCOMMANDS)[number];

interface BaseCodegraphOptions {
  project: string;
}

interface StatusOptions extends BaseCodegraphOptions {
  subcommand: 'status';
}

interface InitOptions extends BaseCodegraphOptions {
  subcommand: 'init';
  yes?: boolean;
}

interface IndexOptions extends BaseCodegraphOptions {
  subcommand: 'index';
  force?: boolean;
  quiet?: boolean;
}

interface QueryOptions extends BaseCodegraphOptions {
  subcommand: 'query';
  search: string;
  json?: boolean;
  limit?: number;
}

interface FilesOptions extends BaseCodegraphOptions {
  subcommand: 'files';
  json?: boolean;
  maxDepth?: number;
}

interface ContextOptions extends BaseCodegraphOptions {
  subcommand: 'context';
  task: string;
}

interface AffectedOptions extends BaseCodegraphOptions {
  subcommand: 'affected';
  files: string[];
  json?: boolean;
}

export type CodegraphInvocationOptions = StatusOptions | InitOptions | IndexOptions | QueryOptions | FilesOptions | ContextOptions | AffectedOptions;

export interface CodegraphInvocation {
  executable: typeof CODEGRAPH_EXECUTABLE;
  args: string[];
  cwd: string;
  packageName: typeof CODEGRAPH_PACKAGE;
  subcommand: AllowedSubcommand;
}

export interface CodegraphExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CodegraphProcessRunner = (invocation: CodegraphInvocation) => Promise<CodegraphExecutionResult>;

export function createCodegraphInvocation(options: CodegraphInvocationOptions): CodegraphInvocation {
  if (!isAllowedSubcommand(options.subcommand)) {
    throw new Error(`Unsupported codegraph subcommand: ${String(options.subcommand)}`);
  }

  const projectRoot = resolveProjectRoot(options.project);
  const args = [CODEGRAPH_PACKAGE, options.subcommand, ...createSubcommandArgs(projectRoot, options)];

  return {
    executable: CODEGRAPH_EXECUTABLE,
    args,
    cwd: projectRoot,
    packageName: CODEGRAPH_PACKAGE,
    subcommand: options.subcommand
  };
}

export async function executeCodegraphInvocation(invocation: CodegraphInvocation, runner: CodegraphProcessRunner = spawnCodegraphProcess): Promise<CodegraphExecutionResult> {
  return runner(invocation);
}

function isAllowedSubcommand(value: string): value is AllowedSubcommand {
  return ALLOWED_SUBCOMMANDS.includes(value as AllowedSubcommand);
}

function resolveProjectRoot(project: string): string {
  if (project.trim().length === 0 || project.includes('\0')) {
    throw new Error('Project path must be a non-empty local path');
  }

  const projectRoot = resolve(project);
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new Error('Project path must exist and be a directory');
  }

  return projectRoot;
}

function createSubcommandArgs(projectRoot: string, options: CodegraphInvocationOptions): string[] {
  switch (options.subcommand) {
    case 'status':
      return [];
    case 'init':
      return options.yes === true ? ['--yes'] : [];
    case 'index':
      return [...booleanFlag('--force', options.force), ...booleanFlag('--quiet', options.quiet)];
    case 'query':
      return [
        requireNonEmptyValue(options.search, 'search'),
        ...booleanFlag('--json', options.json),
        ...positiveIntegerFlag('--limit', options.limit, 'limit')
      ];
    case 'files':
      return [...booleanFlag('--json', options.json), ...positiveIntegerFlag('--max-depth', options.maxDepth, 'maxDepth')];
    case 'context':
      return [requireNonEmptyValue(options.task, 'task')];
    case 'affected':
      return [...normalizeAffectedFiles(projectRoot, options.files), ...booleanFlag('--json', options.json)];
  }
}

function booleanFlag(flag: string, enabled: boolean | undefined): string[] {
  return enabled === true ? [flag] : [];
}

function positiveIntegerFlag(flag: string, value: number | undefined, name: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return [flag, String(value)];
}

function requireNonEmptyValue(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }

  return value;
}

function normalizeAffectedFiles(projectRoot: string, files: string[]): string[] {
  if (files.length === 0) {
    throw new Error('Affected requires at least one file');
  }

  return files.map((file) => normalizeAffectedFile(projectRoot, file));
}

function normalizeAffectedFile(projectRoot: string, file: string): string {
  const resolvedFile = resolve(projectRoot, file);
  const relativeFile = relative(projectRoot, resolvedFile);

  if (relativeFile.length === 0 || relativeFile.startsWith('..') || isAbsolute(relativeFile)) {
    throw new Error('Affected files must stay inside the project');
  }

  return relativeFile.replaceAll('\\', '/');
}

function spawnCodegraphProcess(invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', rejectProcess);
    child.on('close', (code) => {
      resolveProcess({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8').trimEnd(),
        stderr: Buffer.concat(stderr).toString('utf8').trimEnd()
      });
    });
  });
}
```

- [ ] **Step 4: Run service tests to verify they pass**

Run:

```bash
npm test -- tests/unit/codegraph-service.test.ts
```

Expected: PASS for all `codegraph service` tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/services/codegraph/codegraph-service.ts tests/unit/codegraph-service.test.ts
git commit -m "feat: add codegraph invocation service"
```

---

### Task 2: CLI command family

**Files:**
- Create: `src/cli/commands/codegraph-commands.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/unit/codegraph-commands.test.ts`

- [ ] **Step 1: Write failing CLI command tests**

Create `tests/unit/codegraph-commands.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const codegraphMocks = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn(),
  createCodegraphInvocation: vi.fn((options: { subcommand: string; project: string }) => ({
    executable: 'npx',
    args: ['@colbymchenry/codegraph', options.subcommand],
    cwd: options.project,
    packageName: '@colbymchenry/codegraph',
    subcommand: options.subcommand
  }))
}));

vi.mock('../../src/services/codegraph/codegraph-service.js', () => codegraphMocks);

const { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } = await import('./cli-program-test-utils.js');

function createProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-codegraph-cli-'));
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
  return projectRoot;
}

describe('codegraph CLI commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    codegraphMocks.createCodegraphInvocation.mockClear();
    codegraphMocks.executeCodegraphInvocation.mockReset();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValue({ exitCode: 0, stdout: 'codegraph ok', stderr: '' });
  });

  test('runs status through the Peaks codegraph launcher', async () => {
    const projectRoot = createProject();

    const result = await runCommand(['codegraph', 'status', '--project', projectRoot]);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({ subcommand: 'status', project: projectRoot });
    expect(codegraphMocks.executeCodegraphInvocation).toHaveBeenCalled();
    expect(result.stdout).toContain('codegraph ok');
    expect(result.exitCode).toBeUndefined();
  });

  test('forwards query flags to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'query', '--project', projectRoot, 'auth middleware', '--json', '--limit', '5']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'query',
      project: projectRoot,
      search: 'auth middleware',
      json: true,
      limit: 5
    });
  });

  test('forwards affected files to the service', async () => {
    const projectRoot = createProject();

    await runCommand(['codegraph', 'affected', '--project', projectRoot, 'src/index.ts', '--json']);

    expect(codegraphMocks.createCodegraphInvocation).toHaveBeenCalledWith({
      subcommand: 'affected',
      project: projectRoot,
      files: ['src/index.ts'],
      json: true
    });
  });

  test('prints validation failures as Peaks envelopes', async () => {
    const projectRoot = createProject();
    codegraphMocks.createCodegraphInvocation.mockImplementationOnce(() => {
      throw new Error('Affected files must stay inside the project');
    });

    const result = await runCommand(['codegraph', 'affected', '--project', projectRoot, '../outside.ts']);

    expect(result.stderr.join('\n')).toContain('CODEGRAPH_COMMAND_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('rejects unsupported install subcommand before service execution', async () => {
    await expect(runCommand(['codegraph', 'install'])).rejects.toMatchObject({ code: 'commander.unknownCommand' } satisfies Partial<CommanderError>);

    expect(codegraphMocks.executeCodegraphInvocation).not.toHaveBeenCalled();
  });

  test('sets process exit code when upstream codegraph fails', async () => {
    const projectRoot = createProject();
    codegraphMocks.executeCodegraphInvocation.mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'upstream failed' });

    const result = await runCommand(['codegraph', 'index', '--project', projectRoot]);

    expect(result.stderr).toContain('upstream failed');
    expect(result.exitCode).toBe(2);
  });

  test('supports JSON envelopes for validation errors when --peaks-json is passed', async () => {
    const projectRoot = createProject();
    codegraphMocks.createCodegraphInvocation.mockImplementationOnce(() => {
      throw new Error('Project path must exist and be a directory');
    });

    const result = await runCommand(['codegraph', 'status', '--project', projectRoot, '--peaks-json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.command).toBe('codegraph.status');
    expect(output.code).toBe('CODEGRAPH_COMMAND_FAILED');
  });
});
```

- [ ] **Step 2: Run CLI command tests to verify they fail**

Run:

```bash
npm test -- tests/unit/codegraph-commands.test.ts
```

Expected: FAIL because `codegraph-service` exists from Task 1 but `peaks codegraph` is not registered yet.

- [ ] **Step 3: Implement codegraph command registration**

Create `src/cli/commands/codegraph-commands.ts`:

```ts
import { Command } from 'commander';
import { createCodegraphInvocation, executeCodegraphInvocation, type CodegraphInvocationOptions } from '../../services/codegraph/codegraph-service.js';
import { fail } from '../../shared/result.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

interface PeaksJsonOption {
  peaksJson?: boolean;
}

interface ProjectOption extends PeaksJsonOption {
  project: string;
}

interface InitCommandOptions extends ProjectOption {
  yes?: boolean;
}

interface IndexCommandOptions extends ProjectOption {
  force?: boolean;
  quiet?: boolean;
}

interface QueryCommandOptions extends ProjectOption {
  json?: boolean;
  limit?: string;
}

interface FilesCommandOptions extends ProjectOption {
  json?: boolean;
  maxDepth?: string;
}

interface AffectedCommandOptions extends ProjectOption {
  json?: boolean;
}

export function registerCodegraphCommands(program: Command, io: ProgramIO): void {
  const codegraph = program.command('codegraph').description('Run local codegraph project analysis through a Peaks safety boundary');

  addPeaksJsonOption(codegraph.command('status').description('Show local codegraph status').requiredOption('--project <path>', 'target project root'))
    .action((options: ProjectOption) => runCodegraph(io, { subcommand: 'status', project: options.project }, options));

  addPeaksJsonOption(codegraph.command('init').description('Initialize local codegraph metadata').requiredOption('--project <path>', 'target project root').option('--yes', 'answer yes to supported upstream prompts'))
    .action((options: InitCommandOptions) => runCodegraph(io, { subcommand: 'init', project: options.project, yes: options.yes }, options));

  addPeaksJsonOption(codegraph.command('index').description('Index the local project with codegraph').requiredOption('--project <path>', 'target project root').option('--force', 'force upstream reindex').option('--quiet', 'request quiet upstream output'))
    .action((options: IndexCommandOptions) => runCodegraph(io, { subcommand: 'index', project: options.project, force: options.force, quiet: options.quiet }, options));

  addPeaksJsonOption(codegraph.command('query').description('Query local codegraph context').requiredOption('--project <path>', 'target project root').argument('<search>', 'semantic or symbol search text').option('--json', 'forward JSON output request to upstream codegraph').option('--limit <n>', 'maximum result count'))
    .action((search: string, options: QueryCommandOptions) => runCodegraph(io, { subcommand: 'query', project: options.project, search, json: options.json, limit: parseOptionalInteger(options.limit, 'limit') }, options));

  addPeaksJsonOption(codegraph.command('files').description('List indexed files through codegraph').requiredOption('--project <path>', 'target project root').option('--json', 'forward JSON output request to upstream codegraph').option('--max-depth <n>', 'maximum tree depth'))
    .action((options: FilesCommandOptions) => runCodegraph(io, { subcommand: 'files', project: options.project, json: options.json, maxDepth: parseOptionalInteger(options.maxDepth, 'maxDepth') }, options));

  addPeaksJsonOption(codegraph.command('context').description('Build task-specific local code context').requiredOption('--project <path>', 'target project root').argument('<task>', 'task description'))
    .action((task: string, options: ProjectOption) => runCodegraph(io, { subcommand: 'context', project: options.project, task }, options));

  addPeaksJsonOption(codegraph.command('affected').description('Inspect likely impact for changed files').requiredOption('--project <path>', 'target project root').argument('<files...>', 'changed files inside the project').option('--json', 'forward JSON output request to upstream codegraph'))
    .action((files: string[], options: AffectedCommandOptions) => runCodegraph(io, { subcommand: 'affected', project: options.project, files, json: options.json }, options));
}

function addPeaksJsonOption(command: Command): Command {
  return command.option('--peaks-json', 'print Peaks validation errors as JSON envelopes');
}

async function runCodegraph(io: ProgramIO, options: CodegraphInvocationOptions, cliOptions: PeaksJsonOption): Promise<void> {
  const command = `codegraph.${options.subcommand}`;

  try {
    const invocation = createCodegraphInvocation(options);
    const result = await executeCodegraphInvocation(invocation);

    if (result.stdout.length > 0) {
      io.stdout(result.stdout);
    }
    if (result.stderr.length > 0) {
      io.stderr(result.stderr);
    }
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    printResult(io, fail(command, 'CODEGRAPH_COMMAND_FAILED', getErrorMessage(error), {}, ['Check --project and keep codegraph execution local to that project']), cliOptions.peaksJson);
    process.exitCode = 1;
  }
}

function parseOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }

  return parsed;
}
```

- [ ] **Step 4: Register the command family in the CLI program**

Modify `src/cli/program.ts`:

```ts
import { Command } from 'commander';
import { CLI_VERSION } from '../shared/version.js';
import { registerCoreAndArtifactCommands } from './commands/core-artifact-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerCapabilityWorkerConfigAndSCCommands } from './commands/capability-worker-config-sc-commands.js';
import { registerCodegraphCommands } from './commands/codegraph-commands.js';
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

  return program;
}
```

- [ ] **Step 5: Run CLI command tests to verify they pass**

Run:

```bash
npm test -- tests/unit/codegraph-commands.test.ts
```

Expected: PASS for all `codegraph CLI commands` tests.

- [ ] **Step 6: Run both codegraph test files**

Run:

```bash
npm test -- tests/unit/codegraph-service.test.ts tests/unit/codegraph-commands.test.ts
```

Expected: PASS for both files.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/cli/program.ts src/cli/commands/codegraph-commands.ts tests/unit/codegraph-commands.test.ts
git commit -m "feat: add codegraph CLI boundary"
```

---

### Task 3: Capability catalog seed integration

**Files:**
- Modify: `src/services/recommendations/capability-seed-sources.ts`
- Modify: `src/services/recommendations/capability-seed-items.ts`
- Modify: `src/services/recommendations/capability-seed-mappings.ts`
- Modify: `tests/unit/recommendation-service.test.ts`
- Modify: `tests/unit/capability-map-service.test.ts`

- [ ] **Step 1: Write failing recommendation seed tests**

Add this test to the first `describe('seed capability catalog', ...)` block in `tests/unit/recommendation-service.test.ts`:

```ts
  test('models codegraph as indexed local analysis capabilities for Peaks skills', () => {
    const expectedCapabilityIds = [
      'codegraph.project-indexing',
      'codegraph.semantic-query',
      'codegraph.impact-analysis',
      'codegraph.context-pack'
    ];
    const source = seedCapabilitySources.find((candidate) => candidate.sourceId === 'codegraph');
    const items = seedCapabilityItems.filter((item) => item.sourceId === 'codegraph');

    expect(source?.sourceType).toBe('repo');
    expect(source?.sourceGroup).toBe('access-repo');
    expect(source?.discoveryStatus).toBe('indexed');
    expect(source?.trustSignals?.notes?.join('\n')).toContain('Use through peaks codegraph only');
    expect(source?.items).toEqual(expectedCapabilityIds);
    expect(items.map((item) => item.capabilityId)).toEqual(expectedCapabilityIds);
    expect(items.every((item) => item.fallback.qualityImpact === 'same')).toBe(true);
  });
```

- [ ] **Step 2: Write failing capability map tests**

Add this test to `tests/unit/capability-map-service.test.ts` after the Matt Pocock mapping test:

```ts
  test('maps codegraph local analysis capabilities into Peaks skill landings', () => {
    const plan = createCapabilityMapPlan({ source: 'access-repo' });
    const source = plan.sources.find((candidate) => candidate.sourceId === 'codegraph');
    const targetsFor = (capabilityId: string) =>
      plan.mappings
        .filter((mapping) => mapping.capabilityId === capabilityId)
        .map((mapping) => mapping.target)
        .sort();

    expect(source?.discoveryStatus).toBe('indexed');
    expect(targetsFor('codegraph.project-indexing')).toEqual(['peaks-rd']);
    expect(targetsFor('codegraph.semantic-query')).toEqual(['peaks-rd']);
    expect(targetsFor('codegraph.impact-analysis')).toEqual(['peaks-qa', 'peaks-rd']);
    expect(targetsFor('codegraph.context-pack')).toEqual(['peaks-rd', 'peaks-solo', 'peaks-txt']);
    expect(plan.mappings.filter((mapping) => mapping.sourceId === 'codegraph').every((mapping) => mapping.dryRunOnly)).toBe(true);
    expect(plan.mappings.filter((mapping) => mapping.sourceId === 'codegraph').map((mapping) => mapping.commandPreview)).not.toContain('codegraph install');
  });
```

- [ ] **Step 3: Run capability tests to verify they fail**

Run:

```bash
npm test -- tests/unit/recommendation-service.test.ts tests/unit/capability-map-service.test.ts
```

Expected: FAIL because the codegraph source, items, and mappings do not exist yet.

- [ ] **Step 4: Add the codegraph source**

Modify `src/services/recommendations/capability-seed-sources.ts` by inserting this entry after the `context7` source:

```ts
  { sourceId: 'codegraph', sourceType: 'repo', sourceGroup: 'access-repo', title: 'codegraph', url: 'https://github.com/colbymchenry/codegraph', trustSignals: { notes: ['Use through peaks codegraph only; do not run upstream install flows from the capability map.', 'Local project indexing can create .codegraph artifacts; do not commit generated databases unless explicitly requested.'] }, discoveryStatus: 'indexed', items: ['codegraph.project-indexing', 'codegraph.semantic-query', 'codegraph.impact-analysis', 'codegraph.context-pack'] },
```

- [ ] **Step 5: Add the four codegraph capability items**

Modify `src/services/recommendations/capability-seed-items.ts` by inserting these entries after `context7.docs-lookup` and before `playwright-mcp.browser-validation`:

```ts
  capability('codegraph.project-indexing', 'codegraph', 'Codegraph Project Indexing', 'cli', 'project-analysis', ['engineer'], 'medium', 'peaks-rd-local-scan', 'Use Peaks RD local project scanning when codegraph is unavailable.', 'Codegraph Project Indexing', 'Codegraph 项目索引', 'Indexes a local project through the peaks codegraph execution boundary for role-skill analysis.', '通过 peaks codegraph 执行边界索引本地项目，辅助角色 skill 分析。'),
  capability('codegraph.semantic-query', 'codegraph', 'Codegraph Semantic Query', 'cli', 'project-analysis', ['engineer'], 'medium', 'peaks-rd-local-scan', 'Use local Grep/Glob and RD scanning when codegraph semantic query is unavailable.', 'Codegraph Semantic Query', 'Codegraph 语义查询', 'Queries local symbols and project relationships for RD planning evidence.', '查询本地符号和项目关系，为 RD 规划提供证据。'),
  capability('codegraph.impact-analysis', 'codegraph', 'Codegraph Impact Analysis', 'cli', 'impact-analysis', ['engineer', 'qa'], 'medium', 'peaks-rd-qa-impact-review', 'Use RD changed-file analysis and QA regression planning when codegraph affected output is unavailable.', 'Codegraph Impact Analysis', 'Codegraph 影响面分析', 'Analyzes likely impact for changed files so RD and QA can focus planning and regression scope.', '分析变更文件的可能影响面，帮助 RD 与 QA 聚焦规划和回归范围。'),
  capability('codegraph.context-pack', 'codegraph', 'Codegraph Context Pack', 'cli', 'context-pack', ['engineer', 'qa', 'product'], 'medium', 'peaks-txt-context-capsule', 'Use Peaks TXT context capsules and role-skill handoffs when codegraph context output is unavailable.', 'Codegraph Context Pack', 'Codegraph 上下文包', 'Builds task-specific local context that Solo, RD, and TXT can use as supporting evidence.', '生成任务相关的本地上下文，作为 Solo、RD 与 TXT 的辅助证据。'),
```

- [ ] **Step 6: Add dry-run landing mappings**

Modify `src/services/recommendations/capability-seed-mappings.ts` by inserting these entries after the `context7.docs-lookup` mapping:

```ts
  mapping({ capabilityId: 'codegraph.project-indexing', sourceId: 'codegraph', sourceGroup: 'access-repo', landingKind: 'skill', target: 'peaks-rd', skillName: 'peaks-rd', guidance: 'Use peaks codegraph index --project <path> before semantic analysis when local indexing is needed; generated .codegraph artifacts stay local unless explicitly approved.' }),
  mapping({ capabilityId: 'codegraph.semantic-query', sourceId: 'codegraph', sourceGroup: 'access-repo', landingKind: 'skill', target: 'peaks-rd', skillName: 'peaks-rd', guidance: 'Use peaks codegraph query --project <path> <search> for project relationship evidence during RD planning; Peaks RD gates remain authoritative.' }),
  mapping({ capabilityId: 'codegraph.impact-analysis', sourceId: 'codegraph', sourceGroup: 'access-repo', landingKind: 'skill', target: 'peaks-rd', skillName: 'peaks-rd', guidance: 'Use peaks codegraph affected --project <path> <files...> --json to inspect likely impact before slice planning and red-line checks.' }),
  mapping({ capabilityId: 'codegraph.impact-analysis', sourceId: 'codegraph', sourceGroup: 'access-repo', landingKind: 'skill', target: 'peaks-qa', skillName: 'peaks-qa', guidance: 'Use affected output as regression-surface evidence only; QA validation and test evidence remain authoritative.' }),
  mapping({ capabilityId: 'codegraph.context-pack', sourceId: 'codegraph', sourceGroup: 'access-repo', landingKind: 'skill', target: 'peaks-rd', skillName: 'peaks-rd', guidance: 'Use peaks codegraph context --project <path> <task> to gather local evidence for RD analysis without replacing standards dry-runs.' }),
  mapping({ capabilityId: 'codegraph.context-pack', sourceId: 'codegraph', sourceGroup: 'access-repo', landingKind: 'skill', target: 'peaks-solo', skillName: 'peaks-solo', guidance: 'Solo may attach local context packs or affected summaries before role handoff so RD, QA, and TXT share the same project evidence.' }),
  mapping({ capabilityId: 'codegraph.context-pack', sourceId: 'codegraph', sourceGroup: 'access-repo', landingKind: 'skill', target: 'peaks-txt', skillName: 'peaks-txt', guidance: 'TXT may summarize recorded codegraph context packs into handoffs while treating them as supporting evidence only.' }),
```

- [ ] **Step 7: Run capability tests to verify they pass**

Run:

```bash
npm test -- tests/unit/recommendation-service.test.ts tests/unit/capability-map-service.test.ts
```

Expected: PASS for recommendation and capability map tests.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/services/recommendations/capability-seed-sources.ts src/services/recommendations/capability-seed-items.ts src/services/recommendations/capability-seed-mappings.ts tests/unit/recommendation-service.test.ts tests/unit/capability-map-service.test.ts
git commit -m "feat: catalog codegraph skill analysis capabilities"
```

---

### Task 4: Peaks skill guidance

**Files:**
- Modify: `skills/peaks-rd/SKILL.md`
- Modify: `skills/peaks-solo/SKILL.md`
- Modify: `skills/peaks-txt/SKILL.md`
- Modify: `skills/peaks-qa/SKILL.md`
- Create: `tests/unit/codegraph-skill-integration.test.ts`

- [ ] **Step 1: Write failing skill markdown tests**

Create `tests/unit/codegraph-skill-integration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

function readSkill(skillName: string): string {
  return readFileSync(join(process.cwd(), 'skills', skillName, 'SKILL.md'), 'utf8');
}

function expectCodegraphGuardrails(content: string): void {
  expect(content).toContain('peaks codegraph');
  expect(content).not.toContain('direct upstream codegraph commands');
  expect(content).not.toContain('codegraph install');
  expect(content).not.toContain('serve --mcp');
  expect(content).not.toContain('configure MCP');
}

describe('Codegraph skill analysis integration guidance', () => {
  test('peaks-rd uses codegraph as local project evidence while keeping RD gates authoritative', () => {
    const content = readSkill('peaks-rd');

    expect(content).toContain('## Codegraph project analysis');
    expect(content).toContain('local project-analysis evidence');
    expect(content).toContain('red-line scope boundaries');
    expect(content).toContain('Peaks RD gates remain authoritative');
    expect(content).toContain('peaks codegraph affected --project <path> <changed-files...> --json');
    expectCodegraphGuardrails(content);
  });

  test('peaks-solo coordinates codegraph context without replacing role skills', () => {
    const content = readSkill('peaks-solo');

    expect(content).toContain('## Codegraph orchestration context');
    expect(content).toContain('optional project-analysis enhancement');
    expect(content).toContain('role handoff');
    expect(content).toContain('Solo must not treat codegraph output as approval');
    expectCodegraphGuardrails(content);
  });

  test('peaks-txt consumes recorded codegraph context as supporting handoff evidence', () => {
    const content = readSkill('peaks-txt');

    expect(content).toContain('## Codegraph context capsules');
    expect(content).toContain('supporting evidence');
    expect(content).toContain('.peaks/<session-id>/rd/codegraph-context.md');
    expect(content).toContain('Durable memory extraction still requires explicit authorization');
    expectCodegraphGuardrails(content);
  });

  test('peaks-qa uses affected output only for regression focus', () => {
    const content = readSkill('peaks-qa');

    expect(content).toContain('## Codegraph regression focus');
    expect(content).toContain('regression-surface evidence');
    expect(content).toContain('External analysis cannot pass QA by itself');
    expect(content).toContain('peaks codegraph affected --project <path> <changed-files...> --json');
    expectCodegraphGuardrails(content);
  });
});
```

- [ ] **Step 2: Run skill tests to verify they fail**

Run:

```bash
npm test -- tests/unit/codegraph-skill-integration.test.ts
```

Expected: FAIL because the four skill markdown files do not yet contain codegraph integration sections.

- [ ] **Step 3: Add RD skill guidance**

Append this section to `skills/peaks-rd/SKILL.md` near existing external-capability guidance sections:

```md
## Codegraph project analysis

Use codegraph as local project-analysis evidence when project scanning needs relationship context that plain file reads cannot show. Invoke it only through Peaks:

- `peaks codegraph status --project <path>` to check whether local codegraph state exists.
- `peaks codegraph index --project <path>` before semantic analysis when indexing is needed.
- `peaks codegraph context --project <path> "<task>"` to collect task-specific local evidence.
- `peaks codegraph affected --project <path> <changed-files...> --json` to inspect likely impact before slice planning, red-line scope boundaries, or QA handoff.

Treat codegraph output as untrusted supporting evidence. Do not run upstream installer flows, configure MCP, mutate agent settings, or commit `.codegraph/` artifacts. Peaks RD gates remain authoritative: standards dry-runs, red-line boundary checks, OpenSpec expectations where applicable, unit-test evidence, code review, security review, and final dry-run handoff.
```

- [ ] **Step 4: Add Solo skill guidance**

Append this section to `skills/peaks-solo/SKILL.md` near `## Optional capabilities`:

```md
## Codegraph orchestration context

Codegraph is an optional project-analysis enhancement for role handoff. Solo may coordinate `peaks codegraph context --project <path> "<task>"` or `peaks codegraph affected --project <path> <changed-files...> --json` before assigning work to RD, QA, or TXT when shared project evidence would make the handoff narrower.

Record useful output in the local Peaks artifact workspace, such as `.peaks/<session-id>/rd/codegraph-context.md` or `.peaks/<session-id>/rd/codegraph-affected.json`. Solo must not treat codegraph output as approval, must not bypass role skills, and must not run upstream installer flows, configure MCP, mutate agent settings, or commit `.codegraph/` artifacts.
```

- [ ] **Step 5: Add TXT skill guidance**

Append this section to `skills/peaks-txt/SKILL.md` near existing handoff/context guidance:

```md
## Codegraph context capsules

TXT may consume recorded codegraph artifacts as supporting evidence when preparing handoffs, release notes, or implementation summaries. Preferred local artifact paths are `.peaks/<session-id>/rd/codegraph-context.md` and `.peaks/<session-id>/rd/codegraph-affected.json`.

Summarize the relevant project relationships, affected areas, and uncertainty from the artifact. Do not present codegraph output as the final source of truth, do not run upstream commands directly, and do not persist generated `.codegraph/` databases into git. Durable memory extraction still requires explicit authorization.
```

- [ ] **Step 6: Add QA skill guidance**

Append this section to `skills/peaks-qa/SKILL.md` near existing QA evidence guidance:

```md
## Codegraph regression focus

QA may use `peaks codegraph affected --project <path> <changed-files...> --json` as regression-surface evidence when deciding which related modules, tests, or manual checks deserve attention. This is useful when RD provides changed files and the likely dependency impact is unclear.

External analysis cannot pass QA by itself. Treat codegraph output as untrusted supporting evidence, verify behavior through normal Peaks QA validation, and do not run upstream installer flows, configure MCP, mutate agent settings, or commit `.codegraph/` artifacts.
```

- [ ] **Step 7: Run skill tests to verify they pass**

Run:

```bash
npm test -- tests/unit/codegraph-skill-integration.test.ts
```

Expected: PASS for all skill markdown tests.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add skills/peaks-rd/SKILL.md skills/peaks-solo/SKILL.md skills/peaks-txt/SKILL.md skills/peaks-qa/SKILL.md tests/unit/codegraph-skill-integration.test.ts
git commit -m "feat: document codegraph skill analysis flow"
```

---

### Task 5: Integration validation and hardening

**Files:**
- Modify only if checks reveal issues: files changed in Tasks 1-4

- [ ] **Step 1: Run focused codegraph-related tests**

Run:

```bash
npm test -- tests/unit/codegraph-service.test.ts tests/unit/codegraph-commands.test.ts tests/unit/recommendation-service.test.ts tests/unit/capability-map-service.test.ts tests/unit/codegraph-skill-integration.test.ts
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
> peaks-cli@1.0.4 typecheck
> tsc -p tsconfig.json --noEmit
```

with exit code 0.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS for the full Vitest suite. Existing skipped tests may remain skipped.

- [ ] **Step 4: Inspect git diff for scope and safety**

Run:

```bash
git diff -- src/services/codegraph src/cli src/services/recommendations skills tests/unit
```

Expected:

- No references instructing skills to run direct upstream codegraph commands.
- No references instructing users to run `codegraph install`.
- No MCP installation, settings mutation, hooks mutation, or `.codegraph/` persistence code.
- Codegraph command implementation only allows `status`, `init`, `index`, `query`, `files`, `context`, and `affected`.

- [ ] **Step 5: Commit final validation fixes if any were needed**

If Step 1, Step 2, Step 3, or Step 4 required changes, run:

```bash
git add src/services/codegraph src/cli src/services/recommendations skills tests/unit
git commit -m "fix: harden codegraph skill analysis integration"
```

Expected: a commit is created only if validation found and fixed issues.

---

## Self-Review

**Spec coverage:**
- Skill-family capability lift is covered by Task 4 skill guidance and Task 3 capability mappings.
- Safe `peaks codegraph` execution boundary is covered by Tasks 1 and 2.
- Unsupported installer/MCP/settings mutation guardrails are covered by service/CLI allowed subcommands, skill tests, and final diff inspection.
- Capability catalog source, items, and dry-run mappings are covered by Task 3.
- Test-first implementation is enforced by every task beginning with failing tests.
- Final validation commands are included in Task 5.

**Ambiguity resolved:**
- `--json` on codegraph subcommands is forwarded to upstream codegraph. Peaks error envelopes use `--peaks-json` to avoid colliding with upstream JSON flags.
- `--project` scopes execution by setting the process `cwd` to the resolved project root; affected file arguments are normalized and rejected if they escape that root.
- The CLI does execute upstream `npx` for explicit codegraph commands, but tests use service-level construction and CLI-level mocks so the suite never runs `npx`.

**Type consistency:**
- The plan uses `CodegraphInvocationOptions`, `CodegraphInvocation`, `CodegraphExecutionResult`, and `CodegraphProcessRunner` consistently across service and CLI tests.
- Capability IDs match across source, items, mappings, and tests.
