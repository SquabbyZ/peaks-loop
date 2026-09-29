// packages/peaks-loop-shared/tests/paths-fs.test.ts
//
// Filesystem-facing subjects of peaks-loop-shared's own modules: the paths
// dir constants, the required skill/schema catalogs, and the four fs helpers
// exercised against a real tmp directory.
//
// Split off tests/shared.test.ts on 2026-09-29 (strict-remediation-abc,
// slice b1-filesplit-campaign): that file had grown to 335 raw lines, over
// the 300-raw-line cap .peaks/docs/lint-gate.md §4 row 5 sets for files
// under src/ and packages/. The split is by subject — this file keeps the
// paths/fs cases; tests/result-version.test.ts keeps the result-envelope,
// version, redaction and index-barrel cases. All 19 original cases survive
// in these two files, none dropped, merged, or weakened.
//
// Why this package has its own tests at all (unchanged from the original):
// `pnpm -r --filter ./packages/* run test` printed "No test files found,
// exiting with code 0" for this package on 2026-09-29, while the package
// publishes 5 source files to npm. Its root mirror test was deleted as
// redundant in 08e92d8f and nothing replaced it, so a published package
// reported a green it never earned. Same rule the lint gate already names
// for lint: an untested file is not a clean file
// (.peaks/docs/lint-gate.md, the `notLinted` ceiling).
//
// `declareDimensions` is inlined here for the same reason as
// peaks-loop-mut/tests/thresholds.test.ts — the root helper lives behind the
// '~' vitest alias (main package only) and this package's vitest config does
// not inherit it. The 5-line duplication is intentional.
//
// Dimensions covered:
//   - render:      paths catalog + dir constants
//   - integration: the four fs helpers against a real tmp directory
//   - behavior / a11y: carried by tests/result-version.test.ts, declared
//     as omitted below
//
// Run with: pnpm -F peaks-loop-shared test

import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Dim = 'render' | 'behavior' | 'integration' | 'a11y';
function declareDimensions(
  _file: string,
  covered: readonly Dim[],
  omitted: ReadonlyArray<{ dim: Dim; reason: string }> = []
): void {
  const ALL: readonly Dim[] = ['render', 'behavior', 'integration', 'a11y'];
  const coveredSet = new Set(covered);
  const missing = ALL.filter((d) => !coveredSet.has(d) && !omitted.find((o) => o.dim === d));
  if (missing.length > 0) {
    throw new Error(
      `[${_file}] missing dimensions ${missing.join(', ')}; add a describe(...) or pass an omitted[] entry.`
    );
  }
}

declareDimensions(
  'packages/peaks-loop-shared/tests/paths-fs.test.ts',
  ['render', 'integration'],
  [
    {
      dim: 'behavior',
      reason: 'the result/version behavior cases live in tests/result-version.test.ts'
    },
    {
      dim: 'a11y',
      reason: 'the redactSensitiveErrorMessage cases live in tests/result-version.test.ts'
    }
  ]
);

import { isDirectory, listDirectories, pathExists, readText } from '../src/fs.js';
import {
  repoRoot,
  requiredSchemaFiles,
  requiredSkillNames,
  schemasDir,
  skillsDir,
  templatesDir
} from '../src/paths.js';

describe('render — paths dir constants', () => {
  it('when the module is imported from inside the repo, should root itself at a directory holding both package.json and skills/', () => {
    // given: repoRoot, computed at import time by walking up from this file
    // when:  the two markers findRepoRoot() keys on are checked
    // then:  both exist under the resolved root
    expect(existsSync(join(repoRoot, 'package.json'))).toBe(true);
    expect(existsSync(join(repoRoot, 'skills'))).toBe(true);
  });

  it('when the asset dirs are read, should be the skills/, schemas/ and templates/ children of that root', () => {
    // given: the four path constants this module exports
    // when:  each asset dir is compared with resolve(repoRoot, ...)
    // then:  all three are composed from the same root, and skills/ + schemas/ exist
    expect(skillsDir).toBe(resolve(repoRoot, 'skills'));
    expect(schemasDir).toBe(resolve(repoRoot, 'schemas'));
    expect(templatesDir).toBe(resolve(repoRoot, 'templates'));
    expect(statSync(skillsDir).isDirectory()).toBe(true);
    expect(statSync(schemasDir).isDirectory()).toBe(true);
  });
});

describe('render — paths catalog', () => {
  it('when requiredSkillNames is read, should hold exactly the 8 documented peaks skill ids', () => {
    // given: the frozen skill-name list
    // when:  it is sorted
    // then:  it equals the documented set, spelled as the skills/ dirs spell them
    expect([...requiredSkillNames].sort()).toEqual([
      'peaks-code',
      'peaks-prd',
      'peaks-qa',
      'peaks-rd',
      'peaks-sc',
      'peaks-sop',
      'peaks-txt',
      'peaks-ui'
    ]);
  });

  it('when requiredSchemaFiles is read, should name only <kebab-name>.schema.json files', () => {
    // given: the frozen schema list (>= 15 entries by contract)
    // when:  every entry is matched against the schema-file shape
    // then:  the list is non-trivial and every name conforms
    expect(requiredSchemaFiles.length).toBeGreaterThanOrEqual(15);
    for (const name of requiredSchemaFiles) {
      expect(name).toMatch(/^[a-z0-9-]+\.schema\.json$/);
    }
  });

  it('when either list is read, should contain no duplicate entry', () => {
    // given: the two required-name catalogs
    // when:  each is put through a Set
    // then:  nothing was listed twice (a duplicate would silently shrink a check)
    expect(new Set(requiredSkillNames).size).toBe(requiredSkillNames.length);
    expect(new Set(requiredSchemaFiles).size).toBe(requiredSchemaFiles.length);
  });
});

describe('integration — fs helpers on a real tmp directory', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-shared-fs-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('when pathExists() is asked about a file, a directory and a missing path, should answer true, true, false', async () => {
    // given: one real file, one real directory, one absent name
    // when:  pathExists() probes all three
    // then:  it reports existence without throwing on the absent one
    const file = join(tmpRoot, 'a.txt');
    writeFileSync(file, 'hi', 'utf8');
    const dir = join(tmpRoot, 'a-dir');
    mkdirSync(dir);
    expect(await pathExists(file)).toBe(true);
    expect(await pathExists(dir)).toBe(true);
    expect(await pathExists(join(tmpRoot, 'absent'))).toBe(false);
  });

  it('when readText() reads a file, should return its contents verbatim, and when the file is absent, should reject', async () => {
    // given: a file with two lines and an absent path
    // when:  readText() is used on each
    // then:  the bytes come back unchanged; the absent one rejects (ENOENT propagates)
    const file = join(tmpRoot, 'r.txt');
    writeFileSync(file, 'hello\nworld', 'utf8');
    expect(await readText(file)).toBe('hello\nworld');
    await expect(readText(join(tmpRoot, 'absent.txt'))).rejects.toThrow();
  });

  it('when listDirectories() reads a mixed directory, should return only the subdirectory names, sorted', async () => {
    // given: a directory holding 2 subdirectories and a file
    // when:  listDirectories() reads it
    // then:  the file is filtered out and the names come back sorted
    mkdirSync(join(tmpRoot, 'b-dir'));
    mkdirSync(join(tmpRoot, 'a-dir'));
    writeFileSync(join(tmpRoot, 'note.txt'), 'noise', 'utf8');
    expect(await listDirectories(tmpRoot)).toEqual(['a-dir', 'b-dir']);
    await expect(listDirectories(join(tmpRoot, 'absent'))).rejects.toThrow();
  });

  it('when isDirectory() is asked about a directory, a file and a missing path, should answer true, false, false', async () => {
    // given: a real directory, a real file, an absent path
    // when:  isDirectory() stats each
    // then:  only the directory answers true, and the absent path answers false
    //        instead of throwing
    const dir = join(tmpRoot, 'd');
    mkdirSync(dir);
    const file = join(tmpRoot, 'f.txt');
    writeFileSync(file, 'x', 'utf8');
    expect(await isDirectory(dir)).toBe(true);
    expect(await isDirectory(file)).toBe(false);
    expect(await isDirectory(join(tmpRoot, 'absent'))).toBe(false);
  });
});
