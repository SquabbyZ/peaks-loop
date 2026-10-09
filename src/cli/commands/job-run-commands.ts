// Split out of `job-commands.ts`:
// `job continue`, `job resume`, `job progress` and `job handoff` — the
// read/advance surface a running job is driven through.
import type { Command } from 'commander';
import { ok, fail } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import {
  readJobProgress,
  tryReadJobProgress,
  describeNextSlice
} from '../../services/job/job-progress-store.js';
import {
  asJson,
  failResult,
  projectRoot,
  type JobIdOnlyOpts,
  type JobProgressOpts
} from './job-command-shared.js';
import { SESSION_ID_HELP, resolveJobStateRoot } from './job-state-root.js';

const PROGRESS_DESCRIPTION =
  'v3.1.2: read the on-disk slice progress mirror (.peaks/_runtime/<sid>/job/<jid>/progress.json). ' +
  'Returns { jobId, done, total, currentSlice, lastCommitSha, updatedAt }.';

// "return done=0/total=0 envelope instead of failing when progress.json is
// absent". No code path has ever returned such an envelope — the option was
// born in `d9a1a098` with `process.exitCode = 1` on the same branch — so it
// described a contract that never existed, and `--allow-missing` appeared to
// be broken. It is not: its job is to pick WHICH structured code reports the
// absence. The help text was the side that was wrong; it now says what the
// flag does. See `rd/requests/013-…-exit-code-root-cause.md` for why the
// alternative reading was rejected (the literal promise is also
// unimplementable without a new absent-vs-corrupt distinction:
// `tryReadJobProgress` returns `null` for a corrupt file too, so "done=0"
// there would report unreadable state as empty state).
const PROGRESS_ALLOW_MISSING_HELP =
  'report an absent progress.json as NO_PROGRESS (expected absence) rather than PROGRESS_READ_FAILED (read error); the command still exits non-zero';

function runJobContinue(opts: JobIdOnlyOpts, io: ProgramIO): void {
  const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
  const orch = new JobOrchestrator(store);
  const r = orch.continueNow(opts.jobId);
  printResult(io, ok('continue', r as unknown as Record<string, unknown>), asJson(opts));
}

function runJobResume(opts: JobIdOnlyOpts, io: ProgramIO): void {
  const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
  const orch = new JobOrchestrator(store);
  const s = orch.status(opts.jobId);
  printResult(
    io,
    ok('resume', { resumed: opts.jobId, ...(s as unknown as Record<string, unknown>) }),
    asJson(opts)
  );
}

// v3.1.2: read the on-disk slice progress mirror written by `peaks job
// checkpoint --state done`; gate-step-08 and Step 0.7 (resume) read it too. The
// `next:` sentence comes from describeNextSlice, never re-derived from state.json.
function runJobProgress(opts: JobProgressOpts, io: ProgramIO): void {
  try {
    const jobRoot = resolveJobStateRoot(opts, opts.jobId);
    const sessId = jobRoot.sessionId;
    const project = projectRoot(opts);
    const progress =
      opts.allowMissing === true
        ? tryReadJobProgress(project, sessId, opts.jobId)
        : readJobProgress(project, sessId, opts.jobId);
    if (progress === null) {
      // F1: this site already set `process.exitCode = 1` by hand; it is
      // routed through `failResult` so all nine failure sites in this file
      // share one rule instead of this one being the lone precedent.
      failResult(
        io,
        fail(
          'progress',
          'NO_PROGRESS',
          `No progress.json for job ${opts.jobId} at .peaks/_runtime/${sessId}/job/${opts.jobId}/progress.json`,
          { jobId: opts.jobId, sessionId: sessId },
          [
            'Run `peaks job checkpoint --state done ...` at least once to seed progress.json.',
            // return a zero-progress envelope." That line could only ever be
            // printed when `--allow-missing` had ALREADY been passed — this
            // `progress === null` branch is unreachable otherwise, because the
            // no-flag path throws into the catch below and reports
            // PROGRESS_READ_FAILED. So the CLI was advising the caller to pass
            // the flag they had just passed, to obtain an envelope that does
            // not exist. Replaced with the fact the caller actually needs.
            '--allow-missing selects this NO_PROGRESS envelope over a PROGRESS_READ_FAILED read error; it does not change the exit code.'
          ]
        ),
        opts
      );
      return;
    }
    printResult(
      io,
      ok('progress', progress, [], [`Next: ${describeNextSlice(progress, progress.jobId)}`]),
      asJson(opts)
    );
  } catch (err) {
    failResult(
      io,
      fail(
        'progress',
        'PROGRESS_READ_FAILED',
        err instanceof Error ? err.message : String(err),
        { jobId: opts.jobId },
        ['Verify the job id and try again']
      ),
      opts
    );
  }
}

function runJobHandoff(opts: JobIdOnlyOpts, io: ProgramIO): void {
  const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
  const orch = new JobOrchestrator(store);
  const s = orch.status(opts.jobId);
  printResult(
    io,
    ok('handoff', { handoffFor: opts.jobId, ...(s as unknown as Record<string, unknown>) }),
    asJson(opts)
  );
}

export function registerJobRunCommands(job: Command, io: ProgramIO): void {
  addJsonOption(
    job
      .command('continue')
      .requiredOption('--job-id <jid>')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action((opts: JobIdOnlyOpts) => runJobContinue(opts, io));

  addJsonOption(
    job
      .command('resume')
      .requiredOption('--job-id <jid>')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action((opts: JobIdOnlyOpts) => runJobResume(opts, io));

  addJsonOption(
    job
      .command('progress')
      .description(PROGRESS_DESCRIPTION)
      .requiredOption('--job-id <jid>')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
      .option('--allow-missing', PROGRESS_ALLOW_MISSING_HELP)
  ).action((opts: JobProgressOpts) => runJobProgress(opts, io));

  addJsonOption(
    job
      .command('handoff')
      .requiredOption('--job-id <jid>')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action((opts: JobIdOnlyOpts) => runJobHandoff(opts, io));
}
