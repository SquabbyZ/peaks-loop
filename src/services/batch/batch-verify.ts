// src/services/batch/batch-verify.ts
//
// The unified verification: ONE acceptance gate for the whole batch.
//
// THE GATE IS THE SINGLE-TASK GATE, VERBATIM. The fast-lane norm's §1 defines
// the acceptance gate a single task runs as `test pass + tsc pass + lint
// pass`. The batch mode runs THAT gate once for the whole batch instead of
// once per item: only the COUNT changes (N runs became 1), so the strictness
// does not drop by a notch.
//
// WHY ATTRIBUTION EXISTS. A red gate has two causes: an item's own breakage,
// which the fix phase's per-item scoped test catches at the moment it
// happens, and a breakage that only appears when the items are together. The
// gate tells them apart because the fix phase ran each item's scoped test
// right after that item's fix, so the per-item outcome IS the evidence: the
// progress record appends an item as `fixed` only once that item is green.
//
// THE BUILD DEPENDENCY IS EXPLICIT. Two legs import build output: `tsc`
// resolves the workspace packages' subpath exports into `packages/*/dist`,
// and the suite imports the same packages through node_modules. That output
// is in no commit, so it is a PREREQUISITE of the gate, and the gate says so
// rather than guessing: a leg whose failure has the artifact shape is
// BLOCKED, with the build command as its remedy, and no item is named. The
// gate does not run the build itself: a verification phase that writes to the
// tree is not a verification, and the repository's own gate takes that road.
//
// THE PHASE-BOUNDARY NOTICE states what the SYSTEM is doing at the batch's
// cheapest compaction moment, and routes through the same verdict channel the
// zero-pause contract lives in, so it cannot ask the user to compact.

import { spawnSync } from 'node:child_process';

import { buildContextVerdict } from '../../cli/commands/core/skill-context-verdict.js';
import { thresholdFor, type AutoCompactMode } from '../code/auto-compact-modes.js';
import { readBatchProgress } from './batch-progress-store.js';
import type { BatchItem, BatchProgress } from './batch-progress-types.js';

/**
 * The acceptance gate a batch runs, ONCE: the same three legs a single task
 * runs, in the same order. The batch mode amortizes the runs; it does not
 * choose a different gate.
 */
export const BATCH_ACCEPTANCE_GATE = ['test', 'tsc', 'lint'] as const;

/** One leg of the gate. */
export type BatchAcceptanceCheck = (typeof BATCH_ACCEPTANCE_GATE)[number];

/**
 * The command that produces the build artifacts two of the legs import.
 * Named here because it is the remedy a blocked leg offers.
 */
export const BATCH_GATE_BUILD_COMMAND = 'pnpm build';

/** What one leg reported. */
export interface BatchCheckOutcome {
  readonly ok: boolean;
  /**
   * The leg's own output, in full: the artifact detector reads it, and a tail
   * of a failing `tsc` run can hold a genuine type error next to the
   * module-resolution errors.
   */
  readonly output: string;
}

/** Runs one leg of the gate, injected so a test need not spend a suite's wall clock. */
export type BatchCheckRunner = (check: BatchAcceptanceCheck) => BatchCheckOutcome;

/** One leg's result, as the verdict reports it. */
export interface BatchCheckResult {
  readonly name: BatchAcceptanceCheck;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Which kind of breakage a red gate points at: `integration` (the batch
 * itself), `single-item` (one item, named in the failing detail), or
 * `unknown` (no evidence to attribute with).
 */
export type BatchAttribution = 'integration' | 'single-item' | 'unknown';

/** The verdict of the unified verification. */
export interface BatchVerificationResult {
  readonly gate: 'pass' | 'fail' | 'blocked';
  readonly checks: readonly BatchCheckResult[];
  readonly attribution: BatchAttribution;
}

/**
 * The shape of a failure that is an ARTIFACT problem, not a source problem.
 */
export type BatchArtifactShape = 'missing-workspace-dist' | 'build-prerequisite-refused';

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

/** The repository's own sentence for a suite that refused to start. */
const BUILD_PREREQUISITE_REFUSAL = 'Test suite refused to start:';

/** The seam a caller may replace: how one leg is run. */
export interface BatchVerificationOptions {
  readonly runCheck?: BatchCheckRunner;
}

/**
 * Verify the whole batch against the acceptance gate, once. A malformed
 * progress record throws rather than reading as an empty batch: the record IS
 * the attribution's evidence, so losing it would turn a verdict into a guess.
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
      // A leg that never produced a verdict is not a red leg: nothing is
      // known about the leg at all.
      blocked = true;
      outcome = { ok: false, output: `could not run: ${describeError(error)}` };
    }
    const shape = outcome.ok ? null : detectArtifactFailure(outcome.output);
    if (shape !== null) blocked = true;
    checks.push({
      name: check,
      ok: outcome.ok,
      detail: shape === null ? tail(outcome.output) : blockedDetail(shape)
    });
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
 * The wording states what the SYSTEM is doing: compaction is running, this is
 * the moment its recovery cost is lowest, and the progress is already on
 * disk. It never asks the user for an action, because the zero-pause
 * contract makes compaction the system's job. The context ratio comes from
 * `buildContextVerdict` rather than from a second reading of the number, so
 * the occupancy shown and the tier the system acts on cannot disagree.
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
 * Is this leg's failure an ARTIFACT problem rather than a source problem?
 *
 * TWO SHAPES, and both are the repository's own. `missing-workspace-dist` is
 * the `tsc` leg's shape: every error it reported is a module-resolution
 * failure (TS2307 or TS7016) naming an internal workspace package, because
 * `tsc -p tsconfig.json` resolves the packages' subpath exports into their
 * `dist/` output, which no commit contains. That is the repository gate's
 * own rule (.husky/gate/repo.mjs), keyed on the PROPERTY rather than on one
 * spelling of the symptom: an absent build output says TS2307 and a missing
 * declaration file says TS7016, and both are the same problem.
 *
 * `build-prerequisite-refused` is the suite's shape: it refused to start
 * because the workspace build is stale, which is what the repository's own
 * test preflight does (tests/_global-setup/packages-build.ts). A run that
 * refused produced no results of its own, so a run that DID report results
 * is not this shape.
 */
export function detectArtifactFailure(output: string): BatchArtifactShape | null {
  const errors = output.split('\n').filter((line) => /error TS\d+/.test(line));
  if (errors.length > 0 && errors.every(isMissingWorkspaceModule)) {
    return 'missing-workspace-dist';
  }
  if (output.includes(BUILD_PREREQUISITE_REFUSAL) && !hasTestResults(output)) {
    return 'build-prerequisite-refused';
  }
  return null;
}

/**
 * Run one leg through the repository's own command. The command strings are
 * constants and the working directory travels as the child's `cwd`, so
 * nothing a caller supplies reaches a shell.
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
  if (result.status === 0) return { ok: true, output: 'passed' };
  return { ok: false, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** A module-resolution failure naming an internal workspace package. */
function isMissingWorkspaceModule(line: string): boolean {
  return /error TS(?:2307|7016)/.test(line) && /'peaks-loop-[^']*'/.test(line);
}

/** Did the suite report results of its own? A refused run reported none. */
function hasTestResults(output: string): boolean {
  return /Test Files\s+\d/.test(output);
}

/** What a blocked leg says: the reason, the remedy, and no item. */
function blockedDetail(shape: BatchArtifactShape): string {
  const why =
    shape === 'missing-workspace-dist'
      ? 'every error is a module-resolution failure naming an internal workspace package, which resolves into untracked build output'
      : 'the suite refused to start because the workspace build is stale';
  return `blocked — ${why}. Run \`${BATCH_GATE_BUILD_COMMAND}\` first, then re-run.`;
}

/** The last lines of a leg's output: enough to see what failed. */
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
 * Put the culprit's name into the failing legs' details: a red gate that
 * does not say which item is at fault sends the reader back to the whole
 * batch to find out. A BLOCKED gate never reaches here, because nothing is
 * known about the leg and so nothing may be blamed on an item.
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
