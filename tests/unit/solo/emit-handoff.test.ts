/**
 * v3.1.2 Step 11 — `peaks solo emit-handoff` size-fear ban unit tests.
 *
 * Covers the 4 evaluation paths:
 *   1. allow single-rid (no decision OR isJob=false)
 *   2. allow Job-done (remaining === 0)
 *   3. block Job-remaining (remaining > 0, no --force-under-job)
 *   4. allow --force-under-job override
 *
 * Plus the JOB_NOT_INITIALIZED block path (no state.json under Job mode).
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { evaluateEmitHandoff, JOB_NOT_INITIALIZED, JOB_REMAINING_BLOCKED } from '../../../src/services/solo/emit-handoff.js';
import { writeJobShapeDecision } from '../../../src/services/solo/job-shape-decision.js';

const SESSION_ID = '2026-07-03-test-emit-handoff';
const FIXED_NOW = new Date('2026-07-03T12:00:00.000Z');

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-emit-handoff-'));
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

function writeState(project: string, jid: string, slices: Array<{ status: string }>): void {
  const dir = join(project, '.peaks', '_runtime', SESSION_ID, 'job', jid);
  // mkdirSync is async-friendly via fs/promises, but we use the sync
  // fs module here for the test seam.
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      jobId: jid,
      sessionId: SESSION_ID,
      startedAt: FIXED_NOW.toISOString(),
      lastCheckpointAt: FIXED_NOW.toISOString(),
      parallelismHint: 'llm-decides',
      exitPolicy: 'strict',
      mainLoopStrategy: 'single',
      rotateEvery: 3,
      mainSessionCycle: 0,
      slices: slices.map((sl, i) => ({ sliceId: `slice-${i + 1}`, label: `slice-${i + 1}`, ...sl }))
    }, null, 2) + '\n',
    'utf8'
  );
}

describe('solo/emit-handoff: 4 paths', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('AC-1: single-rid (no decision file) → allow', () => {
    const r = evaluateEmitHandoff({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.kind).toBe('allow-not-job');
  });

  test('AC-2: isJob=false → allow (even if a state.json exists)', () => {
    writeShape(project, false, 'unit-test-emit-single');
    writeState(project, 'unit-test-emit-single', [{ status: 'done' }, { status: 'pending' }]);
    const r = evaluateEmitHandoff({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.kind).toBe('allow-not-job');
  });

  test('AC-3: isJob=true + state.json + remaining===0 → allow-done', () => {
    writeShape(project, true, 'unit-test-emit-done');
    writeState(project, 'unit-test-emit-done', [
      { status: 'done' }, { status: 'done' }, { status: 'done' }
    ]);
    const r = evaluateEmitHandoff({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.kind).toBe('allow-done');
    if (r.kind === 'allow-done') expect(r.remaining).toBe(0);
  });

  test('AC-4: isJob=true + state.json + remaining>0 → block JOB_REMAINING_BLOCKED', () => {
    writeShape(project, true, 'unit-test-emit-remaining');
    writeState(project, 'unit-test-emit-remaining', [
      { status: 'done' }, { status: 'pending' }, { status: 'pending' }, { status: 'pending' }
    ]);
    const r = evaluateEmitHandoff({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.kind).toBe('block-remaining');
    if (r.kind === 'block-remaining') {
      expect(r.code).toBe(JOB_REMAINING_BLOCKED);
      expect(r.remaining).toBe(3);
      expect(r.jobId).toBe('unit-test-emit-remaining');
    }
  });

  test('AC-5: isJob=true + remaining>0 + --force-under-job → allow-force-override', () => {
    writeShape(project, true, 'unit-test-emit-force');
    writeState(project, 'unit-test-emit-force', [
      { status: 'done' }, { status: 'pending' }, { status: 'pending' }
    ]);
    const r = evaluateEmitHandoff({
      projectRoot: project,
      sessionId: SESSION_ID,
      forceUnderJob: true
    });
    expect(r.kind).toBe('allow-force-override');
    if (r.kind === 'allow-force-override') expect(r.remaining).toBe(2);
  });

  test('AC-6: isJob=true + no state.json → block JOB_NOT_INITIALIZED', () => {
    writeShape(project, true, 'unit-test-emit-no-state');
    const r = evaluateEmitHandoff({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.kind).toBe('block-not-initialized');
    if (r.kind === 'block-not-initialized') {
      expect(r.code).toBe(JOB_NOT_INITIALIZED);
      expect(r.jobId).toBe('unit-test-emit-no-state');
    }
  });

  test('extra: skipped slices do NOT count toward remaining', () => {
    writeShape(project, true, 'unit-test-emit-skip');
    writeState(project, 'unit-test-emit-skip', [
      { status: 'done' }, { status: 'skipped' }, { status: 'pending' }
    ]);
    const r = evaluateEmitHandoff({ projectRoot: project, sessionId: SESSION_ID });
    // One pending → remaining=1
    expect(r.kind).toBe('block-remaining');
    if (r.kind === 'block-remaining') expect(r.remaining).toBe(1);
  });

  test('extra: --job-id override takes precedence over decision.suggestedJobId', () => {
    writeShape(project, true, 'decision-jid');
    writeState(project, 'override-jid', [{ status: 'done' }, { status: 'done' }]);
    const r = evaluateEmitHandoff({
      projectRoot: project,
      sessionId: SESSION_ID,
      jobId: 'override-jid'
    });
    expect(r.kind).toBe('allow-done');
  });

  test('extra: --job-id override with no state.json still blocks NOT_INITIALIZED', () => {
    writeShape(project, true, 'decision-jid-2');
    const r = evaluateEmitHandoff({
      projectRoot: project,
      sessionId: SESSION_ID,
      jobId: 'nonexistent-jid'
    });
    expect(r.kind).toBe('block-not-initialized');
    if (r.kind === 'block-not-initialized') {
      expect(r.jobId).toBe('nonexistent-jid');
    }
  });

  test('extra: state.json with malformed JSON counts as not-initialized (defensive)', () => {
    writeShape(project, true, 'unit-test-emit-malformed');
    const dir = join(project, '.peaks', '_runtime', SESSION_ID, 'job', 'unit-test-emit-malformed');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), '{ not json', 'utf8');
    const r = evaluateEmitHandoff({ projectRoot: project, sessionId: SESSION_ID });
    expect(r.kind).toBe('block-not-initialized');
    if (r.kind === 'block-not-initialized') {
      expect(r.code).toBe(JOB_NOT_INITIALIZED);
    }
    void existsSync;
  });
});