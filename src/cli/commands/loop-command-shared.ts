// src/cli/commands/loop-command-shared.ts
//
// What the `peaks loop` verbs share: the option types, the `--project` /
// `--json` chain `export` and `import` both declare, and the project-root
// resolution. Split out of `loop-commands.ts` so the bundle verbs can live in
// their own modules without repeating the same eight-line construction.

import type { Command } from 'commander';

import { findProjectRoot } from '../../services/config/config-safety.js';

export type GoalComposeOptions = {
  project: string;
  goal: string;
  json?: boolean;
};

export type LoopDistillOptions = {
  project: string;
  apply: boolean;
  json?: boolean;
};

export type LoopPlaceholderOptions = {
  project: string;
  json?: boolean;
};

export type LoopExportOptions = {
  loop: string;
  out: string;
  project?: string;
  json?: boolean;
};

export type LoopImportOptions = {
  in: string;
  as?: string;
  project?: string;
  json?: boolean;
};

/** `--project`, else the nearest project root above cwd, else cwd. */
export function resolveLoopProjectRoot(project: string | undefined): string {
  return project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

/** `--project` + `--json`, the option chain `loop export` and `loop import` share. */
export const LOOP_EXPORT_IMPORT_OPTS = (cmd: Command): Command =>
  cmd
    .option('--project <path>', 'target project root (defaults to cwd)')
    .option('--json', 'print machine-readable JSON envelope');
