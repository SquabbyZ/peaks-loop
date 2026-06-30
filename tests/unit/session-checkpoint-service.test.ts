import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  CHECKPOINT_CONSTANTS,
  CHECKPOINT_REASONS,
  isValidCheckpointReason,
  latestCheckpointPath,
  listCheckpointPaths,
  readCheckpoint,
  writeCheckpoint,
  type CheckpointSnapshot,
} from '../../src/services/session/session-checkpoint-service.js';

const TEMPS: string[] = [];

function tempProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'peaks-checkpoint-'));
  TEMPS.push(p);
  return p;
}

afterEach(() => {
  while (TEMPS.length > 0) {
    const p = TEMPS.pop();
    if (p) rmSync(p, { recursive: true, force: true });
  }
});

function seedSession(projectRoot: string, sid: string, lastActivity: string): void {
  const sidPath = join(projectRoot, '.peaks/_runtime', sid);
  mkdirSync(sidPath, { recursive: true });
  writeFileSync(
    join(sidPath, 'session.json'),
    JSON.stringify({ sessionId: sid, lastActivity }),
    'utf8'
  );
}

describe('CHECKPOINT_CONSTANTS', () => {
  test('exposes expected values', () => {
    expect(CHECKPOINT_CONSTANTS.CHECKPOINTS_DIR).toBe('checkpoints');
    expect(CHECKPOINT_CONSTANTS.CHECKPOINT_FILENAME_EXT).toBe('.json');
    expect(CHECKPOINT_CONSTANTS.MAX_CHECKPOINTS).toBe(10);
  });
});

describe('CHECKPOINT_REASONS', () => {
  test('lists the 5 documented reasons', () => {
    expect(CHECKPOINT_REASONS).toEqual([
      'context-fill',
      'periodic',
      'artifact-written',
      'user-pause',
      'user-close'
    ]);
  });

  test('isValidCheckpointReason matches', () => {
    expect(isValidCheckpointReason('periodic')).toBe(true);
    expect(isValidCheckpointReason('unknown')).toBe(false);
  });
});

describe('writeCheckpoint', () => {
  test('writes JSON with all required fields', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    seedSession(project, sid, '2026-06-17');
    const fakeNow = new Date('2026-06-17T11:21:42.123Z');
    const result = writeCheckpoint(project, {
      sessionId: sid,
      reason: 'periodic',
      now: () => fakeNow,
      currentPlan: 'PRD#11 cross-date consolidation',
      openQuestions: ['R2 race condition'],
      recentDecisions: ['use <sessionId>/<sessionId> backticks'],
      recentArtifactPaths: ['.peaks/_runtime/2026-06-16-session-aaf8c7/rd/...'],
      gitStatus: 'M .peaks/PROJECT.md',
      skillsActive: ['peaks-rd'],
      todoState: ['#3 in_progress']
    });
    expect(result.sessionId).toBe(sid);
    expect(result.reason).toBe('periodic');
    expect(result.createdAt).toBe(fakeNow.toISOString());
    expect(existsSync(result.path)).toBe(true);

    const snapshot = JSON.parse(readFileSync(result.path, 'utf8')) as CheckpointSnapshot;
    expect(snapshot.sessionId).toBe(sid);
    expect(snapshot.lastActivity).toBe('2026-06-17');
    expect(snapshot.currentPlan).toBe('PRD#11 cross-date consolidation');
    expect(snapshot.openQuestions).toEqual(['R2 race condition']);
    expect(snapshot.recentDecisions).toEqual(['use <sessionId>/<sessionId> backticks']);
    expect(snapshot.recentArtifactPaths).toEqual(['.peaks/_runtime/2026-06-16-session-aaf8c7/rd/...']);
    expect(snapshot.gitStatus).toBe('M .peaks/PROJECT.md');
    expect(snapshot.skillsActive).toEqual(['peaks-rd']);
    expect(snapshot.todoState).toEqual(['#3 in_progress']);
    expect(snapshot.reason).toBe('periodic');
    expect(snapshot.createdAt).toBe(fakeNow.toISOString());
  });

  test('idempotent: multiple writes produce multiple files', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    seedSession(project, sid, '2026-06-17');
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 5, 17, 11, 21, t++));
    const r1 = writeCheckpoint(project, { sessionId: sid, reason: 'periodic', now: clock });
    const r2 = writeCheckpoint(project, { sessionId: sid, reason: 'context-fill', now: clock });
    expect(existsSync(r1.path)).toBe(true);
    expect(existsSync(r2.path)).toBe(true);
    expect(r1.path).not.toBe(r2.path);
    expect(listCheckpointPaths(project, sid)).toHaveLength(2);
  });

  test('pruning: only MAX_CHECKPOINTS newest retained', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    seedSession(project, sid, '2026-06-17');
    for (let i = 0; i < 13; i++) {
      writeCheckpoint(project, {
        sessionId: sid,
        reason: 'periodic',
        now: () => new Date(Date.UTC(2026, 5, 17, 11, 21, i))
      });
    }
    const retained = listCheckpointPaths(project, sid);
    expect(retained).toHaveLength(CHECKPOINT_CONSTANTS.MAX_CHECKPOINTS);
    const latest = latestCheckpointPath(project, sid);
    expect(latest).not.toBeNull();
    expect(latest).toBe(retained[0]);
    const snap = readCheckpoint(latest as string);
    expect(snap.createdAt).toBe(new Date(Date.UTC(2026, 5, 17, 11, 21, 12)).toISOString());
  });

  test('writes to .peaks/_runtime/<sid>/checkpoints/<filename>.json', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    seedSession(project, sid, '2026-06-17');
    const fakeNow = new Date('2026-06-17T11:21:42.000Z');
    const result = writeCheckpoint(project, { sessionId: sid, reason: 'periodic', now: () => fakeNow });
    expect(result.path).toContain(join('.peaks/_runtime', sid, 'checkpoints').split(sep).join('/'));
    expect(result.path.endsWith('.json')).toBe(true);
  });

  test('falls back to createdAt when session.json missing or lastActivity absent', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    const fakeNow = new Date('2026-06-17T11:21:42.000Z');
    const result = writeCheckpoint(project, {
      sessionId: sid,
      reason: 'user-pause',
      now: () => fakeNow
    });
    const snap = readCheckpoint(result.path);
    expect(snap.lastActivity).toBe(fakeNow.toISOString());
  });
});