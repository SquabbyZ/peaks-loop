import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VendorAdapter } from './adapter';
import type { ChildStatus } from '../types';

const pExecFile = promisify(execFile);

export class ClaudeAdapter implements VendorAdapter {
  readonly id = 'claude' as const;
  readonly binary = 'claude';
  readonly maxPromptBytes = 8 * 1024;

  headlessArgs(prompt: string, opts?: { autoCompactMarker?: string }): string[] {
    const injected = opts?.autoCompactMarker
      ? `${opts.autoCompactMarker}\n\n${prompt}`
      : prompt;
    return ['-p', injected, '--output-format', 'json', '--include-partial-messages'];
  }

  parseStatusLine(stdout: string): ChildStatus | null {
    try {
      const obj = JSON.parse(stdout);
      if (typeof obj.progress !== 'number') return null;
      return {
        rid: String(obj.rid ?? ''),
        vendor: 'claude',
        progress: obj.progress,
        state: obj.state,
        note: String(obj.note ?? ''),
        ts: Number(obj.ts ?? Date.now()),
      };
    } catch { return null; }
  }

  async detectInstalled(): Promise<boolean> {
    try {
      const { stdout } = await pExecFile(this.binary, ['--version'], { timeout: 3000 });
      return stdout.length > 0;
    } catch { return false; }
  }
}