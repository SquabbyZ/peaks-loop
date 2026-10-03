// tests/unit/lint/baseline-scope-population-set.test.ts
//
// Rid `2026-10-03-scope-growth-vs-shrink` §2.50 — the pure arms of the new policy,
// run against the trip functions where they live (`.husky/baseline/rescope.mjs` and
// `.husky/baseline/leg-scope.mjs`, executed over `pathToFileURL(REPO_ROOT)` the way
// `rescope-projection-bounded.test.ts` loads its emitters). The process arms — the
// same states measured through a real generator run in a scratch repository — live
// in `baseline-scope-growth-vs-shrink.test.ts`.
//
// THE POLICY UNDER TEST (owner decision 2026-10-03, backlog §2.50): `--rescope` is
// required when the rule text, the dirs set or the extensions changed, OR when the
// leaving set is non-empty; pure growth proceeds unflagged and prints itself. The
// leaving set is a SET — HEAD's in-scope file list minus the run's — never an
// arithmetic difference, because `950 > 943` does not prove nothing left: one file
// can exit while three enter.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';

declareDimensions(
  'tests/unit/lint/baseline-scope-population-set.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'pure trip arms; the process arms run the real generator in the sibling file'
    }
  ]
);

type ScopeBlock = {
  dirs: string[];
  rule: string;
  extensions: string;
  silentWarning: { source: string; scannedFiles: number };
};

type TripCall = {
  headScope: ScopeBlock;
  headFileCount: number;
  newScope: ScopeBlock;
  gatedCount: number;
  headCeilings: Record<string, number>;
  ceilings: Record<string, number>;
  headFiles: string[];
  runFiles: string[];
};

type Guards = {
  scopeTrip: (c: TripCall) => string | null;
  rescopeUnneededTrip: (c: Omit<TripCall, 'headCeilings' | 'ceilings'>) => string | null;
  scopeGrowthLine: (i: {
    headFileCount: number;
    gatedCount: number;
    entered: string[];
    left: string[];
  }) => string;
  scopePopulationMove: (headFiles: string[], runFiles: string[]) => unknown;
  describeLegScopeMove: (move: { leg: string; from: number | null; to: number | null }) => string;
};

const guardBag: Record<string, unknown> = {};

beforeAll(async () => {
  const load = async (rel: string[]): Promise<Record<string, unknown>> =>
    (await import(pathToFileURL(join(REPO_ROOT, ...rel)).href)) as Record<string, unknown>;
  Object.assign(guardBag, await load(['.husky', 'baseline', 'rescope.mjs']));
  Object.assign(guardBag, await load(['.husky', 'baseline', 'leg-scope.mjs']));
});

/** Resolve one export where the arm runs, so a missing export reddens that arm alone. */
function guard<T>(name: string): T {
  const f = guardBag[name];
  if (typeof f !== 'function') throw new Error(`the guards export no \`${name}\``);
  return f as unknown as T;
}

const scopeTripOf = (): Guards['scopeTrip'] => guard('scopeTrip');
const unneededOf = (): Guards['rescopeUnneededTrip'] => guard('rescopeUnneededTrip');
const growthLineOf = (): Guards['scopeGrowthLine'] => guard('scopeGrowthLine');
const populationMoveOf = (): Guards['scopePopulationMove'] => guard('scopePopulationMove');
const describeMoveOf = (): Guards['describeLegScopeMove'] => guard('describeLegScopeMove');

/** `count` distinct in-scope paths, named from the enumeration they stand for. */
function files(prefix: string, count: number, from = 0): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(from + i)}.ts`);
}

/** One scope block, with the leg population recording the given enumeration size. */
function scope(scannedFiles: number, over: Partial<ScopeBlock> = {}): ScopeBlock {
  return {
    dirs: ['src'],
    rule: 'src/** + packages/*/src/**',
    extensions: 'ts, tsx, mjs, cjs, js',
    silentWarning: { source: 'git ls-files <scope dirs>', scannedFiles },
    ...over
  };
}

/** The trip over a HEAD list of `headCount` files and a run list derived from it. */
function trip(
  headCount: number,
  headFiles: string[],
  runFiles: string[],
  headScopeOver: Partial<ScopeBlock> = {},
  newScopeOver: Partial<ScopeBlock> = {}
): string | null {
  return scopeTripOf()({
    headScope: scope(headCount, headScopeOver),
    headFileCount: headCount,
    newScope: scope(runFiles.length, newScopeOver),
    gatedCount: runFiles.length,
    headCeilings: {},
    ceilings: {},
    headFiles,
    runFiles
  });
}

describe('Scenario: behavior — the leaving set is a set, not an arithmetic difference', () => {
  it('pure growth — nothing left, files entered — proceeds with NO flag and NO refusal', () => {
    const head = files('src/f', 943);
    const run = [...head, ...files('src/new-', 7)];
    expect(trip(943, head, run), 'the §2.43 trip refused any count move; §2.50 must not')
      .toBeNull();
  });

  it('a file leaving refuses even while the count GROWS (one out, three in), naming the leaver', () => {
    const head = ['src/leaver.ts', ...files('src/f', 942)];
    const run = [...files('src/f', 942), ...files('src/new-', 8)];
    const refusal = trip(943, head, run);
    expect(refusal, '950 > 943 did not prove nothing left').not.toBeNull();
    expect(String(refusal)).toContain('SCOPE CHANGE');
    expect(String(refusal)).toContain('src/leaver.ts');
    expect(String(refusal)).toContain('--rescope');
  });

  it('scopePopulationMove subtracts lists as sets, in both directions, and refuses to speak without one', () => {
    const moved = populationMoveOf()(
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      ['src/a.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts']
    ) as { left: string[]; entered: string[] } | null;
    expect(moved, 'a missing enumeration cannot be asked of this check').not.toBeNull();
    expect(moved?.left).toEqual(['src/b.ts', 'src/c.ts']);
    expect(moved?.entered).toEqual(['src/e.ts', 'src/f.ts']);
    expect(populationMoveOf()(null as unknown as string[], ['src/a.ts'])).toBeNull();
    expect(populationMoveOf()(['src/a.ts'], null as unknown as string[])).toBeNull();
  });
});

describe('Scenario: render — the boundary text and the printed statements', () => {
  it('a rule-text change refuses with the SAME enumeration on both sides, and says the text moved', () => {
    const head = files('src/f', 10);
    const refusal = trip(10, head, head, {}, { rule: 'src/** ONLY (crafted)' });
    expect(refusal, '§2.50 requires the flag for the rule text, not only for dirs').not.toBeNull();
    expect(String(refusal)).toContain('SCOPE CHANGE');
    expect(String(refusal)).toContain('src/** ONLY (crafted)');
  });

  it('an extensions change refuses too, naming both spellings', () => {
    const head = files('src/f', 10);
    const refusal = trip(10, head, head, {}, { extensions: 'ts only (crafted)' });
    expect(refusal).not.toBeNull();
    expect(String(refusal)).toContain('ts only (crafted)');
  });

  it('the growth statement is the one §2.50 prescribes, both numbers and both counts', () => {
    expect(
      growthLineOf()({
        headFileCount: 943,
        gatedCount: 950,
        entered: files('src/new-', 7),
        left: []
      })
    ).toBe('scope grew: 943 -> 950 (7 entered, 0 left the scope)');
  });

  it('a moved leg says WHICH DIRECTION it moved, so growth and leaving read apart at a glance', () => {
    const grew = describeMoveOf()({ leg: 'silentWarning', from: 943, to: 950 });
    expect(grew).toContain('silent-warning leg population: 943 -> 950');
    expect(grew).toMatch(/MORE/);
    const shrank = describeMoveOf()({ leg: 'silentWarning', from: 950, to: 944 });
    expect(shrank).toContain('silent-warning leg population: 950 -> 944');
    expect(shrank).toMatch(/FEWER/);
  });
});

describe('Scenario: a11y — the flag keeps meaning the boundary, never the crowd', () => {
  it('--rescope over pure growth is refused as nothing to rescope, and says growth is not a rescope', () => {
    const head = files('src/f', 943);
    const run = [...head, ...files('src/new-', 7)];
    const refusal = unneededOf()({
      headScope: scope(943),
      headFileCount: 943,
      newScope: scope(950),
      gatedCount: 950,
      headFiles: head,
      runFiles: run
    });
    expect(refusal, 'the flag must not be spendable on an ordinary split').not.toBeNull();
    expect(String(refusal)).toContain('nothing to rescope');
    expect(String(refusal)).toContain('7');
  });

  it('--rescope over a state where something really LEFT still applies (no unneeded trip)', () => {
    const head = ['src/leaver.ts', ...files('src/f', 942)];
    const run = files('src/f', 942);
    expect(
      unneededOf()({
        headScope: scope(943),
        headFileCount: 943,
        newScope: scope(942),
        gatedCount: 942,
        headFiles: head,
        runFiles: run
      })
    ).toBeNull();
  });
});
