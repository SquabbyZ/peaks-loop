// tests/unit/lint/coverage-redline-tripwire.test.ts
//
// The tripwire over the FROZEN instrument: `scripts/coverage-c8.mjs` must keep enforcing 100%
// and must keep saying so.
//
// WHY THIS EXISTS AT ALL. The coverage-floor slice is ADDITIVE — `coverage-c8.mjs` is not
// modified, its `--100` rule is not weakened, and the whole decision rests on that staying
// true. A promise like that decays quietly: the next person to find the 100% bar unreachable
// has an obvious local fix, and deleting one flag would look like housekeeping in a diff
// nobody re-reads. `git diff` proves the file is unchanged TODAY; this test is what makes the
// rule hard to delete tomorrow.
//
// WHY A TRIPWIRE AND NOT A STRICTER MEANING. It does not judge whether the bar is good, or
// whether it is reachable — it monitors the two things the slice promised would not move: the
// threshold, and the comment that states the rule. Anything more would duplicate the file's
// own reasoning in a second place and drift from it.
//
// THE INJECTION CONTROL IS IN THIS FILE. Arm A checks the real file; arm B removes each marker
// from a COPY and asserts the checker goes red naming it. Without B, a checker that returned
// `[]` unconditionally would pass A. This is the shape the repository's own red rule uses
// (`tests/unit/standards/no-ai-co-author-trailer.test.ts`).
//
// Dimensions covered:
//   - behavior:    the checker on the real text and on three injected defects
//   - integration: the real `scripts/coverage-c8.mjs` is read off disk
//   - a11y:        the refusal names the missing marker, so the remedy is obvious

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FROZEN_REL = join('scripts', 'coverage-c8.mjs');

/**
 * The three literals the slice promises will not move. The first two are the enforcement
 * (`--check-coverage --100`); the third is the rule stated in the file's own header, which is
 * the part a reader trusts when deciding whether the flag is load-bearing or leftover.
 */
export const FROZEN_MARKERS = Object.freeze([
  '--check-coverage',
  '--100',
  'do NOT weaken the 100% threshold'
]);

/** Which of the frozen markers `text` no longer carries. `[]` means the instrument is intact. */
export function frozenProblems(text: string): string[] {
  return FROZEN_MARKERS.filter((marker) => !text.includes(marker)).map(
    (marker) => `scripts/coverage-c8.mjs no longer contains ${JSON.stringify(marker)}`
  );
}

declareDimensions(
  'tests/unit/lint/coverage-redline-tripwire.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the subject is a file on disk and a list of missing markers; nothing is rendered, and the operator-facing part is the refusal sentence asserted under a11y'
    }
  ]
);

describe('Scenario: integration — the frozen instrument is intact', () => {
  it('A: the real coverage-c8.mjs still enforces --100 and still states the rule', () => {
    const text = readFileSync(join(REPO_ROOT, FROZEN_REL), 'utf8');
    // Non-vacuous: an empty read would make every marker check below meaningless.
    expect(text.length, 'scripts/coverage-c8.mjs read as empty').toBeGreaterThan(1000);

    const problems = frozenProblems(text);
    expect(
      problems,
      `${problems.join('\n')}\nThe coverage floor is ADDITIVE: this file is the strict ` +
        'instrument and was deliberately left untouched. If weakening it is really intended, ' +
        'that is a separate decision about the 100% bar — not a side effect of the floor.'
    ).toEqual([]);
  });
});

describe('Scenario: behavior and a11y — the checker can fail, and says why', () => {
  it('B: removing any ONE marker makes the checker red and names it', () => {
    const text = readFileSync(join(REPO_ROOT, FROZEN_REL), 'utf8');
    for (const marker of FROZEN_MARKERS) {
      const mutated = text.split(marker).join('REDACTED-BY-THE-TEST');
      // The mutation must really have removed something, or this arm tests nothing.
      expect(mutated, `the marker ${marker} was absent before mutation`).not.toBe(text);
      const problems = frozenProblems(mutated);
      expect(problems, `the checker passed with ${marker} removed`).toHaveLength(1);
      expect(problems[0]).toContain(JSON.stringify(marker));
    }
  });

  it('C: a text carrying none of the markers reports all three, not just the first', () => {
    expect(frozenProblems('// nothing to see here\n')).toHaveLength(FROZEN_MARKERS.length);
  });
});
