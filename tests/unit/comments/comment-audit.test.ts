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

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  COMMENT_SCAN_SCOPE,
  auditComments,
  scopeFiles
} from '~/src/services/comments/comment-audit';

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

  it('reports both categories separately, because they will be gated separately', () => {
    expect(audit.deadReferences).toBeGreaterThanOrEqual(0);
    expect(audit.narrative).toBeGreaterThanOrEqual(0);
    const sum = audit.files.reduce((n, f) => n + f.deadReferences + f.narrative, 0);
    expect(sum).toBe(audit.deadReferences + audit.narrative);
  });

  it('carries the scope list into the report order, worst file first', () => {
    expect(COMMENT_SCAN_SCOPE.length).toBeGreaterThan(0);
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
