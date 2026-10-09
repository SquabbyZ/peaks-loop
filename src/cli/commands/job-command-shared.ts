// Split out of `job-commands.ts`: the option
// shapes every `job` subcommand reads, plus the four helpers that take the
// narrowest structural type each one actually reads. Re-exported from
// `job-commands.ts`, which is still their published import path.
import type { ResultEnvelope } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import type { JobStateStore } from '../../services/job/job-state-store.js';

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
export function asJson(opts: JobJsonOpts): boolean {
  return opts.json === true;
}

/**
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
export function failResult(
  io: ProgramIO,
  result: ResultEnvelope<unknown>,
  opts: JobJsonOpts
): void {
  printResult(io, result, asJson(opts));
  process.exitCode = 1;
}

export function projectRoot(opts: JobProjectOpts): string {
  // Reuse the workspace root resolver from peaks CLI; for now, CWD as a safe placeholder.
  return opts.project ?? process.cwd();
}

/**
 * D7: slices are keyed `slice-NNN`, but `peaks job init --slice-list "S1,…"`
 * takes labels, so the natural string to pass back to `--slice-id` is that same
 * label. Resolve an exact sliceId OR an exact label to the canonical sliceId;
 * anything else is a hard error listing the valid ids, so a mistyped
 * `slice-04` can never be accepted as a silent no-op that leaves the slice
 * pending.
 */
export function resolveSliceId(
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
export interface JobJsonOpts {
  readonly json?: boolean;
}

export interface JobProjectOpts {
  readonly project?: string;
}

export interface JobRootOpts extends JobProjectOpts {
  readonly sessionId?: string;
}

export interface JobInitOpts extends JobRootOpts, JobJsonOpts {
  readonly jobId: string;
  readonly sliceList: string;
  readonly parallelismHint?: string;
  readonly exitPolicy?: string;
  readonly mainLoopStrategy?: string;
  readonly rotateEvery?: string;
}

export interface JobStatusOpts extends JobRootOpts, JobJsonOpts {
  readonly jobId: string;
  readonly watch?: boolean;
}

export interface JobIdOnlyOpts extends JobRootOpts, JobJsonOpts {
  readonly jobId: string;
}

export interface JobSubagentCleanupOpts extends JobIdOnlyOpts {
  readonly batchId: string;
  readonly force?: boolean;
}

export interface JobCheckpointOpts extends JobIdOnlyOpts {
  readonly sliceId: string;
  readonly state: string;
  readonly commitSha?: string;
  readonly reason?: string;
}

export interface JobBlockOpts extends JobIdOnlyOpts {
  readonly sliceId: string;
  readonly reason: string;
}

export interface JobProgressOpts extends JobIdOnlyOpts {
  readonly allowMissing?: boolean;
}

export interface JobCostCheckOpts extends JobRootOpts, JobJsonOpts {
  readonly reviewFile: string;
}
