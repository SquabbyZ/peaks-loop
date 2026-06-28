/**
 * v2.15.0 follow-up — G8 tests: legacy detector.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLegacy } from '../../../../src/services/legacy/legacy-detector.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-legacy-test-'));
});
afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const full = join(tmpDir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('detectLegacy', () => {
  it('returns empty when the directory does not exist', () => {
    const r = detectLegacy(tmpDir, 'nope');
    expect(r.scannedFiles).toBe(0);
    expect(r.findings).toEqual([]);
    expect(r.smells).toBe('low');
  });
  it('flags TODO comments', () => {
    writeFile('src/a.ts', '// TODO: refactor this\nconst x = 1;\n');
    const r = detectLegacy(tmpDir, 'src');
    expect(r.summary.todo).toBe(1);
  });
  it('flags console.log calls', () => {
    writeFile('src/a.ts', 'console.log("debug");\n');
    const r = detectLegacy(tmpDir, 'src');
    expect(r.summary['console-log']).toBe(1);
  });
  it('flags as any type usage', () => {
    writeFile('src/a.ts', 'const x: any = 1;\n');
    const r = detectLegacy(tmpDir, 'src');
    expect(r.summary['any-type']).toBe(1);
  });
  it('flags large files (> 500 lines)', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`).join('\n');
    writeFile('src/big.ts', lines);
    const r = detectLegacy(tmpDir, 'src');
    expect(r.summary['large-file']).toBe(1);
  });
  it('classifies the overall smell grade as high when many findings', () => {
    for (let i = 0; i < 60; i++) {
      writeFile(`src/f${i}.ts`, `// TODO: ${i}\nconsole.log(${i});\n`);
    }
    const r = detectLegacy(tmpDir, 'src');
    expect(r.smells).toBe('high');
  });
  it('skips node_modules and .git', () => {
    writeFile('node_modules/x.ts', '// TODO: should not be detected\n');
    writeFile('.git/x.ts', '// TODO: should not be detected\n');
    const r = detectLegacy(tmpDir, '');
    expect(r.findings).toEqual([]);
  });
});
