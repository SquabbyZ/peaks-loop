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

describe('buildArtifactRelativePath with session', () => {
  test('generates numbered filename when session exists', () => {
    mockGetSessionId.mockReturnValue('2026-05-28-session-a3f8b1');
    const result = buildArtifactRelativePath('test-feature', 'rd');
    expect(result).toMatch(/^\.peaks\/2026-05-28-session-a3f8b1\/rd\/\d+-test-feature\.md$/);
  });
  test('generates path with nested segments under session', () => {
    mockGetSessionId.mockReturnValue('2026-01-01-session-bbbb');
    const result = buildArtifactRelativePath('my-bug', 'qa');
    expect(result).toMatch(/^\.peaks\/2026-01-01-session-bbbb\/qa\/\d+-my-bug\.md$/);
  });
  test('rejects unsafe session id', () => {
    mockGetSessionId.mockReturnValue('../escape');
    expect(() => buildArtifactRelativePath('test', 'rd')).toThrow(ChangeIdValidationError);
  });
  test('rejects unsafe role segment with session', () => {
    mockGetSessionId.mockReturnValue('2026-05-28-session-cccc');
    expect(() => buildArtifactRelativePath('test', '../evil')).toThrow(ChangeIdValidationError);
  });
});

describe('buildArtifactRelativePathInRoot', () => {
  test('returns changeId-based path when caller projectRoot has no session', () => {
    mockGetSessionId.mockReturnValue(null);
    const result = buildArtifactRelativePathInRoot('/tmp/explicit-project-root', 'checkout-refactor', 'rd', 'architecture');
    expect(result).toBe('.peaks/checkout-refactor/rd/architecture');
    // The function must have called getSessionId with the EXPLICIT projectRoot,
    // not the result of findProjectRoot(process.cwd()).
    expect(mockGetSessionId).toHaveBeenCalledWith('/tmp/explicit-project-root');
  });

  test('returns session-based path when caller projectRoot has a session binding', () => {
    mockGetSessionId.mockReturnValue('2026-06-04-session-aaa111');
    const result = buildArtifactRelativePathInRoot('/tmp/explicit-project-root', 'my-feature', 'rd');
    expect(result).toMatch(/^\.peaks\/2026-06-04-session-aaa111\/rd\/\d+-my-feature\.md$/);
    expect(mockGetSessionId).toHaveBeenCalledWith('/tmp/explicit-project-root');
  });

  test('two different projectRoots produce different result shapes (defense against cross-workspace pollution)', () => {
    // Reset call history from earlier tests in this file so the
    // NthCalledWith assertions below have a stable baseline.
    mockGetSessionId.mockClear();
    // First call: a projectRoot with no session — should get the changeId-based path.
    mockGetSessionId.mockImplementation((root: string) => root === '/root/with-session' ? '2026-06-04-session-bbb222' : null);
    const noSessionPath = buildArtifactRelativePathInRoot('/root/without-session', 'shared-change', 'rd', 'x');
    expect(noSessionPath).toBe('.peaks/shared-change/rd/x');
    const sessionPath = buildArtifactRelativePathInRoot('/root/with-session', 'shared-change', 'rd', 'x');
    expect(sessionPath).toMatch(/^\.peaks\/2026-06-04-session-bbb222\/rd\/\d+-shared-change\.md$/);
    // Crucial: the two calls must have invoked getSessionId with their own
    // projectRoot, not with a shared value derived from process.cwd().
    expect(mockGetSessionId).toHaveBeenNthCalledWith(1, '/root/without-session');
    expect(mockGetSessionId).toHaveBeenNthCalledWith(2, '/root/with-session');
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
