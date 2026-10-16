// tests/unit/standards/tier-prose-carriers.test.ts
//
// THE TIER AS PROSE STATES IT, BOUND TO THE TIER AS THE GATE DECLARES IT.
//
// `scripts/test-changed-classify.mjs` declares the whole-tree tier ONCE — two guard directories
// plus the selector for the ROOT of `tests/unit/` — and `subset()` unions all three members into
// every subset verdict, so the machine path reaches the tier by rule however the diff is shaped.
// Four hand-written sites in `src/` still described that tier as the TWO DIRECTORIES it was before
// the root member existed, so a reader — and a HAND-run built from that reading — works from an
// outdated list. This file is the arm that keeps the two sides together, and it is the first of
// this repository's tier arms whose subject is the PROSE rather than the selector.
//
// WHY THE ARM LIVES HERE AND NOT IN `src/`. The tier is a `.mjs` constant, loaded by plain `node`
// from `.husky/pre-push`: it cannot load a `.ts` file, and moving the constants the other way would
// make the pre-push path depend on a loader it does not have. `tests/` is therefore the only layer
// that can read both sides, and `scripts/test-changed-root-tier.mjs` already records the same wall
// for the same reason.
//
// WHY THE CARRIERS ARE READ AS SOURCE TEXT RATHER THAN IMPORTED. Two of the four are exported
// constants and would import; the fourth is a doc comment, which no import can reach, and a fifth
// kind of carrier could be anything. Reading each carrier's own BYTES also makes the arm drivable
// against a damaged copy of the repository — the only way AC2's per-carrier mutation can be shown
// as a red rather than asserted as a predicate — and it keeps one mechanism for all four instead of
// two. The expectation is derived from the constant and never the other way round: constant →
// prose spelling, one direction, which is what lets a FIFTH member redden the carriers.
//
// WHAT MAKES IT NON-VACUOUS. The two sides are INDEPENDENTLY authored (a hand-written sentence
// against a declared constant), so this is not a constant compared to itself. The arms damage the
// REAL text of every carrier, once per member, and require the check to name the member that went
// missing; then they plant a FIFTH member — and, separately, a changed ROOT selector — into a copy
// of the classifier and require every carrier to redden.
//
// WHAT IT DELIBERATELY DOES NOT DO: scan `src/` for an undeclared fifth carrier. The tier's path
// names appear in seven `src/` comments that cite a SPECIFIC guard FILE (`…/file-size-cap.test.ts`
// and its neighbours) — file citations, not tier lists — and a scanner over path strings cannot
// tell the two apart without being taught a distinction that would then need an arm of its own. A
// fifth PROSE carrier is a finding for a slice, not a silent fold-in. Its one blind spot is named
// where it bites: the arm binds MEMBER NAMES, so a stale cardinality word ("both path names") is
// invisible to it.
//
// Dimensions: `render` is omitted — nothing is rendered, the observable is the list of members a
// carrier failed to name — and `a11y` is omitted for the reason the tier's sibling file gives: the
// drift surfaces as a failing assertion whose message names the carrier, not as an operator-facing
// surface of its own.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/standards/tier-prose-carriers.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'nothing is rendered — the observable is the list of tier members a carrier fails to name'
    },
    {
      dim: 'a11y',
      reason:
        'no operator-facing surface: the drift surfaces as a failing assertion that names the carrier, as in `tests/unit/scripts/test-changed-guard-tier.test.ts`'
    }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLASSIFIER_REL = 'scripts/test-changed-classify.mjs';

type ClassifyModule = {
  GATE_GUARD_SUITES: readonly string[];
  ROOT_TIER_SELECTOR: string;
};

/** A carrier's own bytes out of its file's text — narrow, so a sibling carrier cannot satisfy it. */
type Carrier = {
  /** What a reader calls the site, and what a failure message must name. */
  readonly name: string;
  /** The file whose text carries it, repo-relative. */
  readonly file: string;
  readonly slice: (source: string) => string;
};

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-tier-prose-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

async function loadClassifier(): Promise<ClassifyModule> {
  return (await import(pathToFileURL(join(REPO_ROOT, CLASSIFIER_REL)).href)) as ClassifyModule;
}

/** The carrier's file text, read the way every other arm in this repository reads a tree fact. */
function sourceOf(carrier: Carrier): string {
  return readFileSync(join(REPO_ROOT, carrier.file), 'utf8');
}

/**
 * The tier as PROSE spells it. The classifier writes each guard directory with the trailing slash
 * a directory selector needs; every carrier writes it as the path a reader would run, without it.
 * The root member is already a path and crosses unchanged.
 *
 * The derivation runs ONE WAY on purpose. An expectation read back out of the prose, or a prose
 * list generated from the constant, would make this file a restatement rather than a guard: the
 * point is that the sentence and the constant were written by different hands, so a disagreement
 * is a defect in one of them and the arm cannot tell which — it only has to say so.
 *
 * Stripping the slash is safe in the failing direction: a member declared WITHOUT one is left
 * alone, and the check is a substring test, so a prose spelling carrying the slash still matches.
 */
function tierNames(mod: ClassifyModule): string[] {
  return [...mod.GATE_GUARD_SUITES.map((dir) => dir.replace(/\/$/, '')), mod.ROOT_TIER_SELECTOR];
}

/** The `/** … *\/` block documenting the declaration that starts at `marker`. Throws if it moved. */
function docBlockAbove(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`no \`${marker}\` in that file — the carrier moved`);
  const start = source.slice(0, at).lastIndexOf('/**');
  if (start < 0)
    throw new Error(`\`${marker}\` carries no doc comment above it — the carrier moved`);
  return source.slice(start, at);
}

/** The one source LINE holding `marker`. A sentence is a line; the whole file is not a carrier. */
function lineHolding(source: string, marker: string): string {
  const line = source.split('\n').find((candidate) => candidate.includes(marker));
  if (line === undefined) throw new Error(`no line holds \`${marker}\` — the carrier moved`);
  return line;
}

/**
 * THE FOUR SITES. Each is the site's OWN bytes, cut as narrowly as the site allows: the two
 * carriers sharing `test-tool-detection.ts` are cut from different regions (the block's tier
 * sentence, and the doc comment above `formatTestToolDetection`) so that damaging one cannot be
 * satisfied by the other — the vacuity AC2 exists to rule out.
 */
const CARRIERS: ReadonlyArray<readonly [string, Carrier]> = [
  [
    "the dispatch prompt's runner-rule token list",
    {
      name: "the dispatch prompt's runner-rule token list",
      file: 'src/services/context/build-dispatch-system-prompt.ts',
      slice: (source) => {
        const at = source.indexOf('export const TEST_RUNNER_RULE_TOKENS');
        if (at < 0) throw new Error('TEST_RUNNER_RULE_TOKENS is gone — the carrier moved');
        return source.slice(source.lastIndexOf('/**', at), source.indexOf('] as const;', at));
      }
    }
  ],
  [
    'the post-compact re-injection test-scope rule',
    {
      name: 'the post-compact re-injection test-scope rule',
      file: 'src/services/context/post-compact-reinjection.ts',
      slice: (source) => lineHolding(source, 'Test scope:')
    }
  ],
  [
    "the Test Scope block's tier sentence",
    {
      name: "the Test Scope block's tier sentence",
      file: 'src/services/dispatch/test-tool-detection.ts',
      slice: (source) => lineHolding(source, "This repo's tier is")
    }
  ],
  [
    "the Test Scope block's own doc comment",
    {
      name: "the Test Scope block's own doc comment",
      file: 'src/services/dispatch/test-tool-detection.ts',
      slice: (source) => docBlockAbove(source, 'export function formatTestToolDetection')
    }
  ]
];

/** The tier members this carrier fails to name, in the classifier's own order. */
function missingTierNames(carrier: Carrier, source: string, names: readonly string[]): string[] {
  const text = carrier.slice(source);
  return names.filter((name) => !text.includes(name));
}

/**
 * The string the pre-s12 prose asserted and the gate no longer does: that a scoped run MISSES the
 * tier. It was false the moment `subset()` began unioning the tier into every subset verdict, and a
 * reader who trusts it concludes the risk is unmitigated when it is not.
 */
const RETIRED_CLAIM = 'silently misses';

/** The classifier's declaration of the guard-directory SET — the anchor a fifth member is planted at. */
const SUITES_ANCHOR =
  'export const GATE_GUARD_SUITES = Object.freeze([STANDARDS_GUARD_PATH, LINT_GUARD_PATH]);';

/** The classifier's declaration of the ROOT member — the anchor a changed selector is planted at. */
const SELECTOR_ANCHOR = "export const ROOT_TIER_SELECTOR = 'tests/unit/*.test.ts';";

/**
 * A copy of the shipped classifier with ONE declaration rewritten, imported from scratch. Each
 * replant THROWS when its anchor is gone, so a refactor cannot silently disarm it and leave the
 * arms below green over a plant that never landed.
 */
async function loadPlantedClassifier(label: string, anchor: string, planted: string) {
  const source = readFileSync(join(REPO_ROOT, CLASSIFIER_REL), 'utf8');
  expect(source, `${CLASSIFIER_REL} no longer carries \`${anchor}\``).toContain(anchor);
  const rewritten = source.replace(anchor, planted);
  expect(rewritten, 'the injection must really change the module').not.toBe(source);
  const target = join(mkdtempSync(join(SCRATCH, `${label}-`)), 'test-changed-classify.mjs');
  writeFileSync(target, rewritten, 'utf8');
  return (await import(pathToFileURL(target).href)) as ClassifyModule;
}

// ---------------------------------------------------------------------------
// behavior — every carrier names every member the classifier declares
// ---------------------------------------------------------------------------

describe('Scenario: behavior — each prose carrier names every member of the declared tier', () => {
  it('when the classifier is read, should declare the two directories and the root selector', async () => {
    // given: the tier's declaration, and the root tier's own reader beside it
    // when:  both are read
    // then:  the tier is the three members this arm binds the prose to — TWO directories plus the
    //        root SELECTOR, which is a different KIND of member and is why it is named separately
    const mod = await loadClassifier();
    const names = tierNames(mod);

    expect(mod.GATE_GUARD_SUITES).toHaveLength(2);
    expect(names).toHaveLength(mod.GATE_GUARD_SUITES.length + 1);
    expect(names).toContain(mod.ROOT_TIER_SELECTOR);
    expect(names, 'the root member is not a directory').toContain('tests/unit/*.test.ts');
  });

  it.each(CARRIERS)(
    'when the tier is the classifier`s, should be named by %s',
    async (_name, carrier) => {
      // given: one hand-written carrier, and the tier the gate actually unions
      // when:  the carrier's own bytes are searched for each member's spelling
      // then:  every member is named — a carrier that lists two of three is the defect this arm
      //        exists for, and it is exactly what s12 found and did not fix
      const names = tierNames(await loadClassifier());
      const missing = missingTierNames(carrier, sourceOf(carrier), names);

      expect(missing, `${carrier.name} must name ${names.join(', ')}`).toEqual([]);
    }
  );

  it('when the carriers are cut, should cut each one narrow rather than whole-file', () => {
    // given: the vacuity AC2 rules out — a carrier whose slice is its whole file would be satisfied
    //        by ANY other carrier in that file, and the two sharing `test-tool-detection.ts` would
    //        be one carrier wearing two names
    // when:  every slice is measured against the file it came from
    // then:  each is a strict, non-empty part of its file, and no two slices overlap
    const slices: string[] = [];
    for (const [name, carrier] of CARRIERS) {
      const source = sourceOf(carrier);
      const slice = carrier.slice(source);
      expect(slice.length, `${name} was cut to nothing`).toBeGreaterThan(0);
      expect(slice.length, `${name} was cut to the whole file`).toBeLessThan(source.length);
      for (const other of slices) {
        expect(
          slice.includes(other) || other.includes(slice),
          `${name} overlaps another carrier's slice`
        ).toBe(false);
      }
      slices.push(slice);
    }
  });

  it('when the block explains why it names the tier, should no longer claim a scoped run misses it', () => {
    // given: site 4 of the four, which is not merely incomplete — it stated the PRE-s12 rule as
    //        current, and it is the one a reader is most likely to trust, because it is the WHY
    // when:  the comment's own bytes are read
    // then:  the retired claim is gone. It was true of the gate before s8/s12 and is false now:
    //        `subset()` unions the tier into every subset verdict, so the gap is a HAND-run's
    const carrier = CARRIERS[3]?.[1] as Carrier;
    const doc = carrier.slice(sourceOf(carrier));

    expect(doc, 'the correction must stay a correction').not.toContain(RETIRED_CLAIM);
    // CONTROL: the same predicate fires on the sentence it was written against, so "absent" is a
    // reading of this comment and not of a comment that happens to be empty
    expect(`and so a scoped run ${RETIRED_CLAIM} the tier`).toContain(RETIRED_CLAIM);
    expect(doc.length, 'the control is vacuous on an empty carrier').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// integration — the carriers are real bytes, and every one of them can go red
// ---------------------------------------------------------------------------

describe('Scenario: integration — every carrier is covered, and each one can go red', () => {
  it.each(CARRIERS)(
    'when %s is damaged, should name the member that went missing',
    async (_name, carrier) => {
      // given: the carrier's REAL bytes, and one member struck out of them at a time
      // when:  the same check the arms above ran is re-run over the damaged copy
      // then:  exactly that member is reported — for every carrier and every member, so an arm
      //        covering three of the four carriers cannot pass by looking like this one
      const names = tierNames(await loadClassifier());
      const source = sourceOf(carrier);
      const text = carrier.slice(source);

      for (const name of names) {
        expect(text, `${carrier.name} does not carry \`${name}\` to begin with`).toContain(name);
        const damagedSource = source.replace(text, text.split(name).join(''));
        expect(damagedSource, `removing \`${name}\` must change the file`).not.toBe(source);
        expect(
          missingTierNames(carrier, damagedSource, names),
          `${carrier.name}, with \`${name}\` struck out`
        ).toEqual([name]);
      }
    }
  );

  it('when a FIFTH member is planted in the classifier, should redden every carrier', async () => {
    // given: the drift this slice exists for — a third guard directory declared by someone who did
    //        not know four hand-written sites name the tier. The control runs first: every carrier
    //        is green against the SHIPPED constant, so the reds below are the plant's doing
    // when:  the same carriers are checked against the planted tier
    // then:  every carrier reports the member it cannot know about — the message names the carrier
    //        AND the member, which is the whole of what a contributor needs to fix it
    const shipped = tierNames(await loadClassifier());
    const planted = await loadPlantedClassifier(
      'fifth-member',
      SUITES_ANCHOR,
      "export const GATE_GUARD_SUITES = Object.freeze([STANDARDS_GUARD_PATH, LINT_GUARD_PATH, 'tests/unit/guard-three/']);"
    );
    const plantedNames = tierNames(planted);
    expect(plantedNames, 'the plant must really add a member').toEqual([
      ...shipped.slice(0, -1),
      'tests/unit/guard-three',
      shipped[shipped.length - 1]
    ]);

    for (const [name, carrier] of CARRIERS) {
      const source = sourceOf(carrier);
      expect(missingTierNames(carrier, source, shipped), `control: ${name} is green today`).toEqual(
        []
      );
      expect(
        missingTierNames(carrier, source, plantedNames),
        `${name} under a fifth member`
      ).toEqual(['tests/unit/guard-three']);
    }
  });

  it('when the ROOT selector is changed in the classifier, should redden every carrier', async () => {
    // given: the other half of the drift — the root member is the tier's newest and least
    //        self-evident, so a selector rewritten without the prose following is the likeliest
    //        single-member regression
    // when:  the carriers are checked against a copy declaring a different selector
    // then:  every carrier names the changed spelling as missing, which is what "bound to the
    //        constant" has to mean if it is to survive a renamed member
    const shipped = tierNames(await loadClassifier());
    const planted = await loadPlantedClassifier(
      'changed-selector',
      SELECTOR_ANCHOR,
      "export const ROOT_TIER_SELECTOR = 'tests/unit/*.spec.ts';"
    );
    const changed = tierNames(planted);
    expect(changed, 'the plant must really change the member').toContain('tests/unit/*.spec.ts');

    for (const [name, carrier] of CARRIERS) {
      const source = sourceOf(carrier);
      expect(missingTierNames(carrier, source, shipped), `control: ${name} is green today`).toEqual(
        []
      );
      expect(
        missingTierNames(carrier, source, changed),
        `${name} under a changed selector`
      ).toEqual(['tests/unit/*.spec.ts']);
    }
  });
});
