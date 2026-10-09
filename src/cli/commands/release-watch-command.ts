// src/cli/commands/release-watch-command.ts
//
// `peaks release watch` — the watch-window status of the promoted release.
// Split out of `release-commands.ts`; the verb name, its options, the rounded
// `percentComplete` on the envelope and the `readyForDone` next-action rule are
// unchanged.

import type { Command } from 'commander';
import { readReleaseState, watchWindow } from '../../services/release/release-state.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveReleaseProjectRoot, type ReleaseProjectOptions } from './release-command-shared.js';

function runReleaseWatch(io: ProgramIO, opts: ReleaseProjectOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const state = readReleaseState(projectRoot);
  if (state.active === null) {
    printResult(
      io,
      fail('release.watch', 'NO_ACTIVE', 'no active release to watch', { projectRoot }, [
        'Run `peaks release plan <version>` to start one.'
      ]),
      opts.json ?? false
    );
    return;
  }
  const win = watchWindow(state.active);
  const readyForDone = win.percentComplete >= 1.0;
  printResult(
    io,
    ok(
      'release.watch',
      {
        projectRoot,
        version: state.active.version,
        currentStage: state.active.currentStage,
        window: {
          elapsedMs: win.elapsedMs,
          remainingMs: win.remainingMs,
          windowMs: win.windowMs,
          percentComplete: Math.round(win.percentComplete * 100) / 100
        },
        readyForDone
      },
      readyForDone
        ? ['Watch window complete. Run `peaks release done` to mark the release done.']
        : []
    ),
    opts.json ?? false
  );
}

export function registerReleaseWatchCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('watch')
      .description(
        'Show the watch window status for the current promoted release. ' +
          '24h window from promoted-at. After the window, run `peaks release done` ' +
          'to mark the release complete.'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: ReleaseProjectOptions) => runReleaseWatch(io, opts));
}
