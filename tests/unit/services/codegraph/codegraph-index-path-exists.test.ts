// tests/unit/services/codegraph/codegraph-index-path-exists.test.ts
//
// 4-dimension unit test for the BOUNDED staleness predicate (perf audit D2,
// rid 2026-09-17-oversize-and-scale).
//
// The defect: `inspectCodegraphIndexIntegrityFrom` asks `pathExists` once per
// index row, and the production predicate answered every row with a full-path
// `existsSync` — 13.5 µs each, 35 ms at 1.2k rows, 1,923 ms at 100x. The gate
// is on a demand path (`peaks codegraph status`, the doctor check), and its
// cost was unbounded in the size of the index.
//
// The replacement answers a row from ONE cached listing of its parent
// directory, so the calls are bounded by the number of DISTINCT DIRECTORIES
// the index names rather than by its row count. The authority does not move:
// anything the cache cannot decide falls through to the per-row `existsSync`,
// which is preserved verbatim.
//
// Two cheaper predicates were considered and are BOTH wrong. They are pinned
// here as controls, because "the fixture can tell them apart" is the only
// thing that makes the equivalence claim mean anything:
//
//   - `git ls-files` MEMBERSHIP (the 11-vs-4 trap): an orchestrator scratch
//     script used it and reported 11 dead rows where the disk says 4 — a
//     project's own uncommitted-but-present files are absent from
//     `git ls-files`, so a tracked-only predicate calls live files dead. The
//     fixture below reproduces that shape exactly (11 present rows, 7 of them
//     uncommitted; 4 genuinely gone).
//   - A walk that trusts every name `readdir` reports: `readdir` lists a
//     BROKEN junction/symlink, and `existsSync` on it is false.
//
// Controls (this repo's standard, non-negotiable):
//   - ORACLE control: every row is compared against the real per-row
//     `existsSync` on the same fixture, and the oracle's own answer set is
//     asserted to contain BOTH outcomes (a fixture of all-true rows would let
//     any constant-returning predicate pass).
//   - DISCRIMINATOR control: the git-membership predicate is computed on the
//     same rows and asserted to disagree (11 vs 4), in the recorded direction.
//     If the two agreed, the fixture would not be exercising the trap at all.
//   - BOUND control: filesystem calls are counted through a `node:fs` mock,
//     so "bounded" is an assertion rather than a claim.
//
// Dimensions covered:
//   - behavior:    equivalence with the per-row stat across plain, absent,
//                  directory, trailing-slash, case-differing, junctioned and
//                  broken-junction rows
//   - integration: real git work tree, real directory junctions/symlinks,
//                  real SQLite index, through the production entry point
//   - a11y:        the human report never names a live-but-uncommitted row as
//                  `stale:` — the operator-visible consequence of the trap
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-index-path-exists.test.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-index-path-exists.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the predicate returns a boolean and renders nothing; the report it feeds is rendered by renderCodegraphIndexIntegrityLines, whose own shape is pinned in codegraph-index-integrity.test.ts'
    }
  ]
);

// ── filesystem call counter ──────────────────────────────────────────
//
// `realExists` is captured BEFORE the wrapper is installed, so the oracle in
// the equivalence test is the untouched `existsSync` and its own calls never
// enter the counters.
const __fs = vi.hoisted(() => ({
  existsCalls: [] as string[],
  readdirCalls: [] as string[],
  realExists: null as unknown as (filePath: string) => boolean
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  __fs.realExists = (filePath: string) => actual.existsSync(filePath);
  return {
    ...actual,
    existsSync: ((filePath: string) => {
      __fs.existsCalls.push(String(filePath));
      return actual.existsSync(filePath);
    }) as unknown as typeof actual.existsSync,
    readdirSync: ((dirPath: string, options?: unknown) => {
      __fs.readdirCalls.push(String(dirPath));
      return (actual.readdirSync as unknown as (a: string, b?: unknown) => unknown)(
        dirPath,
        options
      );
    }) as unknown as typeof actual.readdirSync
  };
});

import { readCodegraphProjectInputs } from '../../../../src/services/codegraph/codegraph-exclude-reconciler.js';
import {
  createCodegraphIndexPathExists,
  inspectCodegraphIndexIntegrity,
  inspectCodegraphIndexIntegrityFrom,
  renderCodegraphIndexIntegrityLines
} from '../../../../src/services/codegraph/codegraph-index-integrity.js';

// ── fixture ──────────────────────────────────────────────────────────

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true });
}

function makeGitRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'peaks-test@example.com']);
  git(root, ['config', 'user.name', 'peaks test']);

  return root;
}

function resetCounters(): void {
  __fs.existsCalls.length = 0;
  __fs.readdirCalls.length = 0;
}

/** Paths among `candidates` that sit inside `root`. */
function insideRoot(root: string, candidates: readonly string[]): string[] {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;

  return candidates.filter((candidate) => candidate.startsWith(prefix));
}

/** Create `relative` and one regular file per name, returning the rows. */
function seedDirectory(root: string, relative: string, names: readonly string[]): string[] {
  mkdirSync(join(root, relative), { recursive: true });
  for (const name of names) {
    writeFileSync(join(root, relative, name), 'export const value = 1;\n', 'utf8');
  }

  return names.map((name) => `${relative}/${name}`);
}

/**
 * The 11-vs-4 trap, built literally: FOUR committed files, SEVEN files added
 * to the working tree after the commit, and FOUR rows naming files that are
 * genuinely gone. `git ls-files` knows 4 of the 11 present rows; the disk
 * knows all 11. A junction to a live directory and a junction to a missing
 * target are added so the two unusual classes are covered on every platform
 * (`'junction'` is a Windows reparse type; on POSIX the same call creates an
 * ordinary directory symlink).
 */
function buildTrapFixture(): { root: string; present: string[]; gone: string[] } {
  const root = makeGitRoot('peaks-cg-path-exists-');
  const committed = Array.from(
    { length: 4 },
    (_unused, index) => `committed-${String(index + 1)}.ts`
  );
  const present = seedDirectory(root, 'src', committed);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);

  const uncommitted = Array.from({ length: 7 }, (_unused, index) => `new-${String(index + 1)}.ts`);
  present.push(...seedDirectory(root, 'src', uncommitted));

  symlinkSync(join(root, 'src'), join(root, 'goodjunc'), 'junction');
  symlinkSync(join(root, 'does-not-exist'), join(root, 'brokenjunc'), 'junction');

  const gone = Array.from({ length: 4 }, (_unused, index) => `src/gone-${String(index + 1)}.ts`);

  return { root, present, gone };
}

function trackedFilesOf(root: string): ReadonlySet<string> {
  const raw = execFileSync('git', ['-C', root, 'ls-files'], {
    encoding: 'utf8',
    windowsHide: true
  });

  return new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

// ── behavior: equivalence with the per-row stat ──────────────────────

describe('codegraph index path-exists predicate (equivalence)', () => {
  it('should answer every row exactly as the per-row stat does', () => {
    const { root, present, gone } = buildTrapFixture();

    // Every class the cache must not silently change: a plain file, an
    // uncommitted-but-present file, a row that is gone, a directory, a
    // trailing-slash row, the empty row, a junction, a broken junction, a
    // path THROUGH a junction, a path through a broken junction, a
    // case-differing path, and a trailing slash on a FILE.
    const rows = [
      ...present,
      ...gone,
      'src',
      'src/',
      '',
      'goodjunc',
      'brokenjunc',
      'goodjunc/new-1.ts',
      'brokenjunc/new-1.ts',
      'SRC/NEW-1.TS',
      'src/new-1.ts/'
    ];

    const resolver = createCodegraphIndexPathExists();
    const oracle = rows.map((row) => __fs.realExists(join(root, row)));
    const actual = rows.map((row) => resolver(root, row));

    // The oracle must carry BOTH outcomes, or this test cannot fail for the
    // right reason: a fixture of all-true rows would pass under any
    // predicate that simply returns true.
    expect(oracle).toContain(true);
    expect(oracle).toContain(false);

    expect(actual).toEqual(oracle);
  });

  it('should MISS the cache on a case-differing row and let the stat decide', () => {
    const { root } = buildTrapFixture();
    const resolver = createCodegraphIndexPathExists();

    // `caseFoldingFs` is a runtime probe of the actual filesystem, not an
    // assumption about the platform: the same code must produce the disk's
    // answer on a case-insensitive Windows volume AND on a case-sensitive
    // Linux ext4 checkout.
    const caseFoldingFs = __fs.realExists(join(root, 'SRC'));

    resetCounters();
    const answer = resolver(root, 'SRC/NEW-1.TS');

    expect(answer).toBe(caseFoldingFs);
    // The mechanism, pinned: the listing carries the ON-DISK spelling, so the
    // case-differing row is a miss and falls through to the stat. A resolver
    // that answered from the listing alone would be WRONG on a
    // case-sensitive filesystem and would not stat here.
    expect(
      __fs.existsCalls.filter((filePath) => filePath === join(root, 'SRC/NEW-1.TS'))
    ).toHaveLength(1);
  });
});

// ── behavior: the 11-vs-4 trap ───────────────────────────────────────

describe('codegraph index path-exists predicate (absent-from-disk, not git-membership)', () => {
  it('should call an uncommitted-but-present file alive, where git membership calls it dead', () => {
    const { root, present, gone } = buildTrapFixture();
    const rows = [...present, ...gone];
    const resolver = createCodegraphIndexPathExists();

    const deadByDisk = rows.filter((row) => !resolver(root, row));
    const tracked = trackedFilesOf(root);
    const deadByGit = rows.filter((row) => !tracked.has(row));

    // The trap, pinned as a DISCRIMINATOR: the two predicates must disagree,
    // and in the recorded direction (11 vs 4). A fixture where they agreed
    // would prove nothing about which one this module implements.
    expect(deadByGit).toEqual([...present.slice(4), ...gone]);
    expect(deadByGit).toHaveLength(11);
    expect(deadByDisk).toEqual(gone);
    expect(deadByDisk).toHaveLength(4);
  });
});

// ── integration: the production entry point stays bounded ────────────

describe('codegraph index path-exists predicate (bounded calls)', () => {
  const FILES_TABLE_SQL =
    'CREATE TABLE files (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, node_count INTEGER DEFAULT 0, errors TEXT)';

  /**
   * A real work tree, a real `.codegraph/config.json` and a real
   * `codegraph.db` holding `liveRowCount` live rows spread over `dirCount`
   * directories, plus `deadRowCount` rows that are gone.
   */
  function buildIndexedProject(
    liveRowCount: number,
    dirCount: number,
    deadRowCount: number
  ): { root: string; liveRows: string[]; deadRows: string[] } {
    const root = makeGitRoot('peaks-cg-bounded-');
    const perDir = Math.ceil(liveRowCount / dirCount);
    const liveRows: string[] = [];
    for (let dir = 0; dir < dirCount; dir += 1) {
      const names = Array.from(
        { length: perDir },
        (_unused, index) => `live-${String(dir)}-${String(index)}.ts`
      );
      liveRows.push(...seedDirectory(root, `pkg${String(dir)}`, names));
    }
    const live = liveRows.slice(0, liveRowCount);

    mkdirSync(join(root, '.codegraph'), { recursive: true });
    writeFileSync(
      join(root, '.codegraph', 'config.json'),
      `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: [] }, null, 2)}\n`,
      'utf8'
    );

    const deadRows = Array.from(
      { length: deadRowCount },
      (_unused, index) => `pkg0/gone-${String(index)}.ts`
    );
    const db = new Database(join(root, '.codegraph', 'codegraph.db'));
    db.pragma('journal_mode = WAL');
    db.exec(FILES_TABLE_SQL);
    const insert = db.prepare(
      'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at) VALUES (?, ?, ?, 0, 0, 0)'
    );
    for (const row of [...live, ...deadRows]) {
      insert.run(row, 'hash', 'typescript');
    }
    db.close();

    return { root, liveRows: live, deadRows };
  }

  it('should read each named directory once and stat only the rows it could not confirm', () => {
    const { root, liveRows, deadRows } = buildIndexedProject(240, 3, 5);
    const liveRowPaths = new Set(liveRows.map((row) => join(root, row)));
    const deadRowPaths = new Set(deadRows.map((row) => join(root, row)));

    resetCounters();
    const report = inspectCodegraphIndexIntegrity(root, readCodegraphProjectInputs(root));

    // The answer is unchanged: exactly the rows that are gone.
    expect(report.deadRows).toEqual(deadRows);
    expect(report.includeGap).toEqual([]);

    // THE BOUND. A live row is confirmed from a listing, so no `existsSync`
    // may ever name a live row's own path. Reverting `inspectCodegraphIndex
    // Integrity` to the bare per-row stat makes this 240 long.
    expect(__fs.existsCalls.filter((filePath) => liveRowPaths.has(filePath))).toEqual([]);

    // Only the misses fall through to the stat, and only once each.
    expect(__fs.existsCalls.filter((filePath) => deadRowPaths.has(filePath))).toHaveLength(
      deadRows.length
    );

    // Each distinct parent directory is listed exactly once (the memo), so
    // the listing count is bounded by the directories the index names — 3
    // here — and not by its 245 rows.
    const listedDirectories = insideRoot(root, __fs.readdirCalls);
    expect(new Set(listedDirectories).size).toBe(3);
    expect(listedDirectories).toHaveLength(3);
  });
});

// ── a11y: the operator-visible consequence ───────────────────────────

describe('codegraph index path-exists predicate (human report)', () => {
  it('should not print a live-but-uncommitted file as a stale row', () => {
    const { root, present, gone } = buildTrapFixture();
    const pathExists = createCodegraphIndexPathExists();

    const report = inspectCodegraphIndexIntegrityFrom({
      configPath: join(root, '.codegraph', 'config.json'),
      databasePath: join(root, '.codegraph', 'codegraph.db'),
      trackedFiles: [...present],
      include: ['**/*.ts'],
      indexedPaths: [...present, ...gone],
      supportsPath: () => true,
      pathExists: (row) => pathExists(root, row)
    });

    expect(report.deadRows).toEqual(gone);

    const lines = renderCodegraphIndexIntegrityLines(report, false);
    const staleLines = lines.filter((line) => line.startsWith('  stale: '));

    expect(staleLines).toHaveLength(gone.length);
    for (const row of gone) {
      expect(staleLines).toContain(`  stale: ${row}`);
    }
  });
});
