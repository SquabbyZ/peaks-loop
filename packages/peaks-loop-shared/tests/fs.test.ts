import { describe, expect, test } from 'vitest';
import { isDirectory, pathExists } from '../src/fs.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve test fixtures from this package's directory, not from the
// main repo root. The shared package's vitest config sets the CWD to
// `packages/peaks-loop-shared/`, so relative paths like 'src' resolve
// inside the shared package itself. Using `src/` keeps the test
// self-contained and CWD-independent.
const here = dirname(fileURLToPath(import.meta.url));
const existingFile = resolve(here, '..', 'package.json');
const existingDir = resolve(here, '..', 'src');

describe('fs utilities', () => {
  test('pathExists returns false for non-existent path', async () => {
    const result = await pathExists('/this/path/does/not/exist/at/all.txt');
    expect(result).toBe(false);
  });

  test('pathExists returns true for existing file', async () => {
    const result = await pathExists(existingFile);
    expect(result).toBe(true);
  });

  test('isDirectory returns true for existing directory', async () => {
    const result = await isDirectory(existingDir);
    expect(result).toBe(true);
  });

  test('isDirectory returns false for non-existent path', async () => {
    const result = await isDirectory('/this/path/does/not/exist/at/all');
    expect(result).toBe(false);
  });
});