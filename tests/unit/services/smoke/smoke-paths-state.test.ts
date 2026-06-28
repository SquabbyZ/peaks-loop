/**
 * v2.15.0 follow-up — G14 tests: smoke-paths-state service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addCriticalPath,
  EMPTY_SMOKE_STATE,
  impactMustChecksToCriticalPaths,
  isCriticalPathSource,
  makeCriticalPathId,
  readSmokeState,
  recordRun,
  summarizeState,
  writeSmokeState,
  type CriticalPath
} from '../../../../src/services/smoke/smoke-paths-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-smoke-test-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('makeCriticalPathId', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(makeCriticalPathId('User Login Flow')).toBe('user-login-flow');
  });
  it('trims leading/trailing hyphens', () => {
    expect(makeCriticalPathId('---test---')).toBe('test');
  });
  it('caps at 60 chars', () => {
    const long = 'a'.repeat(100);
    expect(makeCriticalPathId(long).length).toBe(60);
  });
});

describe('isCriticalPathSource', () => {
  it('accepts the 5 known sources', () => {
    for (const s of ['prd-business-scenario', 'boss-stated', 'historical-incident', 'impact-must-check', 'manual']) {
      expect(isCriticalPathSource(s)).toBe(true);
    }
  });
  it('rejects unknown sources', () => {
    expect(isCriticalPathSource('random')).toBe(false);
  });
});

describe('readSmokeState / writeSmokeState', () => {
  it('returns EMPTY_SMOKE_STATE when no file exists', () => {
    expect(readSmokeState(tmpDir)).toEqual(EMPTY_SMOKE_STATE);
  });
  it('round-trips state through disk', () => {
    const path: CriticalPath = {
      id: 'login',
      name: 'Login flow',
      source: 'manual',
      registeredAt: '2026-06-28T10:00:00Z',
      status: 'pending',
      history: []
    };
    writeSmokeState(tmpDir, { version: 1, paths: [path] });
    expect(existsSync(join(tmpDir, '.peaks/smoke-paths.json'))).toBe(true);
    const reloaded = readSmokeState(tmpDir);
    expect(reloaded.paths).toEqual([path]);
  });
  it('returns EMPTY when JSON is malformed', () => {
    const { writeFileSync, mkdirSync } = require('node:fs');
    mkdirSync(join(tmpDir, '.peaks'), { recursive: true });
    writeFileSync(join(tmpDir, '.peaks/smoke-paths.json'), '{ not valid json', 'utf8');
    expect(readSmokeState(tmpDir)).toEqual(EMPTY_SMOKE_STATE);
  });
});

describe('addCriticalPath (dedup by id)', () => {
  it('adds a new path', () => {
    const path: CriticalPath = { id: 'a', name: 'A', source: 'manual', registeredAt: 't', status: 'pending', history: [] };
    const next = addCriticalPath(EMPTY_SMOKE_STATE, path);
    expect(next.paths).toHaveLength(1);
  });
  it('replaces an existing path with the same id', () => {
    const a1: CriticalPath = { id: 'a', name: 'A v1', source: 'manual', registeredAt: 't1', status: 'pending', history: [] };
    const a2: CriticalPath = { id: 'a', name: 'A v2', source: 'boss-stated', registeredAt: 't2', status: 'pass', history: [{ at: 't2', status: 'pass' }] };
    const s1 = addCriticalPath(EMPTY_SMOKE_STATE, a1);
    const s2 = addCriticalPath(s1, a2);
    expect(s2.paths).toHaveLength(1);
    expect(s2.paths[0]?.name).toBe('A v2');
    expect(s2.paths[0]?.status).toBe('pass');
  });
});

describe('recordRun (history keeps last 5)', () => {
  it('records a pass run', () => {
    const path: CriticalPath = { id: 'x', name: 'X', source: 'manual', registeredAt: 't', status: 'pending', history: [] };
    const s1 = addCriticalPath(EMPTY_SMOKE_STATE, path);
    const s2 = recordRun(s1, 'x', 'pass', 'looks good', new Date('2026-06-28T10:00:00Z'));
    const updated = s2.paths[0]!;
    expect(updated.status).toBe('pass');
    expect(updated.lastRunAt).toBe('2026-06-28T10:00:00.000Z');
    expect(updated.history).toHaveLength(1);
  });
  it('keeps at most 5 history entries (rolling window)', () => {
    const path: CriticalPath = { id: 'x', name: 'X', source: 'manual', registeredAt: 't', status: 'pending', history: [] };
    let s = addCriticalPath(EMPTY_SMOKE_STATE, path);
    for (let i = 0; i < 8; i++) {
      s = recordRun(s, 'x', i % 2 === 0 ? 'pass' : 'fail', `run ${i}`, new Date(2026, 5, 28, 10, i));
    }
    const updated = s.paths[0]!;
    expect(updated.history).toHaveLength(5);
  });
  it('returns state unchanged when id not found', () => {
    const s = recordRun(EMPTY_SMOKE_STATE, 'nonexistent', 'pass');
    expect(s).toBe(EMPTY_SMOKE_STATE);
  });
});

describe('impactMustChecksToCriticalPaths', () => {
  it('converts must-check items to pending critical paths', () => {
    const items = [
      { scenario: 'login 4 flow', category: 'integration', priority: 'P0' },
      { scenario: 'permission check', category: 'business', priority: 'P0' }
    ];
    const paths = impactMustChecksToCriticalPaths(items, new Date('2026-06-28T10:00:00Z'));
    expect(paths).toHaveLength(2);
    expect(paths[0]?.source).toBe('impact-must-check');
    expect(paths[0]?.status).toBe('pending');
    // The id is derived by makeCriticalPathId which strips non-ASCII,
    // so the result is the ASCII portion slugified.
    expect(paths[0]?.id).toBe('login-4-flow');
    expect(paths[0]?.name).toBe('login 4 flow');
  });
});

describe('summarizeState', () => {
  it('counts pass/fail/pending correctly', () => {
    const make = (id: string, status: 'pass' | 'fail' | 'pending'): CriticalPath => ({
      id, name: id, source: 'manual', registeredAt: 't', status, history: []
    });
    const s = {
      version: 1 as const,
      paths: [make('a', 'pass'), make('b', 'fail'), make('c', 'pending'), make('d', 'pass')]
    };
    const summary = summarizeState(s);
    expect(summary.totalPaths).toBe(4);
    expect(summary.passedPaths).toBe(2);
    expect(summary.failedPaths).toBe(1);
    expect(summary.pendingPaths).toBe(1);
    expect(summary.failedDetails[0]?.id).toBe('b');
  });
  it('returns empty failed details when no failures', () => {
    const path: CriticalPath = { id: 'a', name: 'A', source: 'manual', registeredAt: 't', status: 'pass', history: [] };
    const summary = summarizeState({ version: 1, paths: [path] });
    expect(summary.failedPaths).toBe(0);
    expect(summary.failedDetails).toEqual([]);
  });
});
