import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpClientTransport } from './mcp-client-service.js';

export type StdioTransportOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
};

export function createStdioTransport(options: StdioTransportOptions): McpClientTransport {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...(options.env ?? {}) })) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  const child: ChildProcessWithoutNullStreams = spawn(options.command, options.args ?? [], {
    env,
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let lineHandler: ((line: string) => void) | null = null;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (lineHandler !== null) {
      lineHandler(chunk);
    }
  });

  return {
    send: (line) =>
      new Promise<void>((resolve, reject) => {
        child.stdin.write(line, (error) => {
          if (error !== null && error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    onLine: (handler) => {
      lineHandler = handler;
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill();
      })
  };
}
