// src/cli/commands/release-plan-command.ts
//
// `peaks release plan <version>` — start a new release. Split out of
// `release-commands.ts`; the verb name, its options and the envelope shape are
// unchanged.

import type { Command } from 'commander';
import {
  planRelease,
  readReleaseState,
  writeReleaseState
} from '../../services/release/release-state.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveReleaseProjectRoot, type ReleaseProjectOptions } from './release-command-shared.js';

function runReleasePlan(io: ProgramIO, version: string, opts: ReleaseProjectOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const state = readReleaseState(projectRoot);
  const result = planRelease(state, version);
  if ('error' in result) {
    printResult(
      io,
      fail('release.plan', 'CONFLICT', result.error, { projectRoot }, [
        'Run `peaks release rollback` or `peaks release hotfix` to clear the active release.'
      ]),
      opts.json ?? false
    );
    return;
  }
  writeReleaseState(projectRoot, result.state);
  printResult(
    io,
    ok(
      'release.plan',
      {
        projectRoot,
        version: result.record.version,
        currentStage: result.record.currentStage
      },
      [],
      ['Run `peaks release canary --percent 10` to begin the canary phase.']
    ),
    opts.json ?? false
  );
}

export function registerReleasePlanCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('plan <version>')
      .description(
        'Start a new release. Stores the version in the canary pipeline state. ' +
          'Fails when there is already an active release in any non-terminal stage.'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((version: string, opts: ReleaseProjectOptions) => runReleasePlan(io, version, opts));
}
