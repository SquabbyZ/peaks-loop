/**
 * rid-011 — peaks changeset check (Phase 4 slice 2).
 *
 *   - `peaks changeset check` — hard gate, exit non-zero if any staged
 *     .changeset/*.md exists. No warning mode, no --strict, no
 *     --skip-changeset-check.
 *
 * Wired into `_register.ts` via the rid-007 auto-registration barrel;
 * do NOT add a second registration call in `program.ts`.
 */

import type { Command } from 'commander';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { runChangesetHardGate } from '../../services/changeset/changeset-check-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerChangesetCommands(program: Command, io: ProgramIO): void {
  const changeset = program
    .command('changeset')
    .description('rid-011 — changeset hard gate (no warning mode, no skip).');

  addJsonOption(
    changeset
      .command('check')
      .description(
        'Hard-gate check: exit non-zero if any .changeset/*.md file is staged ' +
          '(excluding README.md). Mirrors publish.yml gate-changeset step.'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const gate = runChangesetHardGate(projectRoot);
    if (gate.ok) {
      printResult(io, ok('changeset.check', {
        root: gate.root,
        state: gate.state,
        stagedFiles: gate.stagedFiles,
        snapshotAt: gate.snapshotAt
      }, [], []), opts.json ?? false);
      return;
    }
    process.exitCode = 1;
    printResult(io, fail(
      'changeset.check',
      'CHANGESET_BLOCKED',
      `${gate.stagedFiles.length} staged .changeset/*.md file(s) — refusing to proceed`,
      {
        root: gate.root,
        state: gate.state,
        stagedFiles: gate.stagedFiles,
        snapshotAt: gate.snapshotAt
      },
      [
        `Drain pending changesets before proceeding: drain `.concat(
          gate.stagedFiles.join(', '),
          ' via the coordinating LLM (e.g. `pnpm changeset version` or `peaks changeset publish` if installed).'
        ),
        'Then re-run `peaks changeset check` to confirm a clean state.'
      ]
    ), opts.json ?? false);
  });
}