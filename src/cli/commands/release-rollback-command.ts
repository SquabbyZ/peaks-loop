// src/cli/commands/release-rollback-command.ts
//
// `peaks release rollback` — emergency rollback of the active release. Split
// out of `release-commands.ts`; the verb name, its options and the envelope
// shape are unchanged.

import type { Command } from 'commander';
import {
  readReleaseState,
  rollbackRelease,
  writeReleaseState
} from '../../services/release/release-state.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveReleaseProjectRoot, type ReleaseProjectOptions } from './release-command-shared.js';

type RollbackOptions = ReleaseProjectOptions & { note?: string };

function runReleaseRollback(io: ProgramIO, opts: RollbackOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const state = readReleaseState(projectRoot);
  const result = rollbackRelease(state, opts.note);
  if ('error' in result) {
    printResult(
      io,
      fail('release.rollback', 'INVALID_TRANSITION', result.error, { projectRoot }, []),
      opts.json ?? false
    );
    return;
  }
  writeReleaseState(projectRoot, result.state);
  printResult(
    io,
    ok(
      'release.rollback',
      {
        projectRoot,
        rolledBack: result.record.version,
        finalStage: result.record.currentStage
      },
      [],
      ['Run `peaks release hotfix <version>` to start a hotfix on the previous release.']
    ),
    opts.json ?? false
  );
}

export function registerReleaseRollbackCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('rollback')
      .description(
        'Emergency rollback of the active release. Moves the active release to ' +
          'the history with currentStage=rolled-back. Available from any ' +
          'pre-done stage.'
      )
      .option('--note <text>', 'optional rollback reason')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: RollbackOptions) => runReleaseRollback(io, opts));
}
