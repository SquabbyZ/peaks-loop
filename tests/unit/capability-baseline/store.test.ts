import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeBaselineHash,
  readBaselineFile,
  verifyLock,
  writeBaselineFile
} from '~/src/services/capability-baseline/store';
import type { CapabilityBaselineFile, BaselineLock } from '~/src/services/capability-baseline/types';

let projectRoot = '';
afterEach(() => { if (projectRoot) rmSync(projectRoot, { recursive: true, force: true }); projectRoot = ''; });

beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), 'cbl-store-')); });

function sampleFile(): CapabilityBaselineFile {
  return {
    schemaVersion: '2026-08-03',
    version: '4.0.8',
    signedBy: 'SquabbyZ',
    signedAt: '2026-08-03T10:00:00.000Z',
    rows: []
  };
}

describe('capability-baseline/store', () => {
  it('writeBaselineFile creates both capability-baseline.json and capability-baseline.lock', () => {
    const out = writeBaselineFile({ projectRoot, file: sampleFile() });
    expect(existsSync(out.path)).toBe(true);
    expect(existsSync(out.lockPath)).toBe(true);
    const lock = JSON.parse(readFileSync(out.lockPath, 'utf8')) as BaselineLock;
    expect(lock.signedBy).toBe('SquabbyZ');
    expect(lock.version).toBe('4.0.8');
  });
  it('readBaselineFile returns ok when file and lock are consistent', () => {
    const out = writeBaselineFile({ projectRoot, file: sampleFile() });
    const r = readBaselineFile(projectRoot);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.version).toBe('4.0.8');
      expect(typeof r.lock.baselineHash).toBe('string');
      expect(r.lock.baselineHash.length).toBeGreaterThan(0);
    }
  });
  it('readBaselineFile returns BASELINE_HASH_MISMATCH when the lock is tampered', () => {
    writeBaselineFile({ projectRoot, file: sampleFile() });
    const lockPath = join(projectRoot, 'openspec', 'baselines', 'current', 'capability-baseline.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as BaselineLock;
    writeFileSync(lockPath, JSON.stringify({ ...lock, baselineHash: 'deadbeef' }, null, 2));
    const r = readBaselineFile(projectRoot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_HASH_MISMATCH');
  });
  it('readBaselineFile returns BASELINE_NOT_SIGNED when signedBy is not SquabbyZ', () => {
    const file = { ...sampleFile(), signedBy: 'AnyoneElse' as unknown as 'SquabbyZ' };
    writeBaselineFile({ projectRoot, file });
    const r = readBaselineFile(projectRoot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_NOT_SIGNED');
  });
  it('computeBaselineHash is stable across re-signing (strips signedBy / signedAt)', () => {
    const a = computeBaselineHash(sampleFile());
    const b = computeBaselineHash({ ...sampleFile(), signedAt: '2026-08-03T11:00:00.000Z' });
    expect(a).toBe(b);
  });
  it('verifyLock accepts a matching lock and rejects a mismatched one', () => {
    const file = sampleFile();
    const hash = computeBaselineHash(file);
    const okLock: BaselineLock = { baselineHash: hash, signedBy: 'SquabbyZ', signedAt: file.signedAt, version: file.version };
    const badLock: BaselineLock = { ...okLock, baselineHash: '00' };
    expect(verifyLock(file, okLock).ok).toBe(true);
    const v = verifyLock(file, badLock);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe('BASELINE_HASH_MISMATCH');
  });
});
