import type { VendorAdapter } from './adapter.js';
import type { ChildStatus } from '../types.js';
import { detectBinaryInstalled } from './detect-binary.js';

export class CopilotAdapter implements VendorAdapter {
  readonly id = 'copilot' as const;
  readonly binary = 'copilot';
  readonly maxPromptBytes = 6 * 1024;
  headlessArgs(prompt: string): string[] { return ['-p', prompt, '--output-format', 'json']; }
  parseStatusLine(stdout: string): ChildStatus | null {
    try {
      const o = JSON.parse(stdout);
      if (typeof o.progress !== 'number') return null;
      return { rid: String(o.rid ?? ''), vendor: 'copilot', progress: o.progress, state: o.state, note: String(o.note ?? ''), ts: Number(o.ts ?? Date.now()) };
    } catch { return null; }
  }
  async detectInstalled(): Promise<boolean> {
    return detectBinaryInstalled(this.binary);
  }
}