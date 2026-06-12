import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  listRuntimeSessions,
  planRuntimeCleanup,
  executeRuntimeCleanup,
  type RuntimeSessionInfo,
} from '../../src/services/workspace/workspace-clean-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-clean-runtime-'));
}

function touchDir(path: string, ageHours: number): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'marker.txt'), 'x', 'utf8');
  const ageSec = ageHours * 3600;
  const past = new Date(Date.now() - ageSec * 1000);
  utimesSync(path, past, past);
  utimesSync(join(path, 'marker.txt'), past, past);
}

describe('listRuntimeSessions', () => {
  test('returns all _runtime/<sid> dirs with mtime', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, '2026-06-10-session-aaa111'), 48);
      touchDir(join(runtimeDir, '2026-06-11-session-bbb222'), 1);
      const list = listRuntimeSessions(project);
      expect(list).toHaveLength(2);
      const names = list.map((s) => s.sid).sort();
      expect(names).toEqual(['2026-06-10-session-aaa111', '2026-06-11-session-bbb222']);
      expect(list[0]?.ageHours).toBeGreaterThan(40);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns empty array when _runtime/ does not exist', () => {
    const project = makeProject();
    try {
      expect(listRuntimeSessions(project)).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('planRuntimeCleanup', () => {
  test('identifies sessions older than threshold as eligible', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, 'old-sid'), 100);
      touchDir(join(runtimeDir, 'fresh-sid'), 1);
      const sessions: RuntimeSessionInfo[] = listRuntimeSessions(project);
      const plan = planRuntimeCleanup(sessions, { olderThanHours: 24, graceHours: 24 });
      expect(plan.eligible).toEqual(['old-sid']);
      expect(plan.skipped).toHaveLength(1);
      expect(plan.skipped[0]?.sid).toBe('fresh-sid');
      expect(plan.skipped[0]?.reason).toMatch(/fresh/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('executeRuntimeCleanup', () => {
  test('dry-run does not delete, only reports', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, 'old-sid'), 100);
      const result = executeRuntimeCleanup(project, { olderThanHours: 24, graceHours: 24, apply: false });
      expect(result.deleted).toEqual(['old-sid']);
      expect(existsSync(join(runtimeDir, 'old-sid'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply actually deletes eligible sessions', () => {
    const project = makeProject();
    try {
      const runtimeDir = join(project, '.peaks/_runtime');
      mkdirSync(runtimeDir, { recursive: true });
      touchDir(join(runtimeDir, 'old-sid'), 100);
      const result = executeRuntimeCleanup(project, { olderThanHours: 24, graceHours: 24, apply: true });
      expect(result.deleted).toEqual(['old-sid']);
      expect(existsSync(join(runtimeDir, 'old-sid'))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});