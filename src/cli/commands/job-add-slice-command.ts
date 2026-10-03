/**
 * rid 2026-10-03-job-ledger-truthfulness (D1) — `peaks job add-slice`.
 *
 * THE DEFECT. A job's slice list was decided once, at
 * `peaks job init --slice-list <one id>`, and no subcommand could add to it. The
 * subcommand set was `init / status / rotate-now / subagent-cleanup / checkpoint /
 * block / continue / resume / progress / handoff / karpathy-cost-check`. Measured
 * against the committed build on 2026-10-03:
 *
 *   peaks job add-slice …                          → error: unknown command 'add-slice'
 *   peaks job checkpoint --slice-id <new slice>    → ok:false  code:SLICE_NOT_FOUND
 *   peaks job progress --job-id 2026-10-02-c-wave9 → { done: 1, total: 1 }  (stuck)
 *
 * so a wave that plans its next slice only after the previous one lands — which is
 * how every split wave here runs — had no truthful way to record what it did. It
 * either under-reported or opened a new job per slice, and the ledger then recorded
 * the tooling's limitation instead of the work.
 *
 * WHY THIS IS ITS OWN FILE. `src/cli/commands/job-commands.ts` sits over the
 * 300-line cap the gate already ratchets (828 raw lines, and the repository's
 * `fileSizeExcessLines` row is held at its ceiling in both directions), so this
 * slice could not add a subcommand there without moving a gate number — the frozen
 * work. The command mounts onto the existing `job` parent from here, the way
 * `api-diff-commands.ts` mounts `peaks scan api-diff`, and reuses the parent
 * file's session/state resolution rather than re-implementing it. NOTHING about
 * the `job` command's stored shape changed: same state file, same `slice-NNN` ids,
 * same `progress.json` mirror, same envelope, no new ledger field.
 *
 * WHAT IT PROMISES, and each half is load-bearing:
 * - **idempotent** — a label already registered on this job is reported as the
 *   slice it already is (`added: false`) and `state.json` is not written.
 *   Re-running the command cannot grow the job.
 * - **honest** — an empty or whitespace-only label is refused
 *   (`INVALID_SLICE_LABEL`) rather than appended; the mirror is rewritten only when
 *   a slice was actually added, and only if a mirror already exists (a command that
 *   knows nothing about progress does not invent one).
 * - **followed by the rest of the ledger** — every `total` is `slices.length`, so
 *   `status`, `progress`, `continue` and the mirror move together, and `checkpoint`
 *   takes the new slice by name through the existing D7 label resolution.
 */

import type { Command } from 'commander';
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobOrchestrator, type AddSliceOutcome } from '../../services/job/job-orchestrator.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { tryReadJobProgress, writeJobProgress } from '../../services/job/job-progress-store.js';
import {
  SESSION_ID_HELP,
  asJson,
  resolveJobStateRoot,
  type JobJsonOpts,
  type JobRootOpts
} from './job-commands.js';

/**
 * The options `job add-slice` reads (see the S10 option-interface block in
 * `job-commands.ts`: one interface per command, declaring exactly what its action
 * looks at, so no `opts.<field>` is an unchecked `any` read).
 */
interface JobAddSliceOpts extends JobRootOpts, JobJsonOpts {
  readonly jobId: string;
  readonly sliceLabel: string;
}

/**
 * Report a failed envelope AND exit non-zero — the F1 rule every failure site in
 * `job-commands.ts` goes through.
 *
 * Repeated here rather than imported for one mechanical reason: exporting
 * `job-commands.ts`'s `failResult` lengthens its signature past the line width, so
 * prettier reflows it onto five lines, and that file is already over the 300-line
 * cap. A slice that must move no gate number cannot spend four lines there. The
 * behaviour is the same two statements: `printResult(...)` then
 * `process.exitCode = 1`.
 */
function refuse(io: ProgramIO, result: ResultEnvelope<unknown>, opts: JobJsonOpts): void {
  printResult(io, result, asJson(opts));
  process.exitCode = 1;
}

/** An empty or whitespace-only label never reaches the ledger. */
function refuseEmptyLabel(io: ProgramIO, opts: JobAddSliceOpts): void {
  refuse(
    io,
    fail(
      'add-slice',
      'INVALID_SLICE_LABEL',
      `--slice-label must name one slice; got ${JSON.stringify(opts.sliceLabel)} (empty after trimming)`,
      { jobId: opts.jobId },
      ['Re-run with --slice-label <label>, one slice label per call']
    ),
    opts
  );
}

/**
 * Re-mirror the progress file so `total` follows the ledger the hooks read.
 *
 * Only when a mirror already exists: `done` and `lastCommitSha` are taken from the
 * mirror that is being updated, and this command has no checkpoint to base a
 * `done` count on for a job that has never been checkpointed. Returns whether a
 * mirror was written, which is what the envelope reports as `progressMirrored`.
 */
function mirrorProgressAfterAdd(
  projectRoot: string,
  sessionId: string,
  jobId: string,
  orch: JobOrchestrator
): boolean {
  const existing = tryReadJobProgress(projectRoot, sessionId, jobId);
  if (existing === null) return false;
  const state = orch.status(jobId);
  writeJobProgress(projectRoot, sessionId, {
    jobId,
    done: state.done,
    total: state.total,
    // D3: `undefined` is the honest answer when nothing is pending, and the
    // store says so in its own words instead of the caller inventing a slice id.
    currentSlice: state.currentSlice,
    lastCommitSha: existing.lastCommitSha,
    updatedAt: new Date().toISOString()
  });
  return true;
}

/** What the caller is told, and what it can do next. */
function addSliceEnvelope(
  opts: JobAddSliceOpts,
  outcome: AddSliceOutcome,
  progressMirrored: boolean,
  statePath: string
): ResultEnvelope<Record<string, unknown>> {
  const warnings = outcome.added
    ? []
    : [
        `slice "${outcome.label}" is already registered as ${outcome.sliceId} on job ${opts.jobId}; nothing changed`
      ];
  const nextActions = outcome.added
    ? [
        `Recorded ${outcome.sliceId} (${outcome.label}); job ${opts.jobId} now has ${outcome.total} slices.`,
        `Checkpoint it by name: peaks job checkpoint --job-id ${opts.jobId} --slice-id ${outcome.label} --state done --commit-sha <sha>`
      ]
    : [
        `Checkpoint the slice that exists: peaks job checkpoint --job-id ${opts.jobId} --slice-id ${outcome.sliceId} --state done --commit-sha <sha>`
      ];
  return ok(
    'add-slice',
    {
      jobId: opts.jobId,
      sliceId: outcome.sliceId,
      label: outcome.label,
      added: outcome.added,
      total: outcome.total,
      progressMirrored,
      statePath
    },
    warnings,
    nextActions
  );
}

function runAddSlice(io: ProgramIO, opts: JobAddSliceOpts): void {
  const label = opts.sliceLabel.trim();
  if (label.length === 0) {
    // Refused before the job is opened: a job that does not exist must not be the
    // reason the caller learns their label was blank.
    refuseEmptyLabel(io, opts);
    return;
  }
  const jobRoot = resolveJobStateRoot(opts, opts.jobId);
  const orch = new JobOrchestrator(new JobStateStore(jobRoot.rootDir));
  const outcome = orch.addSlice({ jobId: opts.jobId, label });
  const progressMirrored = outcome.added
    ? mirrorProgressAfterAdd(jobRoot.projectRoot, jobRoot.sessionId, opts.jobId, orch)
    : false;
  printResult(
    io,
    addSliceEnvelope(
      opts,
      outcome,
      progressMirrored,
      `${jobRoot.rootDir}/${opts.jobId}/state.json`
    ),
    asJson(opts)
  );
}

export function registerJobAddSliceCommand(program: Command, io: ProgramIO): void {
  // Mount on the existing `job` parent. If it is not registered, this command has
  // no session resolution, no state layout and no `--json` handling to share, so a
  // second bare `job` group would be the wrong answer — say so loudly instead.
  const job = program.commands.find((c) => c.name() === 'job');
  if (job === undefined) {
    throw new Error(
      'registerJobAddSliceCommand: no `job` command on this program — job-commands must be registered first'
    );
  }

  addJsonOption(
    job
      .command('add-slice')
      .description(
        'Register one more slice on an existing job, for a wave planned a slice at a time. ' +
          'Idempotent: a label the job already carries is reported and changes nothing; an ' +
          'empty label is refused. Writes the job state file and re-mirrors progress.json ' +
          'when a mirror already exists, so `total` in status/progress follows the ledger.'
      )
      .requiredOption('--job-id <jid>')
      .requiredOption('--slice-label <label>', 'the slice this wave has now planned')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
      .action((opts: JobAddSliceOpts) => runAddSlice(io, opts))
  );
}
