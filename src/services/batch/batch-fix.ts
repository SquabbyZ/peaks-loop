// src/services/batch/batch-fix.ts
//
// The batch's fix phase: one fix sub-agent per item, each carrying ONLY its
// own diagnosis, and a scoped test that decides whether the item counts as
// fixed.
//
// WHY THE SCOPED TEST IS A GATE AND NOT A REPORT. The batch's verification
// phase runs once, at the end, over the whole tree. When that gate goes red
// the question "which item broke it?" has no answer — unless every item was
// checked on its own, immediately after its own fix. So the scoped test runs
// BETWEEN the fix and the status flip: green ⇒ `appendBatchItem(status:
// 'fixed')`; red ⇒ the item stays `diagnosed` and the failure travels back
// in the result. Without that step the final gate cannot tell an integration
// failure from one broken item.
//
// WHY THE DISPATCH AND THE SCOPED TEST ARE INJECTED. Both are effects this
// library cannot perform on its own: a sub-agent is dispatched by an IDE
// tool call the LLM executes, and a scoped test is a test runner inside the
// target project. So `runBatchFix` takes both as dependencies, and the tests
// pass fakes. The contract that matters — own diagnosis, distinct rid,
// scoped test before the status flip — is then observable without spawning a
// real agent or running a real suite.
//
// The prompt and the rid live in `batch-fix-agent.ts`; the names live in
// `batch-fix-types.ts`. This file is the phase itself: the order of the
// steps, and the one rule that decides a status.

import { planBatchTopology } from './batch-diagnosis.js';
import { appendBatchItem, readBatchProgress } from './batch-progress-store.js';
import { advanceBatchPhase } from './batch-phase-advance.js';
import type { BatchItem } from './batch-progress-types.js';
import type { FileOverlapWavePlan } from '../dispatch/file-overlap-wave-planner.js';
import {
  buildFixPrompt,
  deriveAgentRid,
  FIX_ROLE,
  type BatchFixContext,
  type FixFrame,
  type ScheduledFix
} from './batch-fix-agent.js';
import type {
  BatchFixAgentOutcome,
  BatchFixAgentSpec,
  BatchFixDependencies,
  BatchFixItemResult,
  BatchFixOptions,
  BatchFixResult,
  BatchFixScopedTest
} from './batch-fix-types.js';

export type {
  BatchFixAgentOutcome,
  BatchFixAgentSpec,
  BatchFixDependencies,
  BatchFixDiagnosis,
  BatchFixItemResult,
  BatchFixOptions,
  BatchFixResult,
  BatchFixScopedTest,
  BatchFixScopedTestInput
} from './batch-fix-types.js';

/**
 * Fix every diagnosed item of a batch, one scoped test at a time.
 *
 * The waves are the unit of parallelism: the agents of one wave are
 * dispatched together, and the wave after it starts only when the previous
 * wave's items have been tested. The scoped test of an item runs before that
 * item's status flips, and a red test leaves the item `diagnosed`.
 *
 * @param options - The batch, its items, their diagnoses and the rule list.
 * @param deps - The dispatch and the scoped-test runner.
 * @returns One result per fixed item, and the items that had no diagnosis.
 */
export async function runBatchFix(
  options: BatchFixOptions,
  deps: BatchFixDependencies
): Promise<BatchFixResult> {
  const { fixable, undiagnosable } = splitDiagnosed(options);
  const plan = planBatchTopology(fixable);
  const scheduled = scheduleFixes(fixable, plan, options.rid);
  const frame: FixFrame = {
    context: {
      projectRoot: options.projectRoot,
      sessionId: options.sessionId,
      batchId: options.batchId
    },
    deps,
    diagnoses: options.diagnoses,
    rules: options.rules
  };
  stampFixPhase(frame.context, fixable, plan);

  const results: BatchFixItemResult[] = [];
  for (const wave of plan.waves) {
    for (const result of await runWave(frame, wave.waveIndex, scheduled)) {
      results.push(result);
    }
  }
  // The ③→④ boundary: the fix stage is over, whether its scoped tests
  // were green or not. A red test is the UNIFIED GATE's to attribute, and
  // the attribution needs the batch to be in verification — so the advance
  // happens either way, and it is the cheapest moment to compact.
  advanceBatchPhase({
    projectRoot: options.projectRoot,
    sessionId: options.sessionId,
    batchId: options.batchId,
    toPhase: 'verify'
  });
  return { results, undiagnosable };
}

/**
 * Split the batch's items into the ones a fix agent can be dispatched for and
 * the ones whose diagnosis is missing.
 *
 * Only a `diagnosed` item is fixed: a `pending` one has no diagnosis to
 * carry, and a `fixed` or `verified` one is already behind us.
 */
function splitDiagnosed(options: BatchFixOptions): {
  readonly fixable: BatchItem[];
  readonly undiagnosable: string[];
} {
  const fixable: BatchItem[] = [];
  const undiagnosable: string[] = [];
  for (const item of options.items) {
    if (item.status !== 'diagnosed') continue;
    if (options.diagnoses[item.id] === undefined) undiagnosable.push(item.id);
    else fixable.push(item);
  }
  return { fixable, undiagnosable };
}

/**
 * Give every scheduled item its wave and its own rid.
 *
 * The rid is derived from the batch's rid and the item's id, so two agents
 * of one wave never ask for the same worktree branch.
 */
function scheduleFixes(
  items: readonly BatchItem[],
  plan: FileOverlapWavePlan,
  baseRid: string
): ScheduledFix[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const usedRids = new Set<string>();
  const scheduled: ScheduledFix[] = [];
  for (const wave of plan.waves) {
    for (const itemId of wave.slices) {
      const item = byId.get(itemId);
      if (item === undefined) continue;
      scheduled.push({
        item,
        waveIndex: wave.waveIndex,
        rid: deriveAgentRid(baseRid, itemId, usedRids)
      });
    }
  }
  return scheduled;
}

/**
 * Run one wave: dispatch its agents together, then test each item and flip
 * its status if the test was green.
 */
async function runWave(
  frame: FixFrame,
  waveIndex: number,
  scheduled: readonly ScheduledFix[]
): Promise<BatchFixItemResult[]> {
  const entries = scheduled.filter((entry) => entry.waveIndex === waveIndex);
  const dispatched = await Promise.all(
    entries.map(async (entry) => ({ entry, outcome: await dispatchOne(frame, entry) }))
  );
  const results: BatchFixItemResult[] = [];
  for (const { entry, outcome } of dispatched) {
    results.push(await fixOne(frame, entry, outcome));
  }
  return results;
}

/**
 * Dispatch one fix sub-agent.
 *
 * A dispatch that throws is a failed fix, not a failed batch: the item
 * stays `diagnosed` and the batch's other items still run.
 */
async function dispatchOne(frame: FixFrame, entry: ScheduledFix): Promise<BatchFixAgentOutcome> {
  const diagnosis = frame.diagnoses[entry.item.id];
  if (diagnosis === undefined) {
    return { ok: false, summary: `no diagnosis was recorded for item "${entry.item.id}"` };
  }
  const spec: BatchFixAgentSpec = {
    rid: entry.rid,
    role: FIX_ROLE,
    itemId: entry.item.id,
    waveIndex: entry.waveIndex,
    purpose: `Batch fix: ${entry.item.label} (${entry.item.id})`,
    prompt: buildFixPrompt(entry.item, diagnosis, frame.rules, entry.rid)
  };
  try {
    return await frame.deps.dispatchFixAgent(spec);
  } catch (error) {
    return { ok: false, summary: `the fix agent could not be dispatched: ${describe(error)}` };
  }
}

/**
 * Test one fixed item, and flip its status only if the test was green.
 *
 * The order is the whole point: the test runs while the item is still
 * `diagnosed`, so a record read mid-run shows the item before the flip.
 */
async function fixOne(
  frame: FixFrame,
  entry: ScheduledFix,
  outcome: BatchFixAgentOutcome
): Promise<BatchFixItemResult> {
  const scopedTest = await runScopedTest(frame, entry.item, outcome);
  const fixed = outcome.ok && scopedTest.ok;
  if (fixed) {
    appendBatchItem(frame.context.projectRoot, frame.context.sessionId, frame.context.batchId, {
      ...entry.item,
      status: 'fixed',
      fixedAt: new Date().toISOString()
    });
  }
  return {
    itemId: entry.item.id,
    waveIndex: entry.waveIndex,
    rid: entry.rid,
    status: fixed ? 'fixed' : 'diagnosed',
    fix: outcome,
    scopedTest
  };
}

/**
 * Run one item's scoped test.
 *
 * A runner that throws is a red test, not a crashed batch: the item keeps
 * its `diagnosed` status and the failure text travels back in the result.
 */
async function runScopedTest(
  frame: FixFrame,
  item: BatchItem,
  outcome: BatchFixAgentOutcome
): Promise<BatchFixScopedTest> {
  try {
    return await frame.deps.runScopedTest({ item, outcome });
  } catch (error) {
    return {
      ok: false,
      command: '',
      detail: `the scoped test could not be run: ${describe(error)}`
    };
  }
}

/**
 * Stamp the record with the fix phase and the wave plan.
 *
 * The record is what survives a compaction, and its `phase` is the only
 * field that says a batch is in flight — so entering the fix phase is
 * written down before any agent is dispatched. The items already in the
 * record are kept: the record knows more than this call does.
 */
function stampFixPhase(
  context: BatchFixContext,
  items: readonly BatchItem[],
  topology: FileOverlapWavePlan
): void {
  const current = readBatchProgress(context.projectRoot, context.sessionId, context.batchId);
  const recorded = [...(current?.items ?? [])];
  for (const item of items) {
    if (!recorded.some((candidate) => candidate.id === item.id)) recorded.push(item);
  }
  advanceBatchPhase({
    projectRoot: context.projectRoot,
    sessionId: context.sessionId,
    batchId: context.batchId,
    toPhase: 'fix',
    items: recorded,
    topology
  });
}

/** An error's message, whether it is an `Error` or not. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
