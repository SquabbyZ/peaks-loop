// tests/unit/lint/baseline-monotonicity-coupled-rise.test.ts
//
// Rid-039 (source: `docs/superpowers/specs/2026-10-09-post-mcp-current-state-roadmap.md`
// §3.6, where the user chose "joint determination" over leaving the two size rows on
// independent ratchets). The ratchet's rule was "ANY ceiling higher than the baseline is
// refused"; this slice opens its FIRST exception and nothing else:
//
//   `fileSizeOverCap` may rise if and only if `fileSizeExcessLines` is STRICTLY lower in
//   the same comparison. Equal is not a fall. Higher is not a fall. No other key is
//   eligible, and `fileSizeExcessLines` itself still refuses to rise.
//
// WHY IT IS JUSTIFIED. The excess lines are the debt and the file count is a coarse proxy
// for it, so an independent ratchet on the proxy punishes the INTERMEDIATE steps of the only
// fix that exists. Measured: `src/cli/commands/loop-eval-commands.ts` is 1,125 lines against
// the 300 cap — 825 excess. Split in two, the excess falls 825 → 526 and the count rises
// 1 → 2, which the old rule refused; split in four, the count falls to 0 and it was always
// allowed. The rule never forbade the split, only its honest middle.
//
// WHY THIS FILE IS A SIBLING AND NOT AN ARM IN `baseline-monotonicity.test.ts`. That file
// pins the decision table row by row and sits near the 500 raw-line tests cap; the campaign
// convention (`monotonic-split.test.ts`, `gate-module-staging.test.ts`) is that new arms get
// a file of their own rather than the headroom the next slice needs. The rule itself, its
// reason, why it is not a back door and the limit it knowingly accepts are argued once, in
// the contract comment of `.husky/peaks-gate-baseline-monotonic.mjs`; arm AC-7 below reads
// that comment so the rule sentence cannot silently leave the file the operator reads.
//
// FIVE DIRECTIONS, FIVE INDEPENDENT ARMS, FIVE INJECTIONS. AC-1..AC-5 are one `it` each, and
// AC-6 replays each arm's OWN expectation against a copy of the module whose predicate has
// been weakened in that direction — so the arms are known to be able to fail, not asserted
// to be green. The weakened copies are staged from the real module set by walk, so a sibling
// added later joins the harness with no edit here.
//
// Dimensions:
//   - behavior:    the decision table, direction by direction
//   - integration: the weakened module set staged into a temp tree and imported
//   - a11y:        the permitted-rise note and the guard's own contract comment
//   - render:      omitted — no artifact bytes, JSON envelope or stdout originate here;
//                  the generator's own bytes are `baseline-monotonicity-generator.test.ts`

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { MONOTONIC_ENTRY_REL, monotonicModulePathsUnder } from './_monotonic-module-set.js';

declareDimensions(
  'tests/unit/lint/baseline-monotonicity-coupled-rise.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'no artifact bytes, JSON envelope or stdout originate here; the generator prints the note and writes the file, which `baseline-monotonicity-generator.test.ts` measures'
    }
  ]
);

/** The two rows the policy couples, named once here as the arms' vocabulary. */
const COUNT = 'fileSizeOverCap';
const EXCESS = 'fileSizeExcessLines';
/** The motivating pair, measured 2026-10-09: 1,125 lines in one file, split in two. */
const BEFORE: Ceilings = { [COUNT]: 1, [EXCESS]: 825 };
const AFTER: Ceilings = { [COUNT]: 2, [EXCESS]: 526 };

type Ceilings = Record<string, number>;
type Delta = { key: string; previous: number; next: number };
type CoupledDelta = Delta & { justifiedBy: Delta };
type Decision = {
  ok: boolean;
  raised: Delta[];
  coupledRise: CoupledDelta[];
  lowered: Delta[];
  added: Array<{ key: string; next: number }>;
  removed: Array<{ key: string; previous: number }>;
  invalid: Array<{ key: string; side: string; value: string; why: string }>;
};
type Trip = { refusal: string | null; notes: string[] };
type MonotonicModule = {
  CEILING_KEYS?: readonly string[];
  compareCeilings(previous: Record<string, unknown>, next: Record<string, unknown>): Decision;
  describeMonotonicityNotes?(decision: Decision, seedRun: boolean): string[];
  workingCopyTrip?(options: {
    headRef: string;
    outRel: string;
    head: Ceilings;
    working: Ceilings;
  }): Trip;
};

const ARTIFACT_GIT_PATH = '.peaks/lint/gate-baseline.json';

/** The verdict an arm asserts, in the three buckets this policy can move. */
type Verdict = { ok: boolean; raised: string[]; coupled: string[] };

const keysOf = (rows: Array<{ key: string }>): string[] => rows.map((row) => row.key).sort();

function verdictOf(module: MonotonicModule, previous: Ceilings, next: Ceilings): Verdict {
  const decision = module.compareCeilings(previous, next);
  return {
    ok: decision.ok,
    raised: keysOf(decision.raised),
    coupled: keysOf(decision.coupledRise)
  };
}

/** The module this repository ships — the same entry every import site names. */
async function loadReal(): Promise<MonotonicModule> {
  return (await import(
    pathToFileURL(join(REPO_ROOT, MONOTONIC_ENTRY_REL)).href
  )) as MonotonicModule;
}

// ---------------------------------------------------------------------------
// AC-1..AC-5, each as the pair of vectors it turns on and the verdict it must get
// ---------------------------------------------------------------------------

type Arm = { previous: Ceilings; next: Ceilings; expected: Verdict };

/** AC-1 — the exception's purpose: the count rises BECAUSE the excess fell. */
const AC1: Arm = {
  previous: BEFORE,
  next: AFTER,
  expected: { ok: true, raised: [], coupled: [COUNT] }
};

/** AC-2 — equal is not a fall, so the rise is refused. */
const AC2: Arm = {
  previous: BEFORE,
  next: { [COUNT]: 2, [EXCESS]: 825 },
  expected: { ok: false, raised: [COUNT], coupled: [] }
};

/** AC-3 — a rising excess is not a fall either, and it is refused on its own account too. */
const AC3: Arm = {
  previous: BEFORE,
  next: { [COUNT]: 2, [EXCESS]: 900 },
  expected: { ok: false, raised: [COUNT, EXCESS].sort(), coupled: [] }
};

/** AC-4 — the excess's own ratchet is untouched: its rise refuses whatever the count does. */
const AC4: Arm = {
  previous: BEFORE,
  next: { [COUNT]: 1, [EXCESS]: 826 },
  expected: { ok: false, raised: [EXCESS], coupled: [] }
};

/** AC-5 — one representative non-couple key; the arm below is exhaustive over the list. */
const AC5: Arm = {
  previous: { ...BEFORE, eslintErrors: 4 },
  next: { ...AFTER, eslintErrors: 5 },
  expected: { ok: false, raised: ['eslintErrors'], coupled: [COUNT] }
};

/** A full canonical vector at zero, with the named rows set — never a partial vector. */
function vector(module: MonotonicModule, rows: Ceilings): Ceilings {
  return {
    ...Object.fromEntries((module.CEILING_KEYS ?? []).map((key) => [key, 0] as const)),
    ...rows
  };
}

/**
 * Every canonical row that is NOT the couple, raised by one while the excess falls by 299,
 * and the verdict it earned. Returns ONLY the rows that were not refused for their own key —
 * an empty array is the claim "the exception is one place", over the whole list rather than
 * over the two or three keys someone happened to think of.
 */
function wrongKeysUnderFallingExcess(module: MonotonicModule): string[] {
  const wrong: string[] = [];
  for (const key of module.CEILING_KEYS ?? []) {
    if (key === COUNT || key === EXCESS) continue;
    const decision = module.compareCeilings(
      vector(module, { [EXCESS]: 825, [key]: 1 }),
      vector(module, { [EXCESS]: 526, [key]: 2 })
    );
    if (decision.ok || keysOf(decision.raised).join() !== key || decision.coupledRise.length > 0) {
      wrong.push(key);
    }
  }
  return wrong;
}

describe('Scenario: behavior — the coupled size rise, one direction per arm', () => {
  it('AC-1 — when the file count rises while the excess lines fall, should permit the rise and name the pair that earned it', async () => {
    const module = await loadReal();
    const decision = module.compareCeilings(BEFORE, AFTER);
    expect(verdictOf(module, BEFORE, AFTER)).toEqual(AC1.expected);
    // The permitted rise is REPORTED, not swallowed: the bucket carries the count that went
    // up AND the excess that went down, so an operator reads the justification, not a number.
    expect(decision.coupledRise).toEqual([
      { key: COUNT, previous: 1, next: 2, justifiedBy: { key: EXCESS, previous: 825, next: 526 } }
    ]);
    expect(keysOf(decision.raised)).toEqual([]);
    expect(decision.ok).toBe(true);
  });

  it('AC-2 — when the file count rises and the excess lines hold, should refuse: equal is not a fall', async () => {
    expect(verdictOf(await loadReal(), AC2.previous, AC2.next)).toEqual(AC2.expected);
  });

  it('AC-3 — when the file count rises and the excess lines rise, should refuse both rows', async () => {
    expect(verdictOf(await loadReal(), AC3.previous, AC3.next)).toEqual(AC3.expected);
  });

  it('AC-4 — when the excess lines rise, should refuse however the file count moves', async () => {
    expect(verdictOf(await loadReal(), AC4.previous, AC4.next)).toEqual(AC4.expected);
    // The same rise with the count FALLING: the exception is one-directional, so a count
    // descent cannot buy the excess an increase.
    const module = await loadReal();
    expect(verdictOf(module, { [COUNT]: 2, [EXCESS]: 825 }, { [COUNT]: 1, [EXCESS]: 826 })).toEqual(
      {
        ok: false,
        raised: [EXCESS],
        coupled: []
      }
    );
  });

  it('AC-5 — when any other canonical key rises, should refuse it, and refuse it even when the excess falls', async () => {
    expect(verdictOf(await loadReal(), AC5.previous, AC5.next)).toEqual(AC5.expected);
    const module = await loadReal();
    // Exhaustive: every canonical row except the pair, one at a time, against a strictly
    // falling excess — the shape the exception permits for the count alone.
    expect(wrongKeysUnderFallingExcess(module), 'only fileSizeOverCap may be exempted').toEqual([]);
    expect((module.CEILING_KEYS ?? []).length).toBeGreaterThan(10);
  });

  it('AC-5b — when the row that has to justify the rise is not measurable, should refuse the rise', async () => {
    const module = await loadReal();
    // The three shapes that are NOT a small excess: the measurement dropped the row, the
    // anchor never carried it, and the value is not a ceiling. Each must leave the count rise
    // in `raised`, because a run must not be able to buy a count rise by removing the row
    // that would have to pay for it.
    const dropped = module.compareCeilings(BEFORE, { [COUNT]: 2 });
    expect(keysOf(dropped.raised)).toEqual([COUNT]);
    expect(keysOf(dropped.removed)).toEqual([EXCESS]);
    expect(dropped.ok).toBe(false);

    const added = module.compareCeilings({ [COUNT]: 1 }, AFTER);
    expect(keysOf(added.raised)).toEqual([COUNT]);
    expect(keysOf(added.added)).toEqual([EXCESS]);
    expect(added.ok).toBe(false);

    const notANumber = module.compareCeilings(BEFORE, { [COUNT]: 2, [EXCESS]: '526' });
    expect(keysOf(notANumber.raised)).toEqual([COUNT]);
    expect(keysOf(notANumber.invalid)).toEqual([EXCESS]);
    expect(notANumber.ok).toBe(false);

    const anchorNotANumber = module.compareCeilings({ [COUNT]: 1, [EXCESS]: -1 }, AFTER);
    expect(keysOf(anchorNotANumber.raised)).toEqual([COUNT]);
    expect(anchorNotANumber.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — the injections. Each one weakens the predicate in ONE direction and replays
// that direction's own arm, which must stop holding.
// ---------------------------------------------------------------------------

const COMPARE_REL = '.husky/monotonic/compare.mjs';
const PREDICATE_HEAD = 'const isCoupledRise = (key, before, after) =>';
/** The strict-fall comparison, as the injection anchors spell it. */
const FALLS_STRICTLY = 'after[COUPLED_FALL] < before[COUPLED_FALL]';

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-coupled-rise-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** The predicate replaced wholesale — the shapes that take the guard out or invert it. */
function replacePredicate(text: string, body: string): string {
  const start = text.indexOf(PREDICATE_HEAD);
  const end = text.indexOf(';', start);
  expect(start, `${COMPARE_REL} no longer carries ${PREDICATE_HEAD}`).toBeGreaterThan(-1);
  return `${text.slice(0, start)}${PREDICATE_HEAD} ${body};${text.slice(end + 1)}`;
}

/** The comparison alone replaced — the shapes that keep the key guard and change the test. */
function replaceComparison(text: string, replacement: string): string {
  expect(text, `${COMPARE_REL} no longer carries ${FALLS_STRICTLY}`).toContain(FALLS_STRICTLY);
  return text.replace(FALLS_STRICTLY, replacement);
}

/** The real module set, copied by WALK into a temp root and patched there. */
async function loadWeakened(patch: (text: string) => string): Promise<MonotonicModule> {
  const root = mkdtempSync(join(SCRATCH, 'weakened-'));
  for (const rel of monotonicModulePathsUnder(REPO_ROOT)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, readFileSync(join(REPO_ROOT, rel), 'utf8'), 'utf8');
  }
  const target = join(root, COMPARE_REL);
  const original = readFileSync(target, 'utf8');
  const weakened = patch(original);
  expect(weakened, 'the injection must really change the module').not.toBe(original);
  writeFileSync(target, weakened, 'utf8');
  return (await import(pathToFileURL(join(root, MONOTONIC_ENTRY_REL)).href)) as MonotonicModule;
}

/**
 * The control AND the evidence, in that order. The arm must first hold on the module this
 * repository ships — an arm that was already red could not tell a weakened predicate from
 * its own typo — and then stop holding on the weakened copy, which is what "this test can
 * fail" means. `verdictOf` is called OUTSIDE the throwing lambda so a module that no longer
 * runs is an error rather than a passing "it threw, therefore it went red".
 */
async function expectArmRed(
  patch: (text: string) => string,
  arm: Arm,
  what: string
): Promise<void> {
  expect(verdictOf(await loadReal(), arm.previous, arm.next), `${what} (control)`).toEqual(
    arm.expected
  );
  const weakened = await loadWeakened(patch);
  const verdict = verdictOf(weakened, arm.previous, arm.next);
  expect(
    verdict,
    `${what}: the weakening must change the verdict, not break the module`
  ).not.toEqual(arm.expected);
  expect(() => expect(verdict).toEqual(arm.expected), what).toThrow();
}

describe('Scenario: integration — the predicate weakened five ways, one per direction', () => {
  it('AC-6/1 — AC-1 goes red when the coupled predicate is never satisfied (the exception removed)', async () => {
    await expectArmRed((text) => replacePredicate(text, 'false'), AC1, 'AC-1');
  });

  it('AC-6/2 — AC-2 goes red when the fall is weakened from strict to non-strict', async () => {
    await expectArmRed(
      (text) => replaceComparison(text, 'after[COUPLED_FALL] <= before[COUPLED_FALL]'),
      AC2,
      'AC-2'
    );
  });

  it('AC-6/3 — AC-3 goes red when the fall is measured in the wrong direction', async () => {
    await expectArmRed(
      (text) => replaceComparison(text, 'after[COUPLED_FALL] > before[COUPLED_FALL]'),
      AC3,
      'AC-3'
    );
  });

  it('AC-6/4 — AC-4 goes red when the exemption is widened from the pair-count to the whole pair', async () => {
    await expectArmRed(
      (text) => replacePredicate(text, 'key === COUPLED_RISE || key === COUPLED_FALL'),
      AC4,
      'AC-4'
    );
  });

  it('AC-6/5 — AC-5 goes red when the exemption is widened to every key', async () => {
    const weakened = await loadWeakened((text) => replacePredicate(text, 'true'));
    const module = await loadReal();
    expect(wrongKeysUnderFallingExcess(module), 'the control: nothing outside the pair').toEqual(
      []
    );
    expect(wrongKeysUnderFallingExcess(weakened).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-7 and the note: the rise is said out loud, and the argument stays in the guard
// ---------------------------------------------------------------------------

describe('Scenario: a11y — what a permitted rise says to the operator who reads it', () => {
  it('says the count rose AND which excess fall paid for it, instead of printing "nothing rose"', async () => {
    const module = await loadReal();
    expect(typeof module.describeMonotonicityNotes, 'the note renderer must resolve').toBe(
      'function'
    );
    const decision = module.compareCeilings(BEFORE, AFTER);
    const notes = (module.describeMonotonicityNotes ?? (() => []))(decision, false);
    const text = notes.join('\n');
    expect(text, text).toContain(`${COUNT}: 1 → 2`);
    expect(text, text).toContain(`${EXCESS}: 825 → 526`);
    // The old headline claimed the opposite of what happened here; it must be gone.
    expect(text, text).not.toContain('nothing rose and nothing dropped');
    // And an ordinary descent still reads the old way, so the new sentence is not the only one.
    const plain = (module.describeMonotonicityNotes ?? (() => []))(
      module.compareCeilings(BEFORE, { [COUNT]: 1, [EXCESS]: 526 }),
      false
    ).join('\n');
    expect(plain, plain).toContain('nothing rose and nothing dropped');
  });

  it('AC-7 — the guard’s own contract comment carries the rule sentence and the accepted limit, not the prose reason', () => {
    const contract = readFileSync(join(REPO_ROOT, MONOTONIC_ENTRY_REL), 'utf8');
    expect(contract, 'the exception is argued where the operator reads the rule').toContain(
      'THE ONE EXCEPTION THIS RATCHET HAS EVER SANCTIONED'
    );
    // THE RULE ITSELF, not just the headline that one exists. This phrase is the only place
    // in the guard that states WHEN the rise is allowed, so deleting the rule sentence — the
    // one sentence this arm is named for — turns the arm red. Asserting the phrase and not
    // the paragraph keeps a wording polish green while the rule stays un-droppable.
    expect(contract, 'the rule must be stated, not only its headline').toContain(
      'may go UP when, and ONLY when'
    );
    expect(contract).toContain(COUNT);
    expect(contract).toContain(EXCESS);
    // The degenerate case, recorded as accepted rather than bounded: one 1,125-line file
    // becoming a hundred 301-line files is PERMITTED, and it is written down with the reason
    // there is no maximum rise in the code.
    expect(contract, 'the accepted limit must be stated, not implied').toContain(
      'hundred 301-line files'
    );
    expect(contract).toContain('KNOWN AND ACCEPTED LIMIT');
    expect(contract, 'and the reason there is no bound').toMatch(/BOUNDED/);
  });

  it('reports the permitted pair on the working-copy trip rather than passing it in silence', async () => {
    const module = await loadReal();
    const trip = module.workingCopyTrip?.({
      headRef: 'HEAD',
      outRel: ARTIFACT_GIT_PATH,
      head: BEFORE,
      working: AFTER
    });
    // The exemption lives in the comparison, so it holds here too — a previous run that
    // legitimately wrote a count of 2 must not be refused on the next run before its commit.
    expect(trip?.refusal, 'a previous run’s legitimate write is not an attack').toBeNull();
    const text = (trip?.notes ?? []).join('\n');
    expect(text, text).toContain(`${COUNT}: HEAD 1 → disk 2`);
    expect(text, text).toContain(`${EXCESS}: HEAD 825 → disk 526`);
    // And the refusal half is untouched: any OTHER row lifted on the disk still refuses,
    // including in the same disk edit that carries the permitted pair.
    const other = module.workingCopyTrip?.({
      headRef: 'HEAD',
      outRel: ARTIFACT_GIT_PATH,
      head: { ...BEFORE, prettierUnformatted: 2 },
      working: { ...AFTER, prettierUnformatted: 9 }
    });
    expect(other?.refusal, 'a lift outside the pair still refuses').not.toBeNull();
    expect(other?.refusal ?? '', 'and it names the row that did it').toContain(
      'prettierUnformatted'
    );
  });
});
