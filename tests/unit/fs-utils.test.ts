import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { createDirectoryLinkSync, getDirectoryLinkType, readDirectoryLinkTarget } from '../../src/shared/fs-utils.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('getDirectoryLinkType', () => {
  test('uses junction on Windows', () => {
    expect(getDirectoryLinkType('win32')).toBe('junction');
  });

  test('uses dir symlink type on macOS and Linux', () => {
    expect(getDirectoryLinkType('darwin')).toBe('dir');
    expect(getDirectoryLinkType('linux')).toBe('dir');
  });
});

describe('createDirectoryLinkSync', () => {
  const testDir = join(tmpdir(), `fs-utils-test-${Date.now()}`);

  beforeEach(() => mkdirSync(testDir, { recursive: true }));

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('creates a directory link', () => {
    const target = join(testDir, 'target-dir');
    const link = join(testDir, 'link-dir');
    mkdirSync(target, { recursive: true });

    createDirectoryLinkSync(target, link);

    expect(readDirectoryLinkTarget(link)).toBeTruthy();
  });
});

describe('readDirectoryLinkTarget', () => {
  test('returns null for non-existent path', () => {
    expect(readDirectoryLinkTarget('/non/existent')).toBeNull();
  });
});
