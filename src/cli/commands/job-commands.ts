// src/cli/commands/job-commands.ts
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { JobStateStore } from '../../services/job/job-state-store.js';
import { JobOrchestrator } from '../../services/job/job-orchestrator.js';
import {
  writeJobProgress,
  readJobProgress,
  tryReadJobProgress
} from '../../services/job/job-progress-store.js';
import { JobRotation } from '../../services/job/job-rotation.js';
import { SubAgentJobWrapper } from '../../services/job/subagent-job-wrapper.js';
import { emitJobEvent } from '../../services/job/job-event-emitter.js';
import {
  JobInitInputSchema,
  JobCheckpointInputSchema,
  JobBlockInputSchema
} from '../../services/job/job-types.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import {
  buildCostCheckEnvelope,
  runKarpathyCostCheck
} from '../../services/karpathy-cost/karpathy-cost-check-service.js';
import { read24hState } from '../../services/24h-mode/store.js';
import {
  codegraphRefreshNotice,
  refreshCodegraphAfterSlice,
  type CodegraphAutorefreshResult
} from '../../services/codegraph/codegraph-autorefresh.js';

// `printResult`'s third parameter is `asJson: boolean`. Each `job` subcommand
// registers `--json` (see the `addJsonOption` calls below), so the flag to pass
// it is `opts.json` — NEVER the whole options object. Commander types an
// action's `opts` as `any`, so `printResult(io, envelope, opts)` type-checks
// and is ALWAYS truthy: it forces the envelope branch and makes the
// `warning: ` / `next: ` human rendering in `cli-helpers.ts` unreachable. That
// is how the A2 codegraph-refresh warning ended up inside the JSON stdout
// envelope instead of on stderr as `warning: `. `job progress` always passed
// `opts.json`; the rest of this file did not, and E1 (2026-09-17) brought them
// in line. Do not reintroduce the object form.
//
// S10 (2026-09-20): the parameter is now `JobJsonOpts` rather than `any`. The
// gate above is about which VALUE is passed, not about the parameter's type —
// declaring the one field this function reads is what stops every `opts.<x>`
// call site in the file from being an `any` access. See the option-interface
// block above `registerJobCommands`.
function asJson(opts: JobJsonOpts): boolean {
  return opts.json === true;
}

/**
 * F1 (rid 2026-09-17-exit-code-truth): report a FAILED envelope **and** make the
 * process exit non-zero.
 *
 * WHY THIS EXISTS. `printResult` (`src/cli/cli-helpers.ts`) renders a failed
 * envelope — `CODE: message` + `nextActions` on stderr — but it does NOT set
 * `process.exitCode`. Measured with the real CLI before this fix:
 * `peaks job block --job-id j1 --slice-id nope --reason why` printed
 * `SLICE_NOT_FOUND: …` on stderr and exited **0**, so CI and every script
 * wrapping `peaks job` read the failure as success. Seven of this file's nine
 * failure-reporting sites had that gap; only `job progress` set the code, and
 * that was the file's one accidental precedent rather than a rule.
 *
 * Every `fail(...)` envelope in this file now goes through here, so "reported a
 * failure" and "exited non-zero" cannot drift apart again. The helper takes the
 * Commander `opts` object and calls `asJson(opts)` itself — it must never be
 * handed a bare `opts.json`-less boolean, and it must never pass `opts` to
 * `printResult` (see the `asJson` comment above for that bug's history).
 *
 * DELIBERATELY NOT APPLIED TO THE ADVISORY PATHS. Three sites in this file
 * report a non-fatal outcome through an `ok(...)` envelope and MUST keep
 * exiting 0: the two `emitJobEvent` best-effort catches (`job init`,
 * `job status`) and the post-slice codegraph refresh in `job checkpoint`, whose
 * stated design is "a refresh failure must never fail the checkpoint". Those
 * are annotated in place; `tests/unit/cli/job-exit-code.test.ts` pins both
 * directions so a future blanket "every warning exits 1" edit turns red.
 */
function failResult(io: ProgramIO, result: ResultEnvelope<unknown>, opts: JobJsonOpts): void {
  printResult(io, result, asJson(opts));
  process.exitCode = 1;
}

function projectRoot(opts: JobProjectOpts): string {
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
    if (
      entry.isDirectory() &&
      existsSync(join(runtimeDir, entry.name, 'job', jobId, 'state.json'))
    ) {
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
 * 3. `getCurrentSessionId(project)` — this caller's session binding, falling back
 *    to `.peaks/_runtime/session.json` when no caller binding is resolvable
 * 4. Error (NO_ACTIVE_SESSION) — must never silently fall back to a random uuid
 *
 * When `jobId` is passed and it is absent from the resolved session, the thrown
 * error names the session that does hold it (if any), instead of leaving the
 * caller with a bare "no state for <job> at <other-sid>" path.
 */
function resolveJobStateRoot(
  opts: JobRootOpts,
  jobId?: string
): { rootDir: string; sessionId: string; projectRoot: string } {
  const project = projectRoot(opts);
  const sessionId = opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
  if (!sessionId) {
    throw new Error(
      'NO_ACTIVE_SESSION: peaks job requires --session-id or an active peaks-code session via peaks workspace init'
    );
  }
  // Sid axis — the sibling of the jobId guard in `JobStateStore.jobDir`. A
  // caller-supplied `--session-id` reaches this join unmodified, so a
  // traversal value lands `job/<id>/state.json` outside every project root
  // while the envelope still reads `ok: true`.
  if (isUnsafePathInput(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
  }
  const rootDir = join(project, '.peaks', '_runtime', sessionId, 'job');
  if (jobId && !existsSync(join(rootDir, jobId, 'state.json'))) {
    const other = findSessionHoldingJob(project, jobId);
    throw new Error(
      other
        ? `JOB_NOT_IN_SESSION: no job "${jobId}" in session "${sessionId}"; it lives in session "${other}" — re-run with --session-id ${other}`
        : `JOB_NOT_IN_SESSION: no job "${jobId}" in session "${sessionId}" (and no other session under .peaks/_runtime/ has it)`
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
  sliceId: string
): { sliceId: string } | { message: string; validSliceIds: string[] } {
  const slices = store.load(jobId).slices;
  const hit = slices.find((sl) => sl.sliceId === sliceId || sl.label === sliceId);
  if (hit) return { sliceId: hit.sliceId };
  return {
    message: `no slice "${sliceId}" in job ${jobId}; valid ids: ${slices.map((sl) => `${sl.sliceId} (${sl.label})`).join(', ')}`,
    validSliceIds: slices.map((sl) => sl.sliceId)
  };
}

/**
 * S10 (2026-09-20) — the option shapes the `job` subcommands read.
 *
 * WHY. Commander types an action's `opts` as `any`, so every `opts.<field>`
 * access in this file was an `any` access: 109 `no-unsafe-*` findings, the
 * largest single TS root in the S10 census. The root is the *entrance* — the
 * untyped `opts` parameter — not the 109 sites, so the fix is to declare it.
 *
 * Each interface names exactly the options its own command READS, plus `--json`
 * (added by `addJsonOption`). So a field absent here is a field that command
 * does not read, and reading it is now a compile error instead of an `any`
 * access. (A command may declare more than it reads — `job status` declares
 * `--show-cost` and never looks at it; that option is deliberately not listed.)
 * `readonly` is honest: these are read-only inputs; Commander owns the object.
 *
 * The four helpers above (`asJson`, `failResult`, `projectRoot`,
 * `resolveJobStateRoot`) take the narrowest structural type each one actually
 * reads, so all eleven action callbacks remain assignable to them.
 */
interface JobJsonOpts {
  readonly json?: boolean;
}

interface JobProjectOpts {
  readonly project?: string;
}

interface JobRootOpts extends JobProjectOpts {
  readonly sessionId?: string;
}

interface JobInitOpts extends JobRootOpts, JobJsonOpts {
  readonly jobId: string;
  readonly sliceList: string;
  readonly parallelismHint?: string;
  readonly exitPolicy?: string;
  readonly mainLoopStrategy?: string;
  readonly rotateEvery?: string;
}

interface JobStatusOpts extends JobRootOpts, JobJsonOpts {
  readonly jobId: string;
  readonly watch?: boolean;
}

interface JobIdOnlyOpts extends JobRootOpts, JobJsonOpts {
  readonly jobId: string;
}

interface JobSubagentCleanupOpts extends JobIdOnlyOpts {
  readonly batchId: string;
  readonly force?: boolean;
}

interface JobCheckpointOpts extends JobIdOnlyOpts {
  readonly sliceId: string;
  readonly state: string;
  readonly commitSha?: string;
  readonly reason?: string;
}

interface JobBlockOpts extends JobIdOnlyOpts {
  readonly sliceId: string;
  readonly reason: string;
}

interface JobProgressOpts extends JobIdOnlyOpts {
  readonly allowMissing?: boolean;
}

interface JobCostCheckOpts extends JobRootOpts, JobJsonOpts {
  readonly reviewFile: string;
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
    .action((opts: JobInitOpts) => {
      const project = projectRoot(opts);
      // Resolve sessionId: explicit flag > PEAKS_SESSION_ID > caller-first session binding
      // (this caller's binding, else the project-global session.json) > FAIL.
      // Per spec §3.3, Job state lives at .peaks/_runtime/<sessionId>/job/<jobId>/state.json —
      // a random UUID would scatter state across dirs and break resume/auto-compact.
      let sessionId: string | null =
        opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
      if (!sessionId) {
        return failResult(
          io,
          fail(
            'init',
            'NO_ACTIVE_SESSION',
            'peaks job init requires --session-id (or an active peaks-code session via peaks workspace init)',
            { project },
            [
              'Re-run with --session-id <sid>',
              'Or run `peaks workspace init` to create a session first'
            ]
          ),
          opts
        );
      }
      const parsed = JobInitInputSchema.safeParse({
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
      try {
        emitJobEvent({
          kind: 'job-started',
          jobId: state.jobId,
          total: state.slices.length,
          strategy: state.mainLoopStrategy
        });
      } catch (e) {
        // ADVISORY (F1, 2026-09-17) — deliberately exits 0. Event emission is a
        // telemetry side effect; a failed emit does not mean `job init` failed
        // (the state file was already written above). This catch must NOT be
        // routed through `failResult`. Pinned by the "advisory stays 0" control
        // in tests/unit/cli/job-exit-code.test.ts.
        void e;
      }
      printResult(
        io,
        ok('init', {
          jobId: state.jobId,
          sliceCount: state.slices.length,
          statePath: `${jobRoot.rootDir}/${state.jobId}/state.json`
        }),
        asJson(opts)
      );
    });
  addJsonOption(job.commands.find((c) => c.name() === 'init')!);

  job
    .command('status')
    .requiredOption('--job-id <jid>')
    .option('--watch', 'poll every 3s')
    .option('--show-cost', 'overlay cost from peaks budget')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action((opts: JobStatusOpts) => {
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
    });
  addJsonOption(job.commands.find((c) => c.name() === 'status')!);

  // M4.2: wire rotate-now to JobRotation (session-rotate callbacks are stubs pending M6.5 batch-fix).
  job
    .command('rotate-now')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts: JobIdOnlyOpts) => {
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
  addJsonOption(job.commands.find((c) => c.name() === 'rotate-now')!);

  job
    .command('subagent-cleanup')
    .requiredOption('--job-id <jid>')
    .requiredOption('--batch-id <bid>')
    .option('--force')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts: JobSubagentCleanupOpts) => {
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
  addJsonOption(job.commands.find((c) => c.name() === 'subagent-cleanup')!);

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
    .action(async (opts: JobCheckpointOpts) => {
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
        return failResult(
          io,
          fail('checkpoint', 'INVALID_CHECKPOINT', parsed.error.message, {}),
          opts
        );
      const jobRoot = resolveJobStateRoot(opts, opts.jobId);
      const store = new JobStateStore(jobRoot.rootDir);
      // D7: `--slice-id` accepts the canonical `slice-NNN` or the slice's label
      // ("S1"); an id that matches no slice is rejected here, BEFORE any write,
      // so progress.json is never touched by a checkpoint that matched nothing.
      const slice = resolveSliceId(store, parsed.data.jobId, parsed.data.sliceId);
      if ('message' in slice) {
        return failResult(
          io,
          fail(
            'checkpoint',
            'SLICE_NOT_FOUND',
            slice.message,
            {
              jobId: parsed.data.jobId,
              sliceId: parsed.data.sliceId,
              validSliceIds: slice.validSliceIds
            },
            ['Re-run with one of the valid slice ids']
          ),
          opts
        );
      }
      const sliceId = slice.sliceId;
      const orch = new JobOrchestrator(store);
      // 2026-09-03-codegraph-autorefresh: set on --state done so the ok
      // envelope carries a non-blocking `codegraph` result; null for
      // failed/skipped (no slice-complete boundary).
      let codegraph: CodegraphAutorefreshResult | null = null;
      // A2 (2026-09-17): the human-visible half of the refresh outcome. null
      // when the refresh succeeded or when no codegraph store was in use.
      let codegraphWarning: string | null = null;
      if (parsed.data.state === 'done') {
        await orch.checkpointDone({
          jobId: parsed.data.jobId,
          sliceId,
          ...(parsed.data.commitSha ? { commitSha: parsed.data.commitSha } : {})
        });
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
        // Auto codegraph refresh at the slice-complete boundary. Best-effort:
        // a refresh failure must never fail the checkpoint.
        //
        // A2 (2026-09-17): "must never fail the checkpoint" is not "must
        // never be seen". A refresh that did not happen while a codegraph
        // store IS in use is now a warning line (stderr, `warning: ` prefix,
        // via printResult) naming the reason and the remedy. See
        // `codegraphRefreshNotice` for why `no-codegraph-dir` stays silent.
        //
        // ADVISORY (F1, 2026-09-17) — deliberately exits 0, and the reach of
        // that word is exactly here. The checkpoint itself SUCCEEDED (the slice
        // flipped to done and progress.json was mirrored above); the refresh is
        // a derived index, rebuildable on demand. So the outcome is reported
        // through `ok(...)` + a `warning:` line, never through `failResult`,
        // and `process.exitCode` is left alone even when the refresh throws.
        // Raising it would turn an advisory rebuild into a build breaker for
        // every CI that runs `peaks job checkpoint`. Pinned by the "advisory
        // stays 0" control in tests/unit/cli/job-exit-code.test.ts.
        try {
          codegraph = await refreshCodegraphAfterSlice(project);
        } catch (e) {
          codegraph = {
            refreshed: false,
            reason: 'unavailable',
            note: `auto codegraph refresh failed: ${e instanceof Error ? e.message : String(e)}`
          };
        }
        codegraphWarning = codegraphRefreshNotice(codegraph);
      } else if (parsed.data.state === 'skipped') {
        await orch.checkpointSkipped({
          jobId: parsed.data.jobId,
          sliceId,
          reason: parsed.data.reason!
        });
      } else {
        await orch.checkpointFailed({
          jobId: parsed.data.jobId,
          sliceId,
          reason: parsed.data.reason!
        });
      }
      printResult(
        io,
        ok(
          'checkpoint',
          { sliceId, status: parsed.data.state, codegraph },
          codegraphWarning === null ? [] : [codegraphWarning]
        ),
        asJson(opts)
      );
    });
  addJsonOption(job.commands.find((c) => c.name() === 'checkpoint')!);

  job
    .command('block')
    .requiredOption('--job-id <jid>')
    .requiredOption('--slice-id <rid>')
    .requiredOption('--reason <text>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action(async (opts: JobBlockOpts) => {
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
            ['Re-run with one of the valid slice ids']
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
    });
  addJsonOption(job.commands.find((c) => c.name() === 'block')!);

  job
    .command('continue')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action((opts: JobIdOnlyOpts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const orch = new JobOrchestrator(store);
      const r = orch.continueNow(opts.jobId);
      printResult(io, ok('continue', r as unknown as Record<string, unknown>), asJson(opts));
    });
  addJsonOption(job.commands.find((c) => c.name() === 'continue')!);

  job
    .command('resume')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action((opts: JobIdOnlyOpts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(
        io,
        ok('resume', { resumed: opts.jobId, ...(s as unknown as Record<string, unknown>) }),
        asJson(opts)
      );
    });
  addJsonOption(job.commands.find((c) => c.name() === 'resume')!);

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
    // H3 (rid 2026-09-17-exit-code-root-cause): this string used to promise
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
    .option(
      '--allow-missing',
      'report an absent progress.json as NO_PROGRESS (expected absence) rather than PROGRESS_READ_FAILED (read error); the command still exits non-zero'
    )
    .action((opts: JobProgressOpts) => {
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
                // H3: the second action used to read "Or pass --allow-missing to
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
          ok(
            'progress',
            progress,
            [],
            [`Next: slice #${progress.done + 1} of ${progress.total} (${progress.currentSlice})`]
          ),
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
    });
  addJsonOption(job.commands.find((c) => c.name() === 'progress')!);

  job
    .command('handoff')
    .requiredOption('--job-id <jid>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .option('--project <repo>')
    .action((opts: JobIdOnlyOpts) => {
      const store = new JobStateStore(resolveJobStateRoot(opts, opts.jobId).rootDir);
      const orch = new JobOrchestrator(store);
      const s = orch.status(opts.jobId);
      printResult(
        io,
        ok('handoff', { handoffFor: opts.jobId, ...(s as unknown as Record<string, unknown>) }),
        asJson(opts)
      );
    });
  addJsonOption(job.commands.find((c) => c.name() === 'handoff')!);

  job
    .command('karpathy-cost-check')
    .description(
      "Read the slice's rd/karpathy-review.md and decide whether to downgrade a block gateAction to warn (slice 2026-07-30-karpathy-cost-self-review)."
    )
    .requiredOption(
      '--review-file <path>',
      'path to rd/karpathy-review.md (or its .json sibling if the file is JSON)'
    )
    .option('--project <repo>')
    .option('--session-id <sid>', SESSION_ID_HELP)
    .action((opts: JobCostCheckOpts) => {
      const project = projectRoot(opts);
      const sessionId =
        opts.sessionId ?? process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(project);
      if (!sessionId) {
        return failResult(
          io,
          fail(
            'karpathy-cost-check',
            'NO_ACTIVE_SESSION',
            'karpathy-cost-check requires --session-id (or an active peaks-code session)',
            { project },
            [
              'Re-run with --session-id <sid>',
              'Or run `peaks workspace init` to create a session first'
            ]
          ),
          opts
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
        is24hModeActive
      });
      printResult(io, buildCostCheckEnvelope(out), asJson(opts));
    });
  addJsonOption(job.commands.find((c) => c.name() === 'karpathy-cost-check')!);

  program.addCommand(job);
}
