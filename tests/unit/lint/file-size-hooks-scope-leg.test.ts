// tests/unit/lint/file-size-hooks-scope-leg.test.ts
//
// Rid `2026-10-02-hooks-size-rows` (backlog §2.32), the SCOPE half: the arms that
// prove the two `.husky/` rows measure what they say they measure, and measure only
// that.
//
// WHY THESE ARMS ARE THE SLICE. The whole reason the hooks rows are a SECOND pair and
// not a fifth directory in `FILE_SIZE_SCOPE_DIRS` is that joining them at cap 300
// would raise `fileSizeOverCap` 162 → 165 and `fileSizeExcessLines` 54,318 → 55,834 —
// a policy re-decision dressed as a measurement, which the monotonicity guard refuses
// correctly. That distinction is only real if the two scopes are blind to each other,
// so the arms below push a file over cap in ONE scope and require the OTHER pair not
// to move. If a hooks file can move the main rows, this slice has quietly performed
// the scope-dir edit it was told not to make.
//
// FOUR READINGS OF THE HOOKS NUMBERS, no two of them sharing a mechanism:
//   walk     — `walkHooksScope()`'s own `readdirSync` recursion, the policy's
//              extension list, the policy's line unit, the hooks cap
//   git      — `git ls-files -- .husky`, the enumeration the census actually uses
//   tool     — `scripts/lint/file-size-census.ts` through the repository's real tsx,
//              spawned the way the leg spawns it
//   artifact — the ceilings the real generator wrote from that envelope
// A number the artifact carries that the walk cannot reproduce is a number that was
// never measured, which is the failure mode this repo keeps re-finding (the guard that
// read the artifact it was built to protect; the ceiling that was typed in).
//
// THE FIXTURE, NOT THE REPO. Every process arm runs the real gate, the real leg, the
// real census and the real generator inside an OS-temp repository
// (`_file-size-hooks-fixture.ts`), because the published `.peaks/lint/gate-baseline.json`
// cannot carry the two new rows until the orchestrator's seeding run lands — and the
// leg refuses the whole leg on a missing ceiling until then. Nothing here writes into
// the repository; the artifact under `.peaks/` is read, never written.
//
// Dimensions:
//   - integration: walk == git == tool == artifact, and the real leg on both scopes
//   - behavior:    untracked files cannot inflate a row, an absent scope crashes the
//                  census instead of reporting zero, a re-decided input is refused
//   - render:      the mismatch text names both the seeded input and the measured one
//   - a11y:        omitted — what a breach says is asserted in
//                  `file-size-hooks-gate-leg.test.ts`, which owns the print arms

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  HOOKS_EXCESS_KEY,
  HOOKS_EXCESS_ROW,
  HOOKS_OVER_CAP_KEY,
  HOOKS_OVER_CAP_ROW,
  HOOKS_WHOLE_SCOPE_SOURCE,
  MAIN_EXCESS_ROW,
  MAIN_OVER_CAP_ROW,
  createFixture,
  fileOf,
  rowFor,
  walkHooksScope,
  type Fixture,
  type FixtureArtifact
} from './_file-size-hooks-fixture.js';
import {
  FILE_SIZE_CAP_HOOKS,
  FILE_SIZE_SCOPE_DIRS,
  isHooksMeasuredFile,
  isPolicyMeasuredFile
} from '../../../src/services/scan/file-size-policy.js';

declareDimensions(
  'tests/unit/lint/file-size-hooks-scope-leg.test.ts',
  ['integration', 'behavior', 'render'],
  [{ dim: 'a11y', reason: 'the breach text is asserted in the sibling leg file' }]
);

const fixture: Fixture = createFixture('hooks-scope');

afterAll(() => {
  fixture.cleanup();
});

let seeded: FixtureArtifact | null = null;

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
    throw new Error(`the fixture measured no ceiling at "${key}"`);
  }
  return value;
}

/** Every row the leg printed, keyed by label, so arms can compare runs. */
function rows(out: string): Record<string, { mark: string; actual: number; ceiling: number }> {
  return {
    [MAIN_OVER_CAP_ROW]: rowFor(out, MAIN_OVER_CAP_ROW),
    [MAIN_EXCESS_ROW]: rowFor(out, MAIN_EXCESS_ROW),
    [HOOKS_OVER_CAP_ROW]: rowFor(out, HOOKS_OVER_CAP_ROW),
    [HOOKS_EXCESS_ROW]: rowFor(out, HOOKS_EXCESS_ROW)
  };
}

const LEG_REL = join('.husky', 'peaks-gate-file-size.mjs');

async function loadLeg(): Promise<{
  fileSizeInputTrips(
    envelope: Record<string, unknown>,
    artifactDoc: Record<string, unknown>
  ): string[];
}> {
  const module = (await import(pathToFileURL(join(fixture.root, LEG_REL)).href)) as Record<
    string,
    unknown
  >;
  const trips = module.fileSizeInputTrips as (
    envelope: Record<string, unknown>,
    artifactDoc: Record<string, unknown>
  ) => string[];
  return { fileSizeInputTrips: trips };
}

// ── integration: the four readings ────────────────────────────────────

describe('Scenario: integration — walk == git == tool == artifact for the hooks rows', () => {
  it(
    'recomputes both hooks numbers by walking .husky, and the tool, the git list and the artifact all agree',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const walked = walkHooksScope(fixture.root);
      const env = fixture.census();
      const gitListed = fixture.hooksScopeFiles();
      expect(walked.overCap, JSON.stringify(walked)).toBe(env.hooks.overCap);
      expect(walked.excessLines, JSON.stringify(walked)).toBe(env.hooks.excessLines);
      expect(walked.files.map((entry) => entry.file).sort()).toEqual(
        env.hooks.files.map((entry) => entry.file).sort()
      );
      // The walk enumerated by recursion, the census by `git ls-files`; the artifact
      // was written by a generator that can only copy the envelope, so agreeing here
      // is what makes the ceiling checkable rather than asserted.
      expect(env.hooks.scope.countedFiles).toBe(gitListed.length);
      expect(ceilingOf(HOOKS_OVER_CAP_KEY)).toBe(walked.overCap);
      expect(ceilingOf(HOOKS_EXCESS_KEY)).toBe(walked.excessLines);
      expect(env.hooks.scope.source).toBe(HOOKS_WHOLE_SCOPE_SOURCE);
      expect(env.hooks.scope.dirs).toEqual(['.husky']);
      expect(env.hooks.caps.hooksCap).toBe(FILE_SIZE_CAP_HOOKS);
    }
  );

  it('keeps the two scopes on disjoint predicates, so no path is counted twice', () => {
    // The predicate half of the claim the process arms test with files: a `.husky`
    // path is measured by the hooks rows and NOT by the main ones, and the reverse
    // holds for every policy directory. This is what makes the pair a second scope
    // rather than the forbidden scope-dir edit.
    expect(isPolicyMeasuredFile('.husky/peaks-gate.mjs')).toBe(false);
    expect(isHooksMeasuredFile('.husky/peaks-gate.mjs')).toBe(true);
    expect(isPolicyMeasuredFile('src/services/scan/file-size-policy.ts')).toBe(true);
    expect(isHooksMeasuredFile('src/services/scan/file-size-policy.ts')).toBe(false);
    expect(isHooksMeasuredFile('.husky/notes.md')).toBe(false);
    for (const dir of FILE_SIZE_SCOPE_DIRS) {
      expect(isHooksMeasuredFile(`${dir}/x.ts`), dir).toBe(false);
    }
    const env = fixture.census();
    const main = env.files.map((entry) => entry.file);
    const both = env.hooks.files.map((entry) => entry.file).filter((file) => main.includes(file));
    expect(both, 'the two over-cap lists must share no path').toEqual([]);
    expect(env.scope.dirs).not.toContain('.husky');
    expect(env.hooks.scope.dirs).not.toContain('src');
  });

  it(
    'moves the MAIN rows and not the hooks rows when a src file goes over cap, through the real leg',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      artifact();
      const before = rows(fixture.runGate([]).out);
      expect(before[MAIN_OVER_CAP_ROW]?.mark, 'the fixture starts held').toBe('✓');
      try {
        fixture.addMainFile('src/grew-main.ts', FILE_SIZE_CAP_HOOKS + 5);
        const run = fixture.runGate([]);
        const after = rows(run.out);
        expect(run.code, run.out).toBe(1);
        expect(after[MAIN_OVER_CAP_ROW]?.actual, run.out).toBe(
          (before[MAIN_OVER_CAP_ROW]?.actual ?? 0) + 1
        );
        expect(after[MAIN_EXCESS_ROW]?.actual, run.out).toBe(
          (before[MAIN_EXCESS_ROW]?.actual ?? 0) + 5
        );
        for (const label of [HOOKS_OVER_CAP_ROW, HOOKS_EXCESS_ROW]) {
          expect(after[label]?.actual, label).toBe(before[label]?.actual);
          expect(after[label]?.mark, label).toBe('✓');
        }
      } finally {
        fixture.removeMainFile('src/grew-main.ts');
      }
      expect(fixture.runGate([]).code, 'the tree is back as the ceiling was seeded').toBe(0);
    }
  );

  it(
    'moves the HOOKS rows and not the main rows when a .husky file goes over cap, through the real leg',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const before = rows(fixture.runGate([]).out);
      expect(before[HOOKS_OVER_CAP_ROW]?.mark, 'the fixture starts held').toBe('✓');
      try {
        fixture.addHooksFile('hooks-grew.mjs', FILE_SIZE_CAP_HOOKS + 7);
        const run = fixture.runGate([]);
        const after = rows(run.out);
        expect(run.code, run.out).toBe(1);
        expect(after[HOOKS_OVER_CAP_ROW]?.actual, run.out).toBe(
          (before[HOOKS_OVER_CAP_ROW]?.actual ?? 0) + 1
        );
        expect(after[HOOKS_EXCESS_ROW]?.actual, run.out).toBe(
          (before[HOOKS_EXCESS_ROW]?.actual ?? 0) + 7
        );
        for (const label of [MAIN_OVER_CAP_ROW, MAIN_EXCESS_ROW]) {
          expect(after[label]?.actual, label).toBe(before[label]?.actual);
          expect(after[label]?.mark, label).toBe('✓');
        }
        // The evidence line names the file, so a breach is reviewable from the log.
        expect(run.out).toContain('.husky/hooks-grew.mjs');
      } finally {
        fixture.removeHooksFile('hooks-grew.mjs');
      }
      expect(fixture.runGate([]).code).toBe(0);
    }
  );
});

// ── behavior: what may NOT move a hooks row ───────────────────────────

describe('Scenario: behavior — the scope is the list git reports, and an absent scope is a crash', () => {
  it('ignores an untracked over-cap .husky file, so scratch cannot inflate the row', () => {
    const before = fixture.census();
    const stray = join(fixture.root, '.husky', 'scratch-untracked.mjs');
    writeFileSync(stray, fileOf(FILE_SIZE_CAP_HOOKS + 50), 'utf8');
    try {
      expect(existsSync(stray)).toBe(true);
      const after = fixture.census();
      expect(after.hooks.scope.countedFiles).toBe(before.hooks.scope.countedFiles);
      expect(after.hooks.overCap).toBe(before.hooks.overCap);
      expect(after.hooks.excessLines).toBe(before.hooks.excessLines);
      // The walk DOES see it — which is why the row is enumerated by `git ls-files`
      // and the walk is only ever the thing that cross-measures the list.
      // `scopedFiles`, not `files`: `countedFiles` names the census's whole
      // enumeration (the 4 copied guards, `hooks-big`, and `hooks-small` UNDER cap),
      // while `files` is the over-cap list, and comparing the two populations is not a
      // cross-measure — 6 over-cap-vs-6-enumerated fails here no matter what the walk
      // does, and would only "pass" on a scope with nothing under cap, which is the
      // distinction the two rows exist to keep. Same population, same strict `>`: a
      // walk that restated `git ls-files` would answer 6 and fail this.
      expect(walkHooksScope(fixture.root).scopedFiles.length).toBeGreaterThan(
        before.hooks.scope.countedFiles
      );
      // And the over-cap half of the same claim: the stray is over cap, so the walk
      // counts one more breach than the census does — while the ROW does not move.
      expect(walkHooksScope(fixture.root).overCap).toBe(after.hooks.overCap + 1);
    } finally {
      fixture.unlinkHooksFile('scratch-untracked.mjs');
    }
    expect(fixture.census().hooks.excessLines).toBe(before.hooks.excessLines);
  });

  it('crashes the census rather than reporting a hooks row of zero for a missing .husky', () => {
    const baseline = fixture.census();
    expect(baseline.hooks.overCap).toBeGreaterThan(0);
    // Delete the directory and the census would answer `0 over cap, 0 excess lines` —
    // the exact shape of cleared debt, and indistinguishable from it in the row.
    const crashed = fixture.withHooksDirAbsent(() => fixture.censusRaw());
    expect(crashed.status).not.toBe(0);
    expect(crashed.stdout).toBe('');
    expect(crashed.stderr).toContain('.husky');
    expect(fixture.census().hooks.overCap).toBe(baseline.hooks.overCap);
  });
});

// ── behavior + render: the inputs are bound, not just the number ──────

describe('Scenario: behavior — a hooks ceiling whose inputs can be re-decided is not a ratchet', () => {
  it(
    'refuses the whole leg when the hooks cap is re-decided under it, and prints what it measured first',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const policyRel = join('src', 'services', 'scan', 'file-size-policy.ts');
      const was = fixture.policyText();
      try {
        fixture.patchPolicy((text) =>
          text.replace('FILE_SIZE_CAP_HOOKS = FILE_SIZE_CAP_DEFAULT', 'FILE_SIZE_CAP_HOOKS = 600')
        );
        const run = fixture.runGate([]);
        expect(run.code, run.out).toBe(1);
        expect(run.out).toContain('REFUSING to compare the file-size leg against its ceiling');
        expect(run.out).toMatch(/hooks cap: ceiling seeded under 300, this census measured 600/);
        expect(run.out).toContain('hooks scope note');
        expect(run.out).not.toContain('ceiling held');
        expect(run.out).not.toMatch(new RegExp(`[✓✗] ${HOOKS_OVER_CAP_ROW}`));
      } finally {
        fixture.write(policyRel, was);
      }
      expect(fixture.runGate([]).code).toBe(0);
    }
  );

  it(
    'refuses when the hooks scope directories or extensions are re-decided, and fails closed when the inputs are absent',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const leg = await loadLeg();
      const env = fixture.census() as unknown as Record<string, unknown>;
      const document = fixture.artifactDocument();
      const recorded = (document.fileSizePolicyInputs ?? {}) as Record<string, unknown>;
      // The untouched pairing must be silent, or the arms below prove only that
      // `fileSizeInputTrips` never returns [].
      expect(leg.fileSizeInputTrips(env, document)).toEqual([]);
      const trips = (inputs: Record<string, unknown>): string =>
        leg
          .fileSizeInputTrips(env, {
            ...document,
            fileSizePolicyInputs: { ...recorded, ...inputs }
          })
          .join('\n');
      expect(trips({ hooksScopeDirs: ['.husky', '.config'] })).toContain(
        'hooks scope dirs: ceiling seeded under .husky,.config'
      );
      expect(trips({ hooksScopeExtensions: ['ts'] })).toContain('hooks scope extensions');
      expect(trips({ hooksCap: 400 })).toContain(
        'hooks cap: ceiling seeded under 400, this census measured 300'
      );
      expect(trips({ hooksLineConvention: 'wc -l' })).toContain('hooks line convention');
      // An artifact that records no hooks inputs at all fails closed, never silently.
      expect(trips({ hooksCap: undefined, hooksScopeDirs: undefined })).toContain('hooks cap');
      expect(
        leg.fileSizeInputTrips(env, { ...document, fileSizePolicyInputs: {} }).join('\n')
      ).toContain('hooks cap');
    }
  );
});
