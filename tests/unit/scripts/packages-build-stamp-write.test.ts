// tests/unit/scripts/packages-build-stamp-write.test.ts
//
// The STAMP WRITE of `scripts/packages-build-prerequisite.mjs`, and the refusal
// the guard gives when the stamp file cannot be read at all.
//
// WHY THIS IS A SECOND FILE. `tests/unit/scripts/packages-build-prerequisite.
// test.ts` is at 383 of the `max-lines` 400 ceiling (`skipBlankLines` +
// `skipComments`), so four more cases do not fit in it. The same ceiling put
// `packages-build-lock.test.ts` beside it, and that is the precedent followed
// here. The fixtures come from the same `_setup` module, so nothing is
// re-derived.
//
// WHAT THIS FILE HAS TO PROVE, and why each arm is shaped the way it is:
//
//   atomic   -> the stamp is REPLACED, never rewritten in place. `writeFileSync`
//               is open-TRUNC + write, so a reader between the two sees a
//               partial file, `readStamps` maps that to `null`, and `null` makes
//               EVERY package stale. The property is pinned with a second name
//               for the old file (`linkSync`): a writer that truncates the
//               target mutates the inode both names hold, a writer that renames
//               a temp over it moves only the directory entry. That is
//               deterministic, where a reader-vs-writer race would be flaky —
//               and a flaky case for a defect this narrow is a case that cannot
//               be trusted when it stays green.
//   no store -> a write that cannot complete leaves nothing behind. The temp
//               name lives in `packages/`, whose only gitignore entry is the
//               stamp file itself, so a leaked temp would show up in
//               `git status` as an untracked file. The failure is forced with a
//               directory at the stamp path, which is a state the refusal below
//               also has to name.
//   refusal  -> an unreadable stamp is not a stale `dist/`. With the stamp path
//               a directory and `dist/` present, the verdict is `stale` for a
//               reason that has nothing to do with the artifacts, and the
//               shipped sentence ("not built from their current src/") was
//               therefore FALSE. The remedy it named could not clear it either:
//               `scripts/write-package-dist-stamps.mjs` is step 4 of the 8
//               `&&`-joined steps of `scripts.build`: step 2 wipes the root
//               `dist` and every `packages/*/dist`, and step 3 remakes only the
//               latter — the root `dist` is remade by `tsc` at step 5, which the
//               chain never reaches — and only then does the write hit the same
//               obstacle, exit 1, and leave the `&&` chain short of `tsc`. Both
//               halves are pinned — the false diagnosis must be ABSENT, and so
//               must the failing remedy.
//   scope    -> the walk's rule is DISCLOSED, not asserted as desirable. A real
//               `packages/<dir>` carrying a manifest and no `src/` is not
//               walked, so its `dist/` is never freshness-checked. Shaped after
//               the citation guard's two scope-disclosure cases
//               (`standards/repo-citation-integrity.test.ts`): the case is
//               labelled as a disclosed residual and pinned so the exclusion
//               cannot close or widen unnoticed — NOT as a goal that is met.
//   control  -> the ordinary tree, with no stamp file at all, must still get the
//               ordinary refusal. Without this the discrimination above could be
//               satisfied by breaking the message for everyone.
//
// The `_setup` import registers its cleanup at collection time, so the temp
// roots and the lock files go away even when a case throws.

import { linkSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REBUILD_COMMAND } from '../../../scripts/dist-freshness.mjs';
import {
  ensurePackagesBuilt,
  evaluatePackages,
  listPackageRoots,
  PACKAGE_STAMP_RELATIVE_PATH,
  writePackageDistStamps
} from '../../../scripts/packages-build-prerequisite.mjs';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  fixture,
  recordingBuild,
  SOURCE_A,
  SOURCE_B,
  writeBuilt
} from '../_setup/packages-build-fixture.js';

declareDimensions('tests/unit/scripts/packages-build-stamp-write.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The stamp file of a fixture root. */
function stampOf(root: string): string {
  return join(root, PACKAGE_STAMP_RELATIVE_PATH);
}

/** The refusal `ensurePackagesBuilt` gives for `root`, or `undefined` if it did not refuse. */
function refusalFor(root: string): Error | undefined {
  try {
    ensurePackagesBuilt(root, { runBuild: recordingBuild([]) });
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

// ── render: the shape of the file written ────────────────────────────

describe('Scenario: render — the stamps file is replaced, not rewritten in place', () => {
  it('when the stamps are rewritten, should move the file rather than truncate the one that was there', () => {
    // given: a stamped tree, and a second name for the current stamp file
    const root = fixture({ a: SOURCE_A });
    writePackageDistStamps(root);
    const stamp = stampOf(root);
    const linked = `${stamp}.linked`;
    linkSync(stamp, linked);
    const before = readFileSync(linked, 'utf8');

    // when: the sources move on and the stamps are rewritten
    writeFileSync(join(root, 'packages', 'a', 'src', 'index.ts'), SOURCE_B, 'utf8');
    writePackageDistStamps(root);

    // then: the old file still holds the old bytes, and the stamp path holds new
    // ones — a truncating writer would have changed both names at once, which is
    // the partial read `readStamps` turns into "every package is stale".
    expect(readFileSync(linked, 'utf8')).toBe(before);
    expect(readFileSync(stamp, 'utf8')).not.toBe(before);
  });
});

// ── behavior: what a write that cannot complete leaves behind ────────

describe('Scenario: behavior — a write that cannot complete leaves nothing behind', () => {
  it('when the stamp path cannot be replaced, should throw and leave the packages directory as it was', () => {
    // given: a tree whose stamp path is occupied by a directory
    const root = fixture({ a: SOURCE_A });
    const packagesDir = join(root, 'packages');
    mkdirSync(stampOf(root));
    const before = readdirSync(packagesDir).sort();

    // when: the stamps are written to that path
    // then: it throws, and no temp file is left in a directory whose only
    // gitignore entry is the stamp itself
    expect(() => writePackageDistStamps(root)).toThrow();
    expect(readdirSync(packagesDir).sort()).toEqual(before);
  });
});

// ── behavior: the walk's rule, disclosed rather than desired ─────────

describe('Scenario: behavior — the walk is defined by `src/`, not by a manifest', () => {
  it('when a real packages/<dir> has a manifest and no src/, should not walk it', () => {
    // given: one ordinary package beside a REAL directory carrying a manifest
    // and no `src/` — the shape pnpm discovers as a project and this walk drops
    const root = fixture({ a: SOURCE_A });
    const manifestOnly = join(root, 'packages', 'manifest-only');
    mkdirSync(manifestOnly, { recursive: true });
    writeFileSync(join(manifestOnly, 'package.json'), '{"name":"manifest-only"}\n', 'utf8');

    // when: the walk enumerates that root
    const walked = listPackageRoots(root).map((pkg) => pkg.name);

    // then: only the ordinary package is walked, so the manifest-only
    //       directory's `dist/` is never freshness-checked. This case is a
    //       scope disclosure, not a satisfied goal: it is pinned here so the
    //       exclusion cannot close or widen unnoticed. Closing it means teaching
    //       this walk pnpm's manifest rule, which nothing has decided — under
    //       that rule a package with no `src/` could never read `fresh`.
    expect(walked).toEqual(['a']);
  });
});

describe('Scenario: behavior — a package whose src/ is an empty directory is dropped', () => {
  it('when packages/<dir>/src exists and holds nothing, should not walk it and not classify it either way', () => {
    // given: one ordinary package beside a REAL directory whose `src/` is an empty directory — the tree this walk drops
    // when: the walk enumerates that root and the verdict classifies it
    // then: the empty-src/ directory is in no bucket at all: never missing, never stale, never vouched for
    const root = fixture({ a: SOURCE_A });
    mkdirSync(join(root, 'packages', 'empty-src', 'src'), { recursive: true });

    const walked = listPackageRoots(root).map((pkg) => pkg.name);
    const verdict = evaluatePackages(root);

    // Also a scope disclosure, and the trade runs the OTHER way from the
    // manifest-only case above: there it is a manifest the walk cannot honour,
    // here the drop is load-bearing. An empty `include` is `TS18003: No inputs
    // were found` (measured with this repository's own tsc), so an empty-`src/`
    // package can never acquire a `dist/` — which makes the drop the reason the
    // post-build assertion is assertable at all. Without it the package is
    // `missing` forever and `REBUILD_COMMAND` is a remedy that cannot clear it.
    // Pinned so that trade cannot move in either direction unnoticed: closing
    // the drop turns this arm red, and so does widening it past a src/ that
    // cannot compile.
    expect(walked).toEqual(['a']);
    expect([...verdict.missing, ...verdict.stale, ...verdict.fresh]).toEqual(['a']);
  });
});

// ── integration: a real filesystem state the guard cannot read ───────

describe('Scenario: integration — a stamp path that is not a readable file', () => {
  it('when the stamp path holds a directory, should classify a built package as stale rather than fresh', () => {
    // given: a BUILT package whose stamp path is a directory
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    mkdirSync(stampOf(root));

    // when: the tree is classified
    const verdict = evaluatePackages(root);

    // then: it is `stale`, not `missing` — the artifacts are there, so this is a
    // refusal to vouch for records that cannot be read, and it is the safe
    // direction: an unreadable record is not a proven-current one
    expect(verdict.missing).toEqual([]);
    expect(verdict.stale).toEqual(['a']);
  });
});

// ── a11y: which sentence the operator gets ───────────────────────────

describe('Scenario: a11y — an unreadable stamp is refused as itself, not as a stale dist', () => {
  it('when the stamps cannot be read, should name the stamp path and not blame the dist', () => {
    // given: a tree with a BUILT package whose stamp path is a directory
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');
    mkdirSync(stampOf(root), { recursive: true });

    // when: the guard is asked to vouch for it
    const refusal = refusalFor(root);

    // then: the refusal names the records it could not read, does not make the
    // false claim that the dist/ disagrees with the src/, and does not offer the
    // rebuild that wipes and remakes the packages' dists and then stops on the
    // same obstacle — leaving the root `dist` wiped and never remade
    expect(refusal?.message).toContain(PACKAGE_STAMP_RELATIVE_PATH);
    expect(refusal?.message).not.toContain('not built from their current src/');
    expect(refusal?.message).not.toContain(REBUILD_COMMAND);
  });

  it('when the stamp file is merely absent, should refuse with the dist sentence and the rebuild remedy', () => {
    // given: a built package with no stamp file at all — the ordinary stale tree
    const root = fixture({ a: SOURCE_A });
    writeBuilt(root, 'a');

    // when: the guard is asked to vouch for it
    const refusal = refusalFor(root);

    // then: the ordinary refusal is unchanged, so the distinction above is
    // narrow rather than a new sentence for every tree
    expect(refusal?.message).toContain('not built from their current src/');
    expect(refusal?.message).toContain(REBUILD_COMMAND);
  });
});
