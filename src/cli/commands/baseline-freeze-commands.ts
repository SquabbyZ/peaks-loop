// src/cli/commands/baseline-freeze-commands.ts
//
// `peaks baseline freeze` and `peaks baseline freeze-update` — install a
// baseline JSON file and snapshot the previous version into history. Split out
// of `baseline-commands.ts`; every envelope code, message, data field and
// next-action string is unchanged.

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import {
  historySnapshot,
  readBaselineFile,
  writeBaselineFile
} from '../../services/capability-baseline/store.js';
import { validateBaselineFile } from '../../services/capability-baseline/validator.js';
import type { CapabilityBaselineFile } from '../../services/capability-baseline/types.js';
import type { ProgramIO } from '../cli-helpers.js';
import { fail, ok, type BaselineOptions } from './baseline-command-shared.js';

/**
 * Parse, validate, install and snapshot one baseline file. Returns where it
 * landed and its version on success; prints the matching refusal and returns
 * null otherwise.
 */
function installBaseline(
  io: ProgramIO,
  projectRoot: string,
  from: string
): { path: string; lockPath: string; version: string } | null {
  const file = JSON.parse(readFileSync(from, 'utf8')) as CapabilityBaselineFile;
  const v = validateBaselineFile(file);
  if (!v.ok) {
    fail(io, v.error.code, v.error.message);
    return null;
  }
  const out = writeBaselineFile({ projectRoot, file });
  historySnapshot({ projectRoot, version: file.version });
  return { path: out.path, lockPath: out.lockPath, version: file.version };
}

function runFreeze(io: ProgramIO, opts: { from?: string; project?: string }): void {
  const projectRoot = opts.project ?? '.';
  if (!opts.from) {
    fail(io, 'MISSING_ARG', '--from is required');
    return;
  }
  const out = installBaseline(io, projectRoot, opts.from);
  if (out === null) return;
  ok(io, 'baseline.freeze', { path: out.path, lockPath: out.lockPath, version: out.version });
}

function runFreezeUpdate(
  io: ProgramIO,
  opts: BaselineOptions & { from?: string; confirm?: boolean }
): void {
  const projectRoot = opts.project ?? '.';
  if (opts.confirm !== true) {
    fail(
      io,
      'HUMAN_NL_DECISION_REQUIRED',
      'freeze-update requires the user to approve the ratchet change via AskUserQuestion. The LLM must surface a multi-choice prompt, then re-run with --confirm.'
    );
    return;
  }
  if (!opts.from) {
    fail(io, 'MISSING_ARG', '--from is required');
    return;
  }
  const r = readBaselineFile(projectRoot);
  if (!r.ok) {
    fail(io, r.error.code, r.error.message);
    return;
  }
  const out = installBaseline(io, projectRoot, opts.from);
  if (out === null) return;
  ok(io, 'baseline.freeze-update', {
    path: out.path,
    lockPath: out.lockPath,
    fromVersion: r.file.version,
    version: out.version
  });
}

export function registerBaselineFreezeCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('freeze')
    .description('Freeze the capability baseline from a JSON file (SquabbyZ-signed).')
    .option('--from <path>', 'Path to the baseline JSON input.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { from?: string; project?: string }) => runFreeze(io, opts));
}

export function registerBaselineFreezeUpdateCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('freeze-update')
    .description(
      "Update one or more baseline rows. The LLM authors the JSON; --confirm records the user's approval."
    )
    .option('--from <path>', 'Path to the new baseline JSON input')
    .option(
      '--confirm',
      "Record the user's approval (collected via AskUserQuestion) for this ratchet change"
    )
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { from?: string; confirm?: boolean; project?: string }) =>
      runFreezeUpdate(io, opts)
    );
}
