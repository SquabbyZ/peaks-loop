// tests/unit/lint/file-size-hooks-gate-leg.test.ts
//
// Rid `2026-10-02-hooks-size-rows` (backlog §2.32) — the two ceiling rows for the
// scope that was measured by nothing: `.husky/`, the directory the ratchet itself
// lives in.
//
// WHAT WAS INVISIBLE. `FILE_SIZE_SCOPE_DIRS` names four directories, so the files
// that IMPLEMENT the file-size policy sat outside every row that could see them: no
// `fileSizeOverCap` entry, no `files` table entry, no prettier verdict. At HEAD
// 06c38c86 `peaks-gate.mjs`, `peaks-gate-baseline.mjs` and
// `peaks-gate-baseline-monotonic.mjs` carry 1004 / 750 / 662 raw lines against the
// same cap of 300 the rest of the repo is held to — 3 files over cap, 1,516 lines of
// excess — and `node .husky/peaks-gate.mjs file-size` prints `file-size ceiling held`
// without ever mentioning them.
//
// WHY A SECOND PAIR OF ROWS AND NOT A FIFTH SCOPE DIRECTORY. Joining `.husky` to the
// main policy at cap 300 raises `fileSizeOverCap` 162 → 165 and
// `fileSizeExcessLines` 54,318 → 55,834 (+1,516), and the monotonicity guard refuses
// a raised ceiling — correctly, because that is a policy re-decision wearing the
// clothes of a measurement. So the invisible set gets its own two rows, seeded from
// the census's own new `hooks` block, bound to their own inputs, and enforced by the
// same leg off the same census invocation.
//
// WHY EVERY PROCESS ARM RUNS IN A FIXTURE REPOSITORY. These arms need the whole leg:
// a real census measurement, a real generator-seeded ceiling, a real `check` going
// red. The published `.peaks/lint/gate-baseline.json` carries no hooks rows until the
// orchestrator's seeding run lands — the leg correctly refuses the WHOLE leg on a
// missing ceiling (`missingFileSizeCeilings`), so an arm that only becomes runnable
// after somebody regenerates the artifact is an arm that cannot be watched failing.
// `_file-size-hooks-fixture.ts` builds a repository under OS tmp, copies the real gate
// / leg / generator / census / policy modules byte-for-byte, and forwards
// `node_modules/tsx` to the repository's real tsx: the census that answers is the
// file the gate spawns, and the ceilings are the ones the generator measured. The
// shape is `baseline-monotonicity-seeding.test.ts`'s, with the census unstubbed.
//
// THE DISCIPLINE IS THE PRECEDENT'S. `file-size-excess-gate-leg.test.ts` is what
// these arms mirror, not something to improve on: refuses-to-rise on exactly +1,
// fails closed on a missing key, prints the measured number beside its own ceiling,
// leaves a descent green, types no number, writes nothing into the repo.
//
// Dimensions:
//   - render:      the four rows and the two scope notes the leg prints
//   - behavior:    held / RED on +1 / lowered / refused, against the fixture's ceilings
//   - integration: walk == tool == artifact, the two scopes proven blind to each
//                  other, and the input binding refusing a re-decided hooks cap
//   - a11y:        the breach text and the regenerate instruction a commit sees

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  fileSizeModuleText,
  gateModuleText,
  generatorModuleTextUnder
} from '../standards/_file-size-cap-scan.js';
import {
  HOOKS_EXCESS_KEY,
  HOOKS_EXCESS_ROW,
  HOOKS_OVER_CAP_KEY,
  HOOKS_OVER_CAP_ROW,
  HOOKS_WHOLE_SCOPE_SOURCE,
  MAIN_EXCESS_KEY,
  MAIN_EXCESS_ROW,
  MAIN_OVER_CAP_KEY,
  MAIN_OVER_CAP_ROW,
  createFixture,
  rowFor,
  type Fixture,
  type FixtureArtifact
} from './_file-size-hooks-fixture.js';
import { monotonicModuleTextUnder } from './_monotonic-module-set.js';
import { FILE_SIZE_CAP_HOOKS } from '../../../src/services/scan/file-size-policy.js';

declareDimensions(
  'tests/unit/lint/file-size-hooks-gate-leg.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const fixture: Fixture = createFixture('hooks-leg');
const LEG_REL = join('.husky', 'peaks-gate-file-size.mjs');

afterAll(() => {
  fixture.cleanup();
});

let seeded: FixtureArtifact | null = null;

/**
 * The fixture's own seeded artifact: the real generator, `--seed` into a HEAD that
 * carries no baseline, then committed so HEAD is the anchor for anything that runs
 * afterwards. Every ceiling in it is a measurement, which is why no arm types one.
 */
function artifact(): FixtureArtifact {
  if (seeded === null) {
    const run = fixture.runGenerator(['--seed']);
    if (run.code !== 0) throw new Error(`the fixture seed run must write:\n${run.out}`);
    seeded = fixture.artifact();
    fixture.commitAll('fixture: HEAD carries the seeded ceilings');
  }
  return seeded;
}

function ceilingOf(key: string): number {
  const value = artifact().ceilings[key];
  if (typeof value !== 'number') {
    throw new Error(
      `the fixture measured no ceiling at "${key}": ${JSON.stringify(artifact().ceilings)}`
    );
  }
  return value;
}

/** The four rows as the leg printed them, so an arm can compare a run against a run. */
function rows(out: string): Record<string, { mark: string; actual: number; ceiling: number }> {
  return {
    [MAIN_OVER_CAP_ROW]: rowFor(out, MAIN_OVER_CAP_ROW),
    [MAIN_EXCESS_ROW]: rowFor(out, MAIN_EXCESS_ROW),
    [HOOKS_OVER_CAP_ROW]: rowFor(out, HOOKS_OVER_CAP_ROW),
    [HOOKS_EXCESS_ROW]: rowFor(out, HOOKS_EXCESS_ROW)
  };
}

type LegModule = {
  FS_HOOKS_CEILING_KEY: string;
  FS_HOOKS_EXCESS_CEILING_KEY: string;
  FS_HOOKS_ROW_LABEL: string;
  FS_HOOKS_EXCESS_ROW_LABEL: string;
  missingFileSizeCeilings(ceilings: Record<string, unknown>): string | null;
  hooksEnvelopeProblem(hooks: unknown): string | null;
  fileSizeInputTrips(
    envelope: Record<string, unknown>,
    artifactDoc: Record<string, unknown>
  ): string[];
};

async function loadLeg(): Promise<LegModule> {
  return (await import(pathToFileURL(join(fixture.root, LEG_REL)).href)) as LegModule;
}

// ── render ────────────────────────────────────────────────────────────

describe('Scenario: render — the leg prints a hooks row beside the main pair', () => {
  it(
    'when the census runs whole-scope, should print both hooks rows with their own ceilings and a hooks scope note',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const env = fixture.census();
      artifact();
      const run = fixture.runGate([]);
      expect(run.code, run.out).toBe(0);
      const printed = rows(run.out);
      expect(printed[HOOKS_OVER_CAP_ROW]?.actual, run.out).toBe(env.hooks.overCap);
      expect(printed[HOOKS_OVER_CAP_ROW]?.ceiling, run.out).toBe(ceilingOf(HOOKS_OVER_CAP_KEY));
      expect(printed[HOOKS_OVER_CAP_ROW]?.mark, run.out).toBe('✓');
      expect(printed[HOOKS_EXCESS_ROW]?.actual, run.out).toBe(env.hooks.excessLines);
      expect(printed[HOOKS_EXCESS_ROW]?.ceiling, run.out).toBe(ceilingOf(HOOKS_EXCESS_KEY));
      expect(printed[HOOKS_EXCESS_ROW]?.mark, run.out).toBe('✓');
      // The main pair is still there: the second scope joins the leg, it does not
      // replace the first one.
      expect(printed[MAIN_OVER_CAP_ROW]?.mark, run.out).toBe('✓');
      expect(printed[MAIN_EXCESS_ROW]?.mark, run.out).toBe('✓');
      // And the hooks numbers arrive with the inputs that produced them — scope,
      // count, cap, unit, and the files themselves — so a reader of the log can
      // re-derive the row without re-running anything.
      expect(run.out).toContain('hooks scope note');
      expect(run.out).toContain(HOOKS_WHOLE_SCOPE_SOURCE);
      expect(run.out).toContain(`${env.hooks.scope.countedFiles} hooks file(s)`);
      expect(run.out).toContain(`against cap ${env.hooks.caps.hooksCap}`);
      expect(run.out).toContain(env.hooks.convention);
      for (const entry of env.hooks.files) {
        expect(run.out, entry.file).toContain(entry.file);
      }
    }
  );
});

// ── behavior ──────────────────────────────────────────────────────────

describe('Scenario: behavior — the hooks rows refuse to rise', () => {
  it(
    'when the fixture tree is untouched, should hold all four ceilings and exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      artifact();
      const run = fixture.runGate([]);
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('file-size ceiling held');
      for (const label of [HOOKS_OVER_CAP_ROW, HOOKS_EXCESS_ROW]) {
        expect(rows(run.out)[label]?.mark, run.out).toBe('✓');
      }
    }
  );

  it(
    'when one more excess line than the ceiling sits under .husky/, should turn ONLY the hooks excess row RED and leave the main rows at their own numbers',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const before = fixture.runGate([]);
      expect(before.code, before.out).toBe(0);
      const ceiling = ceilingOf(HOOKS_EXCESS_KEY);
      try {
        // One growth event moves the SUM and not the count: the file that was
        // already over cap gets one line longer, which is exactly the wave-6 shape
        // that `fileSizeOverCap` could not see.
        fixture.growHooksFile('hooks-big.mjs', 1);
        const after = fixture.runGate([]);
        expect(after.code, after.out).toBe(1);
        const excess = rows(after.out)[HOOKS_EXCESS_ROW];
        expect(excess?.mark, after.out).toBe('✗');
        expect(excess?.actual, after.out).toBe(ceiling + 1);
        expect(after.out).toContain(
          `${HOOKS_EXCESS_ROW}: ${String(ceiling + 1)} > ceiling ${ceiling} (+1)`
        );
        expect(rows(after.out)[HOOKS_OVER_CAP_ROW]?.mark, after.out).toBe('✓');
        // H4, one direction: a `.husky` file grew and the main pair did not move.
        const main = rows(after.out);
        expect(main[MAIN_OVER_CAP_ROW]?.actual, after.out).toBe(ceilingOf(MAIN_OVER_CAP_KEY));
        expect(main[MAIN_EXCESS_ROW]?.actual, after.out).toBe(ceilingOf(MAIN_EXCESS_KEY));
        expect(main[MAIN_OVER_CAP_ROW]?.mark, after.out).toBe('✓');
        expect(main[MAIN_EXCESS_ROW]?.mark, after.out).toBe('✓');
      } finally {
        fixture.growHooksFile('hooks-big.mjs', -1);
      }
    }
  );

  it(
    'when one more .husky file than the ceiling is over cap, should turn the hooks over-cap row RED and not the main ones',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const overCap = ceilingOf(HOOKS_OVER_CAP_KEY);
      try {
        fixture.addHooksFile('hooks-grew.mjs', FILE_SIZE_CAP_HOOKS + 1);
        const run = fixture.runGate([]);
        expect(run.code, run.out).toBe(1);
        const row = rows(run.out)[HOOKS_OVER_CAP_ROW];
        expect(row?.mark, run.out).toBe('✗');
        expect(row?.actual, run.out).toBe(overCap + 1);
        expect(run.out).toContain(
          `${HOOKS_OVER_CAP_ROW}: ${String(overCap + 1)} > ceiling ${overCap} (+1)`
        );
        expect(rows(run.out)[MAIN_OVER_CAP_ROW]?.mark, run.out).toBe('✓');
        expect(rows(run.out)[MAIN_EXCESS_ROW]?.mark, run.out).toBe('✓');
      } finally {
        fixture.removeHooksFile('hooks-grew.mjs');
      }
    }
  );

  it(
    'when a hooks file is split down under the cap, should stay GREEN below the ceiling',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // No arm pins `measured == ceiling`: the split campaign this slice enables has
      // to be able to pay the rows back without a re-seed.
      const ceiling = ceilingOf(HOOKS_EXCESS_KEY);
      const big = join('.husky', 'hooks-big.mjs');
      const was = fixture.read(big);
      fixture.write(big, 'export const hoisted = 1;\n');
      try {
        const run = fixture.runGate([]);
        expect(run.code, run.out).toBe(0);
        const row = rows(run.out)[HOOKS_EXCESS_ROW];
        expect(row?.mark, run.out).toBe('✓');
        expect(row?.actual, run.out).toBeLessThan(ceiling);
      } finally {
        fixture.write(big, was);
      }
    }
  );
});

describe('Scenario: behavior — a missing ceiling or a mute census takes the WHOLE leg down', () => {
  it(
    'when the baseline has no ceiling for fileSizeHooksExcessLines, should refuse, print no hooks row, and exit 1',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      artifact();
      const document = fixture.artifactDocument();
      const ceilings: Record<string, number> = {
        ...(document.ceilings as Record<string, number>)
      };
      expect(typeof ceilings[HOOKS_EXCESS_KEY]).toBe('number');
      delete ceilings[HOOKS_EXCESS_KEY];
      fixture.writeArtifact({ ...document, ceilings });
      try {
        const run = fixture.runGate([]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('REFUSING to measure the file-size leg');
        expect(run.out).toContain(HOOKS_EXCESS_KEY);
        expect(run.out).toContain('peaks-gate-baseline.mjs');
        // Neither hooks row prints next to a number that was never measured against
        // anything, and the main pair goes down with them: one census, one guard.
        expect(run.out).not.toMatch(new RegExp(`[✓✗] ${HOOKS_EXCESS_ROW}`));
        expect(run.out).not.toMatch(new RegExp(`[✓✗] ${HOOKS_OVER_CAP_ROW}`));
        expect(run.out).not.toMatch(new RegExp(`[✓✗] ${MAIN_OVER_CAP_ROW}`));
        expect(run.out).not.toContain('ceiling held');
      } finally {
        fixture.writeArtifact(document);
      }
    }
  );

  it('knows all four keys in missingFileSizeCeilings, and refuses only a vector that lacks one', async () => {
    const leg = await loadLeg();
    expect(leg.FS_HOOKS_CEILING_KEY).toBe(HOOKS_OVER_CAP_KEY);
    expect(leg.FS_HOOKS_EXCESS_CEILING_KEY).toBe(HOOKS_EXCESS_KEY);
    expect(leg.FS_HOOKS_ROW_LABEL).toBe(HOOKS_OVER_CAP_ROW);
    expect(leg.FS_HOOKS_EXCESS_ROW_LABEL).toBe(HOOKS_EXCESS_ROW);
    const refusal = leg.missingFileSizeCeilings({
      [MAIN_OVER_CAP_KEY]: 162,
      [MAIN_EXCESS_KEY]: 54318
    });
    expect(
      refusal ?? '',
      'a baseline that carries only the main pair is not a seeded leg'
    ).toContain(HOOKS_OVER_CAP_KEY);
    expect(refusal ?? '').toContain(HOOKS_EXCESS_KEY);
    expect(leg.missingFileSizeCeilings(artifact().ceilings)).toBeNull();
  });

  it('refuses an envelope whose hooks block is absent, malformed, or non-integer', async () => {
    const leg = await loadLeg();
    // A census that stopped reporting the second scope must not read as a clean one:
    // 0 is what "cleared debt" looks like, and telling those apart is the row.
    expect(leg.hooksEnvelopeProblem(undefined)).toContain('hooks');
    expect(
      leg.hooksEnvelopeProblem({
        overCap: '3',
        excessLines: 1516,
        scope: { source: HOOKS_WHOLE_SCOPE_SOURCE, countedFiles: 4 },
        caps: { hooksCap: 300 },
        convention: 'split-newline'
      })
    ).toContain('overCap');
    expect(
      leg.hooksEnvelopeProblem({
        overCap: 0,
        excessLines: 0,
        scope: { source: HOOKS_WHOLE_SCOPE_SOURCE, countedFiles: 4 },
        caps: {},
        convention: 'split-newline'
      })
    ).toContain('hooksCap');
    expect(
      leg.hooksEnvelopeProblem({
        overCap: 3,
        excessLines: 1516,
        scope: { source: HOOKS_WHOLE_SCOPE_SOURCE, countedFiles: 4 },
        caps: { hooksCap: 300 },
        convention: 'split-newline'
      })
    ).toBeNull();
  });
});

// ── integration ───────────────────────────────────────────────────────
// The measurement half of this slice — walk == git == tool == artifact, the two
// scopes proven blind to each other, and the hooks inputs bound the way the main
// pair's are — lives in `file-size-hooks-scope-leg.test.ts`. What is pinned here is
// the WIRING: one census feeding four rows, and no number typed anywhere.

describe('Scenario: integration — the rows are wired, and nothing is typed', () => {
  it('enforces all four rows from ONE census invocation, in the whole-repo mode too', () => {
    // POOLED OVER THE GATE'S MODULE SET, IN THE FIXTURE (rid
    // 2026-10-02-wave9-gate-entry-split): the four `check` calls live in
    // `.husky/gate/legs.mjs` and their `repo`-mode caller in `.husky/gate/repo.mjs`,
    // and the fixture stages that set by WALKING `.husky/` (see `hooksScopeFilesUnder`)
    // rather than by a list of names. A single-file read here would pin a file that no
    // longer holds the symbol; the arms after this one prove the pool is a check.
    const gate = gateModuleText(fixture.root);
    // One spawn feeding four checks: a census failure therefore takes them all down.
    expect(gate.match(/measureFileSizeOverCap\(/g) ?? []).toHaveLength(1);
    expect(gate).toContain('check(FS_ROW_LABEL, gated.overCap');
    expect(gate).toContain('check(FS_EXCESS_ROW_LABEL, gated.excessLines');
    expect(gate).toContain('check(FS_HOOKS_ROW_LABEL, m.env.hooks.overCap');
    expect(gate).toContain('check(FS_HOOKS_EXCESS_ROW_LABEL, m.env.hooks.excessLines');
    expect(gate).toContain('missingFileSizeCeilings(ceilings)');
    // And `repo` mode runs this same leg, not a copy of it, through the same print
    // path — the two `printFileSizeLeg(size` sites are repo mode and file-size mode.
    expect(gate).toMatch(/fileSizeLeg\(check, c, \[\]\)/);
    expect(gate.match(/printFileSizeLeg\(size/g) ?? []).toHaveLength(2);
  });

  it('seeds the rows from the envelope and never from a literal, in the generator and the key list', () => {
    const generator = generatorModuleTextUnder(fixture.root);
    expect(generator).toContain('fileSizeHooksOverCap: size.env.hooks.overCap');
    expect(generator).toContain('fileSizeHooksExcessLines: size.env.hooks.excessLines');
    // The rule `phantomRules` and the silent-warning rows obey: a typed number
    // freezes the ceiling in place of the measurement.
    expect(generator).not.toMatch(/fileSizeHooks(OverCap|ExcessLines):\s*\d/);
    expect(generator).toContain('hooksCap: size.env.hooks.caps.hooksCap');
    expect(generator).toContain('hooksLineConvention: size.env.hooks.convention');
    // The hooks rows are seeded only from the census's own whole-scope hooks run, on
    // the same term the main pair already carries: a named list is not the row.
    expect(generator).toContain('FS_HOOKS_WHOLE_SCOPE_SOURCE');

    // Pooled over the walked monotonic module set (entry + `.husky/monotonic/*.mjs`):
    // since the wave 9 slice 2 split, the canonical list lives in whichever sibling
    // holds it, and a pin on the ENTRY alone would pin a file that no longer speaks.
    const monotonic = monotonicModuleTextUnder(fixture.root);
    expect(monotonic).toContain(`'${HOOKS_OVER_CAP_KEY}'`);
    expect(monotonic).toContain(`'${HOOKS_EXCESS_KEY}'`);

    // Pooled over the walked file-size module set (rid `2026-10-02-wave9-file-size-split`):
    // the hooks keys/labels/source moved into `.husky/file-size/constants.mjs`, so this
    // reads the FIXTURE's set the way `monotonicModuleTextUnder` reads the monotonic set.
    const shared = fileSizeModuleText(fixture.root);
    expect(shared).toContain(HOOKS_OVER_CAP_KEY);
    expect(shared).toContain(HOOKS_OVER_CAP_ROW);
    expect(shared).toContain(HOOKS_EXCESS_ROW);
    expect(shared).toContain(HOOKS_WHOLE_SCOPE_SOURCE);
  });
});

// ── a11y ──────────────────────────────────────────────────────────────

describe('Scenario: a11y — what a hooks breach says to the human who hits it', () => {
  it(
    'when a hooks row breaks, should name the row, the delta, and the do-not-raise instruction',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const ceiling = ceilingOf(HOOKS_EXCESS_KEY);
      fixture.growHooksFile('hooks-big.mjs', 1);
      try {
        const run = fixture.runGate([]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain(
          `${HOOKS_EXCESS_ROW}: ${String(ceiling + 1)} > ceiling ${ceiling} (+1)`
        );
        expect(run.out).toContain('do not raise the ceiling');
        expect(run.out).toContain('hooks scope note');
      } finally {
        fixture.growHooksFile('hooks-big.mjs', -1);
      }
    }
  );

  it('seeds the rows from the envelope and never from a literal, in the generator, the gate and the list', () => {
    const generator = generatorModuleTextUnder(fixture.root);
    expect(generator).toContain('fileSizeHooksOverCap: size.env.hooks.overCap');
    expect(generator).toContain('fileSizeHooksExcessLines: size.env.hooks.excessLines');
    expect(generator).not.toMatch(/fileSizeHooks(OverCap|ExcessLines):\s*\d/);
    expect(generator).toContain('hooksCap: size.env.hooks.caps.hooksCap');
    expect(generator).toContain('hooksLineConvention: size.env.hooks.convention');
    // The hooks rows are seeded only from the census's own whole-scope hooks run, on
    // the same term the main pair already has: a named list describes those files.
    expect(generator).toContain('size.env.hooks.scope.source !== FS_HOOKS_WHOLE_SCOPE_SOURCE');

    const gate = gateModuleText(fixture.root);
    // ONE census invocation feeding all four `check` calls, so a census failure or a
    // missing ceiling takes every row down together. Pooled over the walked set, for
    // the reason in the wiring arm above.
    expect(gate.match(/measureFileSizeOverCap\(/g) ?? []).toHaveLength(1);
    expect(gate).toContain('check(FS_HOOKS_ROW_LABEL, m.env.hooks.overCap');
    expect(gate).toContain('check(FS_HOOKS_EXCESS_ROW_LABEL, m.env.hooks.excessLines');

    // Pooled over the walked monotonic module set (entry + `.husky/monotonic/*.mjs`):
    // since the wave 9 slice 2 split, the canonical list lives in whichever sibling
    // holds it, and a pin on the ENTRY alone would pin a file that no longer speaks.
    const monotonic = monotonicModuleTextUnder(fixture.root);
    expect(monotonic).toContain(`'${HOOKS_OVER_CAP_KEY}'`);
    expect(monotonic).toContain(`'${HOOKS_EXCESS_KEY}'`);
  });
});
