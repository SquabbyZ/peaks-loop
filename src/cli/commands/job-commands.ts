// src/cli/commands/job-commands.ts
import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import {
  JobInitInputSchema,
} from '../../services/job/job-types.js';

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
    .option('--project <repo>')
    .action(async (opts) => {
      const parsed = JobInitInputSchema.safeParse({
        jobId: opts.jobId,
        sliceList: opts.sliceList.split(',').map((s: string) => s.trim()).filter(Boolean),
        parallelismHint: opts.parallelismHint,
        exitPolicy: opts.exitPolicy,
        mainLoopStrategy: opts.mainLoopStrategy,
        rotateEvery: Number(opts.rotateEvery),
        project: projectRoot(opts),
        json: opts.json,
      });
      if (!parsed.success) return printResult(io, fail('init', 'INVALID_INIT', parsed.error.message, {}), opts);
      const store = new JobStateStore(parsed.data.project);
      const orch = new JobOrchestrator(store);
      const state = orch.init({
        jobId: parsed.data.jobId,
        sessionId: randomUUID(),
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

  // M3.2: remaining 5 subcommand slots — block, checkpoint, continue, handoff, resume.
  // For M3.1, register the slots so AC-1's "9 subcommand slots" expectation is met;
  // full handlers land in M3.2.
  const block = job.command('block').requiredOption('--job-id <jid>').option('--project <repo>');
  addJsonOption(block).action(async (opts) => { printResult(io, ok('block', { note: 'block lands in M3.2', jobId: opts.jobId }), opts); });

  const checkpoint = job.command('checkpoint').requiredOption('--job-id <jid>').requiredOption('--slice-id <sid>').option('--project <repo>');
  addJsonOption(checkpoint).action(async (opts) => { printResult(io, ok('checkpoint', { note: 'checkpoint lands in M3.2', jobId: opts.jobId }), opts); });

  const continueCmd = job.command('continue').requiredOption('--job-id <jid>').option('--project <repo>');
  addJsonOption(continueCmd).action(async (opts) => { printResult(io, ok('continue', { note: 'continue lands in M3.2', jobId: opts.jobId }), opts); });

  const handoff = job.command('handoff').requiredOption('--job-id <jid>').option('--project <repo>');
  addJsonOption(handoff).action(async (opts) => { printResult(io, ok('handoff', { note: 'handoff lands in M3.2', jobId: opts.jobId }), opts); });

  const resume = job.command('resume').requiredOption('--job-id <jid>').option('--project <repo>');
  addJsonOption(resume).action(async (opts) => { printResult(io, ok('resume', { note: 'resume lands in M3.2', jobId: opts.jobId }), opts); });

  program.addCommand(job);
}