import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSpillId,
  hydrate,
  listSpills,
  pruneExpiredSpills,
  spill,
  spillPath
} from '../../../src/services/context/spillover-store.js';
import { SPILL_TTL_MS, type SpillRecord } from '../../../src/services/context/spillover-types.js';

// render and a11y are omitted: this storage API has no user-facing output.
describe('context spillover behavior', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function tmpRoot(): string {
    const root = join(tmpdir(), `spill-test-${randomUUID()}`);
    roots.push(root);
    return root;
  }

  it('creates unique IDs across rapid calls', () => {
    const ids = Array.from({ length: 10 }, () => createSpillId());
    expect(new Set(ids).size).toBe(10);
  });

  it('lists all records in createdAt order', () => {
    const projectRoot = tmpRoot();
    const first = spill({ projectRoot, sessionId: 'session-1' }, { turn: 1 });
    const second = spill({ projectRoot, sessionId: 'session-1' }, { turn: 2 });

    expect(listSpills(projectRoot, 'session-1').map(({ spillId }) => spillId)).toEqual([
      first.spillId,
      second.spillId
    ]);
  });

  it('rejects path traversal identifiers', () => {
    const projectRoot = tmpRoot();
    expect(() => spill({ projectRoot, sessionId: '../escape' }, { turn: 1 })).toThrow('safe path segment');
    expect(() => spillPath(projectRoot, 'session-1', '../escape')).toThrow('safe path segment');
  });

  it('filters records by pending state', () => {
    const projectRoot = tmpRoot();
    const pending = spill({ projectRoot, sessionId: 'session-1' }, { turn: 1 });
    const hydrated = spill({ projectRoot, sessionId: 'session-1' }, { turn: 2 });
    hydrate(projectRoot, 'session-1', hydrated.spillId);

    expect(listSpills(projectRoot, 'session-1', { state: 'pending' }).map(({ spillId }) => spillId)).toEqual([
      pending.spillId
    ]);
  });

  describe('filesystem integration', () => {
    it('writes and hydrates a spill record', () => {
      const projectRoot = tmpRoot();
      const record = spill({ projectRoot, sessionId: 'session-1' }, { turn: 'deferred' });
      const path = spillPath(projectRoot, 'session-1', record.spillId);

      expect(existsSync(path)).toBe(true);
      expect(hydrate(projectRoot, 'session-1', record.spillId)).toMatchObject({
        spillId: record.spillId,
        state: 'hydrated',
        payload: { turn: 'deferred' },
        hydratedAt: expect.any(String)
      });
    });

    it('preserves batchId through list and hydrate', () => {
      const projectRoot = tmpRoot();
      const record = spill({ projectRoot, sessionId: 'session-1', batchId: 'batch-7' }, { turn: 7 });

      expect(listSpills(projectRoot, 'session-1')[0]?.batchId).toBe('batch-7');
      expect(hydrate(projectRoot, 'session-1', record.spillId)?.batchId).toBe('batch-7');
    });

    it('prunes records older than the TTL', () => {
      const projectRoot = tmpRoot();
      const record = spill({ projectRoot, sessionId: 'session-1' }, { turn: 'old' });
      const path = spillPath(projectRoot, 'session-1', record.spillId);
      const stored = JSON.parse(readFileSync(path, 'utf8')) as SpillRecord;
      writeFileSync(path, JSON.stringify({
        ...stored,
        createdAt: new Date(Date.now() - SPILL_TTL_MS - 1).toISOString()
      }), 'utf8');

      expect(pruneExpiredSpills(projectRoot, 'session-1')).toEqual([path]);
      expect(existsSync(path)).toBe(false);
    });

    it('TC-8: lstat defense-in-depth - rejects symbolic links pointing outside spill dir', () => {
      // 1. Create a real file outside the spill dir
      const projectRoot = tmpRoot();
      mkdirSync(projectRoot, { recursive: true });
      const outsideFile = join(projectRoot, 'outside.txt');
      writeFileSync(outsideFile, 'sensitive data outside spill dir');

      // 2. Create the spill dir + a symlink pointing to outsideFile
      const spillDirPath = join(projectRoot, '.peaks', '_runtime', 'session-001', 'spill');
      mkdirSync(spillDirPath, { recursive: true });
      const symlinkPath = join(spillDirPath, 'malicious.json');
      // Use 'junction' type on Windows to avoid EPERM (symlinks require elevated privileges)
      symlinkSync(outsideFile, symlinkPath, 'junction');

      // 3. Try to hydrate via the symlink - should return null
      // (lstat detects the symlink and throws inside the try-catch, so hydrate returns null per existing error handling)
      const result = hydrate(projectRoot, 'session-001', 'malicious');
      expect(result).toBeNull();

      // 4. Cleanup
      unlinkSync(symlinkPath);
      unlinkSync(outsideFile);
    });
  });
});
