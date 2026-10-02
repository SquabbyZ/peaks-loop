// tests/unit/lint/baseline-split.test.ts
//
// The acceptance arms for rid `2026-10-02-wave9-generator-split`: the split of
// `.husky/peaks-gate-baseline.mjs` (799 raw lines of straight-line script with a
// top-level `await`) into a 96-line entry plus `.husky/baseline/*.mjs`.
//
// WHY A FILE OF ITS OWN. `baseline-monotonicity-seeding.test.ts` sits at exactly the
// 500-line tests cap and the other three siblings at 472/480/499 — the headroom trap
// slice 1 and slice 2 both fell into (guard work raising `fileSizeOverCap`). New arms
// live here; the edits to the capped files are the staging resolver and the re-aimed
// pins, nothing else.
//
// WHAT IS GUARDED.
//   - the rows are ONE block: `generatorCeilingsFileUnder` answers "which module
//     assembles the last ceiling row" from the tree and THROWS on zero or two, and the
//     PLANT arm proves the refusal can fire. That resolver is what the seeding fixture
//     patches through, so a restated row block breaks a real run, not only an arm.
//   - the set is a WALK: a new sibling under `.husky/baseline/` joins the pool, the
//     pins, and every fixture's staging loop with no name edited anywhere — the
//     second-copy defect this campaign files most often, which in wave 7 and slice 1
//     and slice 2 each showed up as `ERR_MODULE_NOT_FOUND` inside a temp repo.
//   - the entry's own import graph is covered by that walk: every relative specifier
//     the entry writes must be a member of the pooled set AND of the fixtures' staging
//     walk. A pin that pools one set while a fixture stages another is the failure this
//     arm exists to make impossible.
//   - Windows spellings: every path the resolver returns is slash-normalised, because
//     `join()` yields backslashes and a comparison against the walk would silently fail.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  CEILINGS_TAIL_ANCHOR,
  GENERATOR_DIR_REL,
  GENERATOR_ENTRY_REL,
  REPO_ROOT,
  generatorCeilingsFileUnder,
  generatorModulePathsUnder,
  generatorModuleTextUnder
} from '../standards/_file-size-cap-scan.js';
import { hooksScopeFilesUnder } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/baseline-split.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'the refusal and note prose the split moved is asserted verbatim through the generator fixture runs (`baseline-monotonicity*.test.ts`); this file guards the MODULE SET'
    },
    {
      dim: 'a11y',
      reason:
        'no operator-facing sentence originates here; the exit codes and texts belong to the generator scenarios next door'
    }
  ]
);

const writeIn = (root: string, rel: string, text: string): void => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
};

/** Every `from './baseline/<name>.mjs'` specifier the entry writes, as walked relpaths. */
function entrySpecifiers(root: string): string[] {
  const text = readFileSync(join(root, GENERATOR_ENTRY_REL), 'utf8');
  return [...text.matchAll(/from '(\.\/baseline\/[^']+\.mjs)'/g)].map((match) => {
    // The group is not optional, so a `matchAll` result for this pattern always carries
    // it; TS still types it `string | undefined`. Naming the impossibility instead of
    // casting keeps the arm honest: if the pattern ever stopped binding, the arm fails
    // with this message rather than comparing `undefined` against the walk.
    const specifier = match[1];
    if (typeof specifier !== 'string') {
      throw new Error(
        `entry specifier in ${GENERATOR_ENTRY_REL} matched without its path group: ${match[0]}`
      );
    }
    return specifier;
  });
}

describe('Scenario: behavior — the assembled rows are one block in one module', () => {
  it('finds exactly one module carrying the last ceiling row, and it is not the entry', () => {
    const holder = generatorCeilingsFileUnder(REPO_ROOT);
    expect(holder.startsWith(GENERATOR_DIR_REL), `rows holder: ${holder}`).toBe(true);
    const pool = generatorModuleTextUnder(REPO_ROOT);
    const declarations = pool.match(/const ceilings = \{/g) ?? [];
    expect(declarations, 'the ceiling block is assembled in exactly one module').toHaveLength(1);
    // The two rows whose ORDER the seeding fixture's anchor depends on: the hooks pair
    // must stay before `fileSizeExcessLines`, or the fixture patches a row it means to
    // be last and the guard silently un-anchors.
    expect(
      pool.indexOf('fileSizeHooksOverCap: size.env.hooks.overCap') <
        pool.indexOf('fileSizeExcessLines: size.env.excessLines')
    ).toBe(true);
    // The inputs F2 binds each row to, and the source guards §2.32 refuses a literal for.
    for (const needle of [
      'fileSizePolicyInputs: {',
      'fileSizeHooksExcessLines: size.env.hooks.excessLines',
      'FS_WHOLE_SCOPE_SOURCE',
      'FS_HOOKS_WHOLE_SCOPE_SOURCE'
    ]) {
      expect(pool, needle).toContain(needle);
    }
  });

  it('PLANT: refuses a second copy of the rows, and a set that carries none', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-gen-rows-'));
    try {
      const rows =
        'const ceilings = {\n  fileSizeOverCap: size.env.overCap,\n' +
        '  fileSizeExcessLines: size.env.excessLines\n};\n';
      writeIn(root, GENERATOR_ENTRY_REL, "import './baseline/artifact.mjs';\n");
      writeIn(root, `${GENERATOR_DIR_REL}artifact.mjs`, rows);
      expect(generatorCeilingsFileUnder(root)).toBe(`${GENERATOR_DIR_REL}artifact.mjs`);
      // A sibling restating the rows is the second-copy defect: the reader must fail
      // rather than pick one, or the fixture patches a file nothing reads.
      writeIn(root, `${GENERATOR_DIR_REL}restated.mjs`, rows);
      expect(() => generatorCeilingsFileUnder(root)).toThrow(/found 2/);
      // Zero holders is the staleness half.
      rmSync(join(root, `${GENERATOR_DIR_REL}artifact.mjs`));
      rmSync(join(root, `${GENERATOR_DIR_REL}restated.mjs`));
      expect(() => generatorCeilingsFileUnder(root)).toThrow(/found 0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the anchor is indentation-tolerant, because a wrapped region is two spaces deeper', () => {
    // The seeding fixture's fourteenth-row patch and this resolver share the anchor's
    // shape. If it only matched a column-zero object, the split would move the rows out
    // of its reach and the fixture would patch nothing.
    expect(CEILINGS_TAIL_ANCHOR.test('  fileSizeExcessLines: size.env.excessLines\n  };')).toBe(
      true
    );
    expect(CEILINGS_TAIL_ANCHOR.test('fileSizeExcessLines: size.env.excessLines\n};')).toBe(true);
    expect(CEILINGS_TAIL_ANCHOR.test('fileSizeExcessLines: 12\n};')).toBe(false);
  });
});

describe('Scenario: behavior — the generator set is a walk, so it cannot go stale', () => {
  it('grows when a module appears under .husky/baseline/ with no list edited', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-gen-stage-'));
    try {
      writeIn(root, GENERATOR_ENTRY_REL, 'export const entry = 1;\n');
      writeIn(root, `${GENERATOR_DIR_REL}paths.mjs`, 'export const paths = 1;\n');
      expect(generatorModulePathsUnder(root)).toEqual([
        GENERATOR_ENTRY_REL,
        `${GENERATOR_DIR_REL}paths.mjs`
      ]);
      writeIn(root, `${GENERATOR_DIR_REL}later.mjs`, 'export const later = 1;\n');
      expect(generatorModulePathsUnder(root)).toHaveLength(3);
      // The census's rule, not "everything in the directory".
      writeIn(root, '.husky/notes.txt', 'not a module\n');
      expect(generatorModulePathsUnder(root)).toHaveLength(3);
      // And the pooled text follows the walk: the new sibling speaks, the pin hears it.
      expect(generatorModuleTextUnder(root)).toContain('later');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('real tree: the entry imports only walked members, and the fixture stages every one', () => {
    const paths = generatorModulePathsUnder(REPO_ROOT);
    expect(paths[0]).toBe(GENERATOR_ENTRY_REL);
    expect(paths.length, 'the split made the generator a module set').toBeGreaterThan(2);
    // Every relative specifier the entry writes is in the set (nothing imported from a
    // file the pins do not pool)…
    for (const specifier of entrySpecifiers(REPO_ROOT)) {
      const rel = specifier.replace('./baseline/', GENERATOR_DIR_REL);
      expect(paths, `entry specifier ${specifier} is a pooled member`).toContain(rel);
      // …and in the walk the three generator fixtures and the hooks fixture stage from,
      // so no fixture can load a module another one cannot see (Windows-safe: both
      // sides of every comparison here are slash-spelled).
      expect(hooksScopeFilesUnder(REPO_ROOT), `staged by the fixtures: ${rel}`).toContain(rel);
    }
    expect(entrySpecifiers(REPO_ROOT).length, 'the entry imports its regions').toBeGreaterThan(5);
    for (const rel of paths) {
      expect(rel, rel).not.toContain('\\');
      expect(readFileSync(join(REPO_ROOT, rel), 'utf8').length, rel).toBeGreaterThan(0);
    }
    // The shared measurement path is reached from the set, never restated in it.
    const pool = generatorModuleTextUnder(REPO_ROOT);
    expect(pool).toContain('measureFileSizeOverCap(');
    expect(pool).not.toMatch(/function measureFileSizeOverCap/);
    expect(pool.match(/measureFileSizeOverCap\(/g)?.length).toBe(1);
  });

  it('every sibling the entry imports loads, and the refusal shape is one function', async () => {
    // A live call through the set rather than a read of it: `paths.mjs` builds the
    // anchor strings the generator refuses with, and the region modules resolve their
    // outward specifiers (`../peaks-gate-file-size.mjs`, the monotonic entry) one level
    // deeper than the entry does.
    const paths = generatorModulePathsUnder(REPO_ROOT);
    for (const specifier of entrySpecifiers(REPO_ROOT)) {
      const module = (await import(
        pathToFileURL(join(REPO_ROOT, specifier.replace('./baseline/', GENERATOR_DIR_REL))).href
      )) as Record<string, unknown>;
      expect(Object.keys(module).length, `${specifier} exports something`).toBeGreaterThan(0);
    }
    const pathsModule = (await import(
      pathToFileURL(join(REPO_ROOT, `${GENERATOR_DIR_REL}paths.mjs`)).href
    )) as Record<string, unknown>;
    expect(typeof pathsModule.refuse).toBe('function');
    const headRef = pathsModule.HEAD_REF;
    const outRel = pathsModule.OUT_REL;
    if (typeof headRef !== 'string' || typeof outRel !== 'string') {
      throw new Error('paths.mjs must export HEAD_REF and OUT_REL as strings');
    }
    expect(headRef).toBe(`HEAD:${outRel}`);
    expect(String(pathsModule.ROOT).split('\\')).toHaveLength(1);
    expect(paths.length).toBeGreaterThan(1);
  });
});
