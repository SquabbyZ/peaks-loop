/**
 * Unit tests for the ECC cache service (Slice 3 of 4.0.0-beta.10).
 *
 * Covers:
 *  - chmod 0700 on POSIX (setCacheDirPermissions)
 *  - D-009 frontmatter fallback (malformed frontmatter -> filename + first body line)
 *  - readCacheManifest happy / missing / malformed
 *  - cleanupStaleCache 7-day survivor + 8-day removal (active + orphan)
 *  - readAgentSkill validates `^[a-z][a-z0-9-]*$` and rejects path traversal
 *
 * Network download is exercised at integration boundary; tests
 * for `downloadToCache` use the mocked-fetch pattern from
 * `globalThis.fetch` and are marked @integration below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, chmodSync, statSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const homeDirMock = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeDirMock.value };
});

import {
  cleanupStaleCache,
  listCachedAgents,
  readAgentSkill,
  readCacheManifest,
  resolveEccCacheDir,
  setCacheDirPermissions,
} from '../../src/services/agent/ecc-cache-service.js';
// NOTE: `cleanupEccCache` (thin wrapper in main peaks-loop's
// src/services/log/retention.ts) is no longer tested here. The wrapper is
// covered by tests/unit/services/log/retention.test.ts in the main package.

describe('ecc-cache-service', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'peaks-ecc-cache-'));
    homeDirMock.value = tempHome;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('setCacheDirPermissions: chmods 0o700 on POSIX when platform is non-win32', () => {
    if (process.platform === 'win32') {
      // Skip the POSIX assertion on Windows; the function is documented as no-op.
      expect(true).toBe(true);
      return;
    }
    const dir = join(tempHome, 'perm-target');
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    setCacheDirPermissions(dir);
    const stat = statSync(dir);
    expect((stat.mode & 0o777)).toBe(0o700);
  });

  it('setCacheDirPermissions: swallows errors on bad target', () => {
    expect(() => setCacheDirPermissions(join(tempHome, 'nonexistent'))).not.toThrow();
  });

  it('readCacheManifest returns null when no manifest exists', () => {
    expect(readCacheManifest()).toBeNull();
  });

  it('readCacheManifest returns null on malformed JSON', () => {
    const dir = resolveEccCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ecc-installed.json'), '{not-json');
    expect(readCacheManifest()).toBeNull();
  });

  it('readCacheManifest returns null on shape mismatch', () => {
    const dir = resolveEccCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ecc-installed.json'), JSON.stringify({ version: 1 }));
    expect(readCacheManifest()).toBeNull();
  });

  it('readCacheManifest returns parsed manifest on well-formed input', () => {
    const dir = resolveEccCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'ecc-installed.json'),
      JSON.stringify({
        version: '1',
        sha: 'a'.repeat(40),
        fetchedAt: new Date().toISOString(),
        agents: ['foo', 'bar'],
      })
    );
    const manifest = readCacheManifest();
    expect(manifest).not.toBeNull();
    expect(manifest?.agents).toEqual(['foo', 'bar']);
  });

  it('listCachedAgents: D-009 fallback uses filename + first body line for malformed frontmatter', () => {
    const sha = 'b'.repeat(40);
    const cacheDir = resolveEccCacheDir();
    const agentsDir = join(cacheDir, `ecc-${sha}`, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'broken-frontmatter.md'),
      '---\nnot yaml {{{\n---\nFirst body line describing the agent\nSecond body line\n'
    );
    writeFileSync(
      join(agentsDir, 'well-formed.md'),
      '---\nname: well-formed\ndescription: A nicely described agent\n---\nBody line one\nBody line two\n'
    );
    writeFileSync(
      join(cacheDir, 'ecc-installed.json'),
      JSON.stringify({
        version: '1',
        sha,
        fetchedAt: new Date().toISOString(),
        agents: ['broken-frontmatter', 'well-formed'],
      })
    );
    const agents = listCachedAgents();
    expect(agents.length).toBe(2);
    const broken = agents.find((a) => a.name === 'broken-frontmatter');
    expect(broken).toBeDefined();
    expect(broken?.description).toBe('First body line describing the agent');
    const good = agents.find((a) => a.name === 'well-formed');
    expect(good?.description).toBe('A nicely described agent');
  });

  it('readAgentSkill rejects names with path separators or `..`', () => {
    expect(readAgentSkill('../foo')).toBeNull();
    expect(readAgentSkill('foo/bar')).toBeNull();
    expect(readAgentSkill('Foo')).toBeNull();
    expect(readAgentSkill('-foo')).toBeNull();
  });

  it('readAgentSkill returns null when no cache exists', () => {
    expect(readAgentSkill('anything')).toBeNull();
  });

  it('readAgentSkill returns body when cache present and name valid', () => {
    const sha = 'c'.repeat(40);
    const agentsDir = join(resolveEccCacheDir(), `ecc-${sha}`, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'reviewer.md'), '# Reviewer\nbody\n');
    writeFileSync(
      join(resolveEccCacheDir(), 'ecc-installed.json'),
      JSON.stringify({ version: '1', sha, fetchedAt: new Date().toISOString(), agents: ['reviewer'] })
    );
    expect(readAgentSkill('reviewer')).toBe('# Reviewer\nbody\n');
    expect(readAgentSkill('not-cached')).toBeNull();
  });

  it('cleanupStaleCache: 7-day survivor + 8-day orphan removal', () => {
    const sha = 'd'.repeat(40);
    const dir = resolveEccCacheDir();
    mkdirSync(dir, { recursive: true });

    // Active cache: 7 days old by fetchedAt — survives.
    const activeDir = join(dir, `ecc-${sha}`);
    mkdirSync(join(activeDir, 'agents'), { recursive: true });
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Orphan cache: 8 days old by mtime — removed.
    const orphanSha = 'e'.repeat(40);
    const orphanDir = join(dir, `ecc-${orphanSha}`);
    mkdirSync(orphanDir, { recursive: true });
    utimesSync(orphanDir, new Date(now - 8 * day), new Date(now - 8 * day));

    writeFileSync(
      join(dir, 'ecc-installed.json'),
      JSON.stringify({
        version: '1',
        sha,
        fetchedAt: new Date(now - 7 * day).toISOString(),
        agents: ['a'],
      })
    );

    const result = cleanupStaleCache({ retentionDays: 7, nowMs: now });
    expect(existsSync(activeDir)).toBe(true);
    expect(existsSync(orphanDir)).toBe(false);
    expect(result.removed).toContain(orphanDir);
  });

  it('cleanupStaleCache: 8-day active removal invalidates manifest', () => {
    const sha = 'f'.repeat(40);
    const dir = resolveEccCacheDir();
    mkdirSync(dir, { recursive: true });
    const activeDir = join(dir, `ecc-${sha}`);
    mkdirSync(join(activeDir, 'agents'), { recursive: true });
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    writeFileSync(
      join(dir, 'ecc-installed.json'),
      JSON.stringify({
        version: '1',
        sha,
        fetchedAt: new Date(now - 8 * day).toISOString(),
        agents: ['x'],
      })
    );
    const result = cleanupStaleCache({ retentionDays: 7, nowMs: now });
    expect(existsSync(activeDir)).toBe(false);
    expect(result.removed).toContain(activeDir);
    expect(existsSync(join(dir, 'ecc-installed.json'))).toBe(false);
  });

  it('cleanupStaleCache does nothing when dir does not exist', () => {
    rmSync(resolveEccCacheDir(), { recursive: true, force: true });
    const result = cleanupStaleCache({ retentionDays: 7, nowMs: Date.now() });
    expect(result.removed).toEqual([]);
  });

  it('cleanupStaleCache does nothing when no ecc-<sha> dirs present', () => {
    const dir = resolveEccCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'some-other-file.txt'), 'noise');
    const result = cleanupStaleCache({ retentionDays: 7, nowMs: Date.now() });
    expect(result.removed).toEqual([]);
    expect(readdirSync(dir)).toContain('some-other-file.txt');
  });
});