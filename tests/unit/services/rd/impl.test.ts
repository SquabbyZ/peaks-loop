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
});
