/**
 * tests/unit/scripts/test-changed-nul-e2e.test.ts
 *
 * THE CALL-SITE HALF of the push gate's input format: the two `git diff --name-status -z`
 * arguments in `scripts/test-changed.mjs`. Nothing in the parser's own arms can see this half —
 * they are handed a string, and they behave correctly whatever produced it. Only a run of the
 * gate's OWN runner against a REAL repository can tell whether `-z` was passed, which is why this
 * file exists separately from `test-changed-nul-paths.test.ts`.
 *
 * WHAT THE CHANGE COST, stated so the arm is not mistaken for ceremony. Without `-z`, git
 * C-quotes a path holding non-ASCII or control bytes (`core.quotePath` defaults on), the quoted
 * string matches no anchored trigger and no area regex, and the suite that path belongs to is
 * dropped from the selection — silently. So the arm asserts the path reaches the classifier, the
 * verdict is a SUBSET, and the area suite is what vitest is handed.
 *
 * THE PLANT IS THE REQUIREMENT. An arm updated to match new behaviour proves nothing unless it
 * could have failed, so the second arm rebuilds the identical repository with the runner's two
 * `-z` arguments removed and asserts the classification DEGRADES. It degrades the safe way — the
 * NUL parser finds no record in tab-separated text, the diff reads as empty, and the whole suite
 * runs — which is exactly why the loss was latent rather than loud, and exactly why the arm has to
 * pin it rather than trust it.
 *
 * Dimensions: `render` is omitted (the runner's only rendering is the stderr narration asserted
 * under `a11y`) and `behavior` is omitted (the runner runs its whole flow at import, so there is no
 * callable unit here — the parse behaviour is the sibling file's subject).
 */

import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  NON_ASCII_REL,
  ROOT_GUARD_REL,
  STUB_VITEST_MARKER,
  buildGateFixture,
  disposeFixtureScratch,
  loadClassifyModule,
  runGate,
  type GateFixture,
  type GateRun
} from '../_setup/gate-nul-fixture.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/scripts/test-changed-nul-e2e.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: "the runner's only rendering is the stderr narration asserted under a11y"
    },
    {
      dim: 'behavior',
      reason:
        'the runner executes its whole flow at import, so it exposes no callable unit; the parse behaviour is test-changed-nul-paths.test.ts'
    }
  ]
);

let realFixturePromise: Promise<GateFixture> | undefined;
let plantedFixturePromise: Promise<GateFixture> | undefined;
let badSelectorFixturePromise: Promise<GateFixture> | undefined;
let realRun: Promise<GateRun> | undefined;
let plantedRun: Promise<GateRun> | undefined;
let badSelectorRun: Promise<GateRun> | undefined;

function realFixture(): Promise<GateFixture> {
  realFixturePromise ??= buildGateFixture();
  return realFixturePromise;
}

function plantedFixture(): Promise<GateFixture> {
  plantedFixturePromise ??= buildGateFixture(true);
  return plantedFixturePromise;
}

/** The same fixture with the CLASSIFIER's selector desynchronised from the rule's two halves. */
function badSelectorFixture(): Promise<GateFixture> {
  badSelectorFixturePromise ??= buildGateFixture(false, true);
  return badSelectorFixturePromise;
}

/**
 * The runner's stderr over the non-ASCII diff, taken ONCE and read by both arms below — the
 * narration is the runner's and re-running it would only buy a second identical spawn.
 */
function narration(): Promise<GateRun> {
  realRun ??= (async () => runGate(await realFixture()))();
  return realRun;
}

/** The same run with HEAD's call sites: no `-z`, so the NUL parser sees an empty diff. */
function plantedNarration(): Promise<GateRun> {
  plantedRun ??= (async () => runGate(await plantedFixture()))();
  return plantedRun;
}

/** The same run against the desynchronised classifier: the gate must refuse before it selects. */
function badSelectorNarration(): Promise<GateRun> {
  badSelectorRun ??= (async () => runGate(await badSelectorFixture()))();
  return badSelectorRun;
}

afterAll(async () => {
  for (const fixture of [realFixturePromise, plantedFixturePromise, badSelectorFixturePromise]) {
    if (fixture !== undefined) (await fixture).repo.dispose();
  }
  disposeFixtureScratch();
});

describe('Scenario: integration — a non-ASCII path end to end, through the gate`s own runner', () => {
  it(
    'when only a non-ASCII path changed, should select its area suite rather than degrade',
    async () => {
      // given: a temporary repository whose single change is `M src/services/中文 name.ts`
      // when:  the gate's own `scripts/test-changed.mjs` classifies it
      // then:  the path reaches the classifier, the verdict is a SUBSET, and the suite process is
      //        handed that area — not the whole suite (the unmapped fallback) and not nothing
      //        (which is what a quoted path used to cost)
      const { status, stderr } = await narration();

      expect(status, stderr).toBe(0);
      expect(stderr, `the real path must reach the classifier: ${stderr}`).toContain(
        `  - M ${NON_ASCII_REL}`
      );
      expect(stderr).toContain('verdict: subset');
      expect(stderr, 'the area suite, handed to vitest').toContain(
        `${STUB_VITEST_MARKER} run tests/unit/services`
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when a mapped file changed in content only, should hand the tier over as well as the area',
    async () => {
      // given: the fixture's single `M`, in a mapped area, with no file-set change at all — the
      //        shape of a slice that only edits existing files
      // when:  the gate's own runner selects what to run
      // then:  both whole-tree guard directories survive the runner's existence filter and reach
      //        the suite process: the tier rides every subset, so the suites whose subject is the
      //        tree are run even though nothing in the diff names them
      const { status, stderr } = await narration();

      expect(status, stderr).toBe(0);
      const mod = await loadClassifyModule();
      for (const suite of mod.GATE_GUARD_SUITES) {
        expect(stderr, `${suite} must be picked rather than filtered out`).toContain(
          `  * ${suite}`
        );
      }
      expect(stderr, 'the area suite is still handed over too').toContain(
        `${STUB_VITEST_MARKER} run tests/unit/services`
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the root of tests/unit holds a test file, should hand THAT file to the suite process',
    async () => {
      // given: the fixture's `tests/unit/` root holds a `*.test.ts` that the diff never names — the
      //        population the root tier exists for, and the shape nothing used to reach
      // when:  the gate's OWN runner expands the root selector from that directory's listing
      // then:  the file is in the ARGV vitest received, not merely in the classifier's `paths`: an
      //        unexpanded selector is dropped by the runner's `existsSync` filter (vitest's filter
      //        is a `String.includes`), so a `paths` assertion would pass while nothing ever ran
      const { status, stderr } = await narration();
      const argv = stderr.split('\n').find((line) => line.startsWith(STUB_VITEST_MARKER)) ?? '';

      expect(status, stderr).toBe(0);
      expect(argv, `the root guard never reached vitest: ${stderr}`).toContain(ROOT_GUARD_REL);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the classifier`s selector cannot be reconciled, should refuse to run at all',
    async () => {
      // given: R7's fail-closed claim, whose runner half was asserted in prose only — the fixture's
      //        CLASSIFIER is copied with a selector whose halves no longer compose with the rule's
      // when:  the gate's own runner starts and imports the rule
      // then:  it refuses BEFORE selecting anything: exit 1 and no suite process. Passing the
      //        selector through instead would let `existsSync` drop it and the run would stay green
      //        with a guard missing — the silent-loss class this slice exists to close
      const { status, stderr } = await badSelectorNarration();

      expect(status, `the gate must refuse, not run: ${stderr}`).toBe(1);
      expect(stderr, 'and it must say which reconciliation failed').toContain(
        'not tests/unit/*.test.ts'
      );
      expect(stderr, 'no suite may be spawned').not.toContain(STUB_VITEST_MARKER);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the call sites keep HEAD`s tab feed, should degrade the same diff to the whole suite',
    async () => {
      // given: the identical repository, with the runner's two `-z` arguments removed
      // when:  the gate's own runner classifies the identical diff
      // then:  the NUL parser finds no record in tab-separated text, the diff reads as EMPTY, and
      //        the whole suite runs. That is the safe direction — and it is exactly why the
      //        call-site half needs this arm: no parser-level arm can see it
      const control = await narration();
      expect(control.stderr, 'control: the unplanted runner selects the area').toContain(
        'verdict: subset'
      );

      const { status, stderr } = await plantedNarration();
      expect(status, stderr).toBe(0);
      expect(stderr, 'without `-z` the parser sees no record at all').toContain(
        'verdict: empty-diff'
      );
      expect(stderr, 'the whole suite is the fallback').toContain(STUB_VITEST_MARKER);
      expect(stderr).not.toContain(`${STUB_VITEST_MARKER} run tests/unit/services`);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// a11y — the narration an operator reads when this gate runs
// ---------------------------------------------------------------------------

describe('Scenario: a11y — the runner prints the path it decoded, not an escape', () => {
  it('when a non-ASCII path changed, should name its real bytes on stderr', async () => {
    // given: the end-to-end run above
    // when:  the runner's stderr listing is read the way the hook's operator reads it
    // then:  the path appears verbatim and no C escape appears anywhere — a quoted or truncated
    //        form is precisely what made the original miss invisible
    const { stderr } = await narration();

    expect(stderr).toContain(`  - M ${NON_ASCII_REL}`);
    expect(stderr, 'a C escape would mean the parser never saw the real bytes').not.toMatch(
      /\\3[0-7]{2}/
    );
  });
});
