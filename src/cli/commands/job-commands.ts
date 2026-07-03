// src/cli/commands/job-commands.ts
import { Command } from 'commander';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import {
  JobInitInputSchema,
  JobCheckpointInputSchema,
  JobBlockInputSchema,
} from '../../services/job/job-types.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

// Stub stubs for M5/M4 — full impl in those milestones.
async function rotateNowImpl(_jobId: string, _project: string) { return ok('rotate-now', { note: 'rotate-now lands in M4' }); }
async function subagentCleanupImpl(_jobId: string, _batchId: string) { return ok('subagent-cleanup', { note: 'subagent-cleanup lands in M5' }); }

function projectRoot(opts: any): string {
  // Reuse the workspace root resolver from peaks CLI; for now, CWD as a safe placeholder.
  return opts.project ?? process.cwd();
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
    .option('--rotate-every <n>', '3')
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
      const store = new JobStateStore(parsed.data.project);
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
      printResult(io, ok('init', { jobId: state.jobId, sliceCount: state.slices.length, statePath: `${parsed.data.project}/.peaks/_runtime/${state.sessionId}/job/${state.jobId}/state.json` }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'init')!);

  job
    .command('status')
    .requiredOption('--job-id <jid>')
    .option('--watch', 'poll every 3s')
    .option('--show-cost', 'overlay cost from peaks budget')
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(projectRoot(opts));
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
      printResult(io, ok('status', s as unknown as Record<string, unknown>), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'status')!);

  // Stubs for now — implementation lands in M5 (subagent-cleanup) and M4 (rotate-now).
  const rotateNow = job.command('rotate-now').requiredOption('--job-id <jid>').option('--project <repo>');
  addJsonOption(rotateNow).action(async (opts) => { const r = await rotateNowImpl(opts.jobId, projectRoot(opts)); printResult(io, r, opts); });

  const subagentCleanup = job.command('subagent-cleanup').requiredOption('--job-id <jid>').requiredOption('--batch-id <bid>').option('--force').option('--project <repo>');
  addJsonOption(subagentCleanup).action(async (opts) => { const r = await subagentCleanupImpl(opts.jobId, opts.batchId); printResult(io, r, opts); });

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
      const store = new JobStateStore(parsed.data.project);
      const orch = new JobOrchestrator(store);
      if (parsed.data.state === 'done') {
        await orch.checkpointDone({ jobId: parsed.data.jobId, sliceId: parsed.data.sliceId, ...(parsed.data.commitSha ? { commitSha: parsed.data.commitSha } : {}) });
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
      const store = new JobStateStore(parsed.data.project);
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
      const store = new JobStateStore(projectRoot(opts));
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
      const store = new JobStateStore(projectRoot(opts));
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(io, ok('resume', { resumed: opts.jobId, ...(s as unknown as Record<string, unknown>) }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'resume')!);

  job
    .command('handoff')
    .requiredOption('--job-id <jid>')
    .option('--project <repo>')
    .action(async (opts) => {
      const store = new JobStateStore(projectRoot(opts));
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(io, ok('handoff', { handoffFor: opts.jobId, ...(s as unknown as Record<string, unknown>) }), opts);
    });
  addJsonOption(job.commands.find(c => c.name() === 'handoff')!);

  program.addCommand(job);
}