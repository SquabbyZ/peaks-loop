import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { buildResumeContext } from '../../src/services/session/session-resume-service.js';

const TEMPS: string[] = [];

function tempProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'peaks-resume-'));
  TEMPS.push(p);
  return p;
}

afterEach(() => {
  while (TEMPS.length > 0) {
    const p = TEMPS.pop();
    if (p) rmSync(p, { recursive: true, force: true });
  }
});

function seedCheckpoint(projectRoot: string, sid: string, overrides: Record<string, unknown> = {}): string {
  const dir = join(projectRoot, '.peaks/_runtime', sid, 'checkpoints');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, '2026-06-17T11-21-42-000Z.json');
  const snapshot = {
    sessionId: sid,
    lastActivity: '2026-06-17T11:00:00Z',
    currentPlan: 'Cross-date consolidation slice',
    openQuestions: ['R2 race condition'],
    recentDecisions: ['use retrospective-<date>'],
    recentArtifactPaths: ['.peaks/_runtime/2026-06-16-session-aaf8c7/rd/...'],
    gitStatus: 'M .peaks/PROJECT.md',
    skillsActive: ['peaks-rd'],
    todoState: ['#3 in_progress'],
    reason: 'periodic',
    createdAt: '2026-06-17T11:21:42.000Z',
    ...overrides
  };
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf8');
  return path;
}

describe('buildResumeContext', () => {
  test('emits a markdown block with all sections', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    const path = seedCheckpoint(project, sid);
    const ctx = buildResumeContext({
      checkpointPath: path,
      now: () => new Date('2026-06-17T12:21:42.000Z')
    });
    expect(ctx.sourcePath).toBe(path);
    expect(ctx.checkpointAgeMs).toBe(60 * 60 * 1000);
    expect(ctx.relativeAgeLabel).toBe('1h ago');
    expect(ctx.markdown).toContain('## Resume context (from checkpoint)');
    expect(ctx.markdown).toContain('### Current plan');
    expect(ctx.markdown).toContain('Cross-date consolidation slice');
    expect(ctx.markdown).toContain('### Open questions');
    expect(ctx.markdown).toContain('- R2 race condition');
    expect(ctx.markdown).toContain('### Recent decisions');
    expect(ctx.markdown).toContain('- use retrospective-<date>');
    expect(ctx.markdown).toContain('### Recent artifact paths');
    expect(ctx.markdown).toContain('### Todo state');
    expect(ctx.markdown).toContain('### Active skills');
    expect(ctx.markdown).toContain('- peaks-rd');
    expect(ctx.markdown).toContain('### Git status');
    expect(ctx.markdown).toContain('M .peaks/PROJECT.md');
  });

  test('renders empty sections as _(none)_ and omits empty git', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    const path = seedCheckpoint(project, sid, {
      openQuestions: [],
      recentDecisions: [],
      recentArtifactPaths: [],
      todoState: [],
      skillsActive: [],
      gitStatus: '',
      currentPlan: ''
    });
    const ctx = buildResumeContext({ checkpointPath: path });
    expect(ctx.markdown).toContain('_(none)_');
    expect(ctx.markdown).not.toContain('### Git status');
  });

  test('relative age renders minutes', () => {
    const project = tempProject();
    const sid = '2026-06-16-session-aaf8c7';
    const path = seedCheckpoint(project, sid, { createdAt: '2026-06-17T11:00:00.000Z' });
    const ctx = buildResumeContext({
      checkpointPath: path,
      now: () => new Date('2026-06-17T11:35:00.000Z')
    });
    expect(ctx.relativeAgeLabel).toBe('35m ago');
  });

  test('throws RESUME_NOT_FOUND when path missing', () => {
    const project = tempProject();
    expect(() => buildResumeContext({ checkpointPath: join(project, 'nope.json') })).toThrow(/RESUME_NOT_FOUND/);
  });

  test('throws on malformed JSON', () => {
    const project = tempProject();
    const path = join(project, 'bad.json');
    writeFileSync(path, '{not valid json', 'utf8');
    expect(() => buildResumeContext({ checkpointPath: path })).toThrow();
  });
});