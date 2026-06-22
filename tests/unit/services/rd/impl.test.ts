import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

  // R2-W4: externalApiCalls with multiple entries — pin array handling.
// Note: sig-distinct assertions (lines below) are best-effort only —
// generatedAt uses new Date().toISOString() so two empty arrays still
// differ across millisecond boundaries. The load-bearing guards are
// the on-disk length + element-order assertions at the end of this test.
// R3-W1: this test still catches drop/sort/reorder regressions; it just
// catches them via the length+order checks, not via the named sig assertion.
  it('produces distinct sig for multi-entry externalApiCalls (R2-W4)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-multi-'));
    try {
      const astGate: AstGateResult = { passed: true, violations: [] };
      const baseOut = { inputSig: 'a'.repeat(64), changedFiles: ['src/A.ts'], astGate };
      const single = await writeImpl({ ...baseOut, out: join(workdir, 'impl-single.json'), externalApiCalls: [] });
      // R2A-L1: 1-element boundary — a mutation collapsing [] and [x] into
      // the same sig must NOT pass.
      const oneEntry = await writeImpl({
        ...baseOut,
        out: join(workdir, 'impl-one.json'),
        externalApiCalls: [{ file: 'src/A.ts', line: 10, api: 'oauth.handle', version: '2.4.0' }],
      });
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
      expect(multi.sha256).not.toBe(oneEntry.sha256);
      expect(oneEntry.sha256).not.toBe(single.sha256);
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

  // R1-W5: spec §4.3 atomic-write contract — if rename throws mid-write
  // (between writeFile to .tmp and rename to final), the catch→unlink block
  // must remove the .tmp so a half-written impl.json never leaks into the
  // audit trail. A regression that drops the unlink would still pass every
  // happy-path test; this test pins the error branch.
  //
  // Strategy: point `out` at a directory path so the real rename fails with
  // EISDIR. node:fs/promises properties are read-only on Node 18+ so we
  // cannot use vi.spyOn; instead we assert the observable outcome — no
  // .tmp residue after the throw, no impl.json left behind.
  it('unlinks .tmp when rename throws (atomic-write contract, R1-W5)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-crash-'));
    try {
      const astGate: AstGateResult = { passed: true, violations: [] };
      const out = join(workdir, 'impl.json');
      const tmp = `${out}.tmp`;
      // Pre-create `out` as a directory so rename(tmp, out) hits EISDIR.
      mkdirSync(out, { recursive: true });
      await expect(writeImpl({
        out,
        inputSig: 'a'.repeat(64),
        changedFiles: ['src/A.ts'],
        externalApiCalls: [],
        astGate,
      })).rejects.toThrow();
      // Catch branch fired: .tmp was unlinked, no half-written file leaks.
      expect(existsSync(tmp)).toBe(false);
      // And the original `out` target (the directory) is untouched.
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
