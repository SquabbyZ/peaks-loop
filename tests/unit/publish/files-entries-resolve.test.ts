// tests/unit/publish/files-entries-resolve.test.ts
//
// WHY. Slice E1 moved a PUBLISHED contract — `docs/test-style-contract.md` →
// `.peaks/docs/test-style-contract.md`, and slice F1 moved it once more, to
// `contracts/test-style-contract.md`, so it stops being published from under a
// dot-directory. Nothing went wrong either time, and the ONLY reason
// nothing went wrong is that someone hand-edited `package.json#files` in the
// same commit. Had that edit been missed, the tarball would have shipped one
// file short, SILENTLY: `npm pack` exits 0, the tarball is well-formed, and no
// test, script or CI step reads the `files` array and asks whether its entries
// point at anything. E1's QA proved the hole by mutation — corrupt an entry,
// run the whole suite, get `63 passed`, exit 0, zero red.
//
// That is the shape this repository keeps meeting: a hand-synchronisation with
// no mechanism keeping it synchronised. This file is the mechanism.
//
// WHAT IS ASSERTED. Every entry of `package.json#files` resolves in the
// repository it is published FROM. Entries are classed by the shape the array
// actually carries (read in full before this predicate was written — 24
// entries, four classes), and each class gets its own semantics. The classes
// are NOT "things that exist" and "things that do not"; two of the four are
// exempt, and both exemptions are rules with a stated reason rather than
// carve-outs that make the guard pass:
//
//   1. CONCRETE PATH (`README.md`, `bin/peaks.js`, `LICENSE`,
//      `contracts/test-style-contract.md`, the five `scripts/*.mjs`,
//      `config/eslint/.peaks-rules.cjs`, `CHANGELOG.md`, `README-en.md`,
//      `dist/cli/index.js`). MUST exist. This is the class E1 nearly broke: a
//      tracked file moves, the entry stays, the package loses a file.
//
//   2. GLOB (`dist/**/*.js`, `schemas/*.json`, `skills/**`, `agents/**`, …).
//      Asserted through its LITERAL PREFIX — the path up to the first segment
//      containing `*`, so `skills/**` is asserted as `skills` and
//      `schemas/*.json` as `schemas`. What must survive is the DIRECTORY the
//      glob reaches into; a glob whose directory is gone matches nothing and
//      ships nothing, which is the same silent loss as class 1.
//      Deliberately NOT asserted: that at least one file MATCHES. `skills/**`
//      always has matches, `schemas/*.json` may legitimately be empty, and no
//      rule distinguishes them — so a match-count assertion would be a lie
//      about one of the two. Existence is not used to judge a glob, as
//      required: the glob is judged by the one thing that is true of every
//      glob, which is where it looks.
//
//   3. NEGATION (`!skills/**/test-prompts.json`, `!skills/**/.DS_Store`).
//      NOT asserted, and this is not a loophole — a negation REMOVES something
//      from the tarball. A negation naming a path that does not exist removes
//      nothing, which is a no-op and not a defect; `npm` does not error on it
//      either. Asserting it would report a finding against a correct entry.
//      (Contrast control below pins that it stays silent.)
//
//   4. GENERATED / IGNORED (`dist/**`, `dist/cli/index.js`). NOT asserted,
//      keyed on a RULE rather than a name: the entry is exempt when its literal
//      prefix is matched by the root `.gitignore`. `dist/` is `.gitignore:2`.
//      The reason is the one `repo-citation-integrity.test.ts` already
//      litigates for the same shape — a path git is told never to track is not
//      one the checkout is required to contain. Asserting `dist/**` would make
//      this file fail for every developer who has not run `npm run build` (CI
//      builds before unit tests; a bare `vitest run` does not), i.e. it would
//      report a FALSE RED on a clean tree and get trained away. Those entries
//      are not unguarded, they are guarded at the right moment by
//      `scripts/check-build-integrity.mjs`, which runs as the last step of
//      `npm run build` — after `dist/` exists, which is the only time the
//      question is well-posed.
//
// The `.gitignore` reading here is a PREFIX list, not a full gitignore engine —
// the same bounded reading `repo-citation-integrity.test.ts` uses. The limit is
// stated because it has a direction: a fancier rule (`*.log`) that this cannot
// read would leave an entry unexempt and therefore REPORTED. The failure is a
// loud false red a human then reads, never a silent false green. That is the
// safe direction, and it is the direction this guard must fail in.
//
// `peaks` runs `npm pack` on a tree where this file lives, so the cost of
// getting it wrong in the silent direction is a published package missing a
// file — the exact outcome E1 came within one hand-edit of producing.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The root `.gitignore` as a list of directory/file prefixes. */
function ignorePrefixes(repoRoot: string): string[] {
  const path = join(repoRoot, '.gitignore');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter((line) => line.length > 0);
}

/** Does `rel` name `prefix` itself, or something under it? */
function under(rel: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

/**
 * The path up to the first segment carrying a `*`. `dist/**\/*.js` → `dist`;
 * `schemas/*.json` → `schemas`; `README.md` → `README.md` (no glob at all).
 * A pattern whose FIRST segment is a glob (`*.md`) yields the empty string —
 * it names no directory to check, so there is nothing that can go missing.
 */
function literalPrefix(entry: string): string {
  const segments = entry.split('/');
  const firstGlob = segments.findIndex((segment) => segment.includes('*'));
  return (firstGlob === -1 ? segments : segments.slice(0, firstGlob)).join('/');
}

/**
 * Every entry of `entries` that does not resolve against `repoRoot`, rendered
 * as the line a reader needs. Empty array means the array is coherent.
 *
 * Exported so the injection cases below drive the SAME predicate the real
 * `package.json` is judged by — a guard whose failing path is a separate
 * implementation from its passing path has not been tested at all.
 */
export function findUnresolvableEntries(entries: readonly string[], repoRoot: string): string[] {
  const prefixes = ignorePrefixes(repoRoot);
  const findings: string[] = [];

  for (const entry of entries) {
    // class 3 — a negation removes; removing nothing is a no-op, not a defect
    if (entry.startsWith('!')) continue;

    const prefix = literalPrefix(entry);
    // a pattern with no literal directory (see `literalPrefix`) — nothing to check
    if (prefix === '') continue;

    // class 4 — generated output git is told never to track
    if (under(prefix, prefixes)) continue;

    const isGlob = entry.includes('*');
    const target = isGlob ? prefix : entry;
    if (existsSync(join(repoRoot, target))) continue;

    findings.push(
      isGlob
        ? `files entry ${JSON.stringify(entry)} (glob) — its directory ${JSON.stringify(prefix)} does not exist`
        : `files entry ${JSON.stringify(entry)} (concrete path) does not exist`,
    );
  }

  return findings;
}

const realFiles = (): string[] =>
  (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { files: string[] }).files;

describe('Scenario: behavior — the checker can fail, and clears what it should', () => {
  it('when a concrete entry names a file that is gone, should report it', () => {
    // given: the shape E1 nearly shipped — a tracked file moved, its entry left behind
    const entries = ['README.md', 'docs/test-style-contract.md'];

    // when: the entries are resolved
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: the stale one is named, and only it
    expect(findings).toEqual(['files entry "docs/test-style-contract.md" (concrete path) does not exist']);
  });

  it('when a glob reaches into a directory that is gone, should report it', () => {
    // given: a glob whose literal prefix does not exist
    const entries = ['gone-dir/**', 'schemas/*.json'];

    // when: the entries are resolved
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: only the dead glob is reported, and it names the directory, not a match count
    expect(findings).toEqual([
      'files entry "gone-dir/**" (glob) — its directory "gone-dir" does not exist',
    ]);
  });

  it('when a glob reaches into a directory that exists, should report nothing — control', () => {
    // given: real glob entries from the shipped array, whose directories are present
    const entries = ['skills/**', 'agents/**', 'output-styles/**', 'schemas/*.json'];

    // when: the entries are resolved
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: silence. A predicate that judged these by "the file exists" would
    //       report every one of them, forever — the false red that gets a
    //       guard ignored
    expect(findings).toEqual([]);
  });

  it('when a negation names something that does not exist, should report nothing — control', () => {
    // given: negations, including one naming a path that is definitely absent
    const entries = ['!skills/**/test-prompts.json', '!skills/**/.DS_Store', '!skills/**/not-here.json'];

    // when: the entries are resolved
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: silence. A negation subtracts; subtracting nothing is not a defect
    expect(findings).toEqual([]);
  });

  it('when an entry is generated output that is absent, should report nothing — control', () => {
    // given: `dist/` is gitignored, so a clean checkout has none of it — and a
    //        path that is absent for THAT reason must not be reported
    const entries = ['dist/**/*.js', 'dist/cli/index.js', 'dist/never-built/index.js'];

    // when: the entries are resolved
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: silence — the exemption is keyed on the gitignore rule, and the
    //       third entry is the control for it: it is absent AND ignored, and
    //       stays silent for the first reason, not the second
    expect(findings).toEqual([]);
  });

  it('when the exemption is not available, should still report the same absent path', () => {
    // given: the SAME absent path as the control above, minus the gitignored
    //        prefix — so the only difference between red and green here is the
    //        rule, not the absence. This is what stops the exemption above
    //        from being a blanket "absent paths are fine"
    const entries = ['dist/never-built/index.js', 'src/never-built/index.js'];

    // when: the entries are resolved
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: the unignored one is reported and the ignored one is not
    expect(findings).toEqual([
      'files entry "src/never-built/index.js" (concrete path) does not exist',
    ]);
  });

  it('when good and bad entries are mixed, should report the bad ones and only those', () => {
    // given: a list where all four classes appear at once — this is the case
    //        that would go red if any exemption leaked past its class boundary
    const entries = [
      'README.md', //                        concrete, exists
      'LICENSE', //                          concrete, exists
      'skills/**', //                        glob, directory exists
      '!skills/**/test-prompts.json', //     negation
      'dist/**/*.js', //                     generated, ignored
      'docs/gone.md', //                     concrete, absent  -> reported
      'gone-dir/**', //                      glob, absent      -> reported
    ];

    // when: the entries are resolved
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: exactly the two dead entries, in array order
    expect(findings).toEqual([
      'files entry "docs/gone.md" (concrete path) does not exist',
      'files entry "gone-dir/**" (glob) — its directory "gone-dir" does not exist',
    ]);
  });
});

describe('Scenario: integration — the real `package.json#files` resolves on the real tree', () => {
  it('when the shipped files array is read, should name only paths that exist', () => {
    // given: the real array, read off the real manifest
    const entries = realFiles();

    // when: every entry is resolved against the repository it is published from
    const findings = findUnresolvableEntries(entries, projectRoot);

    // then: nothing is stale. Slice E1 hand-edited this array; this is the
    //       assertion that would have caught it being hand-edited WRONG, and
    //       the one that catches the next move
    expect(findings, `unresolvable files entries:\n${findings.join('\n')}`).toEqual([]);
  });

  it('when the array is read, should be the array this guard was written against', () => {
    // given: the real array
    // when: it is inspected
    const entries = realFiles();

    // then: it carries all four classes, so the class handling above is not
    //       dead code written for a shape the array no longer has. If a future
    //       edit removes the last negation or the last glob, this goes red and
    //       says the predicate has classes it is no longer exercising — which
    //       is a thing a reader should be told, not left to infer
    expect(entries.some((e) => e.startsWith('!'))).toBe(true);
    expect(entries.some((e) => e.includes('*') && !e.startsWith('!'))).toBe(true);
    expect(entries.some((e) => !e.includes('*') && !e.startsWith('!'))).toBe(true);
    expect(entries).toContain('contracts/test-style-contract.md');
  });
});
