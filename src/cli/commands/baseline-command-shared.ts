// src/cli/commands/baseline-command-shared.ts
//
// What every `peaks baseline *` verb shares: its two envelope writers, the
// on-disk layout helpers, the guard context and the `--scorer` vocabulary.
// Split out of `baseline-commands.ts`; every path, envelope field and exit
// code is unchanged.

import { join } from 'node:path';
import type { ProgramIO } from '../cli-helpers.js';
import type { GuardContext } from '../../services/capability-guard-runner/types.js';

/** The `--project` / `--json` pair every verb in this family declares. */
export type BaselineOptions = {
  project?: string;
  json?: boolean;
};

export function fail(
  io: ProgramIO,
  code: string,
  message: string,
  data: Record<string, unknown> = {}
): void {
  io.stdout(
    JSON.stringify({
      ok: false,
      command: `baseline`,
      code,
      message,
      data,
      warnings: [],
      nextActions: []
    })
  );
  process.exitCode = 1;
}

export function ok(
  io: ProgramIO,
  command: string,
  data: Record<string, unknown>,
  nextActions: ReadonlyArray<string> = []
): void {
  io.stdout(JSON.stringify({ ok: true, command, data, warnings: [], nextActions }));
}

export const CURRENT_DIR = (root: string): string => join(root, 'openspec', 'baselines', 'current');
export const HISTORY_DIR = (root: string, version: string): string =>
  join(root, 'openspec', 'baselines', 'history', version);

/** Whitelist of supported `--scorer` values for `peaks baseline audit`. */
export const SCORER_MODES = ['live', 'stub'] as const;
export type ScorerMode = (typeof SCORER_MODES)[number];
/**
 * `live` is the default because it is the credential-free one. Defaulting to
 * `stub` would leave the publish gate permanently inconclusive; defaulting to a
 * scorer that needs a key would leave it unrunnable in CI.
 */
export const DEFAULT_SCORER_MODE: ScorerMode = 'live';

export function isScorerMode(v: string | undefined): v is ScorerMode {
  return v !== undefined && (SCORER_MODES as ReadonlyArray<string>).includes(v);
}

/** The guard `run-guard` / `audit` execute against. */
export function guardContext(projectRoot: string): GuardContext {
  return { projectRoot, sessionId: 'cli', contract: {} as never, baselineInvariant: 'auto' };
}
