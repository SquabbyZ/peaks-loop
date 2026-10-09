// Split out of `job-commands.ts`:
// `job checkpoint` and `job block`. The checkpoint action was 90 code lines;
// the done-branch (progress mirror + codegraph refresh) is its own function so
// each piece stays inside the 50-code-line cap.
import type { Command } from 'commander';
import { ok, fail } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import { writeJobProgress } from '../../services/job/job-progress-store.js';
import {
  JobCheckpointInputSchema,
  JobBlockInputSchema,
  type JobCheckpointInput
} from '../../services/job/job-types.js';
import {
  codegraphRefreshNotice,
  refreshCodegraphAfterSlice,
  type CodegraphAutorefreshResult
} from '../../services/codegraph/codegraph-autorefresh.js';
import {
  asJson,
  failResult,
  projectRoot,
  resolveSliceId,
  type JobBlockOpts,
  type JobCheckpointOpts
} from './job-command-shared.js';
import { SESSION_ID_HELP, resolveJobStateRoot } from './job-state-root.js';

const SLICE_NOT_FOUND_HINTS: string[] = ['Re-run with one of the valid slice ids'];

type JobStateRoot = { rootDir: string; sessionId: string; projectRoot: string };

type CheckpointContext = {
  orch: JobOrchestrator;
  jobRoot: JobStateRoot;
  opts: JobCheckpointOpts;
  data: JobCheckpointInput;
  sliceId: string;
};

type CheckpointOutcome = {
  codegraph: CodegraphAutorefreshResult | null;
  codegraphWarning: string | null;
};

const NO_REFRESH: CheckpointOutcome = { codegraph: null, codegraphWarning: null };

/**
 * Auto codegraph refresh at the slice-complete boundary. Best-effort:
 * a refresh failure must never fail the checkpoint.
 *
 * A2 (2026-09-17): "must never fail the checkpoint" is not "must never be
 * seen". A refresh that did not happen while a codegraph store IS in use is now
 * a warning line (stderr, `warning: ` prefix, via printResult) naming the reason
 * and the remedy. See `codegraphRefreshNotice` for why `no-codegraph-dir` stays
 * silent.
 *
 * ADVISORY (F1, 2026-09-17) — deliberately exits 0, and the reach of that word
 * is exactly here. The checkpoint itself SUCCEEDED (the slice flipped to done
 * and progress.json was mirrored above); the refresh is a derived index,
 * rebuildable on demand. So the outcome is reported through `ok(...)` + a
 * `warning:` line, never through `failResult`, and `process.exitCode` is left
 * alone even when the refresh throws. Raising it would turn an advisory rebuild
 * into a build breaker for every CI that runs `peaks job checkpoint`. Pinned by
 * the "advisory stays 0" control in tests/unit/cli/job-exit-code.test.ts.
 */
async function applyCheckpointDone(ctx: CheckpointContext): Promise<CheckpointOutcome> {
  const { orch, jobRoot, opts, data, sliceId } = ctx;
  await orch.checkpointDone({
    jobId: data.jobId,
    sliceId,
    ...(data.commitSha ? { commitSha: data.commitSha } : {})
  });
  // v3.1.2: after each --state done, mirror slice progress to
  // .peaks/_runtime/<sessionId>/job/<jid>/progress.json so the
  // next LLM turn (or peaks code gate-step-08 hook) can read it.
  const project = projectRoot(opts);
  const sessId = jobRoot.sessionId;
  const state = orch.status(data.jobId);
  writeJobProgress(project, sessId, {
    jobId: data.jobId,
    done: state.done,
    total: state.total,
    currentSlice: state.currentSlice,
    lastCommitSha: data.commitSha ?? null,
    updatedAt: new Date().toISOString()
  });
  let codegraph: CodegraphAutorefreshResult;
  try {
    codegraph = await refreshCodegraphAfterSlice(project);
  } catch (e) {
    codegraph = {
      refreshed: false,
      reason: 'unavailable',
      note: `auto codegraph refresh failed: ${e instanceof Error ? e.message : String(e)}`
    };
  }
  return { codegraph, codegraphWarning: codegraphRefreshNotice(codegraph) };
}

async function applyCheckpointState(ctx: CheckpointContext): Promise<CheckpointOutcome> {
  const { orch, data, sliceId } = ctx;
  if (data.state === 'done') return applyCheckpointDone(ctx);
  if (data.state === 'skipped') {
    await orch.checkpointSkipped({ jobId: data.jobId, sliceId, reason: data.reason! });
  } else {
    await orch.checkpointFailed({ jobId: data.jobId, sliceId, reason: data.reason! });
  }
  return NO_REFRESH;
}

function failCheckpointSliceNotFound(
  io: ProgramIO,
  opts: JobCheckpointOpts,
  data: { jobId: string; sliceId: string },
  slice: { message: string; validSliceIds: string[] }
): void {
  failResult(
    io,
    fail(
      'checkpoint',
      'SLICE_NOT_FOUND',
      slice.message,
      { jobId: data.jobId, sliceId: data.sliceId, validSliceIds: slice.validSliceIds },
      SLICE_NOT_FOUND_HINTS
    ),
    opts
  );
}

async function runJobCheckpoint(opts: JobCheckpointOpts, io: ProgramIO): Promise<void> {
  const parsed = JobCheckpointInputSchema.safeParse({
    jobId: opts.jobId,
    sliceId: opts.sliceId,
    state: opts.state,
    commitSha: opts.commitSha,
    reason: opts.reason,
    project: projectRoot(opts),
    json: opts.json
  });
  if (!parsed.success)
    return failResult(io, fail('checkpoint', 'INVALID_CHECKPOINT', parsed.error.message, {}), opts);
  const jobRoot = resolveJobStateRoot(opts, opts.jobId);
  const store = new JobStateStore(jobRoot.rootDir);
  // D7: `--slice-id` accepts the canonical `slice-NNN` or the slice's label
  // ("S1"); an id that matches no slice is rejected here, BEFORE any write,
  // so progress.json is never touched by a checkpoint that matched nothing.
  const slice = resolveSliceId(store, parsed.data.jobId, parsed.data.sliceId);
  if ('message' in slice) {
    failCheckpointSliceNotFound(io, opts, parsed.data, slice);
    return;
  }
  const orch = new JobOrchestrator(store);
  const outcome = await applyCheckpointState({
    orch,
    jobRoot,
    opts,
    data: parsed.data,
    sliceId: slice.sliceId
  });
  printResult(
    io,
    ok(
      'checkpoint',
      { sliceId: slice.sliceId, status: parsed.data.state, codegraph: outcome.codegraph },
      outcome.codegraphWarning === null ? [] : [outcome.codegraphWarning]
    ),
    asJson(opts)
  );
}

async function runJobBlock(opts: JobBlockOpts, io: ProgramIO): Promise<void> {
  const parsed = JobBlockInputSchema.safeParse({
    jobId: opts.jobId,
    sliceId: opts.sliceId,
    reason: opts.reason,
    project: projectRoot(opts),
    json: opts.json
  });
  if (!parsed.success)
    return failResult(io, fail('block', 'INVALID_BLOCK', parsed.error.message, {}), opts);
  const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
  // D7 (same silent no-op as checkpoint): resolve label → sliceId, reject a
  // miss before any write.
  const slice = resolveSliceId(store, parsed.data.jobId, parsed.data.sliceId);
  if ('message' in slice) {
    return failResult(
      io,
      fail(
        'block',
        'SLICE_NOT_FOUND',
        slice.message,
        {
          jobId: parsed.data.jobId,
          sliceId: parsed.data.sliceId,
          validSliceIds: slice.validSliceIds
        },
        SLICE_NOT_FOUND_HINTS
      ),
      opts
    );
  }
  const orch = new JobOrchestrator(store);
  await orch.blockSlice({ ...parsed.data, sliceId: slice.sliceId });
  printResult(
    io,
    ok('block', { blocked: slice.sliceId, reason: parsed.data.reason }),
    asJson(opts)
  );
}

// M3.2: wire the remaining 5 subcommand slots — block, checkpoint, continue,
// handoff, resume. `block` is registered first here, before `continue` /
// `resume` / `progress` / `handoff`, to keep the `job` help order stable.
export function registerJobCheckpointCommands(job: Command, io: ProgramIO): void {
  addJsonOption(
    job
      .command('checkpoint')
      .requiredOption('--job-id <jid>')
      .requiredOption('--slice-id <rid>')
      .requiredOption('--state <done|failed|skipped>')
      .option('--commit-sha <sha>')
      .option('--reason <text>')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action((opts: JobCheckpointOpts) => runJobCheckpoint(opts, io));

  addJsonOption(
    job
      .command('block')
      .requiredOption('--job-id <jid>')
      .requiredOption('--slice-id <rid>')
      .requiredOption('--reason <text>')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action((opts: JobBlockOpts) => runJobBlock(opts, io));
}
