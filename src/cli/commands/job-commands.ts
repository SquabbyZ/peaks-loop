// src/cli/commands/job-commands.ts
//
// The `peaks job` registrar. Split into sibling modules by responsibility
// option shapes + shared helpers, session-root
// resolution, init/status, checkpoint/block, run (continue/resume/progress/
// handoff) and karpathy-cost-check. This file wires them up in the registration
// order the CLI surface dump pins.
//
// `job rotate-now` and `job subagent-cleanup` stay registered HERE: their
// actions carry the three contract-less `async` arrows pinned by
// `tests/unit/standards/gratuitous-async-guard.test.ts`, which keys its 14-site
// set on `file | declaration text`.
import { Command } from 'commander';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobRotation } from '../../services/job/job-rotation.js';
import { SubAgentJobWrapper } from '../../services/job/subagent-job-wrapper.js';
import { asJson, type JobIdOnlyOpts, type JobSubagentCleanupOpts } from './job-command-shared.js';
import { SESSION_ID_HELP, resolveJobStateRoot } from './job-state-root.js';
import { registerJobInitStatusCommands } from './job-init-status-commands.js';
import { registerJobCheckpointCommands } from './job-checkpoint-commands.js';
import { registerJobRunCommands } from './job-run-commands.js';
import { registerJobCostCheckCommand } from './job-cost-check-command.js';

// Published import path preserved: `job-add-slice-command.ts` imports these
// from `./job-commands.js`.
export { asJson, SESSION_ID_HELP, resolveJobStateRoot };
export type { JobJsonOpts, JobRootOpts, JobProjectOpts } from './job-command-shared.js';

// M4.2: wire rotate-now to JobRotation (session-rotate callbacks are stubs
// pending M6.5 batch-fix).
function registerJobRotateNowCommand(job: Command, io: ProgramIO): void {
  addJsonOption(
    job
      .command('rotate-now')
      .requiredOption('--job-id <jid>')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action(async (opts: JobIdOnlyOpts) => {
    const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
    const rotation = new JobRotation(
      store,
      async (_jid) => {
        /* delegate to peaks session rotate — implementation wired in M6.5 batch-fix */ return {
          rotated: true
        };
      },
      async (jid) => ({ jobId: jid, cycle: 0 })
    );
    const r = await rotation.rotateNow(opts.jobId);
    printResult(io, ok('rotate-now', r as unknown as Record<string, unknown>), asJson(opts));
  });
}

function registerJobSubagentCleanupCommand(job: Command, io: ProgramIO): void {
  addJsonOption(
    job
      .command('subagent-cleanup')
      .requiredOption('--job-id <jid>')
      .requiredOption('--batch-id <bid>')
      .option('--force')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action(async (opts: JobSubagentCleanupOpts) => {
    const wrapper = new SubAgentJobWrapper(
      new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir),
      async () => ({ batchId: opts.batchId })
    );
    const r = await wrapper.cleanup({
      jobId: opts.jobId,
      batchId: opts.batchId,
      force: !!opts.force
    });
    printResult(io, ok('subagent-cleanup', r), asJson(opts));
  });
}

export function registerJobCommands(
  program: Command,
  io: ProgramIO = {
    stdout: (t: string) => process.stdout.write(t),
    stderr: (t: string) => process.stderr.write(t)
  }
): void {
  const job = new Command('job').description(
    'Drive long multi-slice work as one Job (peaks-code Step 0.8+)'
  );

  registerJobInitStatusCommands(job, io);
  registerJobRotateNowCommand(job, io);
  registerJobSubagentCleanupCommand(job, io);
  registerJobCheckpointCommands(job, io);
  registerJobRunCommands(job, io);
  registerJobCostCheckCommand(job, io);

  program.addCommand(job);
}
