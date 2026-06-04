import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { repoRoot } from '../../src/shared/paths.js';

const dataPath = join(repoRoot, 'schemas', 'library-breaking-changes.data.json');
const metaPath = join(repoRoot, 'schemas', 'library-breaking-changes.meta.json');

describe('library-breaking-changes.meta.json shape', () => {
  test('is valid JSON with all required fields', () => {
    const raw = readFileSync(metaPath, 'utf8');
    const meta = JSON.parse(raw) as {
      lastUpdated: string;
      freshnessPolicyDays: number;
      libraryCount: number;
      rowCount: number;
    };
    expect(meta.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof meta.freshnessPolicyDays).toBe('number');
    expect(meta.freshnessPolicyDays).toBeGreaterThan(0);
    expect(typeof meta.libraryCount).toBe('number');
    expect(typeof meta.rowCount).toBe('number');
  });

  test('libraryCount and rowCount match the data file (no drift)', () => {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { libraryCount: number; rowCount: number };
    const data = JSON.parse(readFileSync(dataPath, 'utf8')) as Array<{ breakingChanges: unknown[] }>;
    expect(data).toHaveLength(meta.libraryCount);
    const actualRows = data.reduce((sum, lib) => sum + lib.breakingChanges.length, 0);
    expect(actualRows).toBe(meta.rowCount);
  });

  test('lastUpdated is a real calendar date (not in the future)', () => {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { lastUpdated: string };
    const ts = Date.parse(meta.lastUpdated);
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});
