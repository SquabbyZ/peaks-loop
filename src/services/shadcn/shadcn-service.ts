import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const SHADCN_PACKAGE_NAME = 'shadcn';
const SHADCN_PACKAGE_VERSION = '4.7.0';
const SHADCN_EXECUTABLE = process.execPath;
const SHADCN_BINARY_PATH = resolveShadcnBinaryPath();
const SHADCN_PROCESS_TIMEOUT_MS = 600_000;
const SHADCN_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;
const POSITIONAL_ARGUMENT_PREFIX = '-';
const PRESERVED_ENV_KEYS = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR'] as const;

export type ShadcnInvocationOptions = {
  args: string[];
  cwd?: string;
};

export type ShadcnInvocation = {
  executable: typeof SHADCN_EXECUTABLE;
  args: string[];
  cwd: string;
  packageName: typeof SHADCN_PACKAGE_NAME;
  packageVersion: typeof SHADCN_PACKAGE_VERSION;
};

export type ShadcnExecutionResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type ShadcnProcessRunner = (invocation: ShadcnInvocation) => Promise<ShadcnExecutionResult>;

function resolveShadcnBinaryPath(): string {
  const require = createRequire(import.meta.url);
  const binaryPath = require.resolve('shadcn');

  if (!existsSync(binaryPath)) {
    throw new Error('Unable to resolve local shadcn binary from shadcn');
  }

  return binaryPath;
}

function assertShadcnArgs(args: string[]): void {
  if (args.length === 0) {
    throw new Error('shadcn arguments are required');
  }

  if (args[0]?.startsWith(POSITIONAL_ARGUMENT_PREFIX)) {
    throw new Error('shadcn command must not start with -');
  }
}

function createShadcnEnvironment(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of PRESERVED_ENV_KEYS) {
    const value = sourceEnv[key];

    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

function assertOutputLimit(currentSize: number, chunkSize: number): number {
  const nextSize = currentSize + chunkSize;

  if (nextSize > SHADCN_OUTPUT_LIMIT_BYTES) {
    throw new Error(`shadcn output exceeded ${SHADCN_OUTPUT_LIMIT_BYTES} bytes`);
  }

  return nextSize;
}

function terminateShadcnProcess(childProcess: ChildProcess): void {
  if (childProcess.pid === undefined) {
    childProcess.kill();
    return;
  }

  if (process.platform === 'win32') {
    const taskkillPath = process.env.SystemRoot ? resolve(process.env.SystemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
    spawn(taskkillPath, ['/pid', String(childProcess.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-childProcess.pid, 'SIGTERM');
  } catch {
    childProcess.kill('SIGTERM');
  }
}

function defaultShadcnProcessRunner(invocation: ShadcnInvocation): Promise<ShadcnExecutionResult> {
  return new Promise((resolveResult, reject) => {
    const childProcess = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      detached: process.platform !== 'win32',
      env: createShadcnEnvironment(),
      shell: false
    });
    const timeout = setTimeout(() => {
      terminateShadcnProcess(childProcess);
      reject(new Error(`shadcn process timed out after ${SHADCN_PROCESS_TIMEOUT_MS}ms`));
    }, SHADCN_PROCESS_TIMEOUT_MS);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;

    childProcess.stdout.on('data', (chunk: Buffer) => {
      try {
        stdoutSize = assertOutputLimit(stdoutSize, chunk.length);
        stdoutChunks.push(chunk);
      } catch (error) {
        terminateShadcnProcess(childProcess);
        reject(error);
      }
    });

    childProcess.stderr.on('data', (chunk: Buffer) => {
      try {
        stderrSize = assertOutputLimit(stderrSize, chunk.length);
        stderrChunks.push(chunk);
      } catch (error) {
        terminateShadcnProcess(childProcess);
        reject(error);
      }
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    childProcess.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolveResult({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      });
    });
  });
}

export function createShadcnInvocation(options: ShadcnInvocationOptions): ShadcnInvocation {
  assertShadcnArgs(options.args);

  return {
    executable: SHADCN_EXECUTABLE,
    args: [SHADCN_BINARY_PATH, ...options.args],
    cwd: options.cwd ?? process.cwd(),
    packageName: SHADCN_PACKAGE_NAME,
    packageVersion: SHADCN_PACKAGE_VERSION
  };
}

export async function executeShadcnInvocation(
  invocation: ShadcnInvocation,
  runner: ShadcnProcessRunner = defaultShadcnProcessRunner
): Promise<ShadcnExecutionResult> {
  return runner(invocation);
}

export const testInternals = {
  createShadcnEnvironment
};
