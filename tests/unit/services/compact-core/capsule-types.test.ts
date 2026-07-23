/**
 * Phase 2 Task 2.1 — capsule types + Zod schema tests.
 *
 * Pins the canonical `ConvergenceCapsule` shape so the future Phase 2
 * fallback engine cannot drift from the design spec. The schema is
 * `.strict()`: any extra field is rejected. The 64-hex digest field
 * must conform to the deterministic SHA-256 contract.
 *
 * Tests are non-tautological: rejection cases exercise each branch
 * independently rather than a single mega-assert.
 */
import { describe, expect, it } from 'vitest';
import {
  ApprovalGoalSchema,
  ArtifactPointerSchema,
  ApprovedGoalSchema,
  ConvergenceCapsuleSchema,
  ContextMeasurementSchema,
  DecisionRecordSchema,
  DIGEST_HEX_PATTERN,
  FailureRecordSchema,
  GateReceiptSchema,
  IdempotencyEnvelopeSchema,
  JobCursorSchema,
  NextActionSchema,
  OpenQuestionSchema,
  RequestCursorSchema,
  SCHEMA_VERSION,
  TaskSnapshotSchema,
  WORKFLOW_MODES,
  WorkflowModeSchema,
  deriveCapsuleId,
  type ConvergenceCapsuleInput
} from '../../../../src/services/compact-core/capsule-types.js';

const HEX64 = 'a'.repeat(64);

function buildBaseInput(): ConvergenceCapsuleInput {
  return {
    schemaVersion: 1,
    capsuleId: HEX64,
    compactAttemptId: 'attempt-001',
    sourceSessionId: 'session-001',
    goal: {
      id: 'goal-1',
      text: 'Ship the capsule',
      approvedAt: '2026-07-23T00:00:00.000Z',
      approvedBy: 'SquabbyZ'
    },
    mode: 'full-auto',
    activeJob: {
      jobId: 'job-1',
      lane: 'main',
      phase: 'implementation',
      updatedAt: '2026-07-23T00:00:00.000Z'
    },
    activeRequest: null,
    completedGates: [
      {
        gateId: 'g1',
        status: 'passed',
        completedAt: '2026-07-23T00:00:00.000Z',
        receipt: 'gate-1-receipt'
      }
    ],
    activeTasks: [
      {
        taskId: 't1',
        status: 'in-progress',
        summary: 'wire digest',
        startedAt: '2026-07-23T00:00:00.000Z'
      }
    ],
    decisions: [
      {
        id: 'd1',
        decision: 'use SHA-256',
        rationale: 'standard',
        madeAt: '2026-07-23T00:00:00.000Z'
      }
    ],
    openQuestions: [
      {
        id: 'q1',
        question: 'where to mount?',
        blocking: false,
        askedAt: '2026-07-23T00:00:00.000Z'
      }
    ],
    failureHistory: [
      {
        code: 'TIMEOUT',
        summary: 'bridge hung',
        retryCount: 0,
        lastFailureAt: '2026-07-23T00:00:00.000Z'
      }
    ],
    artifactIndex: [
      {
        path: '/tmp/capsule.json',
        sha256: HEX64,
        summary: 'capsule snapshot'
      }
    ],
    nextAction: {
      id: 'a1',
      kind: 'continue',
      summary: 'resume job-1'
    },
    idempotency: {
      scope: 'attempt-001',
      sealedKeys: ['goal.id', 'mode']
    },
    sourceContextMeasurement: {
      promptBytes: 1024,
      capacityBytes: 200_000,
      ratio: 0.00512,
      computedAt: '2026-07-23T00:00:00.000Z',
      windowKind: '200k'
    },
    digest: HEX64
  };
}

describe('SCHEMA_VERSION', () => {
  it('is locked to 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe('WORKFLOW_MODES', () => {
  it('matches design §7.1', () => {
    expect([...WORKFLOW_MODES]).toEqual(['full-auto', 'assisted', 'strict', 'swarm']);
  });
});

describe('DIGEST_HEX_PATTERN', () => {
  it('requires exactly 64 lowercase hex chars', () => {
    expect(DIGEST_HEX_PATTERN.test(HEX64)).toBe(true);
    expect(DIGEST_HEX_PATTERN.test('A'.repeat(64))).toBe(false);
    expect(DIGEST_HEX_PATTERN.test('a'.repeat(63))).toBe(false);
    expect(DIGEST_HEX_PATTERN.test('a'.repeat(65))).toBe(false);
    expect(DIGEST_HEX_PATTERN.test(''.padStart(64, 'g'))).toBe(false);
  });
});

describe('WorkflowModeSchema', () => {
  it('accepts each documented mode', () => {
    for (const mode of WORKFLOW_MODES) {
      expect(WorkflowModeSchema.safeParse(mode).success).toBe(true);
    }
  });
  it('rejects unknown modes', () => {
    expect(WorkflowModeSchema.safeParse('manual').success).toBe(false);
    expect(WorkflowModeSchema.safeParse('').success).toBe(false);
  });
});

describe('ApprovalGoalSchema typo-guard', () => {
  it('exports both typo-guard and canonical name', () => {
    expect(ApprovalGoalSchema).toBe(ApprovedGoalSchema);
  });
});

describe('ApprovedGoalSchema', () => {
  it('accepts a valid goal', () => {
    expect(
      ApprovedGoalSchema.safeParse({
        id: 'g',
        text: 't',
        approvedAt: '2026-07-23T00:00:00.000Z',
        approvedBy: 'SquabbyZ'
      }).success
    ).toBe(true);
  });
  it('rejects missing fields', () => {
    const result = ApprovedGoalSchema.safeParse({ id: 'g' });
    expect(result.success).toBe(false);
  });
  it('rejects extra fields (strict)', () => {
    const result = ApprovedGoalSchema.safeParse({
      id: 'g',
      text: 't',
      approvedAt: '2026-07-23T00:00:00.000Z',
      approvedBy: 'SquabbyZ',
      extra: 'nope'
    });
    expect(result.success).toBe(false);
  });
});

describe('JobCursorSchema', () => {
  it('accepts a valid cursor', () => {
    expect(
      JobCursorSchema.safeParse({
        jobId: 'j',
        lane: 'main',
        phase: 'implementation',
        updatedAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(JobCursorSchema.safeParse({ jobId: 'j' }).success).toBe(false);
  });
});

describe('RequestCursorSchema', () => {
  it('accepts a valid cursor', () => {
    expect(
      RequestCursorSchema.safeParse({
        requestId: 'r',
        sliceId: 's',
        status: 'in-progress',
        updatedAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(RequestCursorSchema.safeParse({ requestId: 'r' }).success).toBe(false);
  });
});

describe('GateReceiptSchema', () => {
  it('accepts a valid receipt', () => {
    expect(
      GateReceiptSchema.safeParse({
        gateId: 'g',
        status: 'passed',
        completedAt: '2026-07-23T00:00:00.000Z',
        receipt: 'r'
      }).success
    ).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(GateReceiptSchema.safeParse({ gateId: 'g' }).success).toBe(false);
  });
});

describe('TaskSnapshotSchema', () => {
  it('accepts a valid snapshot', () => {
    expect(
      TaskSnapshotSchema.safeParse({
        taskId: 't',
        status: 'in-progress',
        summary: 's',
        startedAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(TaskSnapshotSchema.safeParse({ taskId: 't' }).success).toBe(false);
  });
});

describe('DecisionRecordSchema', () => {
  it('accepts a valid record', () => {
    expect(
      DecisionRecordSchema.safeParse({
        id: 'd',
        decision: 'x',
        rationale: 'y',
        madeAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(DecisionRecordSchema.safeParse({ id: 'd' }).success).toBe(false);
  });
});

describe('OpenQuestionSchema', () => {
  it('accepts a valid question with blocking=false', () => {
    expect(
      OpenQuestionSchema.safeParse({
        id: 'q',
        question: '?',
        blocking: false,
        askedAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(true);
  });
  it('rejects non-boolean blocking', () => {
    expect(
      OpenQuestionSchema.safeParse({
        id: 'q',
        question: '?',
        blocking: 'yes',
        askedAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(false);
  });
});

describe('FailureRecordSchema', () => {
  it('accepts retryCount >= 0', () => {
    expect(
      FailureRecordSchema.safeParse({
        code: 'T',
        summary: 's',
        retryCount: 0,
        lastFailureAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(true);
  });
  it('rejects negative retryCount', () => {
    expect(
      FailureRecordSchema.safeParse({
        code: 'T',
        summary: 's',
        retryCount: -1,
        lastFailureAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(false);
  });
  it('rejects non-integer retryCount', () => {
    expect(
      FailureRecordSchema.safeParse({
        code: 'T',
        summary: 's',
        retryCount: 1.5,
        lastFailureAt: '2026-07-23T00:00:00.000Z'
      }).success
    ).toBe(false);
  });
});

describe('ArtifactPointerSchema', () => {
  it('accepts a pointer without optional kind', () => {
    expect(
      ArtifactPointerSchema.safeParse({
        path: '/p',
        sha256: HEX64,
        summary: 's'
      }).success
    ).toBe(true);
  });
  it('accepts a pointer with kind', () => {
    expect(
      ArtifactPointerSchema.safeParse({
        path: '/p',
        sha256: HEX64,
        summary: 's',
        kind: 'plan'
      }).success
    ).toBe(true);
  });
  it('rejects malformed sha256', () => {
    expect(
      ArtifactPointerSchema.safeParse({
        path: '/p',
        sha256: 'not-hex',
        summary: 's'
      }).success
    ).toBe(false);
  });
});

describe('NextActionSchema', () => {
  it('accepts id/kind/summary only', () => {
    expect(
      NextActionSchema.safeParse({
        id: 'a',
        kind: 'continue',
        summary: 'do'
      }).success
    ).toBe(true);
  });
  it('accepts sideEffect=true', () => {
    expect(
      NextActionSchema.safeParse({
        id: 'a',
        kind: 'execute',
        summary: 'do',
        sideEffect: true
      }).success
    ).toBe(true);
  });
  it('rejects missing id', () => {
    expect(NextActionSchema.safeParse({ kind: 'k', summary: 's' }).success).toBe(false);
  });
});

describe('IdempotencyEnvelopeSchema', () => {
  it('accepts a valid envelope', () => {
    expect(
      IdempotencyEnvelopeSchema.safeParse({
        scope: 'attempt-001',
        sealedKeys: ['a', 'b']
      }).success
    ).toBe(true);
  });
  it('rejects empty sealedKeys (must be non-empty array)', () => {
    expect(
      IdempotencyEnvelopeSchema.safeParse({
        scope: 'attempt-001',
        sealedKeys: []
      }).success
    ).toBe(false);
  });
  it('rejects missing scope', () => {
    expect(IdempotencyEnvelopeSchema.safeParse({ sealedKeys: ['a'] }).success).toBe(false);
  });
});

describe('ContextMeasurementSchema', () => {
  it('accepts a valid measurement', () => {
    expect(
      ContextMeasurementSchema.safeParse({
        promptBytes: 1024,
        capacityBytes: 200_000,
        ratio: 0.1,
        computedAt: '2026-07-23T00:00:00.000Z',
        windowKind: '200k'
      }).success
    ).toBe(true);
  });
  it('rejects ratio > 1', () => {
    expect(
      ContextMeasurementSchema.safeParse({
        promptBytes: 1024,
        capacityBytes: 200_000,
        ratio: 1.5,
        computedAt: '2026-07-23T00:00:00.000Z',
        windowKind: '200k'
      }).success
    ).toBe(false);
  });
  it('rejects negative ratio', () => {
    expect(
      ContextMeasurementSchema.safeParse({
        promptBytes: 1024,
        capacityBytes: 200_000,
        ratio: -0.1,
        computedAt: '2026-07-23T00:00:00.000Z',
        windowKind: '200k'
      }).success
    ).toBe(false);
  });
  it('rejects unknown windowKind', () => {
    expect(
      ContextMeasurementSchema.safeParse({
        promptBytes: 1024,
        capacityBytes: 200_000,
        ratio: 0.1,
        computedAt: '2026-07-23T00:00:00.000Z',
        windowKind: '500k'
      }).success
    ).toBe(false);
  });
});

describe('ConvergenceCapsuleSchema', () => {
  it('accepts a complete valid capsule', () => {
    const input = buildBaseInput();
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(true);
  });

  it('rejects an unknown schemaVersion', () => {
    const input = { ...buildBaseInput(), schemaVersion: 2 };
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a malformed capsuleId (not 64-hex)', () => {
    const input = { ...buildBaseInput(), capsuleId: 'not-hex' };
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a malformed digest', () => {
    const input = { ...buildBaseInput(), digest: 'x'.repeat(64) };
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing required fields (compactAttemptId)', () => {
    const base = buildBaseInput();
    const { compactAttemptId: _omit, ...rest } = base;
    void _omit;
    expect(ConvergenceCapsuleSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects unknown mode', () => {
    const input = { ...buildBaseInput(), mode: 'manual' };
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    const input = { ...buildBaseInput(), extraField: 'nope' };
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(false);
  });

  it('rejects non-array completedGates', () => {
    const input = { ...buildBaseInput(), completedGates: 'not-an-array' };
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(false);
  });

  it('accepts empty arrays for collection fields', () => {
    const input = buildBaseInput();
    const result = ConvergenceCapsuleSchema.safeParse({
      ...input,
      completedGates: [],
      activeTasks: [],
      decisions: [],
      openQuestions: [],
      failureHistory: [],
      artifactIndex: []
    });
    expect(result.success).toBe(true);
  });

  it('rejects activeJob with malformed shape', () => {
    const input = { ...buildBaseInput(), activeJob: { jobId: 'j' } };
    expect(ConvergenceCapsuleSchema.safeParse(input).success).toBe(false);
  });

  it('accepts null activeJob and null activeRequest', () => {
    const input = buildBaseInput();
    const result = ConvergenceCapsuleSchema.safeParse({
      ...input,
      activeJob: null,
      activeRequest: null
    });
    expect(result.success).toBe(true);
  });

  it('rejects when sourceContextMeasurement ratio is invalid', () => {
    const input = buildBaseInput();
    const result = ConvergenceCapsuleSchema.safeParse({
      ...input,
      sourceContextMeasurement: {
        ...input.sourceContextMeasurement,
        ratio: 2.0
      }
    });
    expect(result.success).toBe(false);
  });
});

describe('deriveCapsuleId', () => {
  it('returns a 64-hex string', () => {
    const id = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-001',
      firstPayload: 'payload'
    });
    expect(id).toMatch(DIGEST_HEX_PATTERN);
  });

  it('is deterministic for the same inputs', () => {
    const a = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-001',
      firstPayload: 'payload'
    });
    const b = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-001',
      firstPayload: 'payload'
    });
    expect(a).toBe(b);
  });

  it('changes when compactAttemptId changes', () => {
    const a = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-001',
      firstPayload: 'payload'
    });
    const b = deriveCapsuleId({
      compactAttemptId: 'attempt-002',
      sourceSessionId: 'session-001',
      firstPayload: 'payload'
    });
    expect(a).not.toBe(b);
  });

  it('changes when sourceSessionId changes', () => {
    const a = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-001',
      firstPayload: 'payload'
    });
    const b = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-002',
      firstPayload: 'payload'
    });
    expect(a).not.toBe(b);
  });

  it('changes when firstPayload changes', () => {
    const a = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-001',
      firstPayload: 'payload-1'
    });
    const b = deriveCapsuleId({
      compactAttemptId: 'attempt-001',
      sourceSessionId: 'session-001',
      firstPayload: 'payload-2'
    });
    expect(a).not.toBe(b);
  });
});
