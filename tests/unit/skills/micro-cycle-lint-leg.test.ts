// tests/unit/skills/micro-cycle-lint-leg.test.ts
//
// The micro-cycle is the micro-loop both lanes (peaks-code and
// peaks-race-code) run while a slice is still open. Its legs decide WHEN a
// defect is found.
//
// The lint leg used to be missing: the agent wrote code that broke the
// project's own rules, and the violation surfaced minutes later in
// pre-commit / pre-push — a different context, often a different bug, with
// the code already moved on. The cost of the rework is not the lint rule;
// it is the distance between writing the line and learning it was wrong.
//
// So the leg has to sit INSIDE the cycle, right after the local test
// re-scan, and it has to say out loud that a red lint is fixed in the same
// context. A leg that runs late, or that says "this will be caught at
// commit time", is the defect all over again.
//
// This file is a DOCUMENT guard, not a behavioural one: it reads the shared
// reference and asserts the leg's position and its promise. `micro-cycle.md`
// is shared by both lanes, so a careless edit here silently changes the
// loop for both.
//
// Dimensions covered:
//   - behavior:    the leg exists, is ordered after the test re-scan and
//                  before the commit message, and is scoped to the file
//                  just changed
//   - a11y:        the doc states that a red lint is fixed in the same
//                  context instead of being deferred to pre-commit /
//                  pre-push

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MICRO_CYCLE_PATH = 'skills/peaks-code/references/micro-cycle.md';

function microCycle(): string {
  return readFileSync(MICRO_CYCLE_PATH, 'utf8');
}

describe('micro-cycle lint leg', () => {
  it('when the cycle is read, should carry a lint leg after the local test re-scan', () => {
    const text = microCycle();
    const rescanIdx = text.indexOf('局部回扫');
    const lintIdx = text.indexOf('peaks lint check');

    expect(rescanIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeGreaterThan(rescanIdx);
  });

  it('when the lint leg runs, should come before the commit message step', () => {
    // The ordering that matters: a violation is found while the agent still
    // holds the change in mind, not after it has been packaged up to commit.
    const text = microCycle();
    const lintIdx = text.indexOf('peaks lint check');
    const commitIdx = text.indexOf('commit message');

    expect(commitIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(commitIdx);
  });

  it('when the lint leg runs, should scope the check to the file just changed', () => {
    // Scoped, not project-wide: a full-project lint inside a micro-cycle
    // would be as slow as the full suite it is meant to replace.
    const text = microCycle();
    expect(text).toMatch(/peaks lint check\s+--scope\s+<[^>]+>/);
  });

  it('when lint is red, should be fixed in the same context rather than at commit time', () => {
    const text = microCycle();
    expect(text).toMatch(/同一上下文|同一个上下文/);
    expect(text).toMatch(/pre-commit|pre-push/);
  });
});
