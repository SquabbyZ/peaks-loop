import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  archiveSession,
  planArchive,
} from '../../src/services/workspace/workspace-archive-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-archive-'));
}

describe('planArchive', () => {
  test('returns target path under _archive/<yyyy-mm>/<sid>/', () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, '.peaks/_runtime/2026-06-10-session-aaa111/rd'), { recursive: true });
      const plan = planArchive(project, '2026-06-10-session-aaa111');
      expect(plan.targetPath).toMatch(/\.peaks\/_archive\/2026-06\/2026-06-10-session-aaa111$/);
      expect(plan.sourceExists).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns sourceExists=false when source missing', () => {
    const project = makeProject();
    try {
      const plan = planArchive(project, '2026-06-11-session-bbb222');
      expect(plan.sourceExists).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('archiveSession', () => {
  test('dry-run: does not move, only reports', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      const src = join(project, '.peaks/_runtime', sid);
      mkdirSync(join(src, 'rd'), { recursive: true });
      writeFileSync(join(src, 'rd/tech-doc.md'), '# tech', 'utf8');
      const result = archiveSession(project, { sid, apply: false });
      expect(result.moved).toEqual([]);
      expect(existsSync(src)).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('apply: moves _runtime/<sid>/ → _archive/2026-06/<sid>/', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      const src = join(project, '.peaks/_runtime', sid);
      mkdirSync(join(src, 'rd'), { recursive: true });
      writeFileSync(join(src, 'rd/tech-doc.md'), '# tech', 'utf8');
      const result = archiveSession(project, { sid, apply: true });
      expect(result.moved).toEqual([sid]);
      expect(existsSync(src)).toBe(false);
      const target = join(project, '.peaks/_archive/2026-06', sid);
      expect(existsSync(target)).toBe(true);
      expect(existsSync(join(target, 'rd/tech-doc.md'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws NAMING_INVALID when sid is not a canonical session id', () => {
    const project = makeProject();
    try {
      expect(() => archiveSession(project, { sid: 'sid-3', apply: true })).toThrow(/NAMING_INVALID/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
