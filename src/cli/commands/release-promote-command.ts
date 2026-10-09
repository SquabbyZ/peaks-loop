// src/cli/commands/release-promote-command.ts
//
// `peaks release promote` — promote the canary to 100% and start the watch
// window. Split out of `release-commands.ts`; the verb name, its options, the
// `canary-50` precondition and the envelope shape are unchanged.

import type { Command } from 'commander';
import {
  readReleaseState,
  transitionRelease,
  writeReleaseState
} from '../../services/release/release-state.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveReleaseProjectRoot, type ReleaseProjectOptions } from './release-command-shared.js';

type PromoteOptions = ReleaseProjectOptions & { note?: string };

function runReleasePromote(io: ProgramIO, opts: PromoteOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const state = readReleaseState(projectRoot);
  const result = transitionRelease(state, 'promoted', opts.note);
  if ('error' in result) {
    printResult(
      io,
      fail('release.promote', 'INVALID_TRANSITION', result.error, { projectRoot }, []),
      opts.json ?? false
    );
    return;
  }
  writeReleaseState(projectRoot, result.state);
  printResult(
    io,
    ok(
      'release.promote',
      {
        projectRoot,
        currentStage: 'promoted',
        promotedAt: result.state.active?.promotedAt
      },
      [],
      [
        'Watch window started. Run `peaks release watch` to check progress; `peaks release rollback` for emergency.'
      ]
    ),
    opts.json ?? false
  );
}

export function registerReleasePromoteCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('promote')
      .description(
        'Promote the canary to 100% (full release). Requires stage=canary-50. ' +
          'Records the promoted-at timestamp and starts the 24h watch window.'
      )
      .option('--note <text>', 'optional note')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: PromoteOptions) => runReleasePromote(io, opts));
}
