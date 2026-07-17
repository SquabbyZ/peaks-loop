import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAssertions } from '../../../src/services/mut/assert-scanner.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-assert-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function makeTestFile(path: string, content: string): void {
  mkdirSync(join(workdir, path, '..'), { recursive: true });
  writeFileSync(join(workdir, path), content);
}

describe('scanAssertions', () => {
  it('detects toBeDefined() as weak pattern', async () => {
    makeTestFile('a.test.ts', `
      test('x', () => {
        expect(fn()).toBeDefined();
        expect(fn()).toEqual(42);
      });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['a.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toBeDefined')?.count).toBe(1);
    expect(r.totalAssertions).toBe(2);
  });

  it('detects toBeTruthy() as weak pattern', async () => {
    makeTestFile('b.test.ts', `
      test('x', () => { expect(x).toBeTruthy(); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['b.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toBeTruthy')?.count).toBe(1);
  });

  it('detects toEqual-self as weak pattern', async () => {
    makeTestFile('c.test.ts', `
      test('x', () => { expect(x).toEqual(x); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['c.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toEqual-self')?.count).toBe(1);
  });

  it('detects expect.anything() as weak pattern', async () => {
    makeTestFile('d.test.ts', `
      test('x', () => { expect(x).toEqual(expect.anything()); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['d.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'expect-anything')?.count).toBe(1);
  });

  it('detects toBe-self as weak pattern', async () => {
    makeTestFile('e.test.ts', `
      test('x', () => { expect(x).toBe(x); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['e.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toBe-self')?.count).toBe(1);
  });

  it('returns zero weak when no weak patterns present', async () => {
    makeTestFile('f.test.ts', `
      test('x', () => { expect(add(1, 2)).toBe(3); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['f.test.ts'] });
    expect(r.weakAssertions).toBe(0);
  });

  it('computes weakRate correctly', async () => {
    makeTestFile('g.test.ts', `
      test('x', () => {
        expect(x).toBeDefined();
        expect(x).toBeTruthy();
        expect(add(1, 2)).toBe(3);
        expect(add(2, 2)).toBe(4);
      });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['g.test.ts'] });
    expect(r.weakRate).toBe(0.5);
  });
});