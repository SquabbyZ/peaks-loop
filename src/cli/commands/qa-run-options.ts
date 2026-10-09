// src/cli/commands/qa-run-options.ts
//
// The `peaks qa run` flag contract, parsed in isolation from the action handler
// so unit tests can assert it without a project on disk. Extracted from
// `qa-commands.ts`; every default and every reading is unchanged.

import { DEFAULT_MAX_BROWSER_RESTARTS } from './qa-run-slice.js';

export type QaRunOptions = {
  project: string;
  // Commander 12.x sets these for `--no-X` (positive form), not `noX = true`.
  browser?: boolean;
  restartDetector?: boolean;
  maxBrowserRestarts?: string;
  sessionId?: string;
  json?: boolean;
  // Plan 2 / Task 8 — MUT.sig gate.
  mutation?: boolean;
};

function resolveMaxRestarts(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_BROWSER_RESTARTS;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) {
    return DEFAULT_MAX_BROWSER_RESTARTS;
  }
  return n;
}

/**
 * Commander 12.x sets `options.X = false` for `--no-X` (POSITIVE form),
 * not `options.noX = true`. Reads use the positive form; the default is
 * `true` and the boolean form is `false` only when the user passes `--no-X`.
 *
 * Exported for unit testing the parser contract in isolation from
 * the rest of the action handler.
 */
export function readQaRunOptions(options: QaRunOptions): {
  readonly browserEnabled: boolean;
  readonly detectorEnabled: boolean;
  readonly maxRestarts: number;
  readonly mutationEnabled: boolean;
} {
  return {
    browserEnabled: options.browser !== false,
    detectorEnabled: options.restartDetector !== false,
    maxRestarts: resolveMaxRestarts(options.maxBrowserRestarts),
    mutationEnabled: options.mutation !== false
  };
}
