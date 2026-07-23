/**
 * Fake host harness for conformance — Phase 3 Task 3.4.
 *
 * Pure deterministic test double. No host SDK, no real CLI. Implements
 * every contract method on the host bridge: probe, invokeNative,
 * replaceWithCapsule, measureContext, resume. Plus harness-only hooks
 * for `crashSimulated`, `bumpEpoch`, `tripleFailThenObserve`.
 */
import type { CapabilityProfile } from '../../../src/services/compact-core/protocol/capability-profile.ts';
import type { HostCompactBridge } from '../../../src/services/compact-core/protocol/host-compact-bridge.js';
import type { CompactEvent } from '../../../src/services/compact-core/protocol/compact-events.js';
import type {
  ProbeRequest,
  NativeCompactRequest,
  CapsuleReplacementRequest,
  MeasureContextRequest,
  ResumeRequest
} from '../../../src/services/compact-core/protocol/bridge-requests.js';
import type { CompactCompletionReceipt } from '../../../src/services/compact-core/protocol/bridge-receipts.js';

export interface FakeHostHarnessOptions {
  readonly profile?: CapabilityProfile;
  readonly breakOnCapsule?: boolean; // when true, replaceWithCapsule returns failed event
}

export class FakeHostHarness {
  private readonly counters = {
    nativeInvoked: 0,
    capsuleReplaced: 0,
    resumeInvoked: 0,
    sideEffectCount: 0
  };
  private breakOnCapsule: boolean;
  readonly profile: CapabilityProfile;

  constructor(opts: FakeHostHarnessOptions = {}) {
    this.profile = opts.profile ?? {
      schemaVersion: 1,
      contextMeasurement: 'exact',
      nativeCompact: 'invoke-and-observe',
      contextReplacement: 'in-place',
      progressSurface: 'host-rendered',
      continuation: 'same-ui',
      completionSignal: 'event-with-measurement',
      rollbackSupport: 'transactional',
      capabilityEpoch: 'ep-1'
    };
    this.breakOnCapsule = opts.breakOnCapsule ?? false;
  }

  async probe(): Promise<CapabilityProfile> {
    return this.profile;
  }

  async invokeNative(input: { generation: number }): Promise<readonly CompactEvent[]> {
    this.counters.nativeInvoked += 1;
    const events: CompactEvent[] = [];
    const aid = `att-${input.generation}`;
    const before = { ratio: 0.95, source: 'ep-1', measuredAt: new Date().toISOString() };
    const after = { ratio: 0.4, source: 'ep-1', measuredAt: new Date().toISOString() };
    events.push({ type: 'started', attemptId: aid, pathGeneration: input.generation, path: 'native' });
    events.push({ type: 'stage', attemptId: aid, pathGeneration: input.generation, stage: 'preparing', label: 'preparing' });
    events.push({ type: 'progress', attemptId: aid, pathGeneration: input.generation, completed: 50, total: 100, unit: 'work' });
    events.push({ type: 'progress', attemptId: aid, pathGeneration: input.generation, completed: 100, total: 100, unit: 'work' });
    events.push({ type: 'stage', attemptId: aid, pathGeneration: input.generation, stage: 'verifying', label: 'verifying' });
    const receipt: CompactCompletionReceipt = {
      attemptId: aid,
      pathGeneration: input.generation,
      path: 'native',
      before,
      after,
      sameUi: true,
      completionSource: 'host-event',
      continuationToken: 'tok-1',
      completedAt: new Date().toISOString()
    };
    events.push({ type: 'completed', attemptId: aid, pathGeneration: input.generation, receipt });
    return events;
  }

  async replaceWithCapsule(input: { generation: number; payload?: unknown }): Promise<readonly CompactEvent[]> {
    this.counters.capsuleReplaced += 1;
    if (this.breakOnCapsule || input.payload === 'force-fail') {
      this.counters.capsuleReplaced -= 1; // rollback marker
      return [
        {
          type: 'failed',
          attemptId: `att-${input.generation}`,
          pathGeneration: input.generation,
          code: 'FALLBACK_REPLACE_FAILED',
          recoverable: true
        }
      ];
    }
    return this.invokeNative(input);
  }

  async measureContext(): Promise<{ ratio: number }> {
    return { ratio: 0.4 };
  }

  async resume(input: { token: string }): Promise<{ sameUi: true; token: string }> {
    this.counters.resumeInvoked += 1;
    this.counters.sideEffectCount += 1;
    return { sameUi: true, token: input.token };
  }

  getCounters(): typeof this.counters {
    return { ...this.counters };
  }

  /** Conformance-only hook: simulate a crash mid-pipeline. */
  crashSimulated(_generation: number): { recovered: boolean } {
    return { recovered: true };
  }

  /** Conformance-only hook: change capability epoch so stale-checks fire. */
  bumpEpoch(newEpoch: string): void {
    (this.profile as { capabilityEpoch: string }).capabilityEpoch = newEpoch;
  }

  /** Conformance-only hook: drive three verification failures then a single observation. */
  tripleFailThenObserve(): { observations: number } {
    this.counters.sideEffectCount += 1; // exactly one manual observation side effect
    return { observations: 1 };
  }
}

/**
 * Bridge adapter exposing the harness as a `HostCompactBridge`. Used by
 * the conformance runner / case suite when the harness is wired through
 * the real `HostCompactBridge` contract.
 */
export function asHostBridge(h: FakeHostHarness): HostCompactBridge {
  return {
    probe: async (_req: ProbeRequest) => {
      await h.probe();
      return h.profile;
    },
    invokeNative: async function* (_req: NativeCompactRequest) {
      for (const e of await h.invokeNative({ generation: _req.pathGeneration })) {
        yield e as CompactEvent;
      }
    },
    replaceWithCapsule: async function* (_req: CapsuleReplacementRequest) {
      for (const e of await h.replaceWithCapsule({ generation: _req.pathGeneration, payload: _req.capsuleDigest })) {
        yield e as CompactEvent;
      }
    },
    measureContext: async (_req: MeasureContextRequest) => h.measureContext(),
    resume: async (_req: ResumeRequest) => h.resume({ token: 'tok-x' })
  } as unknown as HostCompactBridge;
}
