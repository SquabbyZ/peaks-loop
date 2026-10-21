// tests/unit/services/batch/batch-entry.test.ts
//
// The batch-mode entry decision: how many independent items make a batch.
//
// ONE CLAIM IS ASSERTED HERE, and it is the lane's zero-cost invariant: a
// single item takes exactly the path it takes today, so the decision must
// read "single" at one item. Everything downstream (the diagnosis fan-out,
// the rule pre-read, the topology step) is gated on that answer, so a
// decision that says "batch" at one item silently changes the single-task
// lane's behaviour — the one thing the batch mode is forbidden from doing.
//
// Dimensions covered:
//   - behavior: the decision itself, at and around the boundary
// Omitted:
//   - render:     the decision is a string union, not printed output
//   - integration: no I/O, no clock, no filesystem — the decision is a pure
//                  function of a count
//   - a11y:       no human-facing text originates here; the caller renders it

import { describe, expect, it } from 'vitest';

import { decideBatchMode } from '../../../../src/services/batch/batch-entry.js';

describe('Scenario: behavior — one item is not a batch', () => {
  it('when the batch holds one item, should stay on the single-task path', () => {
    // given: the user handed over exactly one bug
    const itemCount = 1;
    // when: the lane decides which path to take
    const mode = decideBatchMode(itemCount);
    // then: it takes today's path — no diagnosis fan-out, no topology step
    expect(mode).toBe('single');
  });

  it('when the batch holds two independent items, should enter batch mode', () => {
    // given: the user handed over two mutually independent bugs
    const itemCount = 2;
    // when: the lane decides which path to take
    const mode = decideBatchMode(itemCount);
    // then: the batch machinery is allowed to engage
    expect(mode).toBe('batch');
  });

  it('when the batch holds more than two items, should stay in batch mode', () => {
    // given: the user handed over five independent bugs
    const itemCount = 5;
    // when: the lane decides which path to take
    const mode = decideBatchMode(itemCount);
    // then: the batch machinery is allowed to engage
    expect(mode).toBe('batch');
  });

  it('when the batch holds no items at all, should stay on the single-task path', () => {
    // given: nothing to do — the boundary below the threshold, not at it
    const itemCount = 0;
    // when: the lane decides which path to take
    const mode = decideBatchMode(itemCount);
    // then: it does not enter a batch for an empty batch
    expect(mode).toBe('single');
  });
});
