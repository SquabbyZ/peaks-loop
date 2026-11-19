// tests/unit/shared/path-safety.test.ts
//
// rid-mut-baseline-80 — the mutation-target test for `src/shared/path-safety.ts`.
//
// WHY THIS FILE EXISTS AT ALL. The mutation baseline had no dedicated coverage
// for this module: `isUnsafePathInput` / `isUnsafeArtifactPath` /
// `isPathInsideArtifactRoot` were exercised only incidentally, through
// `get-session-dir.test.ts`, which reaches the happy paths and none of the guard
// branches. Measured 2026-11-19 under `--coverageAnalysis off`: 56.5% of this
// file's mutants were killed, and every survivor sat on a guard clause that no
// test ever entered.
//
// WHY IT TAKES NO WORKSPACE. Stryker's vitest-runner pins `pool: 'threads'`
// (`vitest-test-runner.js`), and `process.chdir()` throws in a worker. So a test
// that reaches for `withTmpWorkspacePerTest` cannot be a mutation target. Every
// assertion below is a pure call on a pure function — no tmp dir, no cwd, no
// filesystem — which is both why it is sandbox-safe and why the guards can be
// pinned one branch at a time.
//
// WHY THE ASSERTIONS LOOK REDUNDANT. They are not: each `it` names ONE guard in
// `hasUnsafePathShape`, and the mutation report says which branch survived when
// only some clauses were asserted. A single `expect(isUnsafePathInput(x)).toBe(true)`
// over a table would kill the early-return mutants but leave every later clause's
// negation unpinned, because the first clause already answered `true`.

import { describe, expect, it } from 'vitest';
import {
  isPathInsideArtifactRoot,
  isUnsafeArtifactPath,
  isUnsafePathInput,
  _normalizeArtifactPath
} from '../../../src/shared/path-safety.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/shared/path-safety.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

describe('Scenario: (behavior) — a path is unsafe exactly when it is absolute or escapes its root', () => {
  it('when the input carries a backslash, should be unsafe regardless of the rest', () => {
    // given: a relative-looking path written with a Windows separator
    // when:  the shape guard runs
    // then:  the backslash clause alone marks it unsafe
    expect(isUnsafePathInput('a\\b')).toBe(true);
    expect(isUnsafePathInput('src\\cli\\index.ts')).toBe(true);
    // The clause fires BEFORE normalization, so a backslash that normalization
    // would have folded away still counts.
    expect(isUnsafePathInput('already/posix\\mixed')).toBe(true);
  });

  it('when the input is empty, dot, or dot-dot, should be unsafe', () => {
    // given: the three degenerate values a caller passes by accident
    // when:  the shape guard runs
    // then:  each is refused rather than resolved against an unintended root
    expect(isUnsafePathInput('')).toBe(true);
    expect(isUnsafePathInput('.')).toBe(true);
    expect(isUnsafePathInput('..')).toBe(true);
  });

  it('when the input is rooted, should be unsafe', () => {
    // given: POSIX-absolute and UNC-style spellings
    // when:  the shape guard runs
    // then:  both are refused — a rooted path names a location the caller did not choose
    expect(isUnsafePathInput('/etc/passwd')).toBe(true);
    expect(isUnsafePathInput('//server/share')).toBe(true);
    expect(isUnsafePathInput('/')).toBe(true);
  });

  it('when the input names a drive, should be unsafe', () => {
    // given: Windows drive-absolute and drive-relative forms
    // when:  the shape guard runs
    // then:  the drive clause catches both, and a digit-led relative path is NOT a drive
    expect(isUnsafePathInput('C:/x')).toBe(true);
    expect(isUnsafePathInput('C:foo')).toBe(true);
    expect(isUnsafePathInput('c:foo')).toBe(true);
    // `1:/x` has the right shape but a digit is not a drive letter.
    expect(isUnsafePathInput('1:/x')).toBe(false);
    // A colon-bearing segment is NOT a drive unless the colon sits at the START.
    // Without these the drive regex would be indistinguishable from an
    // unanchored `/[A-Za-z]:/`, which the mutation report showed surviving.
    expect(isUnsafePathInput('x/C:/y')).toBe(false);
    expect(isUnsafePathInput('a/b:c')).toBe(false);
  });

  it('when the input contains a scheme separator, should be unsafe', () => {
    // given: URL-shaped input that is never an artifact path
    // when:  the shape guard runs
    // then:  the scheme clause refuses it
    expect(isUnsafePathInput('http://example.com/x')).toBe(true);
    expect(isUnsafePathInput('file://host/x')).toBe(true);
  });

  it('when the input looks like user@host:path, should be unsafe', () => {
    // given: the scp/ssh spelling, which is a remote location, not a file
    // when:  the shape guard runs
    // then:  it is refused
    expect(isUnsafePathInput('a@b:c')).toBe(true);
    expect(isUnsafePathInput('user@example.com:repo')).toBe(true);
    // The clause needs a non-empty path after the colon. Without this arm the
    // `.+` tail is indistinguishable from `.` and from an empty tail.
    expect(isUnsafePathInput('a@b:')).toBe(false);
    // It also needs `@` to be present at all, and a non-empty user before it.
    expect(isUnsafePathInput('ab:c')).toBe(false);
    expect(isUnsafePathInput('@b:c')).toBe(false);
  });

  it('when the input is a plain relative path, should be safe', () => {
    // given: the forms a caller legitimately passes
    // when:  the shape guard runs
    // then:  none is refused
    expect(isUnsafePathInput('a')).toBe(false);
    expect(isUnsafePathInput('a/b')).toBe(false);
    expect(isUnsafePathInput('a/b/c.ts')).toBe(false);
    expect(isUnsafePathInput('a-b_c.d')).toBe(false);
  });

  it('when the input carries an empty or dot segment inside, should be unsafe', () => {
    // given: a path whose SHAPE is relative but whose segments escape or collapse
    // when:  the shape guard runs
    // then:  the per-segment clause refuses it
    expect(isUnsafePathInput('a//b')).toBe(true);
    expect(isUnsafePathInput('a/./b')).toBe(true);
    expect(isUnsafePathInput('a/../b')).toBe(true);
    expect(isUnsafePathInput('./a')).toBe(true);
    expect(isUnsafePathInput('a/')).toBe(true);
  });
});

describe('Scenario: (render) — the two public predicates agree', () => {
  it('when asked about the artifact spelling, should answer exactly as the path spelling does', () => {
    // given: a spread of inputs covering unsafe and safe shapes
    // when:  both public predicates are asked about the same value
    // then:  `isUnsafeArtifactPath` is a rename, not a second rule
    const inputs = ['a/b', '/abs', 'C:/x', '..', '', 'a\\b', 'ok/path.ts'];
    for (const input of inputs) {
      expect(isUnsafeArtifactPath(input)).toBe(isUnsafePathInput(input));
    }
  });
});

describe('Scenario: (integration) — containment is decided on the normalized form', () => {
  it('when the path equals the root, should be inside', () => {
    // given: the root itself
    // when:  containment is asked
    // then:  equality counts as inside
    expect(isPathInsideArtifactRoot('.peaks/x', '.peaks/x')).toBe(true);
  });

  it('when the path sits under the root, should be inside', () => {
    // given: a descendant
    // when:  containment is asked
    // then:  a prefix match on a segment boundary counts as inside
    expect(isPathInsideArtifactRoot('.peaks/x/y', '.peaks/x')).toBe(true);
    expect(isPathInsideArtifactRoot('.peaks/x/y/z.md', '.peaks/x')).toBe(true);
  });

  it('when the path only shares a prefix, should be outside', () => {
    // given: a sibling whose name starts with the root's name
    // when:  containment is asked
    // then:  it is OUTSIDE — the check appends the separator, so `.peaks/x2`
    //        is not read as living under `.peaks/x`
    expect(isPathInsideArtifactRoot('.peaks/x2', '.peaks/x')).toBe(false);
    expect(isPathInsideArtifactRoot('.peaks/xy/z', '.peaks/x')).toBe(false);
  });

  it('when either argument is empty, should be outside', () => {
    // given: a caller that lost a value
    // when:  containment is asked
    // then:  it answers false rather than comparing against a blank root
    expect(isPathInsideArtifactRoot('', '.peaks/x')).toBe(false);
    expect(isPathInsideArtifactRoot('.peaks/x', '')).toBe(false);
    expect(isPathInsideArtifactRoot('', '')).toBe(false);
  });

  it('when the spellings differ, should decide on the normalized form', () => {
    // given: the same location written with a trailing slash and a backslash
    // when:  containment is asked
    // then:  normalization is applied first, so the separator spelling does not decide it
    expect(isPathInsideArtifactRoot('.peaks/x/y', '.peaks/x/')).toBe(true);
    expect(isPathInsideArtifactRoot('.peaks/x/y/', '.peaks/x')).toBe(true);
  });
});

describe('Scenario: (a11y) — the normalizer is reachable for a caller that needs the key', () => {
  it('when a trailing slash is present, should be stripped and separators folded', () => {
    // given: the two spellings the writer path has to reconcile
    // when:  the exported normalizer runs
    // then:  trailing slashes are gone and backslashes are folded to POSIX
    expect(_normalizeArtifactPath('.peaks/x/')).toBe('.peaks/x');
    expect(_normalizeArtifactPath('.peaks\\x')).toBe('.peaks/x');
    expect(_normalizeArtifactPath('.peaks/x')).toBe('.peaks/x');
  });
});
