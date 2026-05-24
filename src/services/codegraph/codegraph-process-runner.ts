import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { CodegraphExecutionResult, CodegraphInvocation } from './codegraph-service.js';

const CODEGRAPH_PROCESS_TIMEOUT_MS = 600_000;
const CODEGRAPH_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;

function createCodegraphEnvironment(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const preservedKeys = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR'] as const;
  const environment: NodeJS.ProcessEnv = {};

  for (const key of preservedKeys) {
    const value = sourceEnv[key];

    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

function assertOutputLimit(currentSize: number, chunkSize: number): number {
  const nextSize = currentSize + chunkSize;

  if (nextSize > CODEGRAPH_OUTPUT_LIMIT_BYTES) {
    throw new Error(`codegraph output exceeded ${CODEGRAPH_OUTPUT_LIMIT_BYTES} bytes`);
  }

  return nextSize;
}

function terminateCodegraphProcess(childProcess: ChildProcess): void {
  if (childProcess.pid === undefined) {
    childProcess.kill();
    return;
  }

  if (process.platform === 'win32') {
    if (process.env.SystemRoot) {
      spawn(join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/pid', String(childProcess.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
    } else {
      childProcess.kill();
    }
    return;
  }

  try {
    process.kill(-childProcess.pid, 'SIGTERM');
  } catch {
    childProcess.kill('SIGTERM');
  }
}

export function defaultCodegraphProcessRunner(invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> {
  return new Promise((resolveResult, reject) => {
    const childProcess = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      detached: process.platform !== 'win32',
      env: createCodegraphEnvironment(),
      shell: false
    });
    const timeout = setTimeout(() => {
      terminateCodegraphProcess(childProcess);
      reject(new Error(`codegraph process timed out after ${CODEGRAPH_PROCESS_TIMEOUT_MS}ms`));
    }, CODEGRAPH_PROCESS_TIMEOUT_MS);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;

    childProcess.stdout.on('data', (chunk: Buffer) => {
      try {
        stdoutSize = assertOutputLimit(stdoutSize, chunk.length);
        stdoutChunks.push(chunk);
      } catch (error) {
        terminateCodegraphProcess(childProcess);
        reject(error);
      }
    });

    childProcess.stderr.on('data', (chunk: Buffer) => {
      try {
        stderrSize = assertOutputLimit(stderrSize, chunk.length);
        stderrChunks.push(chunk);
      } catch (error) {
        terminateCodegraphProcess(childProcess);
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
