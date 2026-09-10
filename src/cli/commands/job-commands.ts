// src/cli/commands/job-commands.ts
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import { writeJobProgress, readJobProgress, tryReadJobProgress } from '../../services/job/job-progress-store.js';
import { JobRotation } from '../../services/job/job-rotation.js';
import { SubAgentJobWrapper } from '../../services/job/subagent-job-wrapper.js';
import { emitJobEvent } from '../../services/job/job-event-emitter.js';
import {
  JobInitInputSchema,
  JobCheckpointInputSchema,
  JobBlockInputSchema,
} from '../../services/job/job-types.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  buildCostCheckEnvelope,
  runKarpathyCostCheck,
} from '../../services/karpathy-cost/karpathy-cost-check-service.js';
import { read24hState } from '../../services/24h-mode/store.js';
import {
  refreshCodegraphAfterSlice,
  type CodegraphAutorefreshResult,
} from '../../services/codegraph/codegraph-autorefresh.js';

function projectRoot(opts: any): string {
  // Reuse the workspace root resolver from peaks CLI; for now, CWD as a safe placeholder.
  return opts.project ?? process.cwd();
}

/**
 * D6: every job subcommand resolves a job root, so every one of them must be
 * able to name the session that holds the job. Same precedence as the rest of
 * the CLI (`peaks sub-agent dispatch`, `peaks web *`, `peaks share *`), except
 * that job state has no "unknown-sid" location to land in — an unresolvable
 * session is an error, not a silent fallback.
 */
const SESSION_ID_HELP =
  'session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback: NO_ACTIVE_SESSION error)';

/**
 * The session (a direct child of `<project>/.peaks/_runtime/`) that holds
 * `jobId`, or null. Only used to explain a miss: a job that lives in another
 * session must be reported by name so the caller can re-run with --session-id.
 */
function findSessionHoldingJob(project: string, jobId: string): string | null {
  const runtimeDir = join(project, '.peaks', '_runtime');
  if (!existsSync(runtimeDir)) return null;
  for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(runtimeDir, entry.name, 'job', jobId, 'state.json'))) {
      return entry.name;
    }
  }
  return null;
}

/**
 * Resolves the on-disk root for Job state files.
 *
 * Per spec §3.3 + §4.5 (2.7.1 single-scope-axis layout), Job state lives at:
 *   `<projectRoot>/.peaks/_runtime/<sessionId>/job/<jobId>/state.json`
 *
 * The `JobStateStore` itself only knows its `rootDir` + `jobId` and joins them. We
 * compute the canonical root here (per-call) so the store can stay layout-agnostic.
 *
 * Resolution order (D6 — a job must stay addressable while the single per-project
 * `.peaks/_runtime/session.json` binding points at another session):
 * 1. `--session-id` flag (explicit override)
 * 2. `PEAKS_SESSION_ID` env var
 * 3. `getCurrentSessionId(project)` — reads `.peaks/_runtime/session.json`
 * 4. Error (NO_ACTIVE_SESSION) — must never silently fall back to a random uuid
 *
 * When `jobId` is passed and it is absent from the resolved session, the thrown
 * error names the session that does hold it (if any), instead of leaving the
 * caller with a bare "no state for <job> at <other-sid>" path.
 */
function resolveJobStateRoot(opts: any, jobId?: string): { rootDir: string; sessionId: string; projectRoot: string } {
  const project = projectRoot(opts);
  const sessionId = opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
  if (!sessionId) {
    throw new Error('NO_ACTIVE_SESSION: peaks job requires --session-id or an active peaks-code session via peaks workspace init');
  }
  const rootDir = join(project, '.peaks', '_runtime', sessionId, 'job');
  if (jobId && !existsSync(join(rootDir, jobId, 'state.json'))) {
    const other = findSessionHoldingJob(project, jobId);
    throw new Error(
      other
        ? `JOB_NOT_IN_SESSION: no job "${jobId}" in session "${sessionId}"; it lives in session "${other}" — re-run with --session-id ${other}`
        : `JOB_NOT_IN_SESSION: no job "${jobId}" in session "${sessionId}" (and no other session under .peaks/_runtime/ has it)`,
    );
  }
  return { rootDir, sessionId, projectRoot: project };
}

/**
 * D7: slices are keyed `slice-NNN`, but `peaks job init --slice-list "S1,…"`
 * takes labels, so the natural string to pass back to `--slice-id` is that same
 * label. Resolve an exact sliceId OR an exact label to the canonical sliceId;
 * anything else is a hard error listing the valid ids, so a mistyped
 * `slice-04` can never be accepted as a silent no-op that leaves the slice
 * pending.
 */
function resolveSliceId(
  store: JobStateStore,
  jobId: string,
  sliceId: string,
): { sliceId: string } | { message: string; validSliceIds: string[] } {
  const slices = store.load(jobId).slices;
  const hit = slices.find((sl) => sl.sliceId === sliceId || sl.label === sliceId);
  if (hit) return { sliceId: hit.sliceId };
  return {
    message: `no slice "${sliceId}" in job ${jobId}; valid ids: ${slices.map((sl) => `${sl.sliceId} (${sl.label})`).join(', ')}`,
    validSliceIds: slices.map((sl) => sl.sliceId),
  };
}

export function registerJobCommands(program: Command, io: ProgramIO = { stdout: (t: string) => process.stdout.write(t), stderr: (t: string) => process.stderr.write(t) }): void {
  const job = new Command('job').description('Drive long multi-slice work as one Job (peaks-code Step 0.8+)');

  job
    .command('init')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-list <list>')
    .option('--parallelism-hint <serial|llm-decides>', 'llm-decides')
    .option('--exit-policy <strict|best-effort>', 'strict')
    .option('--main-loop-strategy <single|rotating>', 'rotating')
    .option('--rotate-every <n>', 'rotate every N slices (rotating mode)', '3')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const project = projectRoot(opts);
      // Resolve sessionId: explicit flag > PEAKS_SESSION_ID > canonical session binding > FAIL.
      // Per spec §3.3, Job state lives at .peaks/_runtime/<sessionId>/job/<jobId>/state.json —
      // a random UUID would scatter state across dirs and break resume/auto-compact.
      let sessionId: string | null = opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
      if (!sessionId) {
        return printResult(io, fail('init', 'NO_ACTIVE_SESSION', 'peaks job init requires --session-id (or an active peaks-code session via peaks workspace init)', { project }, [
          'Re-run with --session-id <sid>',
          'Or run `peaks workspace init` to create a session first'
        ]), opts);
      }
      const parsed = JobInitInputSchema.safeParse({
        jobId: opts.jobId,
        sessionId,
        sliceList: opts.sliceList.split(',').map((s: string) => s.trim()).filter(Boolean),
        parallelismHint: opts.parallelismHint,
        exitPolicy: opts.exitPolicy,
        mainLoopStrategy: opts.mainLoopStrategy,
        rotateEvery: Number(opts.rotateEvery),
        project,
        json: opts.json,
      });
      if (!parsed.success) return printResult(io, fail('init', 'INVALID_INIT', parsed.error.message, {}), opts);
      const jobRoot = resolveJobStateRoot(opts);
      const store = new JobStateStore(jobRoot.rootDir);
      const orch = new JobOrchestrator(store);
      const state = orch.init({
        jobId: parsed.data.jobId,
        sessionId: parsed.data.sessionId,
        sliceList: parsed.data.sliceList,
        parallelismHint: parsed.data.parallelismHint,
        exitPolicy: parsed.data.exitPolicy,
        mainLoopStrategy: parsed.data.mainLoopStrategy,
        rotateEvery: parsed.data.rotateEvery,
      });
      try {
        emitJobEvent({ kind: 'job-started', jobId: state.jobId, total: state.slices.length, strategy: state.mainLoopStrategy });
      } catch (e) {
        // best-effort: event emission failures must not abort job init
        void e;
      }
      printResult(io, ok('init', { jobId: state.jobId, sliceCount: state.slices.length, statePath: `${jobRoot.rootDir}/${state.jobId}/state.json` }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'init')!);

  job
    .command('status')
    .requiredOption('--job-id <jid>')
    .option('--watch', 'poll every 3s')
    .option('--show-cost', 'overlay cost from peaks budget')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      if (opts.watch) {
        const draw = () => {
          const bar = `[${'='.repeat(s.done)}${' '.repeat(s.total - s.done)}]`;
          process.stdout.write(`\rjob ${opts.jobId}: ${bar} ${s.done}/${s.total}${s.currentSlice ? ` next=${s.currentSlice}` : ''}    `);
        };
        draw();
        const iv = setInterval(() => { const u = orch.status(opts.jobId); Object.assign(s, u); draw(); if (u.done + u.failed + u.skipped + u.blocked >= u.total) clearInterval(iv); }, 3000);
        process.on('SIGINT', () => { clearInterval(iv); process.stdout.write('\n'); process.exit(0); });
        return;
      }
      try {
        emitJobEvent({ kind: 'job-progress', jobId: opts.jobId, done: s.done, total: s.total, ...(s.currentSlice ? { currentSlice: s.currentSlice } : {}) });
      } catch (e) {
        // best-effort: event emission failures must not abort job status
        void e;
      }
      printResult(io, ok('status', s as unknown as Record<string, unknown>), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'status')!);

  // M4.2: wire rotate-now to JobRotation (session-rotate callbacks are stubs pending M6.5 batch-fix).
  job.command('rotate-now')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const rotation = new JobRotation(store,
        async (_jid) => { /* delegate to peaks session rotate — implementation wired in M6.5 batch-fix */ return { rotated: true }; },
        async (jid) => ({ jobId: jid, cycle: 0 }),
      );
      const r = await rotation.rotateNow(opts.jobId);
      printResult(io, ok('rotate-now', r as unknown as Record<string, unknown>), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'rotate-now')!);

  job.command('subagent-cleanup')
    .requiredOption('--job-id <jid>')
    .requiredOption('--batch-id <bid>')
    .option('--force')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const wrapper = new SubAgentJobWrapper(
        new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir),
        async () => ({ batchId: opts.batchId })
      );
      const r = await wrapper.cleanup({ jobId: opts.jobId, batchId: opts.batchId, force: !!opts.force });
      printResult(io, ok('subagent-cleanup', r), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'subagent-cleanup')!);

  // M3.2: wire the remaining 5 subcommand slots — block, checkpoint, continue, handoff, resume.
  job
    .command('checkpoint')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-id <rid>')
    .requiredOption('--state <done|failed|skipped>')
    .option('--commit-sha <sha>')
    .option('--reason <text>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const parsed = JobCheckpointInputSchema.safeParse({
        jobId: opts.jobId, sliceId: opts.sliceId, state: opts.state,
        commitSha: opts.commitSha, reason: opts.reason,
        project: projectRoot(opts), json: opts.json,
      });
      if (!parsed.success) return printResult(io, fail('checkpoint', 'INVALID_CHECKPOINT', parsed.error.message, {}), opts);
      const jobRoot = resolveJobStateRoot(opts, opts.jobId);
      const store = new JobStateStore(jobRoot.rootDir);
      // D7: `--slice-id` accepts the canonical `slice-NNN` or the slice's label
      // ("S1"); an id that matches no slice is rejected here, BEFORE any write,
      // so progress.json is never touched by a checkpoint that matched nothing.
      const slice = resolveSliceId(store, parsed.data.jobId, parsed.data.sliceId);
      if ('message' in slice) {
        return printResult(io, fail('checkpoint', 'SLICE_NOT_FOUND', slice.message, {
          jobId: parsed.data.jobId, sliceId: parsed.data.sliceId, validSliceIds: slice.validSliceIds,
        }, ['Re-run with one of the valid slice ids']), opts);
      }
      const sliceId = slice.sliceId;
      const orch = new JobOrchestrator(store);
      // 2026-09-03-codegraph-autorefresh: set on --state done so the ok
      // envelope carries a non-blocking `codegraph` result; null for
      // failed/skipped (no slice-complete boundary).
      let codegraph: CodegraphAutorefreshResult | null = null;
      if (parsed.data.state === 'done') {
        await orch.checkpointDone({ jobId: parsed.data.jobId, sliceId, ...(parsed.data.commitSha ? { commitSha: parsed.data.commitSha } : {}) });
        // v3.1.2: after each --state done, mirror slice progress to
        // .peaks/_runtime/<sessionId>/job/<jid>/progress.json so the
        // next LLM turn (or peaks code gate-step-08 hook) can read it.
        const project = projectRoot(opts);
        const sessId = jobRoot.sessionId;
        const state = orch.status(parsed.data.jobId);
        writeJobProgress(project, sessId, {
          jobId: parsed.data.jobId,
          done: state.done,
          total: state.total,
          currentSlice: state.currentSlice ?? `slice-${state.done + 1}`,
          lastCommitSha: parsed.data.commitSha ?? null,
          updatedAt: new Date().toISOString()
        });
        // Auto codegraph refresh at the slice-complete boundary. Best-effort
        // and fail-silent: a refresh failure must never fail the checkpoint.
        try {
          codegraph = await refreshCodegraphAfterSlice(project);
        } catch (e) {
          codegraph = { refreshed: false, reason: 'unavailable', note: `auto codegraph refresh failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      } else if (parsed.data.state === 'skipped') {
        await orch.checkpointSkipped({ jobId: parsed.data.jobId, sliceId, reason: parsed.data.reason! });
      } else {
        await orch.checkpointFailed({ jobId: parsed.data.jobId, sliceId, reason: parsed.data.reason! });
      }
      printResult(io, ok('checkpoint', { sliceId, status: parsed.data.state, codegraph }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'checkpoint')!);

  job
    .command('block')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-id <rid>')
    .requiredOption('--reason <text>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const parsed = JobBlockInputSchema.safeParse({
        jobId: opts.jobId, sliceId: opts.sliceId, reason: opts.reason,
        project: projectRoot(opts), json: opts.json,
      });
      if (!parsed.success) return printResult(io, fail('block', 'INVALID_BLOCK', parsed.error.message, {}), opts);
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      // D7 (same silent no-op as checkpoint): resolve label → sliceId, reject a
      // miss before any write.
      const slice = resolveSliceId(store, parsed.data.jobId, parsed.data.sliceId);
      if ('message' in slice) {
        return printResult(io, fail('block', 'SLICE_NOT_FOUND', slice.message, {
          jobId: parsed.data.jobId, sliceId: parsed.data.sliceId, validSliceIds: slice.validSliceIds,
        }, ['Re-run with one of the valid slice ids']), opts);
      }
      const orch = new JobOrchestrator(store);
      await orch.blockSlice({ ...parsed.data, sliceId: slice.sliceId });
      printResult(io, ok('block', { blocked: slice.sliceId, reason: parsed.data.reason }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'block')!);

  job
    .command('continue')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const orch = new JobOrchestrator(store);
      const r = orch.continueNow(opts.jobId);
      printResult(io, ok('continue', r as unknown as Record<string, unknown>), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'continue')!);

  job
    .command('resume')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(io, ok('resume', { resumed: opts.jobId, ...(s as unknown as Record<string, unknown>) }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'resume')!);

  // v3.1.2: read the on-disk slice progress mirror written by `peaks
  // job checkpoint --state done`. Used by peaks code gate-step-08 and
  // by peaks-code Step 0.7 (resume) to surface `Next: slice #N of M
  // (<currentSlice>)` without re-deriving from state.json.
  job
    .command('progress')
    .description(
      'v3.1.2: read the on-disk slice progress mirror (.peaks/_runtime/<sid>/job/<jid>/progress.json). ' +
        'Returns { jobId, done, total, currentSlice, lastCommitSha, updatedAt }.'
    )
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .option('--allow-missing', 'return done=0/total=0 envelope instead of failing when progress.json is absent')
    .action(async (opts) => {
      try {
        const jobRoot = resolveJobStateRoot(opts, opts.jobId);
        const sessId = jobRoot.sessionId;
        const project = projectRoot(opts);
        const progress = opts.allowMissing === true
          ? tryReadJobProgress(project, sessId, opts.jobId)
          : readJobProgress(project, sessId, opts.jobId);
        if (progress === null) {
          printResult(
            io,
            fail('progress', 'NO_PROGRESS', `No progress.json for job ${opts.jobId} at .peaks/_runtime/${sessId}/job/${opts.jobId}/progress.json`, { jobId: opts.jobId, sessionId: sessId }, [
              'Run `peaks job checkpoint --state done ...` at least once to seed progress.json.',
              'Or pass --allow-missing to return a zero-progress envelope.'
            ]),
            opts.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(io, ok('progress', progress, [], [
          `Next: slice #${progress.done + 1} of ${progress.total} (${progress.currentSlice})`
        ]), opts.json);
      } catch (err) {
        printResult(
          io,
          fail('progress', 'PROGRESS_READ_FAILED', err instanceof Error ? err.message : String(err), { jobId: opts.jobId }, ['Verify the job id and try again']),
          opts.json
        );
        process.exitCode = 1;
      }
    });
  addJsonOption(job.commands.find(c => c.name() === 'progress')!);

  job
    .command('handoff')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(io, ok('handoff', { handoffFor: opts.jobId, ...(s as unknown as Record<string, unknown>) }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'handoff')!);

  job
    .command('karpathy-cost-check')
    .description('Read the slice\'s rd/karpathy-review.md and decide whether to downgrade a block gateAction to warn (slice 2026-07-30-karpathy-cost-self-review).')
    .requiredOption('--review-file <path>', 'path to rd/karpathy-review.md (or its .json sibling if the file is JSON)')
    .option('--project <repo>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .action(async (opts) => {
      const project = projectRoot(opts);
      const sessionId = opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
      if (!sessionId) {
        return printResult(
          io,
          fail('karpathy-cost-check', 'NO_ACTIVE_SESSION', 'karpathy-cost-check requires --session-id (or an active peaks-code session)', { project }, [
            'Re-run with --session-id <sid>',
            'Or run `peaks workspace init` to create a session first',
          ]),
          opts,
        );
      }
      const is24hModeActive = (): boolean => {
        try {
          const snapshot = read24hState(project, sessionId);
          return snapshot.state === '24H_ACTIVE';
        } catch {
          return false;
        }
      };
      const out = runKarpathyCostCheck({
        reviewFilePath: opts.reviewFile,
        is24hModeActive,
      });
      printResult(io, buildCostCheckEnvelope(out), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'karpathy-cost-check')!);

  program.addCommand(job);
}