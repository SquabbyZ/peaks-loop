/**
 * conflict-replay — pure envelope builder for the auto re-dispatch path.
 *
 * Slice 2026-08-01-subagent-merge-and-e2e (Task 5). When the parent
 * session's merge-back attempt conflicts (see planMergeBack), the
 * merge-back-runner (Task 9) calls `buildConflictReplay` to compose
 * the envelope the parent passes back into the sub-agent dispatch
 * site. The envelope has three sections:
 *
 *   1. callerBranch: <branch>
 *   2. Original prompt (verbatim)
 *   3. Prior merge transcript (one line per attempt)
 *   4. Conflict diff (wrapped in a fenced ```diff block)
 *
 * Plus a stable instruction list the re-dispatched agent receives in
 * addition to its task system prompt. The instruction set forbids
 * new functionality and tells the agent to re-run the dispatch and
 * report the new conflict state — the parent will retry the merge.
 *
 * The builder is pure: no fs, no network, no child_process.
 */

export type ConflictReplayInput = {
  readonly originalPrompt: string;
  readonly mergeAttemptTranscript: ReadonlyArray<string>;
  readonly conflictDiff: string;
  readonly callerBranch: string;
};

export type ConflictReplayOutput = {
  readonly prompt: string;
  readonly instructions: ReadonlyArray<string>;
};

const INSTRUCTIONS: ReadonlyArray<string> = [
  'A previous merge into the caller branch conflicted. Resolve the conflict preserving the intent of both your prior work and the caller branch.',
  'Do NOT introduce new functionality or refactor outside the conflict.',
  'Re-run the dispatch and report the new conflict state. The parent will retry the merge.',
];

export function buildConflictReplay(input: ConflictReplayInput): ConflictReplayOutput {
  const prompt = [
    '## Conflict replay',
    `callerBranch: ${input.callerBranch}`,
    '',
    '### Original prompt',
    input.originalPrompt,
    '',
    '### Prior merge transcript',
    ...input.mergeAttemptTranscript.map((l) => `  ${l}`),
    '',
    '### Conflict diff',
    '```diff',
    input.conflictDiff,
    '```',
  ].join('\n');
  return { prompt, instructions: INSTRUCTIONS };
}