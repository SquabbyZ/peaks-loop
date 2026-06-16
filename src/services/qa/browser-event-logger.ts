/**
 * Slice 2026-06-16-playwright-restart-loop — G4.
 *
 * BrowserEventLogger
 *
 * Append-only JSONL writer for browser-event records. Each line is
 * a self-contained JSON object, so a crash mid-write leaves a
 * partial line that downstream readers skip.
 *
 * The log path is supplied by the caller (CLI / sub-agent progress
 * signal). For QA slices the convention is:
 *   `.peaks/_runtime/<session-id>/qa/browser-events.jsonl`
 *
 * The logger is fire-and-forget for the production write path:
 * a failed append prints a stderr hint and continues, never throws.
 * The test suite asserts the on-disk format.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type SpuriousRestartEvent = {
  readonly kind: 'spurious_restart';
  readonly ts: string;
  readonly sessionId: string;
  readonly closeTs: string;
  readonly navigateTs: string;
  readonly deltaMs: number;
};

export type BrowserEventRecord = SpuriousRestartEvent;

export type BrowserEventLoggerOptions = {
  /** Absolute file path. The logger creates the parent dir if missing. */
  readonly filePath: string;
};

export class BrowserEventLogger {
  private readonly filePath: string;

  constructor(options: BrowserEventLoggerOptions) {
    this.filePath = options.filePath;
  }

  /**
   * Append one record to the JSONL file. Never throws on write
   * failure (matches the log-commands fire-and-forget pattern; the
   * detector's halt is the user-facing signal, not the log line).
   */
  append(record: BrowserEventRecord): void {
    const dir = dirname(this.filePath);
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    } catch {
      return;
    }
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      return;
    }
    try {
      appendFileSync(this.filePath, line + '\n');
    } catch {
      /* best-effort; never block the CLI on a log write */
    }
  }
}
