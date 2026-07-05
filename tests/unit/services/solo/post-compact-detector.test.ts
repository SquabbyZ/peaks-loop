/**
 * v2.11.0 Group F (Tier 9) — D7 post-compact detector unit tests.
 *
 * Covers:
 *   - Post-compact match: today's checkpoint + mode + active skill
 *   - No checkpoint today → 'no-checkpoint-today'
 *   - Stale checkpoint (yesterday) → fall through (still 'no-checkpoint-today' since not today)
 *   - Missing mode field → 'no-mode-field'
 *   - Active skill mismatch → 'active-skill-mismatch'
 *   - sid-unbound (empty sessionId)
 *   - runtime-dir-missing
 *   - Multi-checkpoint ambiguity (same-mtime tie)
 *   - formatPostCompactResumeLogLine shape (auto vs skip)
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectPostCompactResume,
  formatPostCompactResumeLogLine
} from '../../../../src/services/solo/post-compact-detector.js';
import type { PostCompactResumeProbe } from '../../../../src/services/solo/post-compact-detector.js';

let workDir: string;
let runtimeDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'peaks-pcd-'));
  runtimeDir = join(workDir, '.peaks', '_runtime', '2026-06-26-session-test', 'checkpoints');
  mkdirSync(runtimeDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeCheckpoint(filename: string, payload: Record<string, unknown>, mtime: Date): void {
  const filePath = join(runtimeDir, filename);
  writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  // bump mtime to the desired moment
  const fs = require('node:fs') as typeof import('node:fs');
  fs.utimesSync(filePath, mtime, mtime);
}

describe('detectPostCompactResume — post-compact match (happy path)', () => {
  test("today's checkpoint + mode + peaks-code active → shouldAutoResume=true", async () => {
    const now = new Date('2026-06-26T12:00:00Z');
    const todayMtime = new Date('2026-06-26T08:00:00Z');
    writeCheckpoint('2026-06-26T08-00-00-000Z.json', {
      currentPlan: 'draft v2.11.0 PRD',
      openQuestions: ['how to gate D5.b?'],
      recentDecisions: ['D7 ships in Group F'],
      mode: 'assisted'
    }, todayMtime);
    const probe = await detectPostCompactResume({
      sessionId: '2026-06-26-session-test',
      projectRoot: workDir,
      now: () => now,
      activeSkill: 'peaks-code'
    });
    expect(probe.shouldAutoResume).toBe(true);
    expect(probe.reason).toBe('post-compact-match');
    expect(probe.mode).toBe('assisted');
    expect(probe.task).toBe('draft v2.11.0 PRD');
    expect(probe.openQuestions).toEqual(['how to gate D5.b?']);
    expect(probe.recentDecisions).toEqual(['D7 ships in Group F']);
  });
});

describe('detectPostCompactResume — early-exit reasons', () => {
  test('empty sessionId → sid-unbound', async () => {
    const probe = await detectPostCompactResume({
      sessionId: '',
      projectRoot: workDir
    });
    expect(probe.shouldAutoResume).toBe(false);
    expect(probe.reason).toBe('sid-unbound');
  });

  test('runtime dir missing → runtime-dir-missing', async () => {
    const probe = await detectPostCompactResume({
      sessionId: '2026-06-26-session-missing',
      projectRoot: workDir
    });
    expect(probe.shouldAutoResume).toBe(false);
    expect(probe.reason).toBe('runtime-dir-missing');
  });

  test('runtime dir exists but checkpoints dir empty → no-checkpoint-today', async () => {
    const otherDir = mkdtempSync(join(tmpdir(), 'peaks-pcd-empty-'));
    try {
      mkdirSync(join(otherDir, '.peaks', '_runtime', '2026-06-26-session-empty', 'checkpoints'), { recursive: true });
      const probe = await detectPostCompactResume({
        sessionId: '2026-06-26-session-empty',
        projectRoot: otherDir
      });
      expect(probe.shouldAutoResume).toBe(false);
      expect(probe.reason).toBe('no-checkpoint-today');
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

describe('detectPostCompactResume — mode + skill gates', () => {
  test('checkpoint without mode field → no-mode-field', async () => {
    const now = new Date('2026-06-26T12:00:00Z');
    writeCheckpoint('2026-06-26T09-00-00-000Z.json', {
      currentPlan: 'in flight'
    }, new Date('2026-06-26T09:00:00Z'));
    const probe = await detectPostCompactResume({
      sessionId: '2026-06-26-session-test',
      projectRoot: workDir,
      now: () => now,
      activeSkill: 'peaks-code'
    });
    expect(probe.shouldAutoResume).toBe(false);
    expect(probe.reason).toBe('no-mode-field');
  });

  test('active skill is not peaks-code → active-skill-mismatch', async () => {
    const now = new Date('2026-06-26T12:00:00Z');
    writeCheckpoint('2026-06-26T10-00-00-000Z.json', {
      currentPlan: 'in flight',
      mode: 'assisted'
    }, new Date('2026-06-26T10:00:00Z'));
    const probe = await detectPostCompactResume({
      sessionId: '2026-06-26-session-test',
      projectRoot: workDir,
      now: () => now,
      activeSkill: 'peaks-rd'  // NOT peaks-code
    });
    expect(probe.shouldAutoResume).toBe(false);
    expect(probe.reason).toBe('active-skill-mismatch');
    expect(probe.warnings.length).toBeGreaterThan(0);
  });
});

describe('detectPostCompactResume — disambiguation', () => {
  test('multiple checkpoints with same mtime → multiple-checkpoints-ambiguous', async () => {
    const now = new Date('2026-06-26T12:00:00Z');
    const sameMtime = new Date('2026-06-26T11:00:00Z');
    writeCheckpoint('2026-06-26T11-00-00-001Z.json', {
      currentPlan: 'session A',
      mode: 'assisted'
    }, sameMtime);
    writeCheckpoint('2026-06-26T11-00-00-002Z.json', {
      currentPlan: 'session B',
      mode: 'full-auto'
    }, sameMtime);
    const probe = await detectPostCompactResume({
      sessionId: '2026-06-26-session-test',
      projectRoot: workDir,
      now: () => now,
      activeSkill: 'peaks-code'
    });
    expect(probe.shouldAutoResume).toBe(false);
    expect(probe.reason).toBe('multiple-checkpoints-ambiguous');
  });

  test('multiple checkpoints with different mtimes → most-recent wins', async () => {
    const now = new Date('2026-06-26T12:00:00Z');
    writeCheckpoint('2026-06-26T07-00-00-000Z.json', {
      currentPlan: 'older',
      mode: 'strict'
    }, new Date('2026-06-26T07:00:00Z'));
    writeCheckpoint('2026-06-26T11-00-00-000Z.json', {
      currentPlan: 'newer',
      mode: 'full-auto'
    }, new Date('2026-06-26T11:00:00Z'));
    const probe = await detectPostCompactResume({
      sessionId: '2026-06-26-session-test',
      projectRoot: workDir,
      now: () => now,
      activeSkill: 'peaks-code'
    });
    expect(probe.shouldAutoResume).toBe(true);
    expect(probe.task).toBe('newer');
    expect(probe.mode).toBe('full-auto');
  });
});

describe('detectPostCompactResume — presence fallback for mode', () => {
  test('checkpoint mode is "junk" but presenceModeOverride supplies valid mode → shouldAutoResume=true', async () => {
    const now = new Date('2026-06-26T12:00:00Z');
    writeCheckpoint('2026-06-26T11-00-00-000Z.json', {
      currentPlan: 'resume me',
      mode: 'legacy-garbage-mode-value'
    }, new Date('2026-06-26T11:00:00Z'));
    const probe = await detectPostCompactResume({
      sessionId: '2026-06-26-session-test',
      projectRoot: workDir,
      now: () => now,
      activeSkill: 'peaks-code',
      presenceModeOverride: 'swarm'
    });
    expect(probe.shouldAutoResume).toBe(true);
    expect(probe.mode).toBe('swarm');
  });
});

describe('formatPostCompactResumeLogLine — shape', () => {
  test('auto-resume line includes task, mode, checkpoint path', () => {
    const probe: PostCompactResumeProbe = {
      shouldAutoResume: true,
      reason: 'post-compact-match',
      mode: 'assisted',
      checkpointPath: '/abs/path/checkpoint.json',
      task: 'continue work',
      warnings: []
    };
    const line = formatPostCompactResumeLogLine(probe);
    expect(line).toContain('post-compact resume');
    expect(line).toContain('continue work');
    expect(line).toContain('mode=assisted');
    expect(line).toContain('/abs/path/checkpoint.json');
  });

  test('skip line includes the reason', () => {
    const probe: PostCompactResumeProbe = {
      shouldAutoResume: false,
      reason: 'no-checkpoint-today',
      warnings: []
    };
    const line = formatPostCompactResumeLogLine(probe);
    expect(line).toContain('post-compact skip');
    expect(line).toContain('reason=no-checkpoint-today');
  });
});
