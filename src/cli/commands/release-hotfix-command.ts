// src/cli/commands/release-hotfix-command.ts
//
// `peaks release hotfix <version>` — start a hotfix, forcing any active release
// back. Split out of `release-commands.ts`; the verb name, its options, the
// changeset gate and the envelope shape are unchanged.

import type { Command } from 'commander';
import {
  hotfixRelease,
  readReleaseState,
  writeReleaseState
} from '../../services/release/release-state.js';
import { runChangesetHardGate } from '../../services/changeset/changeset-check-service.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveReleaseProjectRoot, type ReleaseProjectOptions } from './release-command-shared.js';

type HotfixOptions = ReleaseProjectOptions & { note?: string };

/** The refusal a staged changeset triggers before a hotfix may start. */
function changesetBlockedOutcome(
  gate: ReturnType<typeof runChangesetHardGate>,
  projectRoot: string
): ReturnType<typeof fail> {
  return fail(
    'release.hotfix',
    'CHANGESET_BLOCKED',
    `${gate.stagedFiles.length} staged .changeset/*.md file(s) — refusing to start hotfix`,
    {
      projectRoot,
      stagedFiles: [...gate.stagedFiles],
      snapshotAt: gate.snapshotAt
    },
    [
      `Drain pending changesets (coordinating LLM: drain via the standard changeset consumption path), then re-run \`peaks changeset check --project ${projectRoot}\` to confirm clean state.`
    ]
  );
}

function runReleaseHotfix(io: ProgramIO, version: string, opts: HotfixOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const gate = runChangesetHardGate(projectRoot);
  if (gate.state === 'staged-present') {
    process.exitCode = 1;
    printResult(io, changesetBlockedOutcome(gate, projectRoot), opts.json ?? false);
    return;
  }
  const state = readReleaseState(projectRoot);
  const result = hotfixRelease(state, version, opts.note);
  if ('error' in result) {
    printResult(
      io,
      fail('release.hotfix', 'HOTFIX_FAILED', result.error, { projectRoot }, []),
      opts.json ?? false
    );
    return;
  }
  writeReleaseState(projectRoot, result.state);
  printResult(
    io,
    ok(
      'release.hotfix',
      {
        projectRoot,
        version: result.record.version,
        currentStage: result.record.currentStage
      },
      [],
      ['Hotfix started at canary-10. Run `peaks release canary --percent 50` to advance.']
    ),
    opts.json ?? false
  );
}

export function registerReleaseHotfixCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('hotfix <version>')
      .description(
        'Start a hotfix release. Forces a rollback of any active release, ' +
          'skips the `planned` stage, and starts the new release at canary-10. ' +
          'Use this for紧急修复 — minimal ceremony, no full prd ceremony.'
      )
      .option('--note <text>', 'optional hotfix note')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((version: string, opts: HotfixOptions) => runReleaseHotfix(io, version, opts));
}
