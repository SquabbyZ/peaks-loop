import { mkdirSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { CommanderError } from 'commander';
import { vi } from 'vitest';

const mockedLint = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockedConfirmation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const cliProgramTestState = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return {
    home: mkdtempSync(join(tmpdir(), 'peaks-loop-home-')),
    smokeTest: vi.fn(),
    workerRun: vi.fn()
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => cliProgramTestState.home };
});

vi.mock('../../src/services/providers/minimax-provider-service.js', () => ({
  testMiniMaxProvider: cliProgramTestState.smokeTest
}));
vi.mock('../../src/services/providers/minimax-worker-service.js', () => ({
  runMiniMaxWorker: cliProgramTestState.workerRun
}));
vi.mock('../../src/services/mode/mode-enforcement.js', () => ({
  requireUserConfirmation: mockedConfirmation,
  ConfirmationRequiredError: class ConfirmationRequiredError extends Error {
    constructor(transitionKey: string) {
      super(`Confirmation required for: ${transitionKey}`);
      this.name = 'ConfirmationRequiredError';
    }
  }
}));
vi.mock('../../src/services/artifacts/artifact-lint-service.js', () => ({
  lintRequestArtifact: mockedLint
}));

const DEFAULT_CLI_CONFIG = { version: '0.1.0', currentWorkspace: null, workspaces: [], language: 'en', model: 'sonnet', tokens: {}, providers: { minimax: { model: 'minimax-2.7' } } };

// Caller-id source env vars fed by host shell into vitest workers. Must be cleared
// before runCommand so resolveCallerId (src/services/session/resolve-caller-id.ts,
// invoked at src/cli/commands/request-commands.ts:222-257) does not pick up a
// host value that fails the D1 regex and surface as CALLER_ID_INVALID (exit 65).
const CALLER_ID_ENV_KEYS = [
  'CLAUDE_CODE_SESSION_ID',
  'PEAKS_CALLER_ID',
  'PEAKS_OUTER_SESSION_ID'
] as const;

import { createProgram } from '../../src/cli/program.js';

export function getMockedHomeDir(): string {
  return cliProgramTestState.home;
}

export function getMinimaxSmokeTest() {
  return cliProgramTestState.smokeTest;
}

export function getMinimaxWorkerRun() {
  return cliProgramTestState.workerRun;
}

export function resetCliProgramMocks(): void {
  cliProgramTestState.smokeTest.mockReset();
  cliProgramTestState.workerRun.mockReset();
}

export function writeUserConfig(config: unknown = DEFAULT_CLI_CONFIG): void {
  mkdirSync(pathJoin(cliProgramTestState.home, '.peaks'), { recursive: true });
  writeFileSync(pathJoin(cliProgramTestState.home, '.peaks', 'config.json'), JSON.stringify(config), 'utf8');
}

export function createHarness() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram({
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text)
  });
  return { program, stdout, stderr };
}

export async function runCommand(args: string[], env: Record<string, string> = {}) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const harness = createHarness();
  const envKeys = new Set([...Object.keys(env), 'MINIMAX_API_KEY', ...CALLER_ID_ENV_KEYS]);
  // Plan A2: synthesize a regex-valid default callerId so tests don't depend
  // on host shell injection. D4 reject tests pass CLAUDE_CODE_SESSION_ID: ''
  // to force D2 — the hasOwnProperty guard keeps our default from interfering.
  if (
    !Object.prototype.hasOwnProperty.call(env, 'PEAKS_CALLER_ID') &&
    !Object.prototype.hasOwnProperty.call(env, 'CLAUDE_CODE_SESSION_ID')
  ) {
    env['PEAKS_CALLER_ID'] = `vitest-${process.pid}-${Date.now().toString(36)}`;
    envKeys.add('PEAKS_CALLER_ID');
  }
  const previousEnv = new Map(Array.from(envKeys, (key) => [key, process.env[key]]));
  for (const key of envKeys) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      process.env[key] = env[key]!;
    } else {
      delete process.env[key];
    }
  }
  try {
    await harness.program.parseAsync(['node', 'peaks', ...args], { from: 'node' });
  } catch (error: unknown) {
    if (!(error instanceof CommanderError && error.code === 'commander.version')) {
      throw error;
    }
  } finally {
    for (const [key, value] of previousEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
  const exitCode = process.exitCode;
  process.exitCode = previousExitCode;
  return { ...harness, exitCode };
}

export function parseJsonOutput<T = unknown>(stdout: string[]) {
  return JSON.parse(stdout.join('\n')) as {
    ok: boolean;
    command: string;
    data: T;
    code?: string;
    message?: string;
    warnings?: string[];
    nextActions?: string[];
  };
}

writeUserConfig();
