/**
 * v2.15.0 follow-up — G10 tests: complexity estimator.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aggregateTier,
  estimateComplexity,
  estimateFileComplexity
} from '../../../../src/services/complexity/complexity-estimator.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-complexity-test-'));
});
afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('estimateFileComplexity', () => {
  it('returns null when the file does not exist', () => {
    expect(estimateFileComplexity(join(tmpDir, 'nope.ts'))).toBeNull();
  });
  it('classifies a short file with no exports as trivial', () => {
    const f = join(tmpDir, 'a.ts');
    writeFileSync(f, 'const x = 1;\nconst y = 2;\n', 'utf8');
    const c = estimateFileComplexity(f);
    expect(c?.tier).toBe('trivial');
    expect(c?.exports).toBe(0);
  });
  it('classifies a file with > 50 lines as simple', () => {
    const f = join(tmpDir, 'b.ts');
    const lines = Array.from({ length: 80 }, (_, i) => `const x${i} = ${i};`).join('\n');
    writeFileSync(f, lines, 'utf8');
    const c = estimateFileComplexity(f);
    expect(c?.tier).toBe('simple');
  });
  it('classifies a file with async/await as complex', () => {
    const f = join(tmpDir, 'c.ts');
    writeFileSync(f, 'export async function fetch() { return await fetch(); }\n', 'utf8');
    const c = estimateFileComplexity(f);
    expect(c?.tier).toBe('complex');
    expect(c?.hasAsync).toBe(true);
  });
  it('counts exports', () => {
    const f = join(tmpDir, 'd.ts');
    writeFileSync(f, 'export function a() {}\nexport const b = 1;\nexport type C = number;\n', 'utf8');
    const c = estimateFileComplexity(f);
    expect(c?.exports).toBe(3);
  });
});

describe('aggregateTier', () => {
  it('promotes to complex when any file is complex', () => {
    expect(aggregateTier(['trivial', 'simple', 'complex'])).toBe('complex');
  });
  it('promotes to simple when any file is simple (no complex)', () => {
    expect(aggregateTier(['trivial', 'simple'])).toBe('simple');
  });
  it('returns trivial when all are trivial', () => {
    expect(aggregateTier(['trivial', 'trivial'])).toBe('trivial');
  });
  it('returns trivial for empty list', () => {
    expect(aggregateTier([])).toBe('trivial');
  });
});

describe('estimateComplexity (multi-file)', () => {
  it('returns the aggregate tier and summary counts', () => {
    const a = join(tmpDir, 'a.ts'); writeFileSync(a, 'const x = 1;\n', 'utf8');
    const b = join(tmpDir, 'b.ts'); writeFileSync(b, Array.from({ length: 80 }, (_, i) => `x${i}`).join('\n'), 'utf8');
    const c = join(tmpDir, 'c.ts'); writeFileSync(c, 'export async function f() {}\n', 'utf8');
    const r = estimateComplexity(tmpDir, ['a.ts', 'b.ts', 'c.ts', 'nope.ts']);
    expect(r.files).toHaveLength(3); // nope.ts is skipped
    expect(r.overall).toBe('complex');
    expect(r.summary.trivial).toBe(1);
    expect(r.summary.simple).toBe(1);
    expect(r.summary.complex).toBe(1);
  });
});
