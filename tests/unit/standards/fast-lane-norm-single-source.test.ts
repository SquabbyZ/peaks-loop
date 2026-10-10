// tests/unit/standards/fast-lane-norm-single-source.test.ts
//
// Two fast lanes now exist in this repo — peaks-code's `--fast` mode and, in
// time, peaks-race-code — and both need the same two statements: what counts as
// "done" for a fast lane, and when a task is not a fast-lane task at all.
// Those statements live in one file; this pins that they stay there.
//
// The rule the split rests on: two places that cannot be word-for-word
// identical should not have been split. So the gate sentence is asserted to
// appear in the norm and NOT in the doc that points at it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const NORM = 'skills/peaks-code/references/fast-lane-norm.md';
const FAST_MODE = 'skills/peaks-code/references/fast-mode.md';
const GATE = 'test pass + tsc pass + lint pass';

describe('the fast-lane norm is single-sourced', () => {
  it('the norm exists and states the acceptance gate', () => {
    const norm = readFileSync(NORM, 'utf8');
    expect(norm).toContain(GATE);
  });

  it('fast-mode.md points at the norm instead of restating the gate', () => {
    const doc = readFileSync(FAST_MODE, 'utf8');
    expect(doc).toContain('fast-lane-norm.md');
    expect(doc).not.toContain(GATE);
  });

  it('the norm reads as advisory, not as a gate', () => {
    // A norm that reads like a requirement invites the assumption that
    // something enforces it. Nothing does.
    const norm = readFileSync(NORM, 'utf8');
    expect(norm.toLowerCase()).toContain('advisory');
    expect(norm).not.toMatch(/MUST|BLOCKING|RED LINE/);
  });
});
