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
  STUB_VITEST_MARKER,
  buildGateFixture,
  disposeFixtureScratch,
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
let realRun: Promise<GateRun> | undefined;
let plantedRun: Promise<GateRun> | undefined;

function realFixture(): Promise<GateFixture> {
  realFixturePromise ??= buildGateFixture();
  return realFixturePromise;
}

function plantedFixture(): Promise<GateFixture> {
  plantedFixturePromise ??= buildGateFixture(true);
  return plantedFixturePromise;
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

afterAll(async () => {
  for (const fixture of [realFixturePromise, plantedFixturePromise]) {
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
