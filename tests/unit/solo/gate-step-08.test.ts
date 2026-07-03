/**
 * v3.1.2 Step 0.8 — `peaks solo gate-step-08` unit tests.
 *
 * Covers the 4 evaluation paths:
 *   1. allow when job-shape.json exists with isJob=true
 *   2. allow when job-shape.json exists with isJob=false
 *   3. block when job-shape.json is missing AND backup regex matches
 *   4. allow when job-shape.json is missing AND backup regex doesn't match
 *
 * Plus:
 *   - Next: slice #N+1 of M (<currentSlice>) line when progress.json
 *     exists alongside an isJob=true decision.
 *
 * Karpathy §4: every AC ↔ passing test.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  evaluateStep08,
  STEP_08_BACKUP_REGEX,
  type Step08Verdict
} from '../../../src/services/solo/step-08-gate.js';
import { writeJobShapeDecision } from '../../../src/services/solo/job-shape-decision.js';
import { writeJobProgress } from '../../../src/services/job/job-progress-store.js';

const SESSION_ID = '2026-07-03-test-step-08-gate';
const FIXED_NOW = new Date('2026-07-03T12:00:00.000Z');

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-step-08-gate-'));
}

function writeShape(project: string, isJob: boolean, suggestedJobId: string): void {
  writeJobShapeDecision(
    project,
    SESSION_ID,
    {
      isJob,
      rationale: 'unit-test rationale',
      suggestedJobId,
      suggestedStrategy: 'single',
      confidence: 'high',
      prompt: 'unit-test prompt'
    },
    { now: () => FIXED_NOW, force: true }
  );
}

function writeProgress(project: string, jid: string, done: number, total: number, currentSlice: string): void {
  writeJobProgress(project, SESSION_ID, {
    jobId: jid,
    done,
    total,
    currentSlice,
    lastCommitSha: 'a1b2c3d4e5f6',
    updatedAt: FIXED_NOW.toISOString()
  });
}

describe('solo/step-08-gate: evaluateStep08 — 4 paths', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('AC-1: job-shape.json isJob=true → allow (mode=job)', () => {
    writeShape(project, true, 'unit-test-job-allow-true');
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.allow).toBe(true);
    expect(r.verdict.kind).toBe<Step08Verdict['kind']>('allow-job');
    if (r.verdict.kind === 'allow-job') {
      expect(r.verdict.decision.isJob).toBe(true);
      expect(r.verdict.progress).toBeNull();
    }
    expect(r.nextSliceLine).toBeNull();
  });

  test('AC-2: job-shape.json isJob=false → allow (mode=single)', () => {
    writeShape(project, false, 'unit-test-job-allow-false');
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.allow).toBe(true);
    expect(r.verdict.kind).toBe<Step08Verdict['kind']>('allow-single');
    expect(r.nextSliceLine).toBeNull();
  });

  test('AC-3: job-shape.json missing + backup regex match → block (allow=false)', () => {
    const prompt = '继续执行下个 slice,直到全部添加完,不用考虑费用';
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID, prompt });
    expect(r.allow).toBe(false);
    expect(r.verdict.kind).toBe<Step08Verdict['kind']>('block-missing-decision');
    if (r.verdict.kind === 'block-missing-decision') {
      expect(r.verdict.promptHit).toBe(true);
      expect(r.verdict.promptSource).toBe('flag');
    }
  });

  test('AC-4: job-shape.json missing + no regex match → allow (no Job trigger)', () => {
    const prompt = 'Just a one-off question about the codebase — no batch.';
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID, prompt });
    expect(r.allow).toBe(true);
    expect(r.verdict.kind).toBe<Step08Verdict['kind']>('block-missing-decision');
    if (r.verdict.kind === 'block-missing-decision') {
      expect(r.verdict.promptHit).toBe(false);
      expect(r.verdict.promptSource).toBe('flag');
    }
  });
});

describe('solo/step-08-gate: Next: slice context injection', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('AC-5: when isJob=true AND progress.json exists, nextSliceLine carries #N+1 of M (<slice>)', () => {
    const jid = 'unit-test-job-progress';
    writeShape(project, true, jid);
    writeProgress(project, jid, 4, 35, 'slice-5: app/modules/auth');
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.allow).toBe(true);
    expect(r.verdict.kind).toBe<Step08Verdict['kind']>('allow-job');
    expect(r.nextSliceLine).not.toBeNull();
    expect(r.nextSliceLine).toMatch(/Next: slice #5 of 35 \(slice-5: app\/modules\/auth\)/);
  });

  test('AC-6: when isJob=true AND progress.json is missing, nextSliceLine is null', () => {
    writeShape(project, true, 'unit-test-job-no-progress');
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.allow).toBe(true);
    expect(r.nextSliceLine).toBeNull();
  });
});

describe('solo/step-08-gate: backup regex shape (sanity)', () => {
  test('matches every documented trigger keyword', () => {
    expect(STEP_08_BACKUP_REGEX.test('直到')).toBe(true);
    expect(STEP_08_BACKUP_REGEX.test('全部')).toBe(true);
    expect(STEP_08_BACKUP_REGEX.test('until all done')).toBe(true);
    expect(STEP_08_BACKUP_REGEX.test('disavow cost')).toBe(true);
    expect(STEP_08_BACKUP_REGEX.test('不用考虑费用')).toBe(true);
    expect(STEP_08_BACKUP_REGEX.test('all of them')).toBe(true);
  });

  test('does NOT match innocuous prompts (no false positives)', () => {
    expect(STEP_08_BACKUP_REGEX.test('just a one-off Q&A')).toBe(false);
    expect(STEP_08_BACKUP_REGEX.test('fix the auth bug')).toBe(false);
    expect(STEP_08_BACKUP_REGEX.test('add a tooltip')).toBe(false);
  });
});

describe('solo/step-08-gate: prompt source fallback', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('reads last-prompt.txt when --prompt omitted and regex matches', () => {
    const txtDir = join(project, '.peaks', '_runtime', SESSION_ID, 'txt');
    mkdirSync(txtDir, { recursive: true });
    writeFileSync(join(txtDir, 'last-prompt.txt'), 'please run until all done', 'utf8');
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.allow).toBe(false);
    if (r.verdict.kind === 'block-missing-decision') {
      expect(r.verdict.promptSource).toBe('last-prompt-file');
      expect(r.verdict.promptHit).toBe(true);
    }
  });

  test('marks promptSource=stdin-empty when no prompt and no last-prompt.txt', () => {
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.allow).toBe(true);
    if (r.verdict.kind === 'block-missing-decision') {
      expect(r.verdict.promptSource).toBe('stdin-empty');
      expect(r.verdict.promptHit).toBe(false);
    }
  });

  test('ignores stale progress.json from a different jid (no false-positive Next: slice)', () => {
    const jid = 'unit-test-stale-progress';
    writeShape(project, true, jid);
    // progress.json lives under a DIFFERENT jid
    const wrongDir = join(project, '.peaks', '_runtime', SESSION_ID, 'job', 'other-jid');
    mkdirSync(wrongDir, { recursive: true });
    writeFileSync(join(wrongDir, 'progress.json'), JSON.stringify({
      schemaVersion: 1, jobId: 'other-jid', done: 99, total: 100,
      currentSlice: 'slice-100: stale', lastCommitSha: 'zzz', updatedAt: FIXED_NOW.toISOString()
    }), 'utf8');
    const r = evaluateStep08({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.allow).toBe(true);
    // No matching progress.json → nextSliceLine is null
    expect(r.nextSliceLine).toBeNull();
    // progress field on the verdict is also null
    if (r.verdict.kind === 'allow-job') {
      expect(r.verdict.progress).toBeNull();
    }
    // Sanity: the wrong-dir file was not the basis for the verdict.
    expect(existsSync(join(wrongDir, 'progress.json'))).toBe(true);
  });
});