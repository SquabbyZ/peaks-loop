import type { VendorAdapter } from './adapter.js';
import type { ChildStatus } from '../types.js';
import { detectBinaryInstalled } from './detect-binary.js';
import { parseProgressLine } from './progress-line.js';

export class ClaudeAdapter implements VendorAdapter {
  readonly id = 'claude' as const;
  readonly binary = 'claude';
  readonly maxPromptBytes = 8 * 1024;

  headlessArgs(prompt: string, opts?: { autoCompactMarker?: string }): string[] {
    const injected = opts?.autoCompactMarker ? `${opts.autoCompactMarker}\n\n${prompt}` : prompt;
    return ['-p', injected, '--output-format', 'json', '--include-partial-messages'];
  }

  /** The line format is shared with the other two vendors — see `progress-line.ts`. */
  parseStatusLine(stdout: string): ChildStatus | null {
    return parseProgressLine(stdout, 'claude');
  }

  async detectInstalled(): Promise<boolean> {
    return detectBinaryInstalled(this.binary);
  }
}
