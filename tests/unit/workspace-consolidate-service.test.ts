import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  CONSOLIDATE_CONSTANTS,
  executeConsolidate,
  planConsolidate,
} from '../../src/services/workspace/workspace-consolidate-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-consolidate-'));
}

function makeSession(
  projectRoot: string,
  sid: string,
  lastActivity: string,
  createdAt: string = `${lastActivity}T10:00:00Z`,
  files: string[] = ['rd/notes.md', 'session.json']
): void {
  const sidPath = join(projectRoot, '.peaks/_runtime', sid);
  mkdirSync(sidPath, { recursive: true });
  for (const rel of files) {
    if (rel === 'session.json') {
      const payload = JSON.stringify({ sessionId: sid, lastActivity, createdAt });
      writeFileSync(join(sidPath, rel), payload, 'utf8');
    } else {
      const dir = join(sidPath, rel.split('/').slice(0, -1).join('/'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(sidPath, rel), `# ${rel}`, 'utf8');
    }
  }
}

const TEMPS: string[] = [];

function tempProject(): string {
  const p = makeProject();
  TEMPS.push(p);
  return p;
}

afterEach(() => {
  while (TEMPS.length > 0) {
    const p = TEMPS.pop();
    if (p) rmSync(p, { recursive: true, force: true });
  }
});

describe('CONSOLIDATE_CONSTANTS', () => {
  test('exposes expected stable names', () => {
    expect(CONSOLIDATE_CONSTANTS.RUNTIME_DIR).toBe('_runtime');
    expect(CONSOLIDATE_CONSTANTS.ARCHIVE_DIR).toBe('_archive');
    expect(CONSOLIDATE_CONSTANTS.RETROSPECTIVE_PREFIX).toBe('retrospective-');
    expect(CONSOLIDATE_CONSTANTS.MANIFEST_FILENAME).toBe('manifest.json');
    expect(CONSOLIDATE_CONSTANTS.DEFAULT_OLDER_THAN_DAYS).toBe(1);
  });
});

describe('planConsolidate', () => {
  test('same-date session is classified as fresh and skipped', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-17-session-aaa111', '2026-06-17');
    const plan = await planConsolidate(project, {
      apply: false,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(plan.moves).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toBe('fresh');
    expect(plan.dryRun).toBe(true);
  });

  test('cross-date session is classified as cross-date and move-eligible', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-15-session-bbb222', '2026-06-15');
    const plan = await planConsolidate(project, {
      apply: false,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0]?.reason).toBe('cross-date');
    expect(plan.moves[0]?.targetPath).toMatch(
      /\.peaks\/_archive\/retrospective-2026-06-17\/2026-06-15-session-bbb222$/
    );
  });

  test('--keep filter excludes listed sids even when cross-date', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-15-session-ccc333', '2026-06-15');
    makeSession(project, '2026-06-15-session-ddd444', '2026-06-15');
    const plan = await planConsolidate(project, {
      apply: false,
      keep: new Set(['2026-06-15-session-ccc333']),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(plan.keep).toEqual(['2026-06-15-session-ccc333']);
    expect(plan.moves.map((m) => m.sessionId)).toEqual(['2026-06-15-session-ddd444']);
    expect(plan.skipped.find((s) => s.sessionId === '2026-06-15-session-ccc333')?.reason).toBe('kept');
  });

  test('--older-than 7 window admits only sessions ≥ 7 days old', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-15-session-eee555', '2026-06-15');
    makeSession(project, '2026-06-01-session-fff666', '2026-06-01');
    const plan = await planConsolidate(project, {
      apply: false,
      keep: new Set(),
      olderThanDays: 7,
      today: '2026-06-17'
    });
    expect(plan.moves.map((m) => m.sessionId)).toEqual(['2026-06-01-session-fff666']);
    expect(plan.skipped.find((s) => s.sessionId === '2026-06-15-session-eee555')?.reason).toBe('fresh');
  });

  test('missing session.json is classified as missing-lastActivity', async () => {
    const project = tempProject();
    mkdirSync(join(project, '.peaks/_runtime/2026-06-15-session-ggg777/rd'), { recursive: true });
    writeFileSync(join(project, '.peaks/_runtime/2026-06-15-session-ggg777/rd/notes.md'), 'x', 'utf8');
    const plan = await planConsolidate(project, {
      apply: false,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toBe('missing-lastActivity');
  });

  test('invalid-sid directory is skipped and not moved', async () => {
    const project = tempProject();
    mkdirSync(join(project, '.peaks/_runtime/sid-3'), { recursive: true });
    const plan = await planConsolidate(project, {
      apply: false,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(plan.moves).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('invalid-sid');
  });

  test('empty _runtime/ returns an empty plan', async () => {
    const project = tempProject();
    mkdirSync(join(project, '.peaks/_runtime'), { recursive: true });
    const plan = await planConsolidate(project, {
      apply: false,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(plan.candidates).toEqual([]);
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});

describe('executeConsolidate (apply)', () => {
  test('moves source → retrospective archive, writes manifest.json', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-15-session-hhh888', '2026-06-15');
    const sourcePath = join(project, '.peaks/_runtime/2026-06-15-session-hhh888');
    const result = await executeConsolidate(project, {
      apply: true,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(result.moved).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(existsSync(sourcePath)).toBe(false);
    const archivePath = join(project, '.peaks/_archive/retrospective-2026-06-17/2026-06-15-session-hhh888');
    expect(existsSync(archivePath)).toBe(true);
    const manifestPath = join(archivePath, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      sessionId: string;
      reason: string;
      fileList: string[];
      originalLastActivity: string;
      originalCreatedAt: string | null;
    };
    expect(manifest.sessionId).toBe('2026-06-15-session-hhh888');
    expect(manifest.reason).toBe('cross-date consolidate');
    expect(manifest.originalLastActivity).toBe('2026-06-15');
    expect(manifest.fileList).toContain('rd/notes.md');
    expect(manifest.fileList).toContain('session.json');
    expect(manifest.originalCreatedAt).toBe('2026-06-15T10:00:00Z');
  });

  test('dry-run does not write any files', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-15-session-iii999', '2026-06-15');
    const sourcePath = join(project, '.peaks/_runtime/2026-06-15-session-iii999');
    const result = await executeConsolidate(project, {
      apply: false,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(result.moved).toHaveLength(0);
    expect(result.plan.dryRun).toBe(true);
    expect(existsSync(sourcePath)).toBe(true);
    expect(existsSync(join(project, '.peaks/_archive/retrospective-2026-06-17'))).toBe(false);
  });

  test('kept sessions are never moved, exit clean', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-15-session-jjj000', '2026-06-15');
    makeSession(project, '2026-06-15-session-kkk111', '2026-06-15');
    const keepSrc = join(project, '.peaks/_runtime/2026-06-15-session-jjj000');
    const result = await executeConsolidate(project, {
      apply: true,
      keep: new Set(['2026-06-15-session-jjj000']),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(result.moved.map((m) => m.sessionId)).toEqual(['2026-06-15-session-kkk111']);
    expect(existsSync(keepSrc)).toBe(true);
  });

  // Plan 3a Task 4.6: production now pre-removes a stale file-shaped
  // target before renameSync, so Windows MoveFileExW no longer silently
  // replaces a file with the source directory. Atomicity is preserved
  // on every platform; this test now runs unconditionally.
  test('atomicity: when target rename collides, source is left in place', async () => {
    const project = tempProject();
    makeSession(project, '2026-06-15-session-lll222', '2026-06-15');
    const sourcePath = join(project, '.peaks/_runtime/2026-06-15-session-lll222');

    // Pre-create a *file* at the archive path so the renameSync inside
    // moveSessionAtomic will fail with EEXIST.
    const blocker = join(project, '.peaks/_archive/retrospective-2026-06-17/2026-06-15-session-lll222');
    mkdirSync(join(project, '.peaks/_archive/retrospective-2026-06-17'), { recursive: true });
    writeFileSync(blocker, 'NOT-A-DIRECTORY', 'utf8');

    const result = await executeConsolidate(project, {
      apply: true,
      keep: new Set(),
      olderThanDays: 1,
      today: '2026-06-17'
    });
    expect(result.moved).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.sessionId).toBe('2026-06-15-session-lll222');
    // Source must still be present — no half state.
    expect(existsSync(sourcePath)).toBe(true);
  });
});