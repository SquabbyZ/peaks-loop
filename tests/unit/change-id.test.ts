import { describe, expect, test, vi } from 'vitest';

const mockGetSessionId = vi.fn().mockReturnValue(null);
vi.mock('../../src/services/session/session-manager.js', () => ({
  getSessionId: (...args: unknown[]) => mockGetSessionId(...args)
}));

import {
  isValidChangeId,
  isUnsafePathInput,
  isUnsafeArtifactPath,
  buildArtifactRelativePath,
  buildArtifactRelativePathInRoot,
  isPathInsideArtifactRoot,
  validateChangeIdOrThrow,
  ChangeIdValidationError,
} from '../../src/shared/change-id.js';

describe('isValidChangeId', () => {
  test('accepts simple alphanumeric id', () => {
    expect(isValidChangeId('checkout-refactor')).toBe(true);
  });
  test('accepts id with dots and underscores', () => {
    expect(isValidChangeId('v1.2.3')).toBe(true);
    expect(isValidChangeId('feature_abc')).toBe(true);
  });
  test('accepts id with dashes', () => {
    expect(isValidChangeId('my-feature-123')).toBe(true);
  });
  test('accepts single segment', () => {
    expect(isValidChangeId('abc')).toBe(true);
  });
  test('rejects empty string', () => {
    expect(isValidChangeId('')).toBe(false);
  });
  test('rejects dot-only id', () => {
    expect(isValidChangeId('.')).toBe(false);
  });
  test('rejects double-dot id', () => {
    expect(isValidChangeId('..')).toBe(false);
    expect(isValidChangeId('foo..bar')).toBe(false);
  });
  test('rejects path separators', () => {
    expect(isValidChangeId('foo/bar')).toBe(false);
    expect(isValidChangeId('foo\\bar')).toBe(false);
  });
  test('rejects drive prefix', () => {
    expect(isValidChangeId('C:/foo')).toBe(false);
    expect(isValidChangeId('C:\\foo')).toBe(false);
  });
  test('rejects URL-like strings', () => {
    expect(isValidChangeId('https://example.com')).toBe(false);
    expect(isValidChangeId('http://foo.bar')).toBe(false);
    expect(isValidChangeId('git@github.com:foo/bar')).toBe(false);
  });
  test('rejects path traversal', () => {
    expect(isValidChangeId('foo/../bar')).toBe(false);
    expect(isValidChangeId('foo/./bar')).toBe(false);
  });
});

describe('isUnsafePathInput', () => {
  test('accepts safe strings', () => {
    expect(isUnsafePathInput('checkout-refactor')).toBe(false);
    expect(isUnsafePathInput('v1_2_3')).toBe(false);
  });
  test('rejects path traversal patterns', () => {
    expect(isUnsafePathInput('../foo')).toBe(true);
    expect(isUnsafePathInput('foo/../bar')).toBe(true);
  });
  test('rejects dot patterns', () => {
    expect(isUnsafePathInput('.')).toBe(true);
    expect(isUnsafePathInput('..')).toBe(true);
    expect(isUnsafePathInput('foo/./bar')).toBe(true);
    expect(isUnsafePathInput('./foo')).toBe(true);
  });
  test('rejects empty string', () => {
    expect(isUnsafePathInput('')).toBe(true);
  });
  test('rejects backslash separators', () => {
    expect(isUnsafePathInput('foo\\bar')).toBe(true);
  });
  test('rejects absolute Windows and POSIX paths', () => {
    expect(isUnsafePathInput('C:\\foo')).toBe(true);
    expect(isUnsafePathInput('D:/foo')).toBe(true);
    expect(isUnsafePathInput('/tmp/file')).toBe(true);
    expect(isUnsafePathInput('/etc/passwd')).toBe(true);
  });
  test('rejects URL-like strings and UNC-like paths', () => {
    expect(isUnsafePathInput('https://example.com')).toBe(true);
    expect(isUnsafePathInput('git@github.com:foo/bar')).toBe(true);
    expect(isUnsafePathInput('\\\\server\\share')).toBe(true);
  });
});

describe('buildArtifactRelativePath', () => {
  test('generates artifact-relative path with role segment', () => {
    const result = buildArtifactRelativePath('checkout-refactor', 'rd', 'architecture');
    expect(result).toBe('.peaks/checkout-refactor/rd/architecture');
  });
  test('generates artifact-relative path with nested role-scoped segments', () => {
    const result = buildArtifactRelativePath('my-change', 'rd', 'swarm', 'workers', 'rd-impl-001');
    expect(result).toBe('.peaks/my-change/rd/swarm/workers/rd-impl-001');
  });
  test('normalizes backslashes to forward slashes', () => {
    const result = buildArtifactRelativePath('my-change', 'rd', 'waves\\wave-1-discovery');
    expect(result).toBe('.peaks/my-change/rd/waves/wave-1-discovery');
  });
  test('rejects unsafe segments', () => {
    expect(() => buildArtifactRelativePath('checkout-refactor', '..')).toThrow(ChangeIdValidationError);
    expect(() => buildArtifactRelativePath('checkout-refactor', '/tmp/file')).toThrow(ChangeIdValidationError);
    expect(() => buildArtifactRelativePath('checkout-refactor', 'foo/../bar')).toThrow(ChangeIdValidationError);
  });
  test('rejects invalid change id', () => {
    expect(() => buildArtifactRelativePath('..', 'swarm')).toThrow(ChangeIdValidationError);
    expect(() => buildArtifactRelativePath('', 'swarm')).toThrow(ChangeIdValidationError);
    expect(() => buildArtifactRelativePath('foo/../bar', 'swarm')).toThrow(ChangeIdValidationError);
  });
});

describe('buildArtifactRelativePath — change-id routing (slice 2026-06-05-change-id-as-unit-of-work)', () => {
  // As of this slice, the write path is ALWAYS `.peaks/<change-id>/<segments-joined>`,
  // regardless of whether a session is bound. The session id remains the
  // binding for ephemeral state (live sub-agent progress, spawn records)
  // but is NOT the durable scope for reviewable content. The tests in
  // this block replace the legacy "buildArtifactRelativePath with
  // session" suite.
  test('uses segments verbatim under .peaks/<change-id>/', () => {
    mockGetSessionId.mockReturnValue('2026-05-28-session-a3f8b1');
    // The session id is bound but does NOT appear in the artifact path.
    // Reviewable content lives under the change-id; session is the binding
    // for ephemeral state only.
    const result = buildArtifactRelativePath('test-feature', 'rd', '001-test-feature.md');
    expect(result).toBe('.peaks/test-feature/rd/001-test-feature.md');
  });
  test('generates path with nested segments under change-id', () => {
    mockGetSessionId.mockReturnValue('2026-01-01-session-bbbb');
    const result = buildArtifactRelativePath('my-bug', 'qa', '001-my-bug.md');
    expect(result).toBe('.peaks/my-bug/qa/001-my-bug.md');
  });
  test('rejects unsafe change-id (path traversal in changeId)', () => {
    mockGetSessionId.mockReturnValue(null);
    expect(() => buildArtifactRelativePath('../escape', 'rd')).toThrow(ChangeIdValidationError);
  });
  test('rejects unsafe role segment with change-id', () => {
    mockGetSessionId.mockReturnValue(null);
    expect(() => buildArtifactRelativePath('test', '../evil')).toThrow(ChangeIdValidationError);
  });
});

describe('buildArtifactRelativePathInRoot', () => {
  // As of slice 2026-06-05-change-id-as-unit-of-work, the function
  // does NOT need to look up the session id. The path is always
  // `.peaks/<change-id>/<segments-joined>`, regardless of which
  // session is bound. The legacy "session-bound path" branch is gone.
  test('returns changeId-based path with explicit projectRoot', () => {
    mockGetSessionId.mockReturnValue(null);
    const result = buildArtifactRelativePathInRoot('/tmp/explicit-project-root', 'checkout-refactor', 'rd', 'architecture');
    expect(result).toBe('.peaks/checkout-refactor/rd/architecture');
  });

  test('returns change-id-based path even when caller projectRoot has a session binding (slice 2026-06-05-change-id-as-unit-of-work)', () => {
    mockGetSessionId.mockReturnValue('2026-06-04-session-aaa111');
    // Session is bound but the artifact path is the change-id dir.
    const result = buildArtifactRelativePathInRoot('/tmp/explicit-project-root', 'my-feature', 'rd', '001-my-feature.md');
    expect(result).toBe('.peaks/my-feature/rd/001-my-feature.md');
  });

  test('two different projectRoots produce the same change-id-based path (defense against cross-workspace pollution)', () => {
    // As of slice 2026-06-05-change-id-as-unit-of-work, the artifact
    // path no longer depends on the session id. Both projectRoots
    // produce the SAME change-id path regardless of session binding.
    // The getSessionId mock is left in place to confirm the function
    // does not even consult it (asserted via the not-called check).
    mockGetSessionId.mockClear();
    mockGetSessionId.mockImplementation((root: string) => root === '/root/with-session' ? '2026-06-04-session-bbb222' : null);
    const noSessionPath = buildArtifactRelativePathInRoot('/root/without-session', 'shared-change', 'rd', 'x');
    expect(noSessionPath).toBe('.peaks/shared-change/rd/x');
    const sessionPath = buildArtifactRelativePathInRoot('/root/with-session', 'shared-change', 'rd', 'x');
    // Same change-id → same path. Session id is irrelevant.
    expect(sessionPath).toBe('.peaks/shared-change/rd/x');
    // The function does NOT consult the session binding anymore;
    // both calls must produce the change-id path deterministically.
    expect(mockGetSessionId).not.toHaveBeenCalled();
  });

  test('empty projectRoot falls back to process.cwd() (defensive only)', () => {
    // The public API does not allow passing the empty string, but if a
    // future caller does, we want the function to degrade to the legacy
    // findProjectRoot(process.cwd()) behavior, not silently produce a
    // session-based path inside the empty string as a project root.
    mockGetSessionId.mockReturnValue(null);
    const result = buildArtifactRelativePathInRoot('', 'degraded-change', 'rd');
    expect(result).toBe('.peaks/degraded-change/rd');
  });

  test('rejects invalid change id before doing any work', () => {
    mockGetSessionId.mockClear();
    expect(() => buildArtifactRelativePathInRoot('/tmp/explicit', '..', 'rd')).toThrow(ChangeIdValidationError);
    // getSessionId must NOT have been called — the validation runs first.
    expect(mockGetSessionId).not.toHaveBeenCalled();
  });
});

describe('isPathInsideArtifactRoot', () => {
  test('returns true for path inside artifact root', () => {
    expect(isPathInsideArtifactRoot('.peaks/my-change/rd/swarm/task-graph.json', '.peaks/my-change')).toBe(true);
  });
  test('returns true for artifact root itself', () => {
    expect(isPathInsideArtifactRoot('.peaks/my-change', '.peaks/my-change')).toBe(true);
  });
  test('returns false for sibling-prefix path outside artifact root', () => {
    expect(isPathInsideArtifactRoot('.peaks/my-change-evil/rd/swarm/task-graph.json', '.peaks/my-change')).toBe(false);
  });
  test('returns false for path outside artifact root', () => {
    expect(isPathInsideArtifactRoot('.peaks/other-change/rd/swarm/task-graph.json', '.peaks/my-change')).toBe(false);
  });
  test('normalizes backslashes on Windows', () => {
    expect(isPathInsideArtifactRoot('.peaks\\my-change\\rd\\swarm', '.peaks/my-change')).toBe(true);
  });
  test('handles trailing slashes consistently', () => {
    expect(isPathInsideArtifactRoot('.peaks/my-change/', '.peaks/my-change')).toBe(true);
  });
  test('rejects traversal that escapes the root', () => {
    expect(isPathInsideArtifactRoot('.peaks/my-change/../other-change/rd/swarm', '.peaks/my-change')).toBe(false);
  });
  test('returns false for empty normalized paths', () => {
    expect(isPathInsideArtifactRoot('', '.')).toBe(false);
  });
});

describe('validateChangeIdOrThrow', () => {
  test('does not throw for valid change id', () => {
    expect(() => validateChangeIdOrThrow('checkout-refactor')).not.toThrow();
    expect(() => validateChangeIdOrThrow('v1.2.3')).not.toThrow();
  });
  test('throws ChangeIdValidationError for invalid change id', () => {
    expect(() => validateChangeIdOrThrow('')).toThrow(ChangeIdValidationError);
    expect(() => validateChangeIdOrThrow('..')).toThrow(ChangeIdValidationError);
    expect(() => validateChangeIdOrThrow('foo/bar')).toThrow(ChangeIdValidationError);
  });
  test('error contains the invalid change id', () => {
    try {
      validateChangeIdOrThrow('foo/bar');
    } catch (error) {
      expect((error as ChangeIdValidationError).changeId).toBe('foo/bar');
    }
  });
});

describe('isUnsafeArtifactPath', () => {
  test('returns true for path traversal patterns', () => {
    expect(isUnsafeArtifactPath('../foo')).toBe(true);
    expect(isUnsafeArtifactPath('foo/../bar')).toBe(true);
  });
  test('returns true for dot patterns', () => {
    expect(isUnsafeArtifactPath('.')).toBe(true);
    expect(isUnsafeArtifactPath('..')).toBe(true);
  });
  test('returns false for safe artifact paths', () => {
    expect(isUnsafeArtifactPath('.peaks/my-change/rd/swarm/task-graph.json')).toBe(false);
    expect(isUnsafeArtifactPath('rd/swarm/workers/rd-impl-001')).toBe(false);
  });
});
