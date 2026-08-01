// tests/unit/services/dispatch/conflict-replay.test.ts
//
// 4-dimension unit test for the pure conflict-replay envelope builder
// in src/services/dispatch/conflict-replay.ts. When a merge-back
// attempt conflicts, the parent re-dispatches the sub-agent with the
// original prompt, the prior merge transcript, the conflict diff, and
// a fresh instruction block. The builder composes these into a single
// envelope the orchestrator passes back to the dispatch site.
//
// Dimensions covered:
//   - behavior: envelope embeds prompt / transcript / diff and carries
//               a non-empty instruction list forbidding new functionality
//   - render:   not applicable (returns structured data)
//   - integration: not applicable (pure)
//   - a11y:     not applicable (no user-visible text)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/dispatch/conflict-replay.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'pure function, no fs / subprocess boundary' },
    { dim: 'render', reason: 'returns a structured ConflictReplayOutput, no text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import { buildConflictReplay } from '~/src/services/dispatch/conflict-replay';

describe('behavior — envelope shape', () => {
  it('embeds the original prompt, transcript, and conflict diff', () => {
    const out = buildConflictReplay({
      originalPrompt: 'implement login',
      mergeAttemptTranscript: ['git merge --no-ff feat/login'],
      conflictDiff: '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>>',
      callerBranch: 'main',
    });
    expect(out.prompt).toContain('implement login');
    expect(out.prompt).toContain('main');
    expect(out.prompt).toContain('<<<<<<<');
    expect(out.instructions.length).toBeGreaterThan(0);
  });

  it('instructs the agent to not introduce new functionality', () => {
    const out = buildConflictReplay({
      originalPrompt: 'x',
      mergeAttemptTranscript: [],
      conflictDiff: '',
      callerBranch: 'main',
    });
    expect(out.instructions.join(' ')).toMatch(/new functionality/i);
  });

  it('preserves the caller branch name in the prompt header', () => {
    const out = buildConflictReplay({
      originalPrompt: 'x',
      mergeAttemptTranscript: [],
      conflictDiff: '',
      callerBranch: 'feat/checkout',
    });
    expect(out.prompt).toContain('feat/checkout');
  });
});