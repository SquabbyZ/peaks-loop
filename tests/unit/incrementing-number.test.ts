import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getNextNumber,
  buildNumberedFilename,
  getNextNumberedFilePath,
} from '../../src/shared/incrementing-number.js';

describe('incrementing-number', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `test-incrementing-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getNextNumber', () => {
    test('returns 1 for non-existent directory', () => {
      const nonExistent = join(testDir, 'does-not-exist');
      expect(getNextNumber(nonExistent)).toBe(1);
    });

    test('returns 1 for empty directory', () => {
      expect(getNextNumber(testDir)).toBe(1);
    });

    test('returns 1 when directory has no numbered files', () => {
      writeFileSync(join(testDir, 'random-file.md'), 'content');
      writeFileSync(join(testDir, 'another-file.txt'), 'content');
      expect(getNextNumber(testDir)).toBe(1);
    });

    test('returns 2 when directory has 001-file.md', () => {
      writeFileSync(join(testDir, '001-feature.md'), 'content');
      expect(getNextNumber(testDir)).toBe(2);
    });

    test('returns next number after highest', () => {
      writeFileSync(join(testDir, '001-first.md'), 'content');
      writeFileSync(join(testDir, '002-second.md'), 'content');
      writeFileSync(join(testDir, '003-third.md'), 'content');
      expect(getNextNumber(testDir)).toBe(4);
    });

    test('handles non-sequential numbers', () => {
      writeFileSync(join(testDir, '001-first.md'), 'content');
      writeFileSync(join(testDir, '005-fifth.md'), 'content');
      writeFileSync(join(testDir, '003-third.md'), 'content');
      expect(getNextNumber(testDir)).toBe(6);
    });

    test('ignores non-md files', () => {
      writeFileSync(join(testDir, '001-first.md'), 'content');
      writeFileSync(join(testDir, '002-second.txt'), 'content');
      writeFileSync(join(testDir, '999-hundred.md'), 'content');
      expect(getNextNumber(testDir)).toBe(1000);
    });

    test('ignores files without numeric prefix', () => {
      writeFileSync(join(testDir, '001-first.md'), 'content');
      writeFileSync(join(testDir, 'random-file.md'), 'content');
      expect(getNextNumber(testDir)).toBe(2);
    });
  });

  describe('buildNumberedFilename', () => {
    test('generates zero-padded filename', () => {
      expect(buildNumberedFilename(1, 'feature')).toBe('001-feature.md');
      expect(buildNumberedFilename(42, 'test')).toBe('042-test.md');
      expect(buildNumberedFilename(100, 'big')).toBe('100-big.md');
    });

    test('converts description to kebab-case slug', () => {
      expect(buildNumberedFilename(1, 'User Authentication')).toBe('001-user-authentication.md');
      expect(buildNumberedFilename(1, 'Add  new   feature')).toBe('001-add-new-feature.md');
      expect(buildNumberedFilename(1, 'Feature_Name.With.Dots')).toBe('001-feature-name-with-dots.md');
    });

    test('trims leading and trailing dashes', () => {
      expect(buildNumberedFilename(1, '-feature-')).toBe('001-feature.md');
      expect(buildNumberedFilename(1, '  feature  ')).toBe('001-feature.md');
    });

    test('limits slug length to 50 characters', () => {
      const longDescription = 'This is a very long description that should be truncated to fifty characters';
      const result = buildNumberedFilename(1, longDescription);
      const slug = result.replace(/^\d+-/, '').replace('.md', '');
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    test('handles special characters', () => {
      expect(buildNumberedFilename(1, 'auth@system#v2')).toBe('001-auth-system-v2.md');
    });
  });

  describe('getNextNumberedFilePath', () => {
    test('returns path with next number', () => {
      const result = getNextNumberedFilePath(testDir, 'feature');
      expect(result).toBe(join(testDir, '001-feature.md'));
    });

    test('increments when files exist', () => {
      writeFileSync(join(testDir, '001-existing.md'), 'content');
      const result = getNextNumberedFilePath(testDir, 'new');
      expect(result).toBe(join(testDir, '002-new.md'));
    });
  });
});
