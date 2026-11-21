// tests/unit/ide/safe-path-guard.test.ts
//
// The settings-path safety primitives in
// `src/services/ide/shared/safe-path.ts`:
//
//   - `isInsidePath`            — the containment predicate
//   - `assertSafeSettingsFile`  — the throwing, path-building guard the hook /
//                                 statusline install paths call
//   - `isLinkedSettingsFile`    — the boolean the threshold writers ask before
//                                 they write
//
// WHY THIS FILE EXISTS. `isLinkedSettingsFile` is re-exported by BOTH
// `harness-window-config.ts` and `harness-settings-file.ts`, so every write in
// this slice depends on it — and until this suite nothing exercised the module
// it lives in. A guard whose only test is "the caller refused" cannot show that
// it refuses for the right reason, or that it returns `true` rather than a
// truthy accident.
//
// THE DEFECT IT PINS. `writeFileSync`'s `'w'` flag follows a link, so a linked
// settings file (or a linked directory holding an ordinary one) redirects a
// write into an arbitrary file outside the project. `lstat`, never `stat`, is
// what sees it; and an ABSENT path is NOT a link — it is the ordinary first
// write, which must still happen.
//
// Dimensions covered:
//   - render:      the returned path object and the thrown message text
//   - behavior:    each predicate's truth table, including the absent sides
//   - integration: real fs — real junctions/symlinks, real `realpath`
//   - a11y:        the thrown sentences, which are what an operator reads when
//                  the install refuses

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  assertSafeSettingsFile,
  isInsidePath,
  isLinkedSettingsFile
} from '~/src/services/ide/shared/safe-path';

declareDimensions('tests/unit/ide/safe-path-guard.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const DIR = '.claude';
const FILE = 'settings.local.json';

describe('safe-path — isInsidePath', () => {
  it('when the child IS the parent, should be inside', () => {
    // given: the same path on both sides
    // when: containment is asked
    // then: true — a root contains itself, which is what makes the identity
    //       case a containment rather than an escape
    expect(isInsidePath('/a/b', '/a/b')).toBe(true);
  });

  it('when the child is nested under the parent, should be inside', () => {
    // given: a path one level below the parent
    // when: containment is asked
    // then: true, and a deeper one is too — the predicate is not depth-limited
    expect(isInsidePath(join('/a/b', 'c'), '/a/b')).toBe(true);
    expect(isInsidePath(join('/a/b', 'c', 'd', 'e'), '/a/b')).toBe(true);
  });

  it('when the child steps OUT of the parent, should not be inside', () => {
    // given: a `..` path and an absolute path that leave the parent. `../c`
    //        is the case that separates "starts with .." from "ENDS with .." —
    //        the two are only equal for the bare parent, so a predicate built
    //        from the wrong one still answers the bare parent correctly.
    // when: containment is asked
    // then: false for both — an escape is not a nested path
    expect(isInsidePath(join('/a/b', '..', 'c'), '/a/b')).toBe(false);
    expect(isInsidePath('/a/b', '/a/b/..')).toBe(true);
    expect(isInsidePath('/etc/passwd', '/a/b')).toBe(false);
  });

  it('when the child shares a name PREFIX with the parent, should not be inside', () => {
    // given: `/a/bc` beside `/a/b` — string prefix, not path prefix
    // when: containment is asked
    // then: false. A `startsWith` on the raw strings would call this a child
    //       and hand a caller the sibling directory.
    expect(isInsidePath('/a/bc', '/a/b')).toBe(false);
    expect(isInsidePath('/a/b-c', '/a/b')).toBe(false);
  });
});

describe('safe-path — isLinkedSettingsFile', () => {
  let root = '';
  let settingsPath = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-safe-path-'));
    settingsPath = join(root, DIR, FILE);
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('when neither the file nor its directory exists, should answer exactly false', () => {
    // given: the ordinary first write — nothing on disk at all
    // when: the link question is asked
    // then: `false`, STRICTLY. `lstat` throws ENOENT here, so this is the arm
    //       that exercises the catch; a body that did not `return false` would
    //       leave `undefined`, which is falsy and would let a `if (isLinked…)`
    //       caller write — but is not the boolean this function promises.
    expect(isLinkedSettingsFile(settingsPath)).toBe(false);
  });

  it('when both exist and are ordinary, should answer false', () => {
    // given: a real directory holding a real file
    // when: the link question is asked
    // then: false — the ordinary case must not be refused
    mkdirSync(join(root, DIR), { recursive: true });
    writeFileSync(settingsPath, '{}\n', 'utf8');
    expect(isLinkedSettingsFile(settingsPath)).toBe(false);
  });

  it('when the FILE is a link, should answer true', () => {
    // given: `settings.local.json` points at a file outside the project
    // when: the link question is asked
    // then: true — `> settingsPath` would follow it into the victim
    const victim = join(root, 'victim.json');
    writeFileSync(victim, '{}\n', 'utf8');
    mkdirSync(join(root, DIR), { recursive: true });
    linkOrJunction(victim, settingsPath);
    expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
    expect(isLinkedSettingsFile(settingsPath)).toBe(true);
  });

  it('when the DIRECTORY is a link over an ordinary file, should answer true', () => {
    // given: `.claude` is a junction to a directory holding an ordinary file.
    //        The FILE check cannot see this — the file under the link is
    //        ordinary — which is exactly why the directory is asked too.
    // when: the link question is asked
    // then: true
    const victimDir = join(root, 'victim-dir');
    mkdirSync(victimDir);
    writeFileSync(join(victimDir, FILE), '{}\n', 'utf8');
    mkdirSync(root, { recursive: true });
    try {
      symlinkSync(victimDir, join(root, DIR), 'junction');
    } catch {
      symlinkSync(victimDir, join(root, DIR), 'dir');
    }
    expect(lstatSync(join(root, DIR)).isSymbolicLink()).toBe(true);
    expect(lstatSync(settingsPath).isSymbolicLink()).toBe(false);
    expect(isLinkedSettingsFile(settingsPath)).toBe(true);
  });
});

describe('safe-path — assertSafeSettingsFile', () => {
  let root = '';
  let dirPath = '';
  let settingsPath = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-assert-safe-'));
    dirPath = join(root, DIR);
    settingsPath = join(dirPath, FILE);
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('when nothing is on disk yet, should return the path it would write', () => {
    // given: a fresh project with no `.claude` directory
    // when: the install guard runs
    // then: the joined path, and no throw — the absent case is the ordinary
    //       first install, not a refusal
    expect(assertSafeSettingsFile('project', root, DIR, FILE)).toEqual({ settingsPath });
  });

  it('when `.claude` is a real directory holding a real file, should return the path', () => {
    // given: an ordinary settings file inside the root
    // when: the install guard runs
    // then: the path, no throw — the CONTROL for the refusals below, so they
    //       are not a guard that rejects everything
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(settingsPath, '{}\n', 'utf8');
    expect(assertSafeSettingsFile('project', root, DIR, FILE)).toEqual({ settingsPath });
  });

  it('when the DIRECTORY is a link, should throw and name the directory', () => {
    // given: `.claude` is a junction to a directory outside the root
    // when: the install guard runs
    // then: it throws, and the message names the DIRECTORY — a file-level
    //       message here would point the operator at the wrong object
    const victimDir = join(root, 'victim-dir');
    mkdirSync(victimDir);
    try {
      symlinkSync(victimDir, dirPath, 'junction');
    } catch {
      symlinkSync(victimDir, dirPath, 'dir');
    }
    expect(lstatSync(dirPath).isSymbolicLink()).toBe(true);
    expect(() => assertSafeSettingsFile('project', root, DIR, FILE)).toThrow(
      `${DIR} directory must not be a symlink`
    );
  });

  it('when the FILE is a link, should throw and name the file', () => {
    // given: `.claude` is ordinary, `settings.local.json` inside it is a link
    // when: the install guard runs
    // then: it throws, naming the FILE — the directory check already passed, so
    //       this is the second, independent question
    const victim = join(root, 'victim.json');
    writeFileSync(victim, '{}\n', 'utf8');
    mkdirSync(dirPath, { recursive: true });
    linkOrJunction(victim, settingsPath);
    expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
    expect(() => assertSafeSettingsFile('project', root, DIR, FILE)).toThrow(
      `${FILE} must not be a symlink`
    );
  });
});

/** A file symlink, or the junction fallback where symlinks need privileges. */
function linkOrJunction(target: string, linkPath: string): void {
  try {
    symlinkSync(target, linkPath, 'file');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') throw error;
    symlinkSync(target, linkPath, 'junction');
  }
}
