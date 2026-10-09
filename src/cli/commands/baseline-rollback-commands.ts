// src/cli/commands/baseline-rollback-commands.ts
//
// `peaks baseline rollback` and `peaks baseline reset` — the two destructive
// baseline operations, both gated behind `--confirm`. Split out of
// `baseline-commands.ts`; every refusal code, message and data field is
// unchanged.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { readBaselineFile } from '../../services/capability-baseline/store.js';
import type { ProgramIO } from '../cli-helpers.js';
import {
  CURRENT_DIR,
  fail,
  HISTORY_DIR,
  ok,
  type BaselineOptions
} from './baseline-command-shared.js';

function runRollback(
  io: ProgramIO,
  opts: BaselineOptions & { to?: string; confirm?: boolean }
): void {
  const projectRoot = opts.project ?? '.';
  if (opts.confirm !== true) {
    fail(
      io,
      'HUMAN_NL_DECISION_REQUIRED',
      'rollback requires the user to approve via AskUserQuestion. The LLM must surface a multi-choice prompt, then re-run with --confirm.'
    );
    return;
  }
  if (!opts.to) {
    fail(io, 'MISSING_ARG', '--to is required');
    return;
  }
  const source = HISTORY_DIR(projectRoot, opts.to);
  const from = join(source, 'capability-baseline.json');
  const fromLock = join(source, 'capability-baseline.lock');
  if (!existsSync(from) || !existsSync(fromLock)) {
    fail(io, 'BASELINE_HISTORY_GAP', `no frozen baseline recorded for version ${opts.to}`);
    return;
  }
  const r = readBaselineFile(projectRoot);
  if (!r.ok) {
    fail(io, r.error.code, r.error.message);
    return;
  }
  mkdirSync(CURRENT_DIR(projectRoot), { recursive: true });
  copyFileSync(from, join(CURRENT_DIR(projectRoot), 'capability-baseline.json'));
  copyFileSync(fromLock, join(CURRENT_DIR(projectRoot), 'capability-baseline.lock'));
  // Re-read through the locked store so a tampered history entry cannot be
  // installed: the copy is only reported successful if it verifies.
  const after = readBaselineFile(projectRoot);
  if (!after.ok) {
    fail(io, after.error.code, after.error.message);
    return;
  }
  ok(io, 'baseline.rollback', {
    fromVersion: r.file.version,
    toVersion: after.file.version,
    historyPath: source
  });
}

function runReset(io: ProgramIO, opts: BaselineOptions & { confirm?: boolean }): void {
  const projectRoot = opts.project ?? '.';
  if (opts.confirm !== true) {
    fail(
      io,
      'HUMAN_NL_DECISION_REQUIRED',
      'reset requires the user to approve via AskUserQuestion. The LLM must surface a multi-choice prompt, then re-run with --confirm.'
    );
    return;
  }
  const r = readBaselineFile(projectRoot);
  // A missing baseline is already "wiped" — but an unreadable one (hash
  // mismatch / unsigned lock) must not be silently discarded.
  if (!r.ok && r.error.code !== 'BASELINE_NOT_FOUND') {
    fail(io, r.error.code, r.error.message);
    return;
  }
  const wipedVersion = r.ok ? r.file.version : null;
  rmSync(join(CURRENT_DIR(projectRoot), 'capability-baseline.json'), { force: true });
  rmSync(join(CURRENT_DIR(projectRoot), 'capability-baseline.lock'), { force: true });
  ok(io, 'baseline.reset', {
    wipedVersion,
    nextAction: 're-freeze with `baseline freeze --from <path>`'
  });
}

export function registerBaselineRollbackCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('rollback')
    .description(
      "Roll the baseline back to a historical version. --confirm records the user's approval."
    )
    .option('--to <version>', 'Historical version to roll back to')
    .option(
      '--confirm',
      "Record the user's approval (collected via AskUserQuestion) for this rollback"
    )
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { to?: string; confirm?: boolean; project?: string }) => runRollback(io, opts));
}

export function registerBaselineResetCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('reset')
    .description(
      "Wipe the current baseline and require a re-freeze. --confirm records the user's approval."
    )
    .option('--confirm', "Record the user's approval (collected via AskUserQuestion) for the wipe")
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { confirm?: boolean; project?: string }) => runReset(io, opts));
}
