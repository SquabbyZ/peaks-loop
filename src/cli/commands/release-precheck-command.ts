// src/cli/commands/release-precheck-command.ts
//
// `peaks release precheck` — the 6-layer version precheck. Split out of
// `release-commands.ts`; the verb name, its options, the `--strict` CI-parity
// meaning and both the envelope and the exit code are unchanged.

import type { Command } from 'commander';
import { runAllLayers } from '../../services/release/version-precheck-service.js';
import { ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveReleaseProjectRoot, type ReleaseProjectOptions } from './release-command-shared.js';

type PrecheckOptions = ReleaseProjectOptions & {
  strict?: boolean;
  tagAlreadyPushed?: boolean;
};

function runReleasePrecheck(io: ProgramIO, opts: PrecheckOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const envelope = runAllLayers({
    projectRoot,
    strict: opts.strict === true,
    tagAlreadyPushed: opts.tagAlreadyPushed === true
  });
  process.exitCode = envelope.ok ? 0 : 1;
  const warningLines =
    envelope.overall === 'warning'
      ? ['Warning layers reported but did not block. Re-run with --strict to upgrade.']
      : [];
  printResult(io, ok('release.precheck', envelope, [], warningLines), opts.json ?? false);
}

export function registerReleasePrecheckCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('precheck')
      .description(
        'Run the 6-layer version precheck (rootVsShared / tagCollision / ' +
          'changesetStaged / workspaceLockstep / registryPublished / ' +
          'packageVersionBumped). Unverifiable layers are warnings unless --strict ' +
          'is passed (CI parity mode). Shared with publish.yml gate-cli-version step §(A).'
      )
      .option('--strict', 'treat warnings as blockers (CI parity mode)')
      .option(
        '--tag-already-pushed',
        'the tag under release already exists on the remote (tag-triggered publish), ' +
          'so tagCollision is expected rather than a collision'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: PrecheckOptions) => runReleasePrecheck(io, opts));
}
