// packages/peaks-loop-shared/tests/result-version.test.ts
//
// Result-envelope and package-surface subjects of peaks-loop-shared's own
// modules: the result behavior gaps, the version contract, the redaction of
// user-visible failure text, and the index barrel's public surface.
//
// Split off tests/shared.test.ts on 2026-09-29 (strict-remediation-abc,
// slice b1-filesplit-campaign): that file had grown to 335 raw lines, over
// the 300-raw-line cap .peaks/docs/lint-gate.md §4 row 5 sets for files
// under src/ and packages/. The split is by subject — this file keeps the
// result/version/redaction and index-barrel cases; tests/paths-fs.test.ts
// keeps the paths and fs-integration cases. All 19 original cases survive
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
//   - render:   index barrel surface
//   - behavior: the envelope gaps the root sample leaves open (absent
//               failure keys, fail() list defaults, uuid-v4 shape),
//               CLI_VERSION semver shape
//   - a11y:     redactSensitiveErrorMessage — the user-visible text of a
//               failure message
//   - integration: carried by tests/paths-fs.test.ts, declared as omitted
//     below
//
// Run with: pnpm -F peaks-loop-shared test

import { describe, expect, it } from 'vitest';

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
  'packages/peaks-loop-shared/tests/result-version.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'the fs-helper integration cases live in tests/paths-fs.test.ts'
    }
  ]
);

import * as fsModule from '../src/fs.js';
import * as indexPath from '../src/index.js';
import * as pathsModule from '../src/paths.js';
import * as resultModule from '../src/result.js';
import * as versionModule from '../src/version.js';
import { fail, ok, redactSensitiveErrorMessage } from '../src/result.js';
import { CLI_VERSION } from '../src/version.js';

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
