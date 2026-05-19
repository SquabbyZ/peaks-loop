import { describe, expect, test } from 'vitest';
import {
  isValidChangeId,
  isUnsafePathInput,
  isUnsafeArtifactPath,
  buildArtifactRelativePath,
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
  test('generates artifact-relative path with single segment', () => {
    const result = buildArtifactRelativePath('checkout-refactor', 'architecture');
    expect(result).toBe('.peaks/changes/checkout-refactor/architecture');
  });

  test('generates artifact-relative path with nested segments', () => {
    const result = buildArtifactRelativePath('my-change', 'swarm', 'workers', 'rd-impl-001');
    expect(result).toBe('.peaks/changes/my-change/swarm/workers/rd-impl-001');
  });

  test('normalizes backslashes to forward slashes', () => {
    const result = buildArtifactRelativePath('my-change', 'wave-1\\discovery');
    expect(result).toBe('.peaks/changes/my-change/wave-1/discovery');
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

describe('isPathInsideArtifactRoot', () => {
  test('returns true for path inside artifact root', () => {
    expect(isPathInsideArtifactRoot('.peaks/changes/my-change/swarm/task-graph.json', '.peaks/changes/my-change')).toBe(true);
  });

  test('returns true for artifact root itself', () => {
    expect(isPathInsideArtifactRoot('.peaks/changes/my-change', '.peaks/changes/my-change')).toBe(true);
  });

  test('returns false for sibling-prefix path outside artifact root', () => {
    expect(isPathInsideArtifactRoot('.peaks/changes/my-change-evil/swarm/task-graph.json', '.peaks/changes/my-change')).toBe(false);
  });

  test('returns false for path outside artifact root', () => {
    expect(isPathInsideArtifactRoot('.peaks/changes/other-change/swarm/task-graph.json', '.peaks/changes/my-change')).toBe(false);
  });

  test('normalizes backslashes on Windows', () => {
    expect(isPathInsideArtifactRoot('.peaks\\changes\\my-change\\swarm', '.peaks/changes/my-change')).toBe(true);
  });

  test('handles trailing slashes consistently', () => {
    expect(isPathInsideArtifactRoot('.peaks/changes/my-change/', '.peaks/changes/my-change')).toBe(true);
  });

  test('rejects traversal that escapes the root', () => {
    expect(isPathInsideArtifactRoot('.peaks/changes/my-change/../other-change/swarm', '.peaks/changes/my-change')).toBe(false);
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
    expect(isUnsafeArtifactPath('.peaks/changes/my-change/swarm/task-graph.json')).toBe(false);
    expect(isUnsafeArtifactPath('swarm/workers/rd-impl-001')).toBe(false);
  });
});
