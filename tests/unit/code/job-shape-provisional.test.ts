// tests/unit/code/job-shape-provisional.test.ts
//
// Backlog §17.1 fix (3): a Job ledger must never exist without a Job-shape
// decision. `peaks job init` writes the ledger, and the Step 0.8 gate reads a
// ledger with no `job-shape.json` as "the decision step was skipped" — so the
// command now leaves a PROVISIONAL decision behind (isJob=true for the job it
// just created, medium confidence). An existing decision always wins, and a
// write that cannot happen is reported to the caller rather than swallowed.
//
// Dimensions covered: all four. render asserts the written record's shape;
// behavior asserts the existing-decision arm; integration uses a real fs tree;
// a11y asserts that a refused write carries the writer's own message.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  JOB_SHAPE_FILE_NAME,
  readJobShapeDecision,
  writeJobShapeDecision
} from '../../../src/services/code/job-shape-decision.js';
import { ensureProvisionalJobShapeDecision } from '../../../src/services/code/job-shape-provisional.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/code/job-shape-provisional.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-10-19-session-ledger-provisional';
const JOB_ID = 'ledger-provisional-job';

function emptyProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-provisional-'));
}

function runtimeDir(project: string): string {
  return join(project, '.peaks', '_runtime', SESSION_ID);
}

function decisionPath(project: string): string {
  return join(runtimeDir(project), JOB_SHAPE_FILE_NAME);
}

describe('(render) the provisional decision is a complete, schema-valid record', () => {
  it('when no decision exists, should write a medium-confidence Job decision naming the job and the requested strategy', () => {
    // given: a session whose Job ledger was just created and has no decision
    const project = emptyProject();
    mkdirSync(join(runtimeDir(project), 'job', JOB_ID), { recursive: true });

    // when: `peaks job init` asks for the provisional decision
    const out = ensureProvisionalJobShapeDecision(project, SESSION_ID, {
      jobId: JOB_ID,
      strategy: 'single'
    });

    // then: the decision is readable by the gate and says what the ledger implies
    expect(out.written).toBe(true);
    const record = readJobShapeDecision(project, SESSION_ID);
    expect(record.decision).toMatchObject({
      isJob: true,
      suggestedJobId: JOB_ID,
      suggestedStrategy: 'single',
      confidence: 'medium'
    });
    expect(record.decision.rationale).toMatch(/provisional/i);
    expect(record.decision.rationale).toContain('peaks job init');
    // The decision file exists by the time a reader acts on the rationale, so
    // the printed remedy must carry --force or detect-job refuses it.
    expect(record.decision.rationale).toContain('--force');
  });
});

describe('(behavior) an existing decision always wins', () => {
  it('when a deliberate decision exists, should keep it byte-identical and report already-decided', () => {
    // given: a decision recorded before `job init` ran
    const project = emptyProject();
    writeJobShapeDecision(project, SESSION_ID, {
      isJob: false,
      rationale: 'the LLM judged this a single-rid request',
      suggestedJobId: 'single-task',
      suggestedStrategy: 'single',
      confidence: 'high',
      prompt: 'deliberate prompt'
    });
    const before = readFileSync(decisionPath(project), 'utf8');

    // when: `job init` asks for a provisional decision
    const out = ensureProvisionalJobShapeDecision(project, SESSION_ID, {
      jobId: JOB_ID,
      strategy: 'rotating'
    });

    // then: nothing is overwritten, and the caller is told why
    expect(out).toMatchObject({ written: false, reason: 'already-decided' });
    expect(readFileSync(decisionPath(project), 'utf8')).toBe(before);
  });

  it('when a deliberate Job decision exists, should keep it byte-identical', () => {
    // given: an isJob=true decision recorded before `job init` ran
    const project = emptyProject();
    writeJobShapeDecision(project, SESSION_ID, {
      isJob: true,
      rationale: 'the LLM judged this a Job',
      suggestedJobId: 'deliberate-job',
      suggestedStrategy: 'rotating',
      confidence: 'high',
      prompt: 'deliberate Job prompt'
    });
    const before = readFileSync(decisionPath(project), 'utf8');

    // when: `job init` asks for a provisional decision
    const out = ensureProvisionalJobShapeDecision(project, SESSION_ID, {
      jobId: JOB_ID,
      strategy: 'single'
    });

    // then: the deliberate Job decision survives untouched
    expect(out).toMatchObject({ written: false, reason: 'already-decided' });
    expect(readFileSync(decisionPath(project), 'utf8')).toBe(before);
  });

  it('when the existing file is malformed, should leave it untouched and report invalid-existing', () => {
    // given: a `job-shape.json` that no longer parses
    const project = emptyProject();
    mkdirSync(runtimeDir(project), { recursive: true });
    writeFileSync(decisionPath(project), '{ not json', 'utf8');

    // when: `job init` asks for a provisional decision
    const out = ensureProvisionalJobShapeDecision(project, SESSION_ID, {
      jobId: JOB_ID,
      strategy: 'single'
    });

    // then: the bytes stay for a human to inspect, and the corruption is named
    expect(out).toMatchObject({ written: false, reason: 'invalid-existing' });
    if (out.written || out.reason === 'already-decided')
      throw new Error('expected invalid-existing');
    expect(out.error).toMatch(/malformed JSON/i);
    expect(readFileSync(decisionPath(project), 'utf8')).toBe('{ not json');
  });
});

describe('(integration) the decision lands in the session runtime dir on a real fs', () => {
  it('when the session runtime dir already exists, should create job-shape.json beside it', () => {
    // given: the directory `peaks job init` leaves after writing the ledger
    const project = emptyProject();
    mkdirSync(join(runtimeDir(project), 'job', JOB_ID), { recursive: true });
    expect(existsSync(decisionPath(project))).toBe(false);

    // when: the provisional decision is ensured
    const out = ensureProvisionalJobShapeDecision(project, SESSION_ID, {
      jobId: JOB_ID,
      strategy: 'rotating'
    });

    // then: the file exists at the path the gate reads, and the outcome names it
    expect(existsSync(decisionPath(project))).toBe(true);
    expect(out).toMatchObject({ written: true, path: decisionPath(project) });
  });

  it('when called twice, should write once and leave the first decision unchanged', () => {
    // given: a first provisional write
    const project = emptyProject();
    const input = { jobId: JOB_ID, strategy: 'single' } as const;
    ensureProvisionalJobShapeDecision(project, SESSION_ID, input);
    const before = readFileSync(decisionPath(project), 'utf8');

    // when: a second `job init` for the same session asks again
    const second = ensureProvisionalJobShapeDecision(project, SESSION_ID, input);

    // then: the second call is a no-op — the timestamp does not move either
    expect(second).toMatchObject({ written: false, reason: 'already-decided' });
    expect(readFileSync(decisionPath(project), 'utf8')).toBe(before);
  });
});

describe('(a11y) a refused write is reported, not swallowed', () => {
  it('when the job id cannot satisfy the decision schema, should report write-failed with the writer message', () => {
    // given: a job id the decision writer's own schema refuses
    const project = emptyProject();

    // when: `job init` asks for a provisional decision
    const out = ensureProvisionalJobShapeDecision(project, SESSION_ID, {
      jobId: 'X',
      strategy: 'single'
    });

    // then: the failure is returned with the schema's reason, and no file is left behind
    expect(out.written).toBe(false);
    if (out.written || out.reason !== 'write-failed') throw new Error('expected write-failed');
    expect(out.error).toMatch(/suggestedJobId/i);
    expect(existsSync(decisionPath(project))).toBe(false);
  });
});
