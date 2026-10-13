// tests/unit/lint/scan-coverage.test.ts
//
// D2 of rid `rid-gate-scope-visibility` (backlog 9.11 and 9.15): the set of directories
// this repository's static scans cover is DECLARED, not decided by omission, and a
// directory holding executable code that the declaration does not name is a failure
// that names it.
//
// THE RED ARM IS BUILT FROM THE MEASURED INSTANCE, and that is the whole point of the
// last behaviour arm. The defect was a new `.husky/` hook sitting outside the
// `src/**`-scoped path-safety scan, so the arm hands `judgeScanCoverage` the REAL
// declaration with `.husky` removed and requires the REAL tracked tree to go red naming
// `.husky/` and a real file inside it. A control arm that passed because nothing was
// removed would prove nothing; that is the failure mode five repair rounds on this
// repository each shipped (backlog 9.15).
//
// WHY THE RED ARM IS NOT A SPAWN OF THE GATE. `repo` mode is the enforcement surface and
// it does run this leg (an arm below pins the wiring by reading it). But an arm that
// CREATES an undeclared directory inside the repository to watch `repo` mode refuse it
// would race `tests/unit/standards/file-size-cap.test.ts`, which asserts
// `walkScopedFiles(root)` equals `git ls-files --cached --others --exclude-standard` —
// it compares a filesystem walk against git, so any file another test creates under a
// measured directory reddens it from a different worker. The end-to-end run over a real
// added file was made by hand and is quoted in the request artifact instead.
//
// Dimensions:
//   - behavior:    the pure judges, over hand-built and over real inputs
//   - integration: the real `git ls-files` list, the real declaration, the real module
//   - a11y:        the failure text a human reads — what it names and what it asks for
//   - render:      omitted — nothing is rendered; the observable is a returned string

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createFixture } from './_file-size-hooks-fixture.js';
import { runRepoMode } from './_silent-warning-scope-fixture.js';

declareDimensions(
  'tests/unit/lint/scan-coverage.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'nothing is rendered; the observable is the returned failure text' }]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE_PATH = join(REPO_ROOT, '.husky', 'scan-coverage.mjs');

/**
 * The ONE line that carries both preflights' verdicts into the run's failure list — the
 * string the cut arm removes. Pinned here rather than in the assertion so that a rewording
 * of the wiring fails the arm that cuts it instead of silently cutting nothing.
 */
const PREFLIGHT_PUSH =
  'for (const failure of [...unseen.failures, ...coverage.failures]) failures.push(failure);';

type CoverageEntry = {
  readonly at: string;
  readonly scan?: string;
  readonly uncovered?: string;
  /** Required on an `uncovered` entry: the population its row ratchets. */
  readonly files?: number;
};
type CoverageVerdict = {
  failures: string[];
  /** The UNDECLARED locations, which is what the line's last number counts. */
  undeclared: string[];
  counts: { scanned: number; uncovered: number; undecided: number };
  locations: number;
  line: string;
};
type ScanCoverageModule = {
  readonly SCAN_COVERAGE: readonly CoverageEntry[];
  codeLocation(file: string): string | null;
  judgeScanCoverage(input: {
    tracked: readonly string[];
    worktree: readonly string[];
    declaration?: readonly CoverageEntry[];
  }): CoverageVerdict;
};

/** The module is a `.mjs` gate script outside `src/`, so it loads by URL. */
async function loadScanCoverage(): Promise<ScanCoverageModule> {
  return (await import(pathToFileURL(MODULE_PATH).href)) as ScanCoverageModule;
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true })
    .trim()
    .split('\n');
}

function worktreeOnlyFiles(): string[] {
  return execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true
  })
    .trim()
    .split('\n')
    .filter((f) => f !== '');
}

describe('(behavior) a location holding code is declared or it is a failure', () => {
  it('when a path is read for its location, should return the top-level segment or null at the root', async () => {
    const { codeLocation } = await loadScanCoverage();
    expect(codeLocation('.husky/gate/repo.mjs')).toBe('.husky');
    expect(codeLocation('packages/peaks-loop-shared/src/a.ts')).toBe('packages');
    expect(codeLocation('src/a.ts')).toBe('src');
    // A Windows-native path names the same location as a POSIX one.
    expect(codeLocation('src\\a.ts')).toBe('src');
    // The stated limit: a root file has no location, so it is outside this check.
    expect(codeLocation('vitest.config.ts')).toBeNull();
  });

  it('RED: when a directory holding code is declared nowhere, should fail naming that directory', async () => {
    const { judgeScanCoverage } = await loadScanCoverage();
    const verdict = judgeScanCoverage({ tracked: ['tools/probe.mjs'], worktree: [] });
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain('tools/');
    expect(verdict.failures[0]).toContain('tools/probe.mjs');
    expect(verdict.line).toContain('1 undeclared');
  });

  it('RED: when the declaration is missing a location that really holds code, should fail naming it', async () => {
    // The input this check exists to reject is "a directory nobody declared", and the
    // measured instance of it was `.husky/`. Removing `.husky` from the real declaration
    // reproduces that state exactly — same tree, same declaration, one entry short.
    const { SCAN_COVERAGE, judgeScanCoverage } = await loadScanCoverage();
    const weakened = SCAN_COVERAGE.filter((entry) => entry.at !== '.husky');
    const verdict = judgeScanCoverage({
      tracked: trackedFiles(),
      worktree: [],
      declaration: weakened
    });
    expect(verdict.failures.some((f) => f.startsWith('.husky/ holds executable code'))).toBe(true);
    expect(verdict.failures.join('\n')).toMatch(/\.husky\/[^\s)]*\.mjs/);
  });

  it('CONTROL: the weakened declaration above is a real weakening, and the unweakened one names .husky', async () => {
    // Without this pair the arm above could pass on a stale file list rather than on
    // the removal. Both directions are asserted: the entry is gone, and the tree really
    // has code at that location.
    const { SCAN_COVERAGE, judgeScanCoverage } = await loadScanCoverage();
    expect(SCAN_COVERAGE.filter((e) => e.at === '.husky')).toHaveLength(1);
    expect(trackedFiles().some((f) => f.startsWith('.husky/') && /\.mjs$/.test(f))).toBe(true);
    expect(
      judgeScanCoverage({ tracked: trackedFiles(), worktree: [], declaration: SCAN_COVERAGE })
        .failures
    ).toEqual([]);
  });

  it('CONTROL: when the code lives in a declared location, should not report it', async () => {
    const { judgeScanCoverage } = await loadScanCoverage();
    for (const at of ['src', 'tests', 'scripts', '.husky', 'bin', 'examples']) {
      expect(
        judgeScanCoverage({ tracked: [`${at}/deep/a.mjs`], worktree: [] }).failures,
        at
      ).toEqual([]);
    }
    // The negated half: the same path under no declared location does report.
    expect(judgeScanCoverage({ tracked: ['newdir/a.mjs'], worktree: [] }).failures).toHaveLength(1);
  });

  it('when a non-code file is the only thing in a directory, should not report that directory', async () => {
    const { judgeScanCoverage } = await loadScanCoverage();
    expect(
      judgeScanCoverage({ tracked: ['docs/notes.md', 'assets/logo.png'], worktree: [] }).failures
    ).toEqual([]);
  });

  it('when an entry carrying neither verdict is declared, should fail on the declaration itself', async () => {
    // A mistyped field would otherwise read as "declared, and the reader is told
    // nothing" — the state this module exists to end.
    const { judgeScanCoverage } = await loadScanCoverage();
    // The second entry is DELIBERATELY the wrong shape — that is the injection, so the
    // cast is the input rather than a shortcut around the type.
    const mistyped = { at: 'tools', reason: 'typo' } as unknown as CoverageEntry;
    const verdict = judgeScanCoverage({
      tracked: ['src/a.ts'],
      worktree: [],
      declaration: [{ at: 'src' }, mistyped]
    });
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain('neither a `scan` nor an `uncovered` reason');
    expect(verdict.counts.undecided).toBe(2);
    // ONE VERDICT PER ENTRY, so the three counts cannot exceed the entry count — an
    // entry carrying BOTH fields is the same shape as one carrying neither, and
    // counting it under both headings made the printed line's three numbers sum to four.
    expect(verdict.counts.scanned + verdict.counts.uncovered + verdict.counts.undecided).toBe(2);
    const both = { at: 'tools', scan: 'a', uncovered: 'b' } as unknown as CoverageEntry;
    const doubled = judgeScanCoverage({ tracked: [], worktree: [], declaration: [both] });
    expect(doubled.counts).toEqual({ scanned: 0, uncovered: 0, undecided: 1 });
    expect(doubled.failures).toHaveLength(1);
  });

  it('when nothing is undeclared, the count in the line must be the UNDECLARED locations', async () => {
    // The line used to report `failures.length`, which also counts the aggregate
    // undecided-entry message — so a declaration with two undecided entries and ZERO
    // undeclared locations printed "1 undeclared". Reproduced here at the boundary the
    // reviewer named: the safe direction is still a count nobody can trust.
    const { judgeScanCoverage } = await loadScanCoverage();
    const mistyped = { at: 'tools', reason: 'typo' } as unknown as CoverageEntry;
    const verdict = judgeScanCoverage({
      tracked: ['src/a.ts'],
      worktree: [],
      declaration: [{ at: 'src' }, mistyped]
    });
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.undeclared).toEqual([]);
    expect(verdict.line).toContain('0 undeclared');
  });

  it('RED: when a location no scan covers has gained files, should fail on the row it outgrew', async () => {
    // The hole the reviewer measured: a brand-new `bin/brand-new-logic.mjs` was absorbed
    // by the existing `uncovered` entry, which is a permission the declaration did not
    // mean to grant. The five names below are built from the row's own number — a hand
    // count would stop controlling the moment the row moved.
    const { judgeScanCoverage, SCAN_COVERAGE } = await loadScanCoverage();
    const row = SCAN_COVERAGE.find((entry) => entry.at === 'bin');
    if (row?.files === undefined) throw new Error('SCAN_COVERAGE names no `files` for bin/');
    const grown = Array.from({ length: row.files + 1 }, (_, i) => `bin/probe-${i}.mjs`);
    const verdict = judgeScanCoverage({ tracked: grown, worktree: [] });
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.failures[0]).toContain(`bin/ holds ${row.files + 1} code file(s)`);
    expect(verdict.failures[0]).toContain(`names ${row.files}`);
    // CONTROL: exactly the row's number is tolerated, and one fewer is a descent.
    expect(judgeScanCoverage({ tracked: grown.slice(1), worktree: [] }).failures).toEqual([]);
  });
});

describe('(integration) the real tree is fully declared', () => {
  it(
    'when the TRACKED repository is read whole, should declare every location it holds',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The real `git ls-files`, the real declaration. This is the deterministic half:
      // the tracked list moves only when a commit does.
      const { judgeScanCoverage } = await loadScanCoverage();
      const verdict = judgeScanCoverage({ tracked: trackedFiles(), worktree: [] });
      expect(verdict.failures, verdict.failures.join('\n')).toEqual([]);
      // Anti-vacuity: the measured instance and the four silent locations really are in
      // the population this run read, so "0 undeclared" is not "0 locations".
      expect(verdict.locations).toBeGreaterThanOrEqual(9);
      expect(verdict.counts.scanned).toBeGreaterThanOrEqual(5);
      expect(verdict.counts.uncovered).toBeGreaterThanOrEqual(4);
      expect(verdict.line).toContain('0 undeclared');
    }
  );

  it(
    'when a code file exists only in the working tree, should read the working tree too',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // THE WORKING-TREE HALF, over the real tracked list. The untracked path here is
      // SYNTHETIC on purpose: the live `git ls-files --others --exclude-standard` is
      // whatever a concurrent agent has open, an undeclared location in it is a TRUE
      // finding, and an arm asserting the live verdict would redden this suite for a
      // reason that is not its own — measured, the hand-run reproduction's own probe
      // directory did exactly that. The live worktree is covered end to end by that run,
      // quoted in the request artifact.
      const { judgeScanCoverage } = await loadScanCoverage();
      const tracked = trackedFiles();
      const base = judgeScanCoverage({ tracked, worktree: [] }).locations;
      const withWorktree = judgeScanCoverage({ tracked, worktree: ['transient-probe/a.mjs'] });
      expect(withWorktree.locations).toBe(base + 1);
      expect(withWorktree.failures.join('\n')).toContain('transient-probe/');
      // And the real enumeration returns a list, not a boolean: the live worktree is
      // what a caller hands in, and it is empty or it is not.
      expect(Array.isArray(worktreeOnlyFiles())).toBe(true);
    }
  );

  it(
    'WHEN THE WIRE IS CUT, the failure must stop reaching the run — wired arm first',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // WHY THIS REPLACED A `source.toContain(...)` ARM. A text match asserts that the
      // call is WRITTEN, not that its verdict reaches the exit code; it passes on a
      // gate whose preflight is computed and thrown away. This arm runs the REAL gate in
      // a fixture repository, then CUTS the one line that carries the verdicts into the
      // run's failure list and requires the output to change — the 9.15 rule applied to
      // the test rather than to the guard. The fixture is a `mkdtempSync` repository, so
      // nothing is written into this one.
      const fx = createFixture('scan-coverage');
      try {
        const seed = fx.runGenerator(['--seed']);
        expect(seed.code, seed.out).toBe(0);
        // The control arm first: on the seeded fixture as it stands, the preflight holds.
        expect(runRepoMode(fx).code, 'the seeded fixture holds').toBe(0);
        // Then the two red inputs. An undeclared location, and a declared-uncovered
        // location that has GROWN past the number its row names.
        fx.write('tools/probe.mjs', 'export const probe = 1;\n');
        for (const name of ['a', 'b', 'c', 'd', 'e']) {
          fx.write(`bin/${name}.mjs`, 'export const probe = 1;\n');
        }
        const wired = runRepoMode(fx);
        expect(wired.out).toContain('tools/ holds executable code (tools/probe.mjs)');
        expect(wired.out).toContain('bin/ holds 5 code file(s) and SCAN_COVERAGE names 4');
        expect(wired.code, wired.out).toBe(1);

        // when: the preflight's verdicts are computed and DISCARDED
        const gatePath = join(fx.root, '.husky', 'gate', 'repo.mjs');
        const source = readFileSync(gatePath, 'utf8');
        const cut = source.replace(PREFLIGHT_PUSH, '');
        expect(cut, `the weakening found no \`${PREFLIGHT_PUSH}\` to remove`).not.toBe(source);
        writeFileSync(gatePath, cut, 'utf8');
        const severed = runRepoMode(fx);
        // then: neither failure reaches the run, and the exit code returns to 0 — so the
        //       assertions above are known to be sensitive to the wiring, not to the text
        expect(severed.out).not.toContain('tools/ holds executable code');
        expect(severed.out).not.toContain('bin/ holds 5 code file(s)');
        expect(severed.code, severed.out).toBe(0);
      } finally {
        fx.cleanup();
      }
    }
  );
});

describe('(a11y) the failure is a sentence a human can act on', () => {
  it('when a location is undeclared, should name it, name a file, and name the file to edit', async () => {
    const { judgeScanCoverage } = await loadScanCoverage();
    const [failure] = judgeScanCoverage({ tracked: ['newdir/a.mjs'], worktree: [] }).failures;
    expect(failure).toContain('newdir/');
    expect(failure).toContain('newdir/a.mjs');
    expect(failure).toContain('.husky/scan-coverage.mjs');
    expect(failure).toContain('the reason nothing does');
  });
});
