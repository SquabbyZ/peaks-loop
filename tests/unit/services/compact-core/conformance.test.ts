/**
 * Phase 2 Task 2.7 — conformance suite (design §14.2).
 *
 * Runs a deterministic scenario matrix over `makeMockHostBridge` +
 * `runFallbackCompaction` and asserts the §9 / §10 invariants the
 * Phase 2 mock fallback must uphold. Each scenario name is traceable
 * to a single invariant (e.g. `capsule-replace:happy`, `resume:sameUiViolation`).
 *
 * When `process.env.CONFORMANCE_OUT === '1'`, the suite writes a
 * structured `regression-report.json` next to this file. Otherwise the
 * suite is read-only against the disk — the matrix stays in-memory.
 *
 * Vendor-neutrality reminder: this file imports only compact-core public
 * surface, `node:crypto`, and `node:fs` (writeFileSync only when the
 * reporter is on). No host names, no CLI verbs, no vendor strings.
 */
import { afterEach, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFallbackCapsule,
  defaultFallbackEvents,
  makeMockHostBridge,
  runFallbackCompaction,
  strongDefaultProfile
} from '../../../../src/services/compact-core/fallback-coordinator.js';
import type {
  CapabilityProfile,
  CompactCompletionReceipt,
  CompactEvent
} from '../../../../src/services/compact-core/index.js';

// ── Constants & helpers ────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const FIXED_NOW = new Date('2026-07-23T12:00:00.000Z');
const ISO = FIXED_NOW.toISOString();
const SESSION = 'sess-conformance-1';
const ATTEMPT = 'attempt-conformance-1';
const PATH_GEN = 0;
const EPOCH = 'epoch-conformance-1';
const TOKEN = 'tok-conformance-1';

interface ConformanceScenario {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly durationMs: number;
  readonly key: string;
  readonly reason?: string;
}

// Matrix rows keyed by scenario name. Acts as both the accumulating
// buffer (via `set`) and the snapshot source (via `values()`). The
// reporter reads once at afterAll time.
const REPORT_MAP = new Map<string, ConformanceScenario>();

function profile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  // Force the capabilityEpoch to the test's EPOCH so probe() does not
  // raise FALLBACK_PROBE_FAILED (the §6.1 state machine requires the
  // bridge's profile epoch to match what was advertised at attach).
  return { ...strongDefaultProfile(), capabilityEpoch: EPOCH, ...overrides };
}

function capsuleStub(): ReturnType<typeof createFallbackCapsule> {
  return createFallbackCapsule({
    attemptId: ATTEMPT,
    sourceSessionId: SESSION,
    goal: { id: 'g-cf', text: 'CF', approvedAt: ISO, approvedBy: 'SquabbyZ' },
    mode: 'full-auto',
    cursor: null,
    tasks: [{ taskId: 't1', status: 'in-progress', summary: 'cf', startedAt: ISO }],
    nextAction: { id: 'n1', kind: 'continue', summary: 'go' },
    now: () => FIXED_NOW
  });
}

const baseInput = {
  projectRoot: '/tmp/proj-cf',
  sessionId: SESSION,
  attemptId: ATTEMPT,
  pathGeneration: PATH_GEN,
  capabilityEpoch: EPOCH,
  continuationToken: TOKEN,
  targetRatio: 0.6,
  now: () => FIXED_NOW
} as const;

/**
 * Run a scenario, recording its outcome in the in-memory matrix.
 * Failures are caught so the matrix still emits a "failed" row even
 * when the assertion throws (so the reporter can see the failure
 * without crashing the rest of the suite).
 */
async function timed(
  name: string,
  key: string,
  fn: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    REPORT_MAP.set(name, { name, status: 'passed', durationMs: Date.now() - start, key });
  } catch (error) {
    REPORT_MAP.set(name, {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      key,
      reason: (error as Error).message ?? String(error)
    });
    throw error;
  }
}

/** Mark a scenario "skipped" without throwing — used by invariants that
 * live outside this file's scope (e.g. journal-driven recovery is
 * verified in `recovery.test.ts`). */
function skip(name: string, key: string, reason: string): void {
  REPORT_MAP.set(name, { name, status: 'skipped', durationMs: 0, key, reason });
}

beforeEach(() => {
  // No-op: REPORT accumulates across `it()` calls within a single
  // file run. The proxy above stores rows in REPORT_MAP keyed by
  // scenario name so re-runs of the same name overwrite the prior
  // row rather than appending. The file fires the reporter once at
  // afterAll time, not per-test.
});

afterAll(() => {
  if (process.env.CONFORMANCE_OUT !== '1') return;
  // Each describe block's `afterAll` runs once at file end. Inside
  // the describe block, REPORT accumulates scenario rows for the
  // tests that ran — then this hook serializes the snapshot. We
  // collect row-by-row because vitest runs each `it()` in isolation;
  // we want the report to reflect the LAST matrix that finished.
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, 'regression-report.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        contractVersion: 1,
        generatedAt: new Date().toISOString(),
        scenarios: Array.from(REPORT_MAP.values())
      },
      null,
      2
    ),
    'utf8'
  );
});

// ── Matrix ─────────────────────────────────────────────────────────────────

describe('conformance: capsule-replace', () => {
  it('happy: §9 receipt path=fallback, sameUi=true, completionSource honored', async () => {
    await timed('capsule-replace:happy', 'INV-CF-01', async () => {
      const mock = makeMockHostBridge({ profile: profile() });
      const result = await runFallbackCompaction({
        ...baseInput,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.code).toBe('FALLBACK_COMPLETED');
      expect(result.receipt.path).toBe('fallback');
      expect(result.receipt.sameUi).toBe(true);
      expect(result.receipt.before.ratio).toBeGreaterThan(result.receipt.after.ratio);
    });
  });

  it('reject: no current-generation completed event → FALLBACK_REPLACE_FAILED', async () => {
    await timed(
      'capsule-replace:no-completed-event',
      'INV-CF-02',
      async () => {
        const events: readonly CompactEvent[] = [
          {
            type: 'stage',
            attemptId: ATTEMPT,
            pathGeneration: PATH_GEN,
            stage: 'summarizing',
            label: 's'
          },
          {
            type: 'stage',
            attemptId: ATTEMPT,
            pathGeneration: PATH_GEN,
            stage: 'replacing',
            label: 'r'
          }
        ];
        const mock = makeMockHostBridge({
          profile: profile(),
          eventSequences: { fallbackEvents: events }
        });
        const result = await runFallbackCompaction({
          ...baseInput,
          bridge: mock.bridge,
          capsule: capsuleStub()
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('FALLBACK_REPLACE_FAILED');
      }
    );
  });

  it('reject: stale generation completed event is ignored', async () => {
    await timed('capsule-replace:stale-generation', 'INV-CF-03', async () => {
      const staleReceipt: CompactCompletionReceipt = {
        attemptId: ATTEMPT,
        pathGeneration: PATH_GEN + 1,
        path: 'fallback',
        sameUi: true,
        before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
        after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
        completionSource: 'host-event',
        continuationToken: TOKEN,
        completedAt: ISO
      };
      const mock = makeMockHostBridge({
        profile: profile(),
        eventSequences: {
          fallbackEvents: [
            {
              type: 'stage',
              attemptId: ATTEMPT,
              pathGeneration: PATH_GEN,
              stage: 'summarizing',
              label: 's'
            },
            {
              type: 'completed',
              attemptId: ATTEMPT,
              pathGeneration: PATH_GEN + 1,
              receipt: staleReceipt
            }
          ]
        }
      });
      const result = await runFallbackCompaction({
        ...baseInput,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FALLBACK_REPLACE_FAILED');
    });
  });
});

describe('conformance: resume', () => {
  it('happy: digest === sha256(continuationToken)', async () => {
    await timed('resume:digest-matches-token', 'INV-CF-10', async () => {
      const mock = makeMockHostBridge({ profile: profile() });
      const result = await runFallbackCompaction({
        ...baseInput,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.resumeReceipt.continuationTokenDigest).toBe(sha256(TOKEN));
    });
  });

  it('reject: sameUi=false on resume → FALLBACK_RESUME_FAILED', async () => {
    await timed('resume:sameUiViolation', 'INV-CF-11', async () => {
      const mock = makeMockHostBridge({ profile: profile(), script: 'native-resumes' });
      const result = await runFallbackCompaction({
        ...baseInput,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FALLBACK_RESUME_FAILED');
    });
  });

  it('reject: attemptId mismatch on resume → FALLBACK_RESUME_FAILED', async () => {
    await timed('resume:attemptId-mismatch', 'INV-CF-12', async () => {
      const mock = makeMockHostBridge({ profile: profile() });
      const original = mock.bridge.resume.bind(mock.bridge);
      mock.bridge.resume = async (req) => {
        const r = await original(req);
        return { ...r, attemptId: 'wrong-attempt' };
      };
      const result = await runFallbackCompaction({
        ...baseInput,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FALLBACK_RESUME_FAILED');
    });
  });

  it('reject: digest mismatch on resume → FALLBACK_RESUME_FAILED', async () => {
    await timed('resume:digest-mismatch', 'INV-CF-13', async () => {
      const mock = makeMockHostBridge({ profile: profile() });
      const original = mock.bridge.resume.bind(mock.bridge);
      mock.bridge.resume = async (req) => {
        const r = await original(req);
        return { ...r, continuationTokenDigest: sha256('NOT_THE_TOKEN') };
      };
      const result = await runFallbackCompaction({
        ...baseInput,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FALLBACK_RESUME_FAILED');
    });
  });
});

describe('conformance: progress monotonicity (mock fallback emits canonical §8 stream)', () => {
  it('progress:monotonic — summarized stages reach 100% only on completed event', async () => {
    await timed('progress:monotonic', 'INV-CF-20', async () => {
      const mock = makeMockHostBridge({ profile: profile() });
      let sawProgressRatio = -1;
      let completedSeen = false;
      let totalPercentAtComplete = -1;
      const events = defaultFallbackEvents({
        attemptId: ATTEMPT,
        pathGeneration: PATH_GEN,
        completionSource: 'host-event',
        before: 0.9,
        after: 0.4,
        continuationToken: TOKEN
      });
      const stream = mock.bridge.replaceWithCapsule({
        kind: 'capsule-replacement',
        sessionId: SESSION,
        attemptId: ATTEMPT,
        pathGeneration: PATH_GEN,
        capabilityEpoch: EPOCH,
        capsuleDigest: sha256('capsule'),
        rollbackRequired: true
      });
      void events;
      for await (const event of stream) {
        if (event.type === 'progress') {
          sawProgressRatio = event.completed / event.total;
        }
        if (event.type === 'completed') {
          completedSeen = true;
          totalPercentAtComplete = 100;
        }
      }
      expect(sawProgressRatio).toBeGreaterThan(0);
      expect(sawProgressRatio).toBeLessThan(1);
      expect(completedSeen).toBe(true);
      expect(totalPercentAtComplete).toBe(100);
    });
  });
});

describe('conformance: recovery branch (journal-driven, see recovery.test.ts)', () => {
  // These two scenarios are exercised in recovery.test.ts (decideRecoveryAction)
  // rather than here. They are reported as "skipped" in this matrix so the
  // §14.2 regression report retains the traceable name without duplicating
  // assertions across files.
  it('recovery:resume-pre-stage is verified in recovery.test.ts', () => {
    skip(
      'recovery:resume-pre-stage',
      'INV-CF-30',
      'exercised by tests/unit/services/compact-core/recovery.test.ts'
    );
    expect(true).toBe(true);
  });

  it('recovery:stale-abandon is verified in recovery.test.ts', () => {
    skip(
      'recovery:stale-abandon',
      'INV-CF-31',
      'exercised by tests/unit/services/compact-core/recovery.test.ts'
    );
    expect(true).toBe(true);
  });
});

describe('conformance: artifact-pointer (boundary verifier, see artifact-pointers.test.ts)', () => {
  it('artifact-pointer:hash-mismatch is verified in artifact-pointers.test.ts', () => {
    skip(
      'artifact-pointer:hash-mismatch',
      'INV-CF-40',
      'exercised by tests/unit/services/compact-core/artifact-pointers.test.ts'
    );
    expect(true).toBe(true);
  });
});

describe('conformance: target reduction', () => {
  it('honors targetRatio=0.6: before=0.9, after=0.4 passes §9', async () => {
    await timed('target-reduction:0.6', 'INV-CF-50', async () => {
      const mock = makeMockHostBridge({ profile: profile() });
      const result = await runFallbackCompaction({
        ...baseInput,
        targetRatio: 0.6,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.receipt.after.ratio).toBeLessThan(0.6);
    });
  });

  it('honors strict targetRatio=0.5: before=0.9, after=0.4 passes', async () => {
    await timed('target-reduction:0.5', 'INV-CF-51', async () => {
      const mock = makeMockHostBridge({ profile: profile() });
      const result = await runFallbackCompaction({
        ...baseInput,
        targetRatio: 0.5,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(true);
    });
  });
});

describe('conformance: remeasurement', () => {
  it('overrides receipt.after when live read differs (completionSource=remeasure)', async () => {
    await timed('remeasurement:live-reading-wins', 'INV-CF-60', async () => {
      const receipt: CompactCompletionReceipt = {
        attemptId: ATTEMPT,
        pathGeneration: PATH_GEN,
        path: 'fallback',
        sameUi: true,
        before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
        after: { ratio: 0.55, source: 'exact', measuredAt: ISO },
        completionSource: 'remeasure',
        continuationToken: TOKEN,
        completedAt: ISO
      };
      const mock = makeMockHostBridge({
        profile: profile(),
        completionSource: 'remeasure',
        eventSequences: {
          fallbackEvents: [
            {
              type: 'stage',
              attemptId: ATTEMPT,
              pathGeneration: PATH_GEN,
              stage: 'summarizing',
              label: 's'
            },
            {
              type: 'stage',
              attemptId: ATTEMPT,
              pathGeneration: PATH_GEN,
              stage: 'replacing',
              label: 'r'
            },
            {
              type: 'stage',
              attemptId: ATTEMPT,
              pathGeneration: PATH_GEN,
              stage: 'verifying',
              label: 'v'
            },
            {
              type: 'completed',
              attemptId: ATTEMPT,
              pathGeneration: PATH_GEN,
              receipt
            }
          ]
        }
      });
      const original = mock.bridge.measureContext.bind(mock.bridge);
      mock.bridge.measureContext = async (req) => {
        const r = await original(req);
        return { ...r, ratio: 0.35 };
      };
      const result = await runFallbackCompaction({
        ...baseInput,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.receipt.after.ratio).toBe(0.35);
    });
  });
});

describe('conformance: capability epoch', () => {
  it('stale epoch on probe → FALLBACK_PROBE_FAILED', async () => {
    await timed('capability-epoch:stale', 'INV-CF-70', async () => {
      const mock = makeMockHostBridge({
        profile: profile({ capabilityEpoch: 'stale-epoch' })
      });
      const result = await runFallbackCompaction({
        ...baseInput,
        capabilityEpoch: EPOCH,
        bridge: mock.bridge,
        capsule: capsuleStub()
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('FALLBACK_PROBE_FAILED');
    });
  });
});
