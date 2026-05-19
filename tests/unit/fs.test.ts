import { describe, expect, test } from 'vitest';
import { pathExists, isDirectory } from '../../src/shared/fs.js';

describe('fs utilities', () => {
  test('pathExists returns false for non-existent path', async () => {
    const result = await pathExists('/this/path/does/not/exist/at/all.txt');
    expect(result).toBe(false);
  });

  test('pathExists returns true for existing path', async () => {
    const result = await pathExists('package.json');
    expect(result).toBe(true);
  });

  test('isDirectory returns true for existing directory', async () => {
    const result = await isDirectory('schemas');
    expect(result).toBe(true);
  });

  test('isDirectory returns false for non-existent path', async () => {
    const result = await isDirectory('/this/path/does/not/exist/at/all');
    expect(result).toBe(false);
  });
});