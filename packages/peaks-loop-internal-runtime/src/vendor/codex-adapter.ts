import type { VendorAdapter } from './adapter.js';
import type { ChildStatus } from '../types.js';
import { detectBinaryInstalled } from './detect-binary.js';
import { parseProgressLine } from './progress-line.js';

export class CodexAdapter implements VendorAdapter {
  readonly id = 'codex' as const;
  readonly binary = 'codex';
  readonly maxPromptBytes = 5 * 1024;
  headlessArgs(prompt: string): string[] {
    return ['exec', '--json', prompt];
  }
  /** The line format is shared with the other two vendors — see `progress-line.ts`. */
  parseStatusLine(stdout: string): ChildStatus | null {
    return parseProgressLine(stdout, 'codex');
  }
  async detectInstalled(): Promise<boolean> {
    return detectBinaryInstalled(this.binary);
  }
}
