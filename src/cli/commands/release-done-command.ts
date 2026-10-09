// src/cli/commands/release-done-command.ts
//
// `peaks release done` — close the active release once the watch window is
// complete. Split out of `release-commands.ts`; the verb name, its options, the
// "no stage guard, the window is the precondition" ruling and the envelope
// shape are unchanged.

import type { Command } from 'commander';
import {
  readReleaseState,
  transitionRelease,
  watchWindow,
  writeReleaseState,
  type ReleaseState
} from '../../services/release/release-state.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveReleaseProjectRoot, type ReleaseProjectOptions } from './release-command-shared.js';

function noActiveRelease(projectRoot: string): ReturnType<typeof fail> {
  return fail('release.done', 'NO_ACTIVE', 'no active release', { projectRoot }, []);
}

function watchIncomplete(projectRoot: string, percentComplete: number): ReturnType<typeof fail> {
  return fail(
    'release.done',
    'WATCH_INCOMPLETE',
    `watch window not yet complete (${Math.round(percentComplete * 100)}% elapsed)`,
    { projectRoot },
    []
  );
}

function doneTransitionFailed(projectRoot: string, error: string): ReturnType<typeof fail> {
  return fail('release.done', 'INVALID_TRANSITION', error, { projectRoot }, []);
}

function runReleaseDone(io: ProgramIO, opts: ReleaseProjectOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const state = readReleaseState(projectRoot);
  if (state.active === null) {
    printResult(io, noActiveRelease(projectRoot), opts.json ?? false);
    return;
  }
  // No stage guard here: `watching` is unreachable (nothing ever calls
  // transitionRelease(state, 'watching')), so the real precondition is the
  // watch window itself — the same thing this command's description
  // documents ("Requires the watch window to be complete"). The stage
  // table (`promoted → watching → done`) stays as the declared design, but
  // `promoted` may now reach `done` directly.
  const win = watchWindow(state.active);
  if (win.percentComplete < 1.0) {
    printResult(io, watchIncomplete(projectRoot, win.percentComplete), opts.json ?? false);
    return;
  }
  const result = transitionRelease(state, 'done');
  if ('error' in result) {
    printResult(io, doneTransitionFailed(projectRoot, result.error), opts.json ?? false);
    return;
  }
  // Move to history. `transitionRelease` never clears `active`; the fallback
  // is what keeps this read type-safe without asserting non-nullness.
  const finalRecord = result.state.active ?? state.active;
  const newState: ReleaseState = {
    version: 1,
    active: null,
    history: [...result.state.history, finalRecord]
  };
  writeReleaseState(projectRoot, newState);
  printResult(
    io,
    ok(
      'release.done',
      {
        projectRoot,
        version: finalRecord.version,
        doneAt: finalRecord.doneAt
      },
      [],
      []
    ),
    opts.json ?? false
  );
}

export function registerReleaseDoneCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('done')
      .description(
        'Mark the active release as done. Requires the watch window to be ' +
          'complete (24h after promoted-at).'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: ReleaseProjectOptions) => runReleaseDone(io, opts));
}
