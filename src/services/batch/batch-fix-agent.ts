// src/services/batch/batch-fix-agent.ts
//
// The agent-facing half of the batch's fix phase: the prompt one fix
// sub-agent receives, and the request id that agent is dispatched under.
//
// WHY THE PROMPT IS BUILT HERE AND NOT IN THE PHASE. The phase's job is
// ORDER: dispatch, test, flip. The prompt's job is CONTENT: the one item's
// diagnosis, the rules that apply to its files, and the shared governance
// prefix. Splitting them keeps each file one thing, and it is the same split
// the batch record already makes (`batch-progress-types.ts` beside
// `batch-progress-store.ts`).
//
// WHY THE AGENT'S PROMPT IS BUILT FROM THE DIAGNOSIS, NOT FROM THE TREE. A
// fix agent does not re-read the repository: the diagnosis phase already
// measured the root cause and the file set, and a second look would produce a
// second answer to the same question.
//
// WHY THE RID IS DERIVED FROM THE ITEM. The worktree branch name is derived
// from the rid, so two agents sharing a rid would make `git worktree add -b`
// fail. The derivation therefore ends in the item's id, and a collision is
// broken with a counter so two items that differ only in characters a rid
// cannot carry still get two rids.

import {
  buildDispatchSystemPrompt,
  type DispatchPromptInput
} from '../context/build-dispatch-system-prompt.js';
import type { BatchItem } from './batch-progress-types.js';
import type { BatchFixDependencies, BatchFixDiagnosis } from './batch-fix-types.js';

/** The role the fix sub-agents are dispatched as: the lane's own RD role. */
export const FIX_ROLE = 'rd';

/**
 * The memory block a pure prompt builder carries.
 *
 * `buildDispatchSystemPrompt` takes a pre-fetched memory block, and the
 * memory preflight is asynchronous I/O that belongs to the dispatch site, not
 * to a pure prompt builder. This prompt carries no project memory block, and
 * the composer renders its own "no block" form.
 */
const NO_MEMORY_BLOCK: DispatchPromptInput['memoryBlock'] = { available: false };

/** Where the batch's record lives. */
export interface BatchFixContext {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly batchId: string;
}

/** Everything one dispatched agent needs. */
export interface FixFrame {
  readonly context: BatchFixContext;
  readonly deps: BatchFixDependencies;
  readonly diagnoses: Readonly<Record<string, BatchFixDiagnosis>>;
  readonly rules: readonly string[];
}

/** One item, with the wave and the rid it was scheduled under. */
export interface ScheduledFix {
  readonly item: BatchItem;
  readonly waveIndex: number;
  readonly rid: string;
}

/**
 * Build the prompt one fix sub-agent receives.
 *
 * The prompt carries the ONE item's diagnosis and the rule list, and the
 * shared governance prefix comes from the one composer that owns it — a
 * second hand-rolled copy of the prefix would drift away from it.
 */
export function buildFixPrompt(
  item: BatchItem,
  diagnosis: BatchFixDiagnosis,
  rules: readonly string[],
  rid: string
): string {
  const taskBody = [
    `## Batch fix — ${item.label}`,
    '',
    `- Item id: \`${item.id}\``,
    `- Your request id: \`${rid}\``,
    '',
    'You are fixing ONE item of a batch. Other agents are fixing the other',
    'items in parallel, each on its own worktree.',
    '',
    ...renderDiagnosis(diagnosis),
    '',
    '## Rules that apply to the files above',
    '',
    ...renderRules(rules),
    '',
    ...renderBoundaries()
  ].join('\n');

  return buildDispatchSystemPrompt({
    taskTitle: FIX_ROLE,
    taskBody,
    memoryBlock: NO_MEMORY_BLOCK
  });
}

/** The diagnosis block: the answer the fix agent must not go looking for again. */
function renderDiagnosis(diagnosis: BatchFixDiagnosis): readonly string[] {
  const files =
    diagnosis.files.length > 0
      ? diagnosis.files.map((file) => `\`${file}\``).join(', ')
      : '(no file was reported)';
  return [
    '## The diagnosis (authoritative — do not re-read the repository)',
    '',
    `**Root cause (根因)**: ${diagnosis.rootCause}`,
    '',
    `**Expected files (预计文件集)**: ${files}`,
    '',
    `**Risk surface hit (风险面命中)**: ${diagnosis.riskSurface ?? 'none'}`,
    '',
    `**Fix sketch (修复草图)**: ${diagnosis.fixSketch}`,
    '',
    'The diagnosis above IS the answer to the reported symptom. Do NOT',
    're-diagnose it and do NOT re-scan the repository to look for the cause',
    'again — your job is to apply the fix it names.'
  ];
}

/** The rule list, or the honest note that none was pre-read. */
function renderRules(rules: readonly string[]): readonly string[] {
  if (rules.length === 0) return ['- (no rule list was pre-read for this batch)'];
  return rules.map((rule) => `- ${rule}`);
}

/** The two things a fix agent must not do. */
function renderBoundaries(): readonly string[] {
  return [
    '## What you must not do',
    '',
    '- Do NOT `git merge`, `git pull`, `git rebase` or release a worktree — the parent session owns the merge.',
    '- Do NOT run the whole test suite; your scoped test is run for you right after you finish.',
    '',
    'Report what you changed, and the test file your fix is scoped to.'
  ];
}

/**
 * Derive one agent's rid from the batch's rid and the item's id.
 *
 * The rid becomes a worktree branch name, so two agents may never share one.
 * The item's id is sanitized into rid characters, and a collision (two ids
 * that differ only in characters a rid cannot carry) is broken with a counter.
 */
export function deriveAgentRid(baseRid: string, itemId: string, used: Set<string>): string {
  const root = `${sanitizeRidPart(baseRid)}-fix-${sanitizeRidPart(itemId)}`;
  let candidate = root;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${root}-${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

/** The characters a request id may carry, reduced to what a rid accepts. */
function sanitizeRidPart(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '-');
  return cleaned.length > 0 ? cleaned : 'item';
}
