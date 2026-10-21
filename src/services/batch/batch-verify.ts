// src/services/batch/batch-verify.ts
//
// The unified verification: ONE acceptance gate for the whole batch.
//
// WHY THE GATE IS THE SINGLE-TASK GATE, VERBATIM. The fast-lane norm's §1
// defines the acceptance gate a single task runs as `test pass + tsc pass +
// lint pass`. The batch mode runs THAT gate once for the whole batch instead
// of once per item, so the strictness does not drop by a notch: only the
// COUNT changes (N runs became 1). A batch that ran a weaker gate could ship
// a broken tree, so the gate is a constant here and the test pins the
// constant, not the runner.
//
// WHY ATTRIBUTION EXISTS. A red unified gate has two possible causes and
// they call for different repairs: an item's own breakage — which the fix
// phase's per-item scoped test exists to catch at the moment it happens — or
// a breakage that only appears when the items are together, which is a
// cross-item integration problem. The unified gate can only tell the two
// apart because the fix phase ran each item's scoped test immediately after
// that item's fix: the per-item outcome IS the evidence. An item whose
// scoped test was green is not the culprit, so a red gate with every item
// green is an integration failure, and a red gate with an item that never
// reached a green scoped test is a single-item failure whose report names
// that item.
//
// WHERE THE EVIDENCE COMES FROM. The batch's progress record: the fix phase
// appends an item as `fixed` only after that item's scoped test is green, so
// an item's status is its scoped-test outcome. Reading it from the record is
// what makes the attribution possible at all.
//
// WHY THE PHASE-BOUNDARY NOTICE IS HERE. The batch reaches its cheapest
// compaction moment at a phase boundary — the diagnoses are on disk and no
// code has moved yet — and the notice that says so must not turn into a
// request that the user manage their own context. It therefore routes
// through the same verdict channel the zero-pause contract lives in, so the
// wording cannot drift into asking for an action the system owns.

import { spawnSync } from 'node:child_process';

import { buildContextVerdict } from '../../cli/commands/core/skill-context-verdict.js';
import { thresholdFor, type AutoCompactMode } from '../code/auto-compact-modes.js';
import { readBatchProgress } from './batch-progress-store.js';
import type { BatchItem, BatchProgress } from './batch-progress-types.js';

/**
 * The acceptance gate a batch runs, ONCE.
 *
 * The same three legs a single task runs, in the same order. The batch mode
 * amortizes the runs; it does not choose a different gate.
 */
export const BATCH_ACCEPTANCE_GATE = ['test', 'tsc', 'lint'] as const;

/** One leg of the gate. */
export type BatchAcceptanceCheck = (typeof BATCH_ACCEPTANCE_GATE)[number];

/** What one leg reported. */
export interface BatchCheckOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Runs one leg of the gate.
 *
 * A runner is injected rather than hard-wired so the attribution can be
 * exercised without spending a full suite's wall clock on every case, and so
 * a caller that already has a runner (the lane's own harness) does not have
 * to run the legs twice.
 */
export type BatchCheckRunner = (check: BatchAcceptanceCheck) => BatchCheckOutcome;

/** One leg's result, as the verdict reports it. */
export interface BatchCheckResult {
  readonly name: BatchAcceptanceCheck;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Which kind of breakage a red gate points at.
 *
 * `integration` — the batch itself: either it passed, or every item was green
 * at its own scoped test and the breakage is between the items. `single-item`
 * — one item never reached a green scoped test, and the failing detail names
 * it. `unknown` — there is no evidence to attribute with: no batch record, no
 * items, or a leg that never ran.
 */
export type BatchAttribution = 'integration' | 'single-item' | 'unknown';

/** The verdict of the unified verification. */
export interface BatchVerificationResult {
  readonly gate: 'pass' | 'fail' | 'blocked';
  readonly checks: readonly BatchCheckResult[];
  readonly attribution: BatchAttribution;
}

/** The command each leg runs, in the repository's own terms. */
const GATE_COMMANDS: Readonly<Record<BatchAcceptanceCheck, string>> = {
  test: 'pnpm test',
  tsc: 'pnpm exec tsc -p tsconfig.json --noEmit',
  lint: 'pnpm lint'
};

/** How many lines of a failing leg's output the detail carries. */
const FAILURE_DETAIL_LINES = 20;

/** How much output a leg may produce before the runner refuses to buffer it. */
// eslint-disable-next-line no-magic-numbers -- a byte count, not a policy number
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The seam a caller may replace: how one leg is run. */
export interface BatchVerificationOptions {
  readonly runCheck?: BatchCheckRunner;
}

/**
 * Verify the whole batch against the acceptance gate, once.
 *
 * @param projectRoot - The repository the batch was fixed in.
 * @param sessionId - The session the batch's progress record belongs to.
 * @param batchId - The batch whose record holds the per-item evidence.
 * @param options - The runner to use; the repository's own commands by
 *   default.
 * @returns The gate's verdict, the legs it ran, and the attribution. A
 *   malformed progress record throws rather than being read as an empty
 *   batch: the record IS the attribution's evidence, so losing it quietly
 *   would turn a verdict into a guess.
 */
export function runBatchVerification(
  projectRoot: string,
  sessionId: string,
  batchId: string,
  options: BatchVerificationOptions = {}
): BatchVerificationResult {
  const runCheck = options.runCheck ?? ((check) => runLeg(check, projectRoot));
  const checks: BatchCheckResult[] = [];
  let blocked = false;
  for (const check of BATCH_ACCEPTANCE_GATE) {
    let outcome: BatchCheckOutcome;
    try {
      outcome = runCheck(check);
    } catch (error) {
      // A leg that never produced a verdict is not a red leg: the gate is
      // blocked, because nothing is known about the leg at all.
      blocked = true;
      outcome = { ok: false, detail: `could not run: ${describeError(error)}` };
    }
    checks.push({ name: check, ok: outcome.ok, detail: outcome.detail });
  }
  const gate = blocked ? 'blocked' : checks.every((check) => check.ok) ? 'pass' : 'fail';
  const progress = readBatchProgress(projectRoot, sessionId, batchId);
  const offenders = offendersOf(progress);
  const attribution = decideAttribution(gate, progress, offenders);
  return {
    gate,
    checks: nameOffenders(checks, offenders, attribution),
    attribution
  };
}

/**
 * The notice shown when the batch reaches a phase boundary.
 *
 * The wording states what the SYSTEM is doing — compaction is running, this
 * is the moment its recovery cost is lowest, and the progress is already on
 * disk. It never asks the user for an action: the zero-pause contract makes
 * compaction the system's job, and a notice that routes the step to the user
 * is the regression the shared verdict's guard exists to catch.
 *
 * The context ratio in the line comes from `buildContextVerdict` rather than
 * from a second reading of the number here, so the occupancy shown and the
 * tier the system acts on cannot disagree.
 *
 * @param input - How far the batch got, and the ratio and mode to report.
 * @returns The one line the phase boundary shows.
 */
export function buildPhaseBoundaryNotice(input: {
  readonly done: number;
  readonly total: number;
  readonly ratio?: number;
  readonly mode?: AutoCompactMode;
}): string {
  const mode = input.mode ?? 'standard';
  const ratio = input.ratio ?? thresholdFor(mode, 'autoFire');
  const verdict = buildContextVerdict(ratio, mode);
  return `诊断完成（${input.done}/${input.total} 项）；正在压缩 —— 恢复成本最低的时点，进度已落盘（上下文 ${verdict.context.ratioPct}）`;
}

/**
 * Run one leg through the repository's own command.
 *
 * The command strings are constants and the working directory travels as the
 * child's `cwd`, never as part of the command line — so nothing a caller
 * supplies reaches a shell.
 */
function runLeg(check: BatchAcceptanceCheck, projectRoot: string): BatchCheckOutcome {
  const result = spawnSync(GATE_COMMANDS[check], {
    cwd: projectRoot,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === 0) return { ok: true, detail: 'passed' };
  return { ok: false, detail: tail(`${result.stdout ?? ''}${result.stderr ?? ''}`) };
}

/** The last lines of a leg's output — enough to see what failed. */
function tail(output: string): string {
  const lines = output.trim().split('\n');
  return lines.slice(-FAILURE_DETAIL_LINES).join('\n');
}

/** The items whose own scoped test was not green. */
function offendersOf(progress: BatchProgress | null): readonly BatchItem[] {
  if (progress === null) return [];
  return progress.items.filter((item) => item.status !== 'fixed' && item.status !== 'verified');
}

/** Which kind of breakage the verdict points at. */
function decideAttribution(
  gate: BatchVerificationResult['gate'],
  progress: BatchProgress | null,
  offenders: readonly BatchItem[]
): BatchAttribution {
  if (gate === 'pass') return 'integration';
  if (gate === 'blocked') return 'unknown';
  if (progress === null || progress.items.length === 0) return 'unknown';
  return offenders.length === 0 ? 'integration' : 'single-item';
}

/**
 * Put the culprit's name into the failing legs' details.
 *
 * A red gate that does not say which item is at fault sends the reader back
 * to the whole batch to find out, which is the wall-clock the unified gate
 * was introduced to save.
 */
function nameOffenders(
  checks: readonly BatchCheckResult[],
  offenders: readonly BatchItem[],
  attribution: BatchAttribution
): readonly BatchCheckResult[] {
  if (attribution !== 'single-item' || offenders.length === 0) return checks;
  const names = offenders.map((item) => `${item.id} (${item.label})`).join(', ');
  return checks.map((check) =>
    check.ok
      ? check
      : {
          ...check,
          detail: `${check.detail} — item(s) not green at their own scoped test: ${names}`
        }
  );
}

/** An error's message, whatever it turned out to be. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
