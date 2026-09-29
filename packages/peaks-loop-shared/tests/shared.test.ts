// packages/peaks-loop-shared/tests/shared.test.ts
//
// 4-dimension unit test for peaks-loop-shared's OWN modules: fs, paths,
// result, version, and the index barrel.
//
// Why this file exists: `pnpm -r --filter ./packages/* run test` printed
// "No test files found, exiting with code 0" for this package on 2026-09-29,
// while the package publishes 5 source files to npm. Its root mirror test was
// deleted as redundant in 08e92d8f and nothing replaced it, so a published
// package reported a green it never earned. Same rule the lint gate already
// names for lint: an untested file is not a clean file
// (.peaks/docs/lint-gate.md, the `notLinted` ceiling).
//
// Coverage split with the root suite — fs / paths / the index barrel had NO
// test anywhere since 08e92d8f, result is pinned by the root 4-dim sample,
// version lockstep by a root publish test. This file asserts the gaps, not
// the overlaps; the module-by-module matrix is in the a2 artifact.
//
// `declareDimensions` is inlined here for the same reason as
// peaks-loop-mut/tests/thresholds.test.ts — the root helper lives behind the
// '~' vitest alias (main package only) and this package's vitest config does
// not inherit it. The 5-line duplication is intentional.
//
// Dimensions covered:
//   - render:      paths catalog + dir constants; index barrel surface
//   - behavior:    the envelope gaps the root sample leaves open (absent
//                  failure keys, fail() list defaults, uuid-v4 shape),
//                  CLI_VERSION semver shape
//   - integration: the four fs helpers against a real tmp directory
//   - a11y:        redactSensitiveErrorMessage — the user-visible text of a
//                  failure message
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
  'packages/peaks-loop-shared/tests/shared.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

import * as fsModule from '../src/fs.js';
import * as indexPath from '../src/index.js';
import * as pathsModule from '../src/paths.js';
import * as resultModule from '../src/result.js';
import * as versionModule from '../src/version.js';
import { isDirectory, listDirectories, pathExists, readText } from '../src/fs.js';
import {
  repoRoot,
  requiredSchemaFiles,
  requiredSkillNames,
  schemasDir,
  skillsDir,
  templatesDir
} from '../src/paths.js';
import { fail, ok, redactSensitiveErrorMessage } from '../src/result.js';
import { CLI_VERSION } from '../src/version.js';

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

describe('behavior — result envelope', () => {
  // Only the GAPS are asserted here. What the root suite already pins is
  // deliberately not re-mirrored (erratum #2): the ok()/fail() envelope
  // shapes, the fresh-errorId-per-call property, the three getErrorMessage
  // input classes, and fail() redacting before the envelope is built are all
  // covered by tests/unit/_samples/sample-4dim-module.test.ts; the
  // CLI_VERSION / root-package.json lockstep by
  // tests/unit/publish/lockstep-three-packages.test.ts.
  it('when ok() builds an envelope, should leave the failure fields absent rather than present-and-undefined', () => {
    // given: a success envelope — it has no code, no message, no errorId
    // when:  the three keys are probed with `in`
    // then:  none of them exists. The repo compiles with
    //        exactOptionalPropertyTypes, so a present key holding undefined is
    //        a different (and consumer-breaking) shape than an absent one.
    const env = ok('cmd', { a: 1 });
    expect('errorId' in env).toBe(false);
    expect('code' in env).toBe(false);
    expect('message' in env).toBe(false);
  });

  it('when fail() is called without nextActions, should default both list fields to empty arrays', () => {
    // given: the 4-argument fail() call, the shape most src/ call sites use
    // when:  the failure envelope is read back
    // then:  warnings and nextActions are real empty arrays, not undefined —
    //        a consumer that maps over them must not have to null-check
    const env = fail('cmd', 'E', 'boom', null);
    expect(env.warnings).toEqual([]);
    expect(env.nextActions).toEqual([]);
  });

  it('when fail() mints an errorId, should be a uuid v4 (version + variant nibbles in place)', () => {
    // given: the correlation-id contract (audit-4th #B3)
    // when:  the id is matched beyond the 36-character shape the sample checks
    // then:  the version nibble is 4 and the variant nibble is 8..b; a v1/v7
    //        uuid or a hand-rolled 36-char id passes /[0-9a-f-]{36}/ and this
    expect(fail('cmd', 'E', 'boom', null).errorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe('behavior — version contract', () => {
  // Checked against the writer: src/version.ts is GENERATED by
  // scripts/sync-version.mjs (pretest / build / prepack / prepublish) as
  // `export const CLI_VERSION = '<root package.json version>';`. The lockstep
  // itself is already gated by
  // tests/unit/publish/lockstep-three-packages.test.ts and is NOT mirrored
  // here; what nothing pinned is that the emitted literal is a version the
  // npm registry accepts at all.
  it('when the generated constant is read, should be a semver-shaped string', () => {
    // given: CLI_VERSION as emitted by the sync script
    // when:  it is matched against semver, optional prerelease tag included
    // then:  it is a version a registry would accept (08e92d8f left this
    //        unpinned on the package's own leg)
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
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

describe('a11y — redactSensitiveErrorMessage', () => {
  it('when the message carries a bearer token, a private-key header, or a key=value secret, should replace each with [redacted]', () => {
    // given: three credential shapes a real failure message can carry
    // when:  redactSensitiveErrorMessage() runs the pattern list over them
    // then:  no credential material survives in the returned text
    expect(redactSensitiveErrorMessage('Authorization: Bearer abcdefghijklmnop1234')).toBe(
      'Authorization: [redacted]'
    );
    expect(redactSensitiveErrorMessage('cannot parse -----BEGIN RSA PRIVATE KEY----- block')).toBe(
      'cannot parse [redacted] block'
    );
    expect(redactSensitiveErrorMessage('password: hunter2hunter2 rejected')).toBe(
      '[redacted] rejected'
    );
  });

  it('when the message carries a provider-shaped key (aws / github / openai), should replace it with [redacted]', () => {
    // given: three provider key formats, matched by their own pattern
    // when:  the redactor runs
    // then:  each comes back as [redacted] only
    expect(redactSensitiveErrorMessage('aws id AKIAIOSFODNN7EXAMPLE')).toBe('aws id [redacted]');
    expect(redactSensitiveErrorMessage(`ghp_${'a'.repeat(20)}`)).toBe('[redacted]');
    expect(redactSensitiveErrorMessage(`sk-${'B'.repeat(16)}`)).toBe('[redacted]');
  });

  it('when the message only mentions a sensitive word in prose, should still redact the word', () => {
    // given: the last pattern in the list is a bare-keyword catch-all
    // when:  a message contains 'token' / 'password' with no credential at all
    // then:  the word itself is replaced — deliberate over-redaction, pinned so a
    //        future loosening of the list is a visible decision, not an accident
    expect(redactSensitiveErrorMessage('the token was rotated')).toBe('the [redacted] was rotated');
    expect(redactSensitiveErrorMessage('no secrets here')).toBe('no [redacted]s here');
  });

  it('when the message holds no credential shape, should return it unchanged', () => {
    // given: an ordinary failure line
    // when:  the redactor runs
    // then:  the text is byte-identical (the gate must not mangle normal output)
    expect(redactSensitiveErrorMessage('ENOENT: no such file or directory')).toBe(
      'ENOENT: no such file or directory'
    );
  });
});

describe('render — index barrel', () => {
  it('when the package entry point is imported, should expose the documented public surface', () => {
    // given: index.ts is a pure re-export barrel over the four modules
    // when:  its runtime exports are listed
    // then:  they are exactly the 15 documented names, no more, no fewer
    expect(Object.keys(indexPath).sort()).toEqual([
      'CLI_VERSION',
      'fail',
      'getErrorMessage',
      'isDirectory',
      'listDirectories',
      'ok',
      'pathExists',
      'readText',
      'redactSensitiveErrorMessage',
      'repoRoot',
      'requiredSchemaFiles',
      'requiredSkillNames',
      'schemasDir',
      'skillsDir',
      'templatesDir'
    ]);
  });

  it('when the barrel is compared with the modules it re-exports, should drop nothing and add nothing', () => {
    // given: the four submodules imported directly
    // when:  the union of their runtime exports is compared with the barrel's
    // then:  the two sets are identical — the barrel is re-export only
    const fromModules = [
      ...Object.keys(fsModule),
      ...Object.keys(pathsModule),
      ...Object.keys(resultModule),
      ...Object.keys(versionModule)
    ].sort();
    expect(Object.keys(indexPath).sort()).toEqual(fromModules);
  });
});
