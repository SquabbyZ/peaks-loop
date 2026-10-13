// tests/unit/lint/worktree-census.test.ts
//
// D1 of rid `rid-gate-scope-visibility` (backlog 9.21): `repo` mode reads `git ls-files`
// — the index — so an in-scope source file that is only in the working tree is not in
// its population and cannot be named by it. This leg refuses the ones the baseline names
// no row for, so the file is reported instead of silently absent.
//
// WHAT THE ARMS ARE AIMED AT. The input this check exists to reject is "an in-scope file
// present in the working tree, absent from the index, and named by no baseline row", so
// the red arms are built from exactly that shape — and one of them is built from the REAL
// published `files` map with one row removed, which is the state the generator leaves
// behind when it runs before `git add`. The controls are the same input with the row
// present, and the same input with the file in the index instead of the working tree.
//
// WHY NO ARM SPAWNS `repo` MODE. It would have to CREATE an in-scope file inside the
// repository, and `tests/unit/standards/file-size-cap.test.ts` compares
// `walkScopedFiles(root)` against `git ls-files --cached --others --exclude-standard` in
// a concurrent worker, so a file another test creates under a measured directory reddens
// it for a reason that is not its own. The end-to-end run over a real added file was made
// by hand instead, and is quoted in the request artifact.
//
// Dimensions:
//   - behavior:    the pure judge over hand-built and over real inputs
//   - integration: the real published `files` map, the real in-scope file list
//   - a11y:        the failure text a human reads — what it names and what it asks for
//   - render:      omitted — nothing is rendered; the observable is a returned string

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createFixture } from './_file-size-hooks-fixture.js';
import { runRepoMode } from './_silent-warning-scope-fixture.js';

declareDimensions(
  'tests/unit/lint/worktree-census.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'nothing is rendered; the observable is the returned failure text' }]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE_PATH = join(REPO_ROOT, '.husky', 'gate', 'worktree-census.mjs');
const BASELINE_PATH = join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json');

/** The in-scope working-tree file the fixture writes and never commits. */
const UNROWED_PROBE = 'src/zz-unrowed-probe.ts';

/**
 * The ONE line that carries both preflights' verdicts into the run's failure list — the
 * string the cut arm removes. Pinned here rather than in the assertion so that a
 * rewording of the wiring fails the arm that cuts it instead of cutting nothing.
 */
const PREFLIGHT_PUSH =
  'for (const failure of [...unseen.failures, ...coverage.failures]) failures.push(failure);';

type Row = Readonly<Record<string, unknown>>;
type PublishedBaseline = { readonly files: Record<string, Row> };
type WorktreeCensusModule = {
  judgeWorktreeCensus(input: {
    scoped: readonly string[];
    table: Readonly<Record<string, unknown>>;
  }): { failures: string[]; named: string[] };
};

/** The module is a `.mjs` gate script outside `src/`, so it loads by URL. */
async function loadWorktreeCensus(): Promise<WorktreeCensusModule> {
  return (await import(pathToFileURL(MODULE_PATH).href)) as WorktreeCensusModule;
}

function published(): PublishedBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as PublishedBaseline;
}

describe('(behavior) a working-tree file with no baseline row is a failure', () => {
  it('RED: when an in-scope file is in the working tree and in no row, should fail naming it', async () => {
    const { judgeWorktreeCensus } = await loadWorktreeCensus();
    const verdict = judgeWorktreeCensus({ scoped: ['src/services/race/lane-phase.ts'], table: {} });
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain('src/services/race/lane-phase.ts');
    expect(verdict.named).toEqual(['src/services/race/lane-phase.ts']);
  });

  it('CONTROL: when the row is present, the same file is silent', async () => {
    const { judgeWorktreeCensus } = await loadWorktreeCensus();
    const file = 'src/services/race/lane-phase.ts';
    expect(
      judgeWorktreeCensus({ scoped: [file], table: { [file]: { eslint: 0, eslintErrors: 0 } } })
        .failures
    ).toEqual([]);
  });

  it('CONTROL: when the file is in the index instead of the working tree, the list is empty', async () => {
    // Staging is the whole remedy, so the empty input is the CONTROL here rather than a
    // second red: `--others` is what the caller filters, and a staged file is not in it.
    const { judgeWorktreeCensus } = await loadWorktreeCensus();
    expect(judgeWorktreeCensus({ scoped: [], table: {} }).failures).toEqual([]);
    expect(judgeWorktreeCensus({ scoped: [], table: {} }).named).toEqual([]);
  });

  it('when several files are unseen, should name every one of them', async () => {
    const { judgeWorktreeCensus } = await loadWorktreeCensus();
    const verdict = judgeWorktreeCensus({ scoped: ['src/a.ts', 'src/b.ts'], table: {} });
    expect(verdict.named).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('(integration) the real published row map', () => {
  it('RED: when the real map is one row short, should name the file that row covered', async () => {
    // The measured state, rebuilt from the real artifact: the generator ran before
    // `git add`, so the module it added has no row while every other file keeps theirs.
    const { judgeWorktreeCensus } = await loadWorktreeCensus();
    const table = { ...published().files };
    const file = Object.keys(table).find((f) => f.startsWith('src/'));
    if (file === undefined) throw new Error('the published files map names no src/ row');
    delete table[file];
    const verdict = judgeWorktreeCensus({ scoped: [file], table });
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain(file);
  });

  it('CONTROL: when the real map is read whole, files it names are not reported', async () => {
    const { judgeWorktreeCensus } = await loadWorktreeCensus();
    const named = Object.keys(published().files).slice(0, 25);
    expect(named.length).toBeGreaterThan(0);
    expect(judgeWorktreeCensus({ scoped: named, table: published().files }).failures).toEqual([]);
  });

  it(
    'WHEN THE WIRE IS CUT, the failure must stop reaching the run — wired arm first',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // A `source.toContain(...)` arm asserts the call is WRITTEN, not that its verdict
      // reaches the exit code — it passes on a gate that computes the preflight and
      // throws it away. This runs the REAL gate in a `mkdtempSync` fixture repository,
      // then removes the one line that carries both preflights into the run's failure
      // list and requires the output to change. Nothing is written into this repository.
      const fx = createFixture('worktree-census');
      try {
        const seed = fx.runGenerator(['--seed']);
        expect(seed.code, seed.out).toBe(0);
        expect(runRepoMode(fx).code, 'the seeded fixture holds').toBe(0);
        // An in-scope file in the WORKING TREE that no baseline row names — the input
        // this leg exists to reject. It is written, never committed, so the index cannot
        // carry it: exactly the state that was silent before this slice.
        fx.write(UNROWED_PROBE, 'export const probe = 1;\n');
        const wired = runRepoMode(fx);
        expect(wired.out).toContain(UNROWED_PROBE);
        expect(wired.out).toContain('the baseline names no row for it');
        expect(wired.code, wired.out).toBe(1);

        // when: the preflight's verdicts are computed and DISCARDED
        const gatePath = join(fx.root, '.husky', 'gate', 'repo.mjs');
        const source = readFileSync(gatePath, 'utf8');
        const cut = source.replace(PREFLIGHT_PUSH, '');
        expect(cut, `the weakening found no \`${PREFLIGHT_PUSH}\` to remove`).not.toBe(source);
        writeFileSync(gatePath, cut, 'utf8');
        const severed = runRepoMode(fx);
        // then: the run does not name the file and returns to 0
        expect(severed.out).not.toContain(UNROWED_PROBE);
        expect(severed.code, severed.out).toBe(0);
      } finally {
        fx.cleanup();
      }
    }
  );
});

describe('(a11y) the failure is a sentence a human can act on', () => {
  it('when a file is unseen, should name it, name the ordering, and name both commands', async () => {
    const { judgeWorktreeCensus } = await loadWorktreeCensus();
    const [failure] = judgeWorktreeCensus({ scoped: ['src/a.ts'], table: {} }).failures;
    expect(failure).toContain('src/a.ts');
    expect(failure).toContain('git add <file> && node .husky/peaks-gate-baseline.mjs');
    expect(failure).toContain('git ls-files');
  });
});
