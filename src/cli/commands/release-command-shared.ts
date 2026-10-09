// src/cli/commands/release-command-shared.ts
//
// What every `peaks release *` verb shares: the project-root resolution and the
// two canary percents, named so the state machine's vocabulary is not spelled
// out as literals in each verb. Split out of `release-commands.ts`; the values
// and the resolution order are unchanged.

import { findProjectRoot } from '../../services/config/config-safety.js';
import type { ReleaseStage } from '../../services/release/release-state.js';

/** The two canary stages the CLI supports, as the `--percent` values that select them. */
export const CANARY_PERCENT_FIRST = 10;
export const CANARY_PERCENT_SECOND = 50;

export type CanaryPercent = typeof CANARY_PERCENT_FIRST | typeof CANARY_PERCENT_SECOND;

export const CANARY_PERCENTS: Readonly<Record<CanaryPercent, ReleaseStage>> = {
  [CANARY_PERCENT_FIRST]: 'canary-10',
  [CANARY_PERCENT_SECOND]: 'canary-50'
};

/** `--project <path>`, else the nearest project root, else cwd — unchanged order. */
export function resolveReleaseProjectRoot(project: string | undefined): string {
  return project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

/** `--project` + `--json`, the two options every verb in this family declares. */
export type ReleaseProjectOptions = {
  project?: string;
  json?: boolean;
};
