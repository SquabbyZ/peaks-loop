import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  mirrorBinaryPathToPeaksConfig,
  parseCacheRecord,
  readBinaryPathCache,
  readBinaryPathCacheFromPeaksConfig,
  serializeCacheRecord,
  sourceToCompanionBinarySource,
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

// Slice 2026-06-14-cc-connect-weixin (change-1): peaks config is
// the source of truth. `writeBinaryPathCache` mirrors into peaks
// config; `readBinaryPathCache` falls back to peaks config when
// the legacy txt file is absent.

describe('peaks-config mirroring (slice change-1)', () => {
  it('writeBinaryPathCache also updates ~/.peaks/config.json#companion.binaryPath', () => {
    const record: CompanionBinaryCacheRecord = {
      binaryPath: '/repo/node_modules/.bin/cc-connect',
      version: '1.3.2',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'NODE_MODULES'
    };
    const result = writeBinaryPathCache(record, home);
    expect(result.ok).toBe(true);

    const peaksConfigPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
    expect(existsSync(peaksConfigPath)).toBe(true);
    const raw = JSON.parse(readFileSync(peaksConfigPath, 'utf8')) as { companion?: { binaryPath?: string; binaryPathSource?: 'node-modules' | 'path' } };
    expect(raw.companion?.binaryPath).toBe('/repo/node_modules/.bin/cc-connect');
    expect(raw.companion?.binaryPathSource).toBe('node-modules');
  });

  it('writeBinaryPathCache maps PATH/BREW/MANUAL sources to binaryPathSource="path"', () => {
    for (const src of ['PATH', 'BREW', 'MANUAL', 'PATH_CACHE']) {
      const result = writeBinaryPathCache({
        binaryPath: '/usr/local/bin/cc-connect',
        version: '1.3.2',
        resolvedAt: '2026-06-14T08:00:00.000Z',
        source: src
      }, home);
      expect(result.ok).toBe(true);
      const raw = JSON.parse(readFileSync(join(home, COMPANION_HOME_DIRNAME, 'config.json'), 'utf8')) as { companion?: { binaryPathSource?: string } };
      expect(raw.companion?.binaryPathSource).toBe('path');
    }
  });

  it('preserves other peaks config keys when mirroring (does not nuke)', () => {
    const peaksConfigPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
    require('node:fs').mkdirSync(join(home, COMPANION_HOME_DIRNAME), { recursive: true });
    writeFileSync(peaksConfigPath, JSON.stringify({
      version: '2.0.0',
      ocr: { llm: { url: 'https://example.com', authToken: '', model: '', useAnthropic: false, authHeader: 'authorization' } },
      companion: { enabled: true, autoStart: false, customKey: 'keep-me' }
    }, null, 2));
    const result = writeBinaryPathCache({
      binaryPath: '/bin/cc-connect',
      version: '1.3.2',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'NODE_MODULES'
    }, home);
    expect(result.ok).toBe(true);
    const raw = JSON.parse(readFileSync(peaksConfigPath, 'utf8')) as { version?: string; ocr?: { llm?: { url?: string } }; companion?: { enabled?: boolean; autoStart?: boolean; customKey?: string; binaryPath?: string } };
    expect(raw.version).toBe('2.0.0');
    expect(raw.ocr?.llm?.url).toBe('https://example.com');
    expect(raw.companion?.customKey).toBe('keep-me');
    expect(raw.companion?.binaryPath).toBe('/bin/cc-connect');
  });

  it('readBinaryPathCache falls back to peaks config when the txt file is absent', () => {
    const peaksConfigPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
    require('node:fs').mkdirSync(join(home, COMPANION_HOME_DIRNAME), { recursive: true });
    writeFileSync(peaksConfigPath, JSON.stringify({
      version: '2.0.0',
      companion: { binaryPath: '/from/peaks-config', binaryPathSource: 'path' }
    }));
    const record = readBinaryPathCache(home);
    expect(record).not.toBeNull();
    expect(record?.binaryPath).toBe('/from/peaks-config');
    expect(record?.source).toBe('PATH');
  });

  it('readBinaryPathCacheFromPeaksConfig returns null when the companion block is missing', () => {
    const peaksConfigPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
    require('node:fs').mkdirSync(join(home, COMPANION_HOME_DIRNAME), { recursive: true });
    writeFileSync(peaksConfigPath, JSON.stringify({ version: '2.0.0' }));
    expect(readBinaryPathCacheFromPeaksConfig(home)).toBeNull();
  });

  it('readBinaryPathCacheFromPeaksConfig returns null when the binaryPath is empty', () => {
    const peaksConfigPath = join(home, COMPANION_HOME_DIRNAME, 'config.json');
    require('node:fs').mkdirSync(join(home, COMPANION_HOME_DIRNAME), { recursive: true });
    writeFileSync(peaksConfigPath, JSON.stringify({
      version: '2.0.0',
      companion: { binaryPath: '', binaryPathSource: 'path' }
    }));
    expect(readBinaryPathCacheFromPeaksConfig(home)).toBeNull();
  });

  it('mirrorBinaryPathToPeaksConfig is a no-op when the txt write fails (still ok=true is wrong; reflects what happened on disk)', () => {
    // Direct mirror call against a fresh home; nothing in the way.
    const result = mirrorBinaryPathToPeaksConfig({
      binaryPath: '/bin/cc-connect',
      version: '1.3.2',
      resolvedAt: '2026-06-14T08:00:00.000Z',
      source: 'NODE_MODULES'
    }, home);
    expect(result.ok).toBe(true);
    const raw = JSON.parse(readFileSync(result.path, 'utf8')) as { companion?: { binaryPath?: string } };
    expect(raw.companion?.binaryPath).toBe('/bin/cc-connect');
  });

  it('sourceToCompanionBinarySource maps known tokens; unknown returns null', () => {
    expect(sourceToCompanionBinarySource('NODE_MODULES')).toBe('node-modules');
    expect(sourceToCompanionBinarySource('node-modules')).toBe('node-modules');
    expect(sourceToCompanionBinarySource('PATH')).toBe('path');
    expect(sourceToCompanionBinarySource('BREW')).toBe('path');
    expect(sourceToCompanionBinarySource('PATH_CACHE')).toBe('path');
    expect(sourceToCompanionBinarySource('UNKNOWN')).toBeNull();
  });
});
