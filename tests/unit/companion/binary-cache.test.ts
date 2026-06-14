import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  binaryPathCacheFile,
  clearBinaryPathCache,
  companionHomeDir,
  COMPANION_BINARY_PATH_FILENAME,
  COMPANION_COMPANION_DIRNAME,
  COMPANION_HOME_DIRNAME,
  parseCacheRecord,
  readBinaryPathCache,
  serializeCacheRecord,
  writeBinaryPathCache
} from '../../../src/services/companion/binary-cache.js';
import type { CompanionBinaryCacheRecord } from '../../../src/services/companion/companion-types.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peaks-companion-home-'));
});

afterEach(() => {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
});

describe('paths', () => {
  it('companionHomeDir joins home/.peaks/companion', () => {
    expect(companionHomeDir(home)).toBe(join(home, COMPANION_HOME_DIRNAME, COMPANION_COMPANION_DIRNAME));
  });

  it('binaryPathCacheFile is the canonical cache filename', () => {
    expect(binaryPathCacheFile(home)).toBe(join(home, COMPANION_HOME_DIRNAME, COMPANION_COMPANION_DIRNAME, COMPANION_BINARY_PATH_FILENAME));
  });
});

describe('serialize/parse round-trip', () => {
  it('round-trips a record with source PATH', () => {
    const record: CompanionBinaryCacheRecord = {
      binaryPath: '/usr/local/bin/cc-connect',
      version: '1.3.2',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'PATH'
    };
    expect(parseCacheRecord(serializeCacheRecord(record))).toEqual(record);
  });

  it('round-trips a record with a pipe-bearing source string', () => {
    const record: CompanionBinaryCacheRecord = {
      binaryPath: '/opt/homebrew/bin/cc-connect',
      version: '1.3.2-beta.1',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'BREW|/opt/homebrew/bin'
    };
    const parsed = parseCacheRecord(serializeCacheRecord(record));
    expect(parsed).toEqual(record);
  });

  it('returns null for empty input', () => {
    expect(parseCacheRecord('')).toBeNull();
  });

  it('returns null for a record with too few fields', () => {
    expect(parseCacheRecord('a|b|c')).toBeNull();
  });

  it('returns null when any required field is empty', () => {
    expect(parseCacheRecord('|1.3.2|2026-06-14T08:00:00.000Z|PATH')).toBeNull();
    expect(parseCacheRecord('/bin/cc-connect||2026-06-14T08:00:00.000Z|PATH')).toBeNull();
  });

  it('falls back to UNKNOWN when source part is empty', () => {
    const parsed = parseCacheRecord('/bin/cc-connect|1.3.2|2026-06-14T08:00:00.000Z|');
    expect(parsed?.source).toBe('UNKNOWN');
  });
});

describe('read/write/clear cache', () => {
  it('readBinaryPathCache returns null when no file exists', () => {
    expect(readBinaryPathCache(home)).toBeNull();
  });

  it('writeBinaryPathCache creates the directory and the file', () => {
    const record: CompanionBinaryCacheRecord = {
      binaryPath: '/usr/local/bin/cc-connect',
      version: '1.3.2',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'PATH'
    };
    const result = writeBinaryPathCache(record, home);
    expect(result.ok).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readBinaryPathCache(home)).toEqual(record);
    const raw = readFileSync(result.path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('writeBinaryPathCache returns ok=false with a clear error on mkdir failure', () => {
    const record: CompanionBinaryCacheRecord = {
      binaryPath: '/bin/cc-connect',
      version: '1.3.2',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'PATH'
    };
    const blocker = join(home, COMPANION_HOME_DIRNAME);
    require('node:fs').writeFileSync(blocker, 'not a dir');
    const result = writeBinaryPathCache(record, home);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('clearBinaryPathCache removes the file and reports removed=true', () => {
    const record: CompanionBinaryCacheRecord = {
      binaryPath: '/bin/cc-connect',
      version: '1.3.2',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'PATH'
    };
    writeBinaryPathCache(record, home);
    const cleared = clearBinaryPathCache(home);
    expect(cleared.ok).toBe(true);
    expect(cleared.removed).toBe(true);
    expect(readBinaryPathCache(home)).toBeNull();
  });

  it('clearBinaryPathCache reports removed=false when nothing to clear', () => {
    const cleared = clearBinaryPathCache(home);
    expect(cleared.removed).toBe(false);
    expect(cleared.ok).toBe(true);
  });
});
