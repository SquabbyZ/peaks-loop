// tests/unit/services/job/job-next-slice-line.test.ts
//
// criterion (c) (rid 2026-10-03-job-ledger-repair1): the human-readable sentence
// built from the progress mirror still announced a next slice when the ledger had
// none.
//
// MEASURED before this file was written, against the built tree at `1c0f51aa` plus
// the uncommitted job-ledger slice, in a `mkdtempSync` scratch repo that ran its own
// `git init` (`node bin/peaks.js`, job `probe`, two registered slices, both
// checkpointed done):
//
//   peaks job progress --job-id probe
//     → next: Next: slice #3 of 2 (no slice pending)
//
// The parent slice made the FIELD honest (`currentSlice: "no slice pending"`) and
// left the SENTENCE as arithmetic on the old guess: `slice #${done + 1} of ${total}`
// prints `#3 of 2` the moment the job runs out — an index for a slice the ledger
// cannot support, in the one line a resumed reader actually reads. So the fix is
// not "print a smaller number": it is to stop making an index claim the ledger
// cannot support, and to name the command that changes the ledger.
//
// This file pins the builder for every branch of that arithmetic, including the
// contradictory mirror (a pending slice named while every registered slice is
// recorded done) that no CLI sequence produces but no CLI sequence prevents either:
// `progress.json` is a file another process may write.
//
// Dimensions covered:
//   - behavior: the branch matrix and the relational invariant (no index beyond the
//     total, ever)
//   - a11y:     the exact words a human or a resumed LLM reads
// Omitted:
//   - render:   this is a string builder, not output; the rendered `next:` line is
//     the render dimension of tests/unit/cli/job-progress-next-line.test.ts
//   - integration: no fs, subprocess, network, env or clock is touched — the
//     ledger/mirror boundary is the CLI file's integration scenario

import { describe, expect, it } from 'vitest';

import { describeNextSlice, NO_PENDING_SLICE_LABEL } from '~/src/services/job/job-progress-store';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/job/job-next-slice-line.test.ts',
  ['behavior', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the builder returns a string; the rendered `next:` line is the render scenario in tests/unit/cli/job-progress-next-line.test.ts'
    },
    {
      dim: 'integration',
      reason:
        "no fs/subprocess/env/clock boundary here — the ledger-to-mirror boundary is that file's integration scenario"
    }
  ]
);

/** Every `#N of M` pair a sentence asserts, as numbers, not as a constant. */
function indexClaims(sentence: string): Array<{ index: number; total: number }> {
  const claims: Array<{ index: number; total: number }> = [];
  for (const hit of sentence.matchAll(/#(\d+) of (\d+)/g)) {
    claims.push({ index: Number(hit[1]), total: Number(hit[2]) });
  }
  return claims;
}

/** The statuses the orchestrator considers "there is work left at this index". */
const SWEEP_TOTALS = [1, 2, 3, 5, 8];

describe('Scenario: behavior — no branch of the arithmetic may print an index beyond the total', () => {
  it('for every done/total pair and either currentSlice value, should never claim an index above the recorded total', () => {
    // given/when: the whole branch matrix, including the states the CLI cannot
    // produce (done > total) because the mirror is a file another process writes
    for (const total of SWEEP_TOTALS) {
      for (let done = 0; done <= total + 2; done++) {
        for (const currentSlice of [NO_PENDING_SLICE_LABEL, 'alpha']) {
          const sentence = describeNextSlice({ done, total, currentSlice }, 'sweep-job');
          // then: every index claim the sentence makes is one the ledger can hold
          for (const claim of indexClaims(sentence)) {
            expect(claim.total).toBe(total);
            expect(claim.index).toBeGreaterThan(0);
            expect(claim.index).toBeLessThanOrEqual(claim.total);
          }
        }
      }
    }
  });

  it('when the mirror records every registered slice as done, should make no index claim at all', () => {
    // given: the all-done state §2.38's class of misreport came from
    const sentence = describeNextSlice(
      { done: 2, total: 2, currentSlice: NO_PENDING_SLICE_LABEL },
      'probe'
    );
    // then: no `#N of M` arithmetic survives, and the sentence says what is true
    expect(indexClaims(sentence)).toHaveLength(0);
    expect(sentence).not.toMatch(/slice #/);
  });

  it('when nothing is pending but registered slices are still unfinished, should make no index claim', () => {
    // given: 2 of 3 done, the third blocked — nothing is pending, work remains
    const sentence = describeNextSlice(
      { done: 2, total: 3, currentSlice: NO_PENDING_SLICE_LABEL },
      'probe'
    );
    // then: the line must not read as "slice #3 is next"
    expect(indexClaims(sentence)).toHaveLength(0);
    expect(sentence).not.toMatch(/slice #/);
  });

  it('when the mirror names a pending slice it has already counted as done, should refuse the index rather than print it', () => {
    // given: a contradictory mirror — done === total, yet a slice is named
    const sentence = describeNextSlice({ done: 3, total: 3, currentSlice: 'epsilon' }, 'probe');
    // then: no index claim, and the sentence hands the reader the authority instead
    expect(indexClaims(sentence)).toHaveLength(0);
    expect(sentence).toContain('epsilon');
    expect(sentence).toContain('peaks job status');
  });

  it('when a slice is pending within the recorded total, should claim exactly one index and it should be the next one', () => {
    // given: 1 of 5 done
    const sentence = describeNextSlice({ done: 1, total: 5, currentSlice: 'beta' }, 'probe');
    // then/then: one claim, index = done + 1 ≤ total, naming the pending slice
    const claims = indexClaims(sentence);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.index).toBe(2);
    expect(claims[0]!.total).toBe(5);
    expect(sentence).toContain('beta');
  });
});

describe('Scenario: a11y — the words a reader acts on', () => {
  it('when nothing is registered left to do, should say so and name the command that adds one', () => {
    // given/when: the all-done sentence
    const sentence = describeNextSlice(
      { done: 2, total: 2, currentSlice: NO_PENDING_SLICE_LABEL },
      'probe'
    );
    // then: truthful in the reader's terms — what is true, and the exact command,
    //       with the job id already filled in
    expect(sentence).toContain('no further slice is registered');
    expect(sentence).toContain('peaks job add-slice --job-id probe --slice-label "<label>"');
  });

  it('when slices remain but none is pending, should say none is pending and still name add-slice', () => {
    // given/when: 1 of 4 done and the rest terminal
    const sentence = describeNextSlice(
      { done: 1, total: 4, currentSlice: NO_PENDING_SLICE_LABEL },
      'probe'
    );
    // then: it does not claim "no further slice is registered" — four are
    expect(sentence).toContain('no slice is pending');
    expect(sentence).not.toContain('no further slice is registered');
    expect(sentence).toContain('peaks job add-slice');
  });

  it('when a slice is pending, should name it and not offer add-slice advice', () => {
    // given/when: the ordinary mid-job line
    const sentence = describeNextSlice({ done: 0, total: 3, currentSlice: 'alpha' }, 'probe');
    // then: the advice line is for the state with nothing pending, only
    expect(sentence).toContain('slice #1 of 3 (alpha)');
    expect(sentence).not.toContain('add-slice');
  });

  it('when the job id is unknown to the caller, should mark the placeholder instead of inventing an id', () => {
    // given/when: a reader with a mirror but no resolved job id
    const sentence = describeNextSlice(
      { done: 1, total: 1, currentSlice: NO_PENDING_SLICE_LABEL },
      null
    );
    // then: the command it prints is visibly incomplete rather than wrong
    expect(sentence).toContain('--job-id <job-id>');
  });
});
