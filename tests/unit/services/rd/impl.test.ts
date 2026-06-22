import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeImpl } from '../../../../src/services/rd/impl.js';
import type { AstGateResult } from '../../../../src/services/rd/types.js';

describe('writeImpl', () => {
  it('writes impl.json + computes TACT.sig chained to inputSig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const x = 1;\n');
      const astGate: AstGateResult = { passed: true, violations: [] };
      const out = await writeImpl({
        out: join(workdir, 'impl.json'),
        inputSig: 'a'.repeat(64),
        changedFiles: ['src/A.ts'],
        externalApiCalls: [],
        astGate,
      });
      expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(out.inputSig).toBe('a'.repeat(64));
      const onDisk = JSON.parse(readFileSync(join(workdir, 'impl.json'), 'utf8'));
      expect(onDisk.sha256).toBe(out.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('throws when AST gate failed — refuses to write TACT.sig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-fail-'));
    try {
      const astGate: AstGateResult = {
        passed: false,
        violations: [{ file: 'src/X.ts', line: 1, api: 'fooV3', expectedVersion: '2.4.0', actualVersion: 'unknown', severity: 'error' }],
      };
      await expect(writeImpl({
        out: join(workdir, 'impl.json'),
        inputSig: 'a'.repeat(64),
        changedFiles: ['src/X.ts'],
        externalApiCalls: [],
        astGate,
      })).rejects.toThrow(/AST gate failed/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('throws when passed=true but violations non-empty (lying-input defense, R2-W2)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-lying-'));
    try {
      const astGate: AstGateResult = {
        passed: true,
        violations: [{ file: 'src/Y.ts', line: 1, api: 'barV3', expectedVersion: '2.4.0', actualVersion: 'unknown', severity: 'error' }],
      };
      await expect(writeImpl({
        out: join(workdir, 'impl.json'),
        inputSig: 'a'.repeat(64),
        changedFiles: ['src/Y.ts'],
        externalApiCalls: [],
        astGate,
      })).rejects.toThrow(/inconsistent.*passed=true.*violations/i);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  // R2-W4: externalApiCalls with multiple entries — pin array handling
  // (sha256 must differ from the single-/empty-entry case so a regression
  // that drops entries or sorts them is detectable).
  it('produces distinct sig for multi-entry externalApiCalls (R2-W4)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-multi-'));
    try {
      const astGate: AstGateResult = { passed: true, violations: [] };
      const baseOut = { inputSig: 'a'.repeat(64), changedFiles: ['src/A.ts'], astGate };
      const single = await writeImpl({ ...baseOut, out: join(workdir, 'impl-single.json'), externalApiCalls: [] });
      const multi = await writeImpl({
        ...baseOut,
        out: join(workdir, 'impl-multi.json'),
        externalApiCalls: [
          { file: 'src/A.ts', line: 10, api: 'oauth.handle', version: '2.4.0' },
          { file: 'src/A.ts', line: 20, api: 'cache.get', version: '1.0.0' },
          { file: 'src/A.ts', line: 30, api: 'log.info', version: '3.0.0' },
        ],
      });
      expect(multi.sha256).not.toBe(single.sha256);
      // Order matters: swapping two entries must produce different sig.
      const swapped = await writeImpl({
        ...baseOut,
        out: join(workdir, 'impl-swapped.json'),
        externalApiCalls: [
          { file: 'src/A.ts', line: 10, api: 'cache.get', version: '1.0.0' },
          { file: 'src/A.ts', line: 20, api: 'oauth.handle', version: '2.4.0' },
          { file: 'src/A.ts', line: 30, api: 'log.info', version: '3.0.0' },
        ],
      });
      expect(swapped.sha256).not.toBe(multi.sha256);
      // On-disk array must equal in-memory array element-for-element.
      const onDisk = JSON.parse(readFileSync(join(workdir, 'impl-multi.json'), 'utf8'));
      expect(onDisk.externalApiCalls).toHaveLength(3);
      expect(onDisk.externalApiCalls[0]).toMatchObject({ api: 'oauth.handle', line: 10 });
      expect(onDisk.externalApiCalls[2]).toMatchObject({ api: 'log.info', line: 30 });
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
