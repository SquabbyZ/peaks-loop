/**
 * The existence probe's two directions, pinned.
 *
 * `dead-reference` is the category that can delete a real file reference by
 * accident, so both failure modes matter: an ignored runtime path must NOT be
 * reported (that is the false positive that made the first run useless — 33 hits
 * on `.claude/settings.local.json` alone), and a genuinely missing source file
 * MUST be. The third case pins the limit rather than hiding it: a `.gitignore`
 * rule this bounded reader cannot parse leaves the path reported, because a
 * finding a human dismisses in two seconds is cheaper than an exemption that
 * quietly silences real debt.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFsProbe,
  createRepoProbe,
  isIgnoredPath
} from '~/src/services/comments/repo-path-probe';

let root = '';
const RULES = {
  prefixes: ['src/generated/'],
  exact: new Set(['a/generated-thing.json']),
  basenames: new Set(['secret.json'])
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-probe-'));
  mkdirSync(join(root, 'src', 'services'), { recursive: true });
  writeFileSync(join(root, 'src', 'services', 'real.ts'), 'export const a = 1;\n');
  // The directory the widened-vs-strict case is about: it must be a real directory,
  // or `strict('node_modules')` is false for the wrong reason (never created) and
  // the case stops distinguishing the two probes at all.
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(
    join(root, '.gitignore'),
    [
      '# a comment',
      '.peaks/_runtime/',
      '.claude/settings.local.json',
      'secret.json',
      '!keep/this-one.txt',
      'node_modules'
    ].join('\n')
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createRepoProbe', () => {
  // Built lazily: `root` only exists once `beforeAll` has run, and a probe
  // constructed at collection time would read the ignore file from '' and answer
  // "no" to everything — a failure that looks like a broken probe, not a
  // mis-ordered test.
  const probe = (relPath: string): boolean => createRepoProbe(root)(relPath);

  it('says yes to a file that is there', () => {
    expect(probe('src/services/real.ts')).toBe(true);
  });

  it('says yes to generated state git never tracks', () => {
    expect(probe('.peaks/_runtime/session.json')).toBe(true);
    expect(probe('.claude/settings.local.json')).toBe(true);
    expect(probe('src/whatever/secret.json')).toBe(true);
  });

  it('says no to a source file that is simply gone', () => {
    expect(probe('src/services/deleted-and-not-ignored.ts')).toBe(false);
  });

  it('ignores negation rules rather than pretending to parse them', () => {
    // `.gitignore:4` is `!keep/this-one.txt`; the bounded reader skips it, so this
    // path is treated as NOT ignored. Stated because the safe direction here is a
    // reported finding, not a silent exemption.
    expect(probe('keep/this-one.txt')).toBe(false);
  });

  it('does not let an ignore rule answer the installed-package question', () => {
    // The bug this pins: `node_modules` is in `.gitignore`, so probing "is
    // `node_modules/<head>` there?" through the ignore-widened probe answers YES
    // for every first segment. Every citation then reads as a module specifier and
    // the dead-reference count falls to zero — a guard reporting clean because it
    // stopped being able to see. Measured at 344 findings before this line existed.
    const widened = createRepoProbe(root);
    const strict = createFsProbe(root);
    expect(widened('node_modules/anything-at-all')).toBe(true);
    expect(strict('node_modules/anything-at-all')).toBe(false);
    expect(strict('node_modules')).toBe(true);
  });
});

describe('isIgnoredPath', () => {
  it('matches a directory rule for everything below it', () => {
    expect(isIgnoredPath('src/generated/x.ts', RULES)).toBe(true);
    expect(isIgnoredPath('src/services/x.ts', RULES)).toBe(false);
  });

  it('matches a single-file rule on the exact path, not only on a prefix', () => {
    // `.claude/settings.local.json` has no trailing slash: reading it as a
    // directory prefix alone failed every single-file ignore in the repository.
    expect(isIgnoredPath('a/generated-thing.json', RULES)).toBe(true);
    expect(isIgnoredPath('nested/a/generated-thing.json', RULES)).toBe(false);
  });

  it('matches a basename rule on any segment', () => {
    expect(isIgnoredPath('a/b/secret.json', RULES)).toBe(true);
    expect(isIgnoredPath('a/b/other.json', RULES)).toBe(false);
  });
});
