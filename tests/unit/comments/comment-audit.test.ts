/**
 * The audit's own invariants, pinned against this repository.
 *
 * The paths-as-relative case is not hypothetical: the first version of
 * `scopeFiles` stripped the project prefix by string replacement, which on a
 * Windows host produced absolute `C:/…` entries. Those then fed
 * `citationResolves` a `dirname()` that matched nothing, so every sibling
 * reference in the repository reported as a missing file and the dead-reference
 * count came out roughly four times too high. A scan whose file keys are wrong is
 * wrong in the direction that makes it look like there is more debt, which is the
 * direction that gets a new gate deleted.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditComments, commentScanScope, scopeFiles } from '~/src/services/comments/comment-audit';

const ROOT = resolve(__dirname, '..', '..', '..');

describe('scopeFiles', () => {
  it('returns repo-relative POSIX paths, never an absolute one', () => {
    const files = scopeFiles(ROOT, 'src');
    expect(files.length).toBeGreaterThan(100);
    for (const file of files.slice(0, 25)) {
      expect(file.startsWith('/')).toBe(false);
      expect(/^[A-Za-z]:/.test(file)).toBe(false);
      expect(file.includes('\\')).toBe(false);
      expect(file.startsWith('src/')).toBe(true);
    }
  });

  it('resolves a sibling citation from the citing file directory, not the root', () => {
    // `citation-parity.test.ts` cites `tests/unit/comments/…`; a document-relative
    // reading is what makes such a reference legal, and it only works when the
    // file key handed to the resolver is repo-relative.
    const audit = auditComments({ projectRoot: ROOT, kind: 'dead-reference', limit: 0 });
    expect(audit.files.every((file) => !/^[A-Za-z]:/.test(file.file))).toBe(true);
  });
});

describe('auditComments against this repository', () => {
  const audit = auditComments({ projectRoot: ROOT, limit: 0 });

  it('scans the declared product scope and nothing else', () => {
    expect(audit.scannedFiles).toBeGreaterThan(500);
    const prefixes = new Set(audit.files.map((f) => f.file.split('/')[0] as string));
    for (const top of prefixes) {
      expect(['src', 'packages']).toContain(top);
    }
  });

  it('reads the same population the ratchet measures the row over', () => {
    // The gate's comment legs are handed `git ls-files` filtered by
    // `.husky/lint-scope.mjs` (`src/** + packages/*/src/**`) and record that scope in the
    // artifact. The audit used to walk `src` plus ONE named package — a second, narrower
    // spelling of the same rule — so 14 narrative rows sat inside the gated ceiling and
    // outside anything `peaks comments audit` would show or `prune` could clear. A row a
    // tool cannot reach is a row nobody is handed the means to reduce, and the file whose
    // header says the scope follows `.husky/lint-scope.mjs` "rather than a second
    // definition of product code written here" was itself that second definition.
    //
    // Asserted in ONE direction, on the RULE rather than a count: the artifact names only
    // directories with TRACKED files, while this walk reads the disk, so an untracked
    // scratch file legitimately puts a directory on the tool's side that is not yet on the
    // gate's. The reachability claim is the one that must not regress.
    const artifact = JSON.parse(
      readFileSync(join(ROOT, '.peaks', 'lint', 'gate-baseline.json'), 'utf8')
    ) as { scope: { dirs: string[]; rule: string; silentWarning?: { scannedFiles?: number } } };
    const walked = commentScanScope(ROOT).map((dir) => dir.replace(/\\/g, '/'));
    expect(artifact.scope.dirs.length, 'the artifact must name the enforced scope').toBeGreaterThan(
      1
    );
    for (const dir of artifact.scope.dirs) {
      expect(walked, `${dir} is gated but not audited`).toContain(dir);
    }
    const perDir = artifact.scope.dirs.map((dir) => `${dir}=${scopeFiles(ROOT, dir).length}`);
    expect(
      audit.scannedFiles,
      `the walk reads: ${perDir.join(' ')} (artifact records ${artifact.scope.silentWarning?.scannedFiles} gated files for ${artifact.scope.rule})`
    ).toBeGreaterThanOrEqual(artifact.scope.silentWarning?.scannedFiles ?? 0);
  });

  it('reports both categories separately, because they will be gated separately', () => {
    expect(audit.deadReferences).toBeGreaterThanOrEqual(0);
    expect(audit.narrative).toBeGreaterThanOrEqual(0);
    const sum = audit.files.reduce((n, f) => n + f.deadReferences + f.narrative, 0);
    expect(sum).toBe(audit.deadReferences + audit.narrative);
  });

  it('carries the scope list into the report order, worst file first', () => {
    expect(commentScanScope(ROOT).length).toBeGreaterThan(1);
    const counts = audit.files.map((f) => f.deadReferences + f.narrative);
    const sorted = [...counts].sort((a, b) => b - a);
    expect(counts).toEqual(sorted);
  });
});

describe('an explicit population, which is what a ratchet row is measured over', () => {
  const files = scopeFiles(ROOT, 'src').slice(0, 40);

  it('counts the files it was handed, and nothing else', () => {
    const audit = auditComments({ projectRoot: ROOT, files, limit: 0 });
    expect(audit.askedFiles).toBe(40);
    expect(audit.scannedFiles).toBe(40);
    // A subset can never carry more debt than the whole, and the row that ratchets
    // is the whole — this is the assertion that fails if a handed list is ignored
    // and the walk runs anyway.
    expect(audit.narrative).toBeLessThanOrEqual(auditComments({ projectRoot: ROOT }).narrative);
  });

  it('separates scanned from asked when a named file is not on disk', () => {
    // `git ls-files` is the population, and the disk can disagree with it. A leg that
    // read 39 of 40 files must not report a count over 40, and it must not report 0;
    // the two numbers being different is the refusal.
    const audit = auditComments({
      projectRoot: ROOT,
      files: [...files, 'src/services/comments/never-written-here.ts'],
      limit: 0
    });
    expect(audit.askedFiles).toBe(41);
    expect(audit.scannedFiles).toBe(40);
  });
});
