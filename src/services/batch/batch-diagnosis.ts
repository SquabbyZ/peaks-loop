// src/services/batch/batch-diagnosis.ts
//
// The batch's diagnosis phase: the read-only prompt one diagnostician
// receives, and the topology the batch's MEASURED file sets produce.
//
// WHY THE FILE SETS ARE NORMALIZED HERE, NOT IN THE PLANNER. The wave
// planner (`planFileOverlapWaves`) matches a file by EXACT STRING EQUALITY —
// it dedupes and sorts, and nothing else. On a Windows host a
// backslash-spelled path and the same path spelled with forward slashes are
// two different strings to it, so two items that touch the SAME file look
// disjoint, land in the same wave, and two agents edit one file at once.
// `normalizeFileSet` is the one place that decides what a file set is, so
// the normalization happens HERE — on the way in — and the planner keeps
// its one job.
//
// WHY THE DIAGNOSIS IS READ-ONLY, MECHANICALLY. The file set a
// diagnostician reports is the only input the topology step has. A
// diagnostician that also wrote files would be reporting a guess about
// what it changed, and the whole measurement premise of the batch would
// be gone. So the prohibition is in the prompt the agent receives, not
// only in this file's comment.
//
// WHY THE PROMPT REUSES THE SHARED DISPATCH PREFIX. Every dispatched
// sub-agent gets the same governance prefix — the test-tool rule, the
// worktree-governance refusal, the lifecycle rules, the report cap, the
// fact-forcing gate. A diagnostician is a dispatched sub-agent like any
// other, so it gets that prefix from the one composer that owns it
// (`buildDispatchSystemPrompt`) rather than from a second hand-rolled copy
// that could drift away from it.

import {
  buildDispatchSystemPrompt,
  type DispatchPromptInput
} from '../context/build-dispatch-system-prompt.js';
import {
  planFileOverlapWaves,
  type FileOverlapWavePlan
} from '../dispatch/file-overlap-wave-planner.js';
import { normalizeFileSet } from './batch-progress-store.js';
import type { BatchItem } from './batch-progress-types.js';

/**
 * The one item a diagnostician is asked about.
 *
 * `symptom` is what the user reported, in the user's words. It is the
 * symptom, not a diagnosis — the agent is the one that has to find the
 * cause.
 */
export interface BatchDiagnosisItem {
  readonly id: string;
  readonly label: string;
  readonly symptom: string;
}

/**
 * The memory block a pure prompt builder carries.
 *
 * `buildDispatchSystemPrompt` takes a pre-fetched memory block, and the
 * memory preflight is asynchronous I/O that belongs to the dispatch site,
 * not to a pure prompt builder. The unavailable shape is the honest one
 * here: this prompt carries no project memory block, and the composer
 * renders its own "no block" form.
 */
const NO_MEMORY_BLOCK: DispatchPromptInput['memoryBlock'] = { available: false };

/**
 * Plan the batch's waves from the file sets its items MEASURED.
 *
 * @param items - The batch's items, each carrying the file set its
 *   diagnosis reported.
 * @returns The wave plan: items with disjoint file sets share a wave, and
 *   an item that collides with an earlier one is deferred behind it with
 *   the colliding file named.
 */
export function planBatchTopology(items: readonly BatchItem[]): FileOverlapWavePlan {
  const descriptors = items.map((item) => ({
    id: item.id,
    files: normalizeFileSet(item.files)
  }));
  return planFileOverlapWaves(descriptors);
}

/**
 * Build the read-only prompt one diagnostician receives.
 *
 * The prompt asks for exactly the four outputs the batch pipeline
 * consumes — the root cause, the files it expects to change, the risk
 * surface it hit, and a fix sketch — and forbids the three write tools, so
 * the file set it reports is a MEASUREMENT rather than a guess.
 *
 * @param item - The one item to diagnose.
 * @returns The composed prompt, ready to be a sub-agent's dispatch body.
 */
export function buildDiagnosisPrompt(item: BatchDiagnosisItem): string {
  const taskBody = [
    `## Batch diagnosis — ${item.label}`,
    '',
    `- Item id: \`${item.id}\``,
    `- Reported symptom: ${item.symptom}`,
    '',
    'You are diagnosing ONE item of a batch. Other agents are diagnosing the',
    'others in parallel, on the same tree.',
    '',
    'This phase is read-only (只读). You MUST NOT use Edit, Write, or MultiEdit,',
    'and you MUST NOT run any command that changes a file. Read, grep, list and',
    'read-only commands only.',
    '',
    'Report exactly four things, in this order:',
    '',
    '1. **Root cause (根因)** — why the reported symptom happens, in a sentence',
    '   or two.',
    '2. **Expected files (预计文件集)** — the repo-relative paths a fix would',
    '   have to touch, one per line, POSIX separators. This list is the only',
    "   input the batch's scheduling step has, so a path you are unsure about",
    '   belongs IN the list: an item scheduled wrongly is the defect this',
    '   phase exists to prevent.',
    '3. **Risk surface hit (风险面命中)** — the number of the risk surface (1-7)',
    "   from the fast-lane norm's list (`peaks-code/references/fast-lane-norm.md`",
    '   §2) that this item touches, or `none`. If you cannot read that list, say',
    '   `unknown` rather than guessing a number.',
    '4. **Fix sketch (修复草图)** — what the fix would look like, in a few',
    '   sentences. The sketch only; do not apply it.',
    '',
    'Do not fix anything. The fix is a later phase, run against your report.'
  ].join('\n');

  return buildDispatchSystemPrompt({
    taskTitle: 'rd',
    taskBody,
    memoryBlock: NO_MEMORY_BLOCK
  });
}
