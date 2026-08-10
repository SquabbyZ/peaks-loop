import type { ChildStatus } from '../types';

export interface VendorAdapter {
  readonly id: 'claude' | 'codex' | 'copilot';
  readonly binary: string;
  readonly maxPromptBytes: number;
  headlessArgs(prompt: string, opts?: { autoCompactMarker?: string }): string[];
  parseStatusLine(stdout: string): ChildStatus | null;
  detectInstalled(): Promise<boolean>;
}