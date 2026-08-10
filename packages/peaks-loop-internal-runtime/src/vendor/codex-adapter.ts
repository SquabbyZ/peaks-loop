import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VendorAdapter } from './adapter.js';
import type { ChildStatus } from '../types.js';
const pExecFile = promisify(execFile);

export class CodexAdapter implements VendorAdapter {
  readonly id = 'codex' as const;
  readonly binary = 'codex';
  readonly maxPromptBytes = 5 * 1024;
  headlessArgs(prompt: string): string[] {
    return ['exec', '--json', prompt];
  }
  parseStatusLine(stdout: string): ChildStatus | null {
    try {
      const o = JSON.parse(stdout);
      if (typeof o.progress !== 'number') return null;
      return { rid: String(o.rid ?? ''), vendor: 'codex', progress: o.progress, state: o.state, note: String(o.note ?? ''), ts: Number(o.ts ?? Date.now()) };
    } catch { return null; }
  }
  async detectInstalled(): Promise<boolean> {
    try { const { stdout } = await pExecFile(this.binary, ['--version'], { timeout: 3000 }); return stdout.length > 0; }
    catch { return false; }
  }
}