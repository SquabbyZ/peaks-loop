import type { VendorAdapter } from './adapter.js';
import type { ChildStatus } from '../types.js';
import { detectBinaryInstalled } from './detect-binary.js';
import { parseProgressLine } from './progress-line.js';

export class CopilotAdapter implements VendorAdapter {
  readonly id = 'copilot' as const;
  readonly binary = 'copilot';
  readonly maxPromptBytes = 6 * 1024;
  headlessArgs(prompt: string): string[] {
    return ['-p', prompt, '--output-format', 'json'];
  }
  /** The line format is shared with the other two vendors — see `progress-line.ts`. */
  parseStatusLine(stdout: string): ChildStatus | null {
    return parseProgressLine(stdout, 'copilot');
  }
  async detectInstalled(): Promise<boolean> {
    return detectBinaryInstalled(this.binary);
  }
}
