/**
 * v3.1.1 Step 0.8 — Job-shape decision service unit tests.
 *
 * Covers:
 *   - validateJobShapeDecision happy/sad paths
 *   - writeJobShapeDecision stamps `decidedAt` server-side
 *   - write without --force throws on second call; with --force succeeds
 *   - readJobShapeDecision throws JOB_SHAPE_NOT_DECIDED on missing/unreadable/malformed
 *   - round-trip: write → read → deep-equal
 *   - promptHash: same prompt → same hash; different prompt → different hash
 *
 * No keyword regex anywhere — the LLM is the source of truth for
 * whether the request is Job-shaped; this service is the recorder.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  JOB_SHAPE_ALREADY_DECIDED,
  JOB_SHAPE_NOT_DECIDED,
  readJobShapeDecision,
  validateJobShapeDecision,
  writeJobShapeDecision
} from '../../../src/services/solo/job-shape-decision.js';

const SESSION_ID = '2026-07-03-test-jobshape';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-jobshape-'));
}

const FIXED_NOW = new Date('2026-07-03T12:00:00.000Z');

const baseInput = {
  isJob: true,
  rationale: 'multi-dir batch with 25 leaf slices — clearly Job-shaped',
  suggestedJobId: 'unit-test-job-001',
  suggestedStrategy: 'single' as const,
  confidence: 'high' as const,
  prompt: '把项目下的 app 目录下以目录为维度进行 slice 补充单元测试 ... 继续执行下个 slice，直到全部添加完，不用考虑费用'
};

describe('solo/job-shape-decision: validateJobShapeDecision', () => {
  test('accepts a well-formed decision', () => {
    const out = validateJobShapeDecision({
      isJob: true,
      rationale: 'looks Job-shaped',
      suggestedJobId: 'unit-test-job-002',
      suggestedStrategy: 'single',
      confidence: 'high',
      decidedAt: '2026-07-03T12:00:00.000Z'
    });
    expect(out.isJob).toBe(true);
    expect(out.suggestedJobId).toBe('unit-test-job-002');
  });

  test('rejects missing rationale', () => {
    expect(() => validateJobShapeDecision({
      isJob: true,
      suggestedJobId: 'unit-test-job-003',
      suggestedStrategy: 'single',
      confidence: 'high',
      decidedAt: '2026-07-03T12:00:00.000Z'
    })).toThrow();
  });

  test('rejects bad confidence value', () => {
    expect(() => validateJobShapeDecision({
      isJob: true,
      rationale: 'x',
      suggestedJobId: 'unit-test-job-004',
      suggestedStrategy: 'single',
      confidence: 'ultra',
      decidedAt: '2026-07-03T12:00:00.000Z'
    })).toThrow();
  });

  test('rejects bad strategy value', () => {
    expect(() => validateJobShapeDecision({
      isJob: true,
      rationale: 'x',
      suggestedJobId: 'unit-test-job-005',
      suggestedStrategy: 'parallel',
      confidence: 'high',
      decidedAt: '2026-07-03T12:00:00.000Z'
    })).toThrow();
  });

  test('rejects non-boolean isJob', () => {
    expect(() => validateJobShapeDecision({
      isJob: 'true',
      rationale: 'x',
      suggestedJobId: 'unit-test-job-006',
      suggestedStrategy: 'single',
      confidence: 'high',
      decidedAt: '2026-07-03T12:00:00.000Z'
    })).toThrow();
  });

  test('rejects suggestedJobId with spaces', () => {
    expect(() => validateJobShapeDecision({
      isJob: true,
      rationale: 'x',
      suggestedJobId: 'Job With Spaces',
      suggestedStrategy: 'single',
      confidence: 'high',
      decidedAt: '2026-07-03T12:00:00.000Z'
    })).toThrow();
  });

  test('rejects suggestedJobId starting with a dash', () => {
    expect(() => validateJobShapeDecision({
      isJob: true,
      rationale: 'x',
      suggestedJobId: '-bad-id',
      suggestedStrategy: 'single',
      confidence: 'high',
      decidedAt: '2026-07-03T12:00:00.000Z'
    })).toThrow();
  });
});

describe('solo/job-shape-decision: writeJobShapeDecision stamping', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('stamps decidedAt server-side (input lacks decidedAt; output has it; ISO 8601)', () => {
    const input = {
      isJob: baseInput.isJob,
      rationale: baseInput.rationale,
      suggestedJobId: baseInput.suggestedJobId,
      suggestedStrategy: baseInput.suggestedStrategy,
      confidence: baseInput.confidence,
      prompt: baseInput.prompt
    };
    // Sanity: input has no decidedAt.
    expect('decidedAt' in input).toBe(false);
    const before = Date.now();
    const record = writeJobShapeDecision(project, SESSION_ID, input, { now: () => FIXED_NOW });
    const after = Date.now();
    // Output carries decidedAt.
    expect(typeof record.decision.decidedAt).toBe('string');
    // Server-stamped value is the FIXED_NOW ISO (caller-supplied clock).
    expect(record.decision.decidedAt).toBe(FIXED_NOW.toISOString());
    // Defensive: a real call with default `now` should be within ±5s of `new Date()`.
    const liveRecord = writeJobShapeDecision(project, `${SESSION_ID}-live`, { ...input, suggestedJobId: 'unit-test-live-001' }, { force: true });
    const decidedMs = Date.parse(liveRecord.decision.decidedAt);
    expect(Number.isFinite(decidedMs)).toBe(true);
    expect(Math.abs(decidedMs - before)).toBeLessThanOrEqual(5000);
    expect(Math.abs(decidedMs - after)).toBeLessThanOrEqual(5000);
  });
});

describe('solo/job-shape-decision: writeJobShapeDecision force semantics', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('second call without force throws JOB_SHAPE_ALREADY_DECIDED; with force succeeds', () => {
    const first = writeJobShapeDecision(project, SESSION_ID, baseInput, { now: () => FIXED_NOW });
    expect(first.decision.suggestedJobId).toBe(baseInput.suggestedJobId);
    expect(() => writeJobShapeDecision(project, SESSION_ID, baseInput, { now: () => FIXED_NOW })).toThrowError(
      expect.objectContaining({ code: JOB_SHAPE_ALREADY_DECIDED })
    );
    const overwritten = writeJobShapeDecision(project, SESSION_ID, {
      ...baseInput,
      rationale: 'overwritten rationale',
      suggestedJobId: 'unit-test-overwrite-01'
    }, { force: true, now: () => new Date('2026-07-03T13:00:00.000Z') });
    expect(overwritten.decision.rationale).toBe('overwritten rationale');
    expect(overwritten.decision.suggestedJobId).toBe('unit-test-overwrite-01');
    expect(overwritten.decision.decidedAt).toBe('2026-07-03T13:00:00.000Z');
  });
});

describe('solo/job-shape-decision: readJobShapeDecision error paths', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('throws JOB_SHAPE_NOT_DECIDED when file is missing', () => {
    expect(() => readJobShapeDecision(project, SESSION_ID)).toThrowError(
      expect.objectContaining({ code: JOB_SHAPE_NOT_DECIDED })
    );
  });

  test('throws JOB_SHAPE_NOT_DECIDED when file is malformed JSON', () => {
    const dir = join(project, '.peaks', '_runtime', SESSION_ID);
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'job-shape.json'), '{ not json', 'utf8');
    expect(() => readJobShapeDecision(project, SESSION_ID)).toThrowError(
      expect.objectContaining({ code: JOB_SHAPE_NOT_DECIDED })
    );
  });

  test('throws JOB_SHAPE_NOT_DECIDED when file is schema-invalid', () => {
    const dir = join(project, '.peaks', '_runtime', SESSION_ID);
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'job-shape.json'), JSON.stringify({ schemaVersion: 99 }), 'utf8');
    expect(() => readJobShapeDecision(project, SESSION_ID)).toThrowError(
      expect.objectContaining({ code: JOB_SHAPE_NOT_DECIDED })
    );
  });
});

describe('solo/job-shape-decision: round-trip + promptHash', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('write → read returns deep-equal record', () => {
    const written = writeJobShapeDecision(project, SESSION_ID, baseInput, { now: () => FIXED_NOW });
    const read = readJobShapeDecision(project, SESSION_ID);
    expect(read).toEqual(written);
  });

  test('same prompt → same promptHash; different prompt → different promptHash', () => {
    const a = writeJobShapeDecision(project, `${SESSION_ID}-a`, { ...baseInput, suggestedJobId: 'unit-test-hash-001' }, { now: () => FIXED_NOW });
    const b = writeJobShapeDecision(project, `${SESSION_ID}-b`, { ...baseInput, suggestedJobId: 'unit-test-hash-002' }, { now: () => FIXED_NOW });
    const c = writeJobShapeDecision(project, `${SESSION_ID}-c`, { ...baseInput, suggestedJobId: 'unit-test-hash-003', prompt: 'a totally different user prompt' }, { now: () => FIXED_NOW });
    expect(a.promptHash).toBe(b.promptHash);
    expect(a.promptHash).not.toBe(c.promptHash);
    expect(a.promptHash).toMatch(/^[a-f0-9]{16}$/);
  });

  test('promptHash differs by one byte (case-sensitive)', () => {
    const a = writeJobShapeDecision(project, `${SESSION_ID}-cs-a`, { ...baseInput, suggestedJobId: 'unit-test-cs-001', prompt: 'Hello World' }, { now: () => FIXED_NOW });
    const b = writeJobShapeDecision(project, `${SESSION_ID}-cs-b`, { ...baseInput, suggestedJobId: 'unit-test-cs-002', prompt: 'hello world' }, { now: () => FIXED_NOW });
    expect(a.promptHash).not.toBe(b.promptHash);
  });
});
