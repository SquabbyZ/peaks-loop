// tests/unit/lint/baseline-split-anchor.test.ts
//
// Rid `2026-10-02-generator-equivalence-anchor`, repair cycle 2. The generator split
// (`77b711ff` → `c6de09a6`) is proven behaviour-preserving by
// `tests/unit/lint/baseline-split-equivalence.test.ts`, which runs a reference copy of the
// generator against the split copy in two throwaway repos. Cycle 1 read the reference out of
// `git show HEAD:`. That was true only while the slice was UNCOMMITTED — the commit that
// landed it moved `HEAD` onto the SPLIT generator, whose `./baseline/` imports the reference
// fixture deliberately does not stage, so all eleven arms died on
// `Cannot find module …/head/.husky/baseline/anchor.mjs`. A regression test that anchors on
// "the current tip" validates itself the day it is written and self-destructs the day it is
// committed.
//
// THIS FILE is the guard that stops that from happening again. The equivalence pins its
// reference to an explicit commit instead of `HEAD`; the arms here re-check that pin from
// BOTH ends and fail with a sentence naming what moved rather than eleven stack traces:
//   - the pinned commit must still resolve AND still be the monolith (no `./baseline/` import)
//     the comparison relies on;
//   - `HEAD` must still carry the split, and its blob must still DIFFER from the anchor —
//     otherwise the refactor-comparison would be a program compared with itself;
//   - the equivalence file must pin the SAME commit, so editing the sha in one file without
//     the other cannot silently let the guard watch a different anchor than the harness runs.
//
// These are pure git reads, so no fixture and no scratch directory are built here (nothing to
// clean up, §2.31 is satisfied trivially).
//
// Dimensions covered:
//   - integration: the two blobs read out of git (subprocess against the object store)
//   - behavior:    the monolith/split/differ properties of those two reads
//   - render:      OMITTED — this file produces no artifact or output shape of its own
//   - a11y:        OMITTED — the strings below are test-failure messages, not a product surface

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';

declareDimensions(
  'tests/unit/lint/baseline-split-anchor.test.ts',
  ['integration', 'behavior'],
  [
    { dim: 'render', reason: 'produces no artifact or output shape of its own' },
    { dim: 'a11y', reason: 'the strings here are test-failure messages, not a product surface' }
  ]
);

const GENERATOR_REL = '.husky/peaks-gate-baseline.mjs';
const EQUIVALENCE_REL = join('tests', 'unit', 'lint', 'baseline-split-equivalence.test.ts');
/** Where the harness's anchor actually lives since the comment rows landed. */
const ERA_HELPER_REL = join('tests', 'unit', 'lint', '_split-anchor-era.ts');
/**
 * The pre-split commit the reference side is pinned to — `c6de09a6` IS the split, so its
 * parent is the last commit whose generator is still the 799-line monolith. MUST stay equal
 * to the same constant in the equivalence file; the third arm below enforces that.
 */
const PRE_SPLIT_ANCHOR_SHA = '77b711ff';

/** `git show <ref>:` on the generator entry. Throws if the ref does not resolve. */
function gitShowGenerator(ref: string): string {
  return execFileSync('git', ['show', `${ref}:${GENERATOR_REL}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}

describe('Scenario: integration — the pinned pre-split anchor still resolves out of git', () => {
  it(`the pinned anchor ${PRE_SPLIT_ANCHOR_SHA} resolves and is still the monolithic generator`, () => {
    let resolves = true;
    let anchor = '';
    try {
      anchor = gitShowGenerator(PRE_SPLIT_ANCHOR_SHA);
    } catch {
      resolves = false;
    }
    expect(
      resolves,
      `the pinned pre-split anchor ${PRE_SPLIT_ANCHOR_SHA} no longer resolves as a generator ` +
        'blob — the history was rewritten or the entry moved. Re-point PRE_SPLIT_ANCHOR_SHA at ' +
        'the last monolithic commit (the parent of the split), or delete this comparison.'
    ).toBe(true);
    expect(
      anchor.split('\n').length,
      `the pinned anchor ${PRE_SPLIT_ANCHOR_SHA} is far smaller than the 799-line monolith — ` +
        'it is not the pre-split generator. Re-point PRE_SPLIT_ANCHOR_SHA or delete this file.'
    ).toBeGreaterThan(500);
    expect(
      /from '\.\/baseline\//.test(anchor),
      `the pinned anchor ${PRE_SPLIT_ANCHOR_SHA} now imports ./baseline/ — it is no longer the ` +
        'monolithic generator the equivalence relies on, so it would drag the split directory ' +
        'it exists to exclude. Re-point PRE_SPLIT_ANCHOR_SHA at the last pre-split commit, or ' +
        'delete the comparison.'
    ).toBe(false);
  });
});

describe('Scenario: behavior — the tip is the split, and the two anchors agree on the pin', () => {
  it('HEAD really carries the split, and it is a different program than the anchor', () => {
    const head = gitShowGenerator('HEAD');
    expect(
      /from '\.\/baseline\/anchor\.mjs'/.test(head),
      "HEAD's generator no longer imports ./baseline/anchor.mjs — the split was reverted or " +
        're-factored at the tip, so there is nothing here left to compare against the pinned ' +
        `${PRE_SPLIT_ANCHOR_SHA} anchor. Re-point the anchor, or delete this comparison.`
    ).toBe(true);
    expect(
      head,
      `HEAD's generator is byte-identical to the pinned anchor ${PRE_SPLIT_ANCHOR_SHA} — the ` +
        'split does not exist at the tip, so the equivalence would compare a program with ' +
        'itself. Re-point the anchor at the real pre-split commit, or delete this file.'
    ).not.toBe(gitShowGenerator(PRE_SPLIT_ANCHOR_SHA));
  });

  it('the equivalence file pins the SAME anchor, so the two guards cannot drift apart', () => {
    const harness = readFileSync(join(REPO_ROOT, EQUIVALENCE_REL), 'utf8');
    const era = readFileSync(join(REPO_ROOT, ERA_HELPER_REL), 'utf8');
    // The pin moved into the era helper (the harness is a capped, collected file), so the
    // anti-drift claim is now about TWO things: the helper must carry this exact sha, and
    // the harness must read its anchor from that helper instead of keeping a second copy —
    // which is the only way this arm still means "one commit, checked twice".
    expect(
      era.includes(`export const PRE_SPLIT_ANCHOR_SHA = '${PRE_SPLIT_ANCHOR_SHA}';`),
      `_split-anchor-era.ts no longer pins PRE_SPLIT_ANCHOR_SHA to ` +
        `${PRE_SPLIT_ANCHOR_SHA} — the harness runs against one commit while this guard checks ` +
        'another. Make the two constants match, or delete the pair.'
    ).toBe(true);
    expect(
      harness.includes("from './_split-anchor-era.js'"),
      'the equivalence harness no longer reads its anchor from `_split-anchor-era.ts`, so this ' +
        'guard is checking a commit the harness may not be using'
    ).toBe(true);
    expect(
      /const PRE_SPLIT_ANCHOR_SHA/.test(harness),
      'the equivalence harness keeps a SECOND copy of the anchor sha — two pins, one drift'
    ).toBe(false);
  });
});
