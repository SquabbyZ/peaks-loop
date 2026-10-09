// Split out of `job-commands.ts`:
// `job init` and `job status`. Both are registered first so the `job` help
// lists them in the order the CLI surface dump pins.
import type { Command } from 'commander';
import { ok, fail } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import { emitJobEvent } from '../../services/job/job-event-emitter.js';
import { JobInitInputSchema } from '../../services/job/job-types.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  asJson,
  failResult,
  projectRoot,
  type JobInitOpts,
  type JobStatusOpts
} from './job-command-shared.js';
import { SESSION_ID_HELP, resolveJobStateRoot } from './job-state-root.js';

/**
 * `job init` resolves its own session id (the schema needs it before the state
 * root exists), so it repeats the D6 precedence rather than reusing
 * `resolveJobStateRoot`.
 */
function resolveInitSessionId(opts: JobInitOpts, project: string): string | null {
  return opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
}

/**
 * ADVISORY (F1, 2026-09-17) — deliberately exits 0. Event emission is a
 * telemetry side effect; a failed emit does not mean `job init` failed (the
 * state file was already written). This catch must NOT be routed through
 * `failResult`. Pinned by the "advisory stays 0" control in
 * tests/unit/cli/job-exit-code.test.ts.
 */
function emitJobStarted(state: ReturnType<JobOrchestrator['init']>): void {
  try {
    emitJobEvent({
      kind: 'job-started',
      jobId: state.jobId,
      total: state.slices.length,
      strategy: state.mainLoopStrategy
    });
  } catch (e) {
    void e;
  }
}

function failInitNoActiveSession(io: ProgramIO, opts: JobInitOpts, project: string): void {
  failResult(
    io,
    fail(
      'init',
      'NO_ACTIVE_SESSION',
      'peaks job init requires --session-id (or an active peaks-code session via peaks workspace init)',
      { project },
      ['Re-run with --session-id <sid>', 'Or run `peaks workspace init` to create a session first']
    ),
    opts
  );
}

function parseJobInitInput(opts: JobInitOpts, sessionId: string, project: string) {
  return JobInitInputSchema.safeParse({
    jobId: opts.jobId,
    sessionId,
    sliceList: opts.sliceList
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
    parallelismHint: opts.parallelismHint,
    exitPolicy: opts.exitPolicy,
    mainLoopStrategy: opts.mainLoopStrategy,
    rotateEvery: Number(opts.rotateEvery),
    project,
    json: opts.json
  });
}

function runJobInit(opts: JobInitOpts, io: ProgramIO): void {
  const project = projectRoot(opts);
  // Resolve sessionId: explicit flag > PEAKS_SESSION_ID > caller-first session binding
  // (this caller's binding, else the project-global session.json) > FAIL.
  // Per spec §3.3, Job state lives at .peaks/_runtime/<sessionId>/job/<jobId>/state.json —
  // a random UUID would scatter state across dirs and break resume/auto-compact.
  let sessionId: string | null = resolveInitSessionId(opts, project);
  if (!sessionId) {
    failInitNoActiveSession(io, opts, project);
    return;
  }
  const parsed = parseJobInitInput(opts, sessionId, project);
  if (!parsed.success)
    return failResult(io, fail('init', 'INVALID_INIT', parsed.error.message, {}), opts);
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
    rotateEvery: parsed.data.rotateEvery
  });
  emitJobStarted(state);
  printResult(
    io,
    ok('init', {
      jobId: state.jobId,
      sliceCount: state.slices.length,
      statePath: `${jobRoot.rootDir}/${state.jobId}/state.json`
    }),
    asJson(opts)
  );
}

function runJobStatus(opts: JobStatusOpts, io: ProgramIO): void {
  const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
  const orch = new JobOrchestrator(store);
  const s = orch.status(opts.jobId);
  if (opts.watch) {
    const draw = () => {
      const bar = `[${'='.repeat(s.done)}${' '.repeat(s.total - s.done)}]`;
      process.stdout.write(
        `\rjob ${opts.jobId}: ${bar} ${s.done}/${s.total}${s.currentSlice ? ` next=${s.currentSlice}` : ''}    `
      );
    };
    draw();
    const iv = setInterval(() => {
      const u = orch.status(opts.jobId);
      Object.assign(s, u);
      draw();
      if (u.done + u.failed + u.skipped + u.blocked >= u.total) clearInterval(iv);
    }, 3000);
    process.on('SIGINT', () => {
      clearInterval(iv);
      process.stdout.write('\n');
      process.exit(0);
    });
    return;
  }
  try {
    emitJobEvent({
      kind: 'job-progress',
      jobId: opts.jobId,
      done: s.done,
      total: s.total,
      ...(s.currentSlice ? { currentSlice: s.currentSlice } : {})
    });
  } catch (e) {
    // ADVISORY (F1, 2026-09-17) — deliberately exits 0. The status itself
    // was already read successfully; the emit is telemetry. Same rule as
    // the `job init` catch above: do NOT route through `failResult`.
    void e;
  }
  printResult(io, ok('status', s as unknown as Record<string, unknown>), asJson(opts));
}

export function registerJobInitStatusCommands(job: Command, io: ProgramIO): void {
  addJsonOption(
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
  ).action((opts: JobInitOpts) => runJobInit(opts, io));

  addJsonOption(
    job
      .command('status')
      .requiredOption('--job-id <jid>')
      .option('--watch', 'poll every 3s')
      .option('--show-cost', 'overlay cost from peaks budget')
      .option('--session-id <sid>', SESSION_ID_HELP)
      .option('--project <repo>')
  ).action((opts: JobStatusOpts) => runJobStatus(opts, io));
}
