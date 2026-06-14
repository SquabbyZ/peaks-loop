import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_HOME = process.env.HOME;

// Mock node:os BEFORE any other import so config-safety.ts's `homedir()`
// call (cached on macOS after first invocation) returns our fakeHome.
// Without this, the real user's HOME is cached at module-load time and
// `validateUserConfigPathForWrite` rejects fake paths. We read HOME
// at each call (not at module load) so beforeEach's `process.env.HOME`
// assignment takes effect.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => process.env.HOME ?? actual.homedir()
  };
});

describe('sidecar-store', () => {
  let workDir: string;
  let fakeHome: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'peaks-sidecar-test-'));
    fakeHome = join(workDir, 'home');
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    rmSync(workDir, { recursive: true, force: true });
  });

  describe('path helpers', () => {
    it('providersConfigPath returns ~/.peaks/providers.json', async () => {
      const { providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      expect(providersConfigPath(fakeHome)).toBe(join(fakeHome, '.peaks', 'providers.json'));
    });

    it('proxyConfigPath returns ~/.peaks/proxy.json', async () => {
      const { proxyConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      expect(proxyConfigPath(fakeHome)).toBe(join(fakeHome, '.peaks', 'proxy.json'));
    });

    it('workspacesConfigPath returns ~/.peaks/workspaces.json', async () => {
      const { workspacesConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      expect(workspacesConfigPath(fakeHome)).toBe(join(fakeHome, '.peaks', 'workspaces.json'));
    });
  });

  describe('readSidecarJson', () => {
    it('returns fallback when file does not exist', async () => {
      const { readSidecarJson, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      const fallback = { version: '2.0.0', providers: {} };
      expect(readSidecarJson(providersConfigPath(fakeHome), fallback)).toBe(fallback);
    });

    it('returns parsed object when file exists with valid JSON', async () => {
      const { readSidecarJson, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      const path = providersConfigPath(fakeHome);
      mkdirSync(join(fakeHome, '.peaks'), { recursive: true });
      writeFileSync(path, JSON.stringify({ version: '2.0.0', providers: { minimax: { model: 'test-model' } } }, null, 2));
      expect(readSidecarJson(path, { version: '2.0.0', providers: {} })).toEqual({
        version: '2.0.0',
        providers: { minimax: { model: 'test-model' } }
      });
    });

    it('returns fallback when file contains malformed JSON', async () => {
      const { readSidecarJson, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      const path = providersConfigPath(fakeHome);
      mkdirSync(join(fakeHome, '.peaks'), { recursive: true });
      writeFileSync(path, '{ not valid json');
      const fallback = { version: '2.0.0', providers: {} };
      expect(readSidecarJson(path, fallback)).toBe(fallback);
    });

    it('returns fallback when JSON parses to non-object (e.g. array, null, string)', async () => {
      const { readSidecarJson, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      const path = providersConfigPath(fakeHome);
      mkdirSync(join(fakeHome, '.peaks'), { recursive: true });
      writeFileSync(path, 'null');
      const fallback = { version: '2.0.0', providers: {} };
      expect(readSidecarJson(path, fallback)).toBe(fallback);
    });
  });

  describe('writeSidecarJson', () => {
    it('creates file with formatted JSON content', async () => {
      const { writeSidecarJson, providersConfigPath, readSidecarJson } = await import('../../../src/services/config/sidecar-store.js');
      const path = providersConfigPath(fakeHome);
      writeSidecarJson(path, { version: '2.0.0', providers: { minimax: { model: 'test-model' } } });
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, 'utf-8');
      expect(content).toContain('"version": "2.0.0"');
      expect(content).toContain('"model": "test-model"');
      expect(readSidecarJson(path, {})).toEqual({ version: '2.0.0', providers: { minimax: { model: 'test-model' } } });
    });

    it('overwrites existing file', async () => {
      const { writeSidecarJson, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      const path = providersConfigPath(fakeHome);
      writeSidecarJson(path, { version: '2.0.0', providers: { minimax: { model: 'first' } } });
      writeSidecarJson(path, { version: '2.0.0', providers: { minimax: { model: 'second' } } });
      expect(JSON.parse(readFileSync(path, 'utf-8')).providers.minimax.model).toBe('second');
    });

    it('creates parent directory if missing', async () => {
      const { writeSidecarJson, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      const path = providersConfigPath(fakeHome);
      writeSidecarJson(path, { version: '2.0.0', providers: {} });
      expect(existsSync(join(fakeHome, '.peaks'))).toBe(true);
    });
  });

  describe('ensureSidecarVersion', () => {
    it('returns existing version when present', async () => {
      const { ensureSidecarVersion } = await import('../../../src/services/config/sidecar-store.js');
      expect(ensureSidecarVersion({ version: '2.5.0' })).toEqual({ version: '2.5.0' });
    });

    it('falls back to SIDECAR_SCHEMA_VERSION when missing or invalid', async () => {
      const { ensureSidecarVersion } = await import('../../../src/services/config/sidecar-store.js');
      expect(ensureSidecarVersion({})).toEqual({ version: '2.0.0' });
      expect(ensureSidecarVersion({ version: 42 })).toEqual({ version: '2.0.0' });
      expect(ensureSidecarVersion({ version: null })).toEqual({ version: '2.0.0' });
    });
  });

  describe('sidecarExists', () => {
    it('returns false when file missing', async () => {
      const { sidecarExists, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      expect(sidecarExists(providersConfigPath(fakeHome))).toBe(false);
    });

    it('returns true when file exists', async () => {
      const { sidecarExists, writeSidecarJson, providersConfigPath } = await import('../../../src/services/config/sidecar-store.js');
      const path = providersConfigPath(fakeHome);
      writeSidecarJson(path, { version: '2.0.0', providers: {} });
      expect(sidecarExists(path)).toBe(true);
    });
  });
});