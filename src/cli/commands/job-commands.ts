// src/cli/commands/job-commands.ts
import { join } from 'node:path';
import { Command } from 'commander';
import { fail, ok } from '../../shared/result.js';
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

function projectRoot(opts: any): string {
  // Reuse the workspace root resolver from peaks CLI; for now, CWD as a safe placeholder.
  return opts.project ?? process.cwd();
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
 * Resolution order:
 * 1. `--session-id` flag (explicit override)
 * 2. `getCurrentSessionId(project)` — reads `.peaks/_runtime/session.json` per peaks-solo
 * 3. Error (NO_ACTIVE_SESSION) — must never silently fall back to a random uuid
 */
function resolveJobStateRoot(opts: any): { rootDir: string; sessionId: string; projectRoot: string } {
  const project = projectRoot(opts);
  const sessionId = opts.sessionId ?? getCurrentSessionId(project);
  if (!sessionId) {
    throw new Error('NO_ACTIVE_SESSION: peaks job requires --session-id or an active peaks-solo session via peaks workspace init');
  }
  const rootDir = join(project, '.peaks', '_runtime', sessionId, 'job');
  return { rootDir, sessionId, projectRoot: project };
}

export function registerJobCommands(program: Command, io: ProgramIO = { stdout: (t: string) => process.stdout.write(t), stderr: (t: string) => process.stderr.write(t) }): void {
  const job = new Command('job').description('Drive long multi-slice work as one Job (peaks-solo Step 0.8+)');

  job
    .command('init')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-list <list>')
    .option('--parallelism-hint <serial|llm-decides>', 'llm-decides')
    .option('--exit-policy <strict|best-effort>', 'strict')
    .option('--main-loop-strategy <single|rotating>', 'rotating')
    .option('--rotate-every <n>', 'rotate every N slices (rotating mode)', '3')
    .option('--session-id <sid>', 'session id (default: read from .peaks/_runtime/session.json; required to land in the 2.7.1 single-scope-axis layout)')
    .option('--project <repo>')
    .action(async (opts) => {
      const project = projectRoot(opts);
      // Resolve sessionId: explicit flag > canonical session binding > FAIL.
      // Per spec §3.3, Job state lives at .peaks/_runtime/<sessionId>/job/<jobId>/state.json —
      // a random UUID would scatter state across dirs and break resume/auto-compact.
      let sessionId: string | null = opts.sessionId ?? getCurrentSessionId(project);
      if (!sessionId) {
        return printResult(io, fail('init', 'NO_ACTIVE_SESSION', 'peaks job init requires --session-id (or an active peaks-solo session via peaks workspace init)', { project }, [
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
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts).rootDir);
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
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts).rootDir);
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
    .option('--project <repo>')
    .action(async (opts) => {
      const wrapper = new SubAgentJobWrapper(
        new JobStateStore(resolveJobStateRoot(opts).rootDir),
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
    .option('--project <repo>')
    .action(async (opts) => {
      const parsed = JobCheckpointInputSchema.safeParse({
        jobId: opts.jobId, sliceId: opts.sliceId, state: opts.state,
        commitSha: opts.commitSha, reason: opts.reason,
        project: projectRoot(opts), json: opts.json,
      });
      if (!parsed.success) return printResult(io, fail('checkpoint', 'INVALID_CHECKPOINT', parsed.error.message, {}), opts);
      const jobRoot = resolveJobStateRoot(opts);
      const store = new JobStateStore(jobRoot.rootDir);
      const orch = new JobOrchestrator(store);
      if (parsed.data.state === 'done') {
        await orch.checkpointDone({ jobId: parsed.data.jobId, sliceId: parsed.data.sliceId, ...(parsed.data.commitSha ? { commitSha: parsed.data.commitSha } : {}) });
        // v3.1.2: after each --state done, mirror slice progress to
        // .peaks/_runtime/<sessionId>/job/<jid>/progress.json so the
        // next LLM turn (or peaks solo gate-step-08 hook) can read it.
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
      } else if (parsed.data.state === 'skipped') {
        await orch.checkpointSkipped({ jobId: parsed.data.jobId, sliceId: parsed.data.sliceId, reason: parsed.data.reason! });
      } else {
        await orch.checkpointFailed({ jobId: parsed.data.jobId, sliceId: parsed.data.sliceId, reason: parsed.data.reason! });
      }
      printResult(io, ok('checkpoint', { sliceId: parsed.data.sliceId, status: parsed.data.state }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'checkpoint')!);

  job
    .command('block')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-id <rid>')
    .requiredOption('--reason <text>')
    .option('--project <repo>')
    .action(async (opts) => {
      const parsed = JobBlockInputSchema.safeParse({
        jobId: opts.jobId, sliceId: opts.sliceId, reason: opts.reason,
        project: projectRoot(opts), json: opts.json,
      });
      if (!parsed.success) return printResult(io, fail('block', 'INVALID_BLOCK', parsed.error.message, {}), opts);
      const store = new JobStateStore(resolveJobStateRoot(opts).rootDir);
      const orch = new JobOrchestrator(store);
      await orch.blockSlice(parsed.data);
      printResult(io, ok('block', { blocked: parsed.data.sliceId, reason: parsed.data.reason }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'block')!);

  job
    .command('continue')
    .requiredOption('--job-id <jid>')
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts).rootDir);
      const orch = new JobOrchestrator(store);
      const r = orch.continueNow(opts.jobId);
      printResult(io, ok('continue', r as unknown as Record<string, unknown>), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'continue')!);

  job
    .command('resume')
    .requiredOption('--job-id <jid>')
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts).rootDir);
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(io, ok('resume', { resumed: opts.jobId, ...(s as unknown as Record<string, unknown>) }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'resume')!);

  // v3.1.2: read the on-disk slice progress mirror written by `peaks
  // job checkpoint --state done`. Used by peaks solo gate-step-08 and
  // by peaks-solo Step 0.7 (resume) to surface `Next: slice #N of M
  // (<currentSlice>)` without re-deriving from state.json.
  job
    .command('progress')
    .description(
      'v3.1.2: read the on-disk slice progress mirror (.peaks/_runtime/<sid>/job/<jid>/progress.json). ' +
        'Returns { jobId, done, total, currentSlice, lastCommitSha, updatedAt }.'
    )
    .requiredOption('--job-id <jid>')
    .option('--project <repo>')
    .option('--allow-missing', 'return done=0/total=0 envelope instead of failing when progress.json is absent')
    .action(async (opts) => {
      try {
        const jobRoot = resolveJobStateRoot(opts);
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
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts).rootDir);
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(io, ok('handoff', { handoffFor: opts.jobId, ...(s as unknown as Record<string, unknown>) }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'handoff')!);

  program.addCommand(job);
}