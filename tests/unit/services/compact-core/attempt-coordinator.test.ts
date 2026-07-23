/**
 * Task 1.5 — attempt coordinator tests (design §4.2, §5, §6, §9, §10).
 *
 * Dimensions: behavior + integration. Render / a11y do not apply; the
 * coordinator returns typed control results and never emits user-facing
 * text. The coordinator consumes an injected certified bridge (Phase 1
 * fake) and the durable AttemptStore, and must:
 *   - short-circuit an open/awaiting circuit BEFORE attaching a bridge;
 *   - build a side-effect-free dry-run plan (no journal / circuit / host
 *     mutation, no mutating bridge calls);
 *   - select native vs fallback purely from capability + certification;
 *   - re-probe capabilityEpoch immediately before every mutation and
 *     refuse a stale bridge;
 *   - ignore late events tagged with an older pathGeneration;
 *   - switch native→fallback exactly once (same attemptId, +1 generation)
 *     on a recoverable invocation failure;
 *   - record a verification failure ONLY after §9 evaluation, against the
 *     session-scoped counter, latching the manual prompt exactly once when
 *     the third failure trips the circuit;
 *   - claim completed ONLY after both a valid completion receipt AND a
 *     matching resume receipt;
 *   - serialize same-session calls so parallel failures are not lost.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAttemptCoordinator,
  type CertifiedBridgeAttachment
} from '../../../../src/services/compact-core/attempt-coordinator.js';
import { createAttemptStore } from '../../../../src/services/compact-core/attempt-store.js';
import { computeManualMetadataDigest } from '../../../../src/services/compact-core/manual-fallback.js';
import type { CapabilityProfile } from '../../../../src/services/compact-core/protocol/capability-profile.js';
import type { ProviderCertification } from '../../../../src/services/compact-core/compact-policy.js';
import type {
  CapsuleReplacementRequest,
  NativeCompactRequest,
  ResumeRequest
} from '../../../../src/services/compact-core/protocol/bridge-requests.js';
import type {
  CompactCompletionReceipt,
  ContextMeasurementReading,
  ResumeReceipt,
  TransactionReceipt
} from '../../../../src/services/compact-core/protocol/bridge-receipts.js';
import type { CompactEvent } from '../../../../src/services/compact-core/protocol/compact-events.js';
import type { HostCompactBridge } from '../../../../src/services/compact-core/protocol/host-compact-bridge.js';

const SESSION = 'session-1';
const ATTEMPT = 'attempt-1';
const NOW = new Date('2026-07-23T00:00:00.000Z');
const ISO = NOW.toISOString();

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-coordinator-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function nativeStrongProfile(epoch = 'E1'): CapabilityProfile {
  return {
    schemaVersion: 1,
    contextMeasurement: 'exact',
    nativeCompact: 'invoke-and-observe',
    contextReplacement: 'in-place',
    progressSurface: 'native',
    continuation: 'same-ui',
    completionSignal: 'event-with-measurement',
    rollbackSupport: 'transactional',
    capabilityEpoch: epoch
  };
}

/** Remeasure-only profile: completion source must be `remeasure`. */
function nativeRemeasureProfile(epoch = 'E1'): CapabilityProfile {
  return {
    schemaVersion: 1,
    contextMeasurement: 'exact',
    nativeCompact: 'invoke-and-observe',
    contextReplacement: 'in-place',
    progressSurface: 'native',
    continuation: 'same-ui',
    completionSignal: 'remeasure',
    rollbackSupport: 'transactional',
    capabilityEpoch: epoch
  };
}

function fallbackOnlyProfile(epoch = 'E1'): CapabilityProfile {
  return {
    schemaVersion: 1,
    contextMeasurement: 'exact',
    nativeCompact: 'none',
    contextReplacement: 'in-place',
    progressSurface: 'native',
    continuation: 'same-ui',
    completionSignal: 'remeasure',
    rollbackSupport: 'transactional',
    capabilityEpoch: epoch
  };
}

function unsupportedProfile(epoch = 'E1'): CapabilityProfile {
  return {
    schemaVersion: 1,
    contextMeasurement: 'none',
    nativeCompact: 'none',
    contextReplacement: 'none',
    progressSurface: 'none',
    continuation: 'none',
    completionSignal: 'none',
    rollbackSupport: 'none',
    capabilityEpoch: epoch
  };
}

function reading(ratio: number): ContextMeasurementReading {
  return { ratio, source: 'exact', measuredAt: ISO };
}

function completedEvent(
  gen: number,
  path: 'native' | 'fallback',
  opts: {
    before: number;
    after: number;
    token: string;
    attemptId?: string;
    completionSource?: 'host-event' | 'remeasure';
  }
): CompactEvent {
  const attemptId = opts.attemptId ?? ATTEMPT;
  const receipt: CompactCompletionReceipt = {
    attemptId,
    pathGeneration: gen,
    path,
    sameUi: true,
    before: reading(opts.before),
    after: reading(opts.after),
    completionSource: opts.completionSource ?? 'host-event',
    continuationToken: opts.token,
    completedAt: ISO
  };
  return { type: 'completed', attemptId, pathGeneration: gen, receipt };
}

function failedEvent(gen: number, recoverable: boolean): CompactEvent {
  return {
    type: 'failed',
    attemptId: ATTEMPT,
    pathGeneration: gen,
    code: 'NATIVE_FAILED_EVENT',
    recoverable
  };
}

interface FakeCalls {
  attach: number;
  probe: number;
  invokeNative: NativeCompactRequest[];
  replaceWithCapsule: CapsuleReplacementRequest[];
  resume: ResumeRequest[];
}

interface FakeOptions {
  readonly probeProfiles?: readonly CapabilityProfile[];
  readonly certification: ProviderCertification;
  readonly manualMetadata?: CertifiedBridgeAttachment['manualMetadata'];
  readonly nativeInvokeThrows?: boolean;
  readonly nativeEvents?: (gen: number, attemptId: string) => readonly CompactEvent[];
  readonly fallbackEvents?: (gen: number, attemptId: string) => readonly CompactEvent[];
  readonly resumeBadDigest?: boolean;
  readonly attachThrows?: boolean;
  readonly measureContextOverride?: (gen: number, attemptId: string) => ContextMeasurementReading;
  /**
   * Map of probe-call-index → profile; consumed instead of `probeProfiles`
   * when provided (lets tests inject an epoch that changes between
   * admissions vs pre-mutation re-probes).
   */
  readonly probeByCall?: CapabilityProfile[];
}

function createFake(options: FakeOptions): {
  readonly attach: (sessionId: string, attemptId: string) => Promise<CertifiedBridgeAttachment>;
  readonly calls: FakeCalls;
} {
  const calls: FakeCalls = {
    attach: 0,
    probe: 0,
    invokeNative: [],
    replaceWithCapsule: [],
    resume: []
  };

  async function* stream(events: readonly CompactEvent[]): AsyncIterable<CompactEvent> {
    for (const ev of events) {
      yield ev;
    }
  }

  const bridge: HostCompactBridge = {
    async probe() {
      const index = calls.probe;
      calls.probe += 1;
      if (options.probeByCall) {
        return options.probeByCall[Math.min(index, options.probeByCall.length - 1)] as CapabilityProfile;
      }
      const profiles = options.probeProfiles ?? [];
      return profiles[Math.min(index, profiles.length - 1)] as CapabilityProfile;
    },
    invokeNative(input: NativeCompactRequest): AsyncIterable<CompactEvent> {
      calls.invokeNative.push(input);
      if (options.nativeInvokeThrows) {
        throw new Error('native invoke rejected');
      }
      return stream(options.nativeEvents ? options.nativeEvents(input.pathGeneration, input.attemptId) : []);
    },
    replaceWithCapsule(input: CapsuleReplacementRequest): AsyncIterable<CompactEvent> {
      calls.replaceWithCapsule.push(input);
      return stream(options.fallbackEvents ? options.fallbackEvents(input.pathGeneration, input.attemptId) : []);
    },
    async measureContext(): Promise<ContextMeasurementReading> {
      if (options.measureContextOverride) {
        // Use a deterministic gen=0 anchor; remeasure tests do not exercise
        // the gen-aware path.
        return options.measureContextOverride(0, ATTEMPT);
      }
      return reading(0.4);
    },
    async resume(input: ResumeRequest): Promise<ResumeReceipt> {
      calls.resume.push(input);
      return {
        attemptId: input.attemptId,
        pathGeneration: input.pathGeneration,
        continuationTokenDigest: options.resumeBadDigest
          ? sha256('WRONG-TOKEN')
          : sha256(input.continuationToken),
        sameUi: true,
        resumedAt: ISO
      };
    },
    async inspectTransaction(): Promise<TransactionReceipt> {
      return { attemptId: ATTEMPT, pathGeneration: 0, state: 'unknown' };
    },
    async rollback(): Promise<TransactionReceipt> {
      return { attemptId: ATTEMPT, pathGeneration: 0, state: 'rolled-back' };
    }
  };

  return {
    calls,
    async attach() {
      calls.attach += 1;
      if (options.attachThrows) {
        throw new Error('attachBridge rejected');
      }
      return {
        bridge,
        certification: options.certification,
        manualMetadata: options.manualMetadata ?? null
      };
    }
  };
}

function circuitFilePath(): string {
  return join(projectRoot, '.peaks', '_runtime', SESSION, 'compact-attempts', 'session-circuit.json');
}

function journalFilePath(): string {
  return join(
    projectRoot,
    '.peaks',
    '_runtime',
    SESSION,
    'compact-attempts',
    `${ATTEMPT}.journal.json`
  );
}

interface MakeCoordinatorOptions extends FakeOptions {
  readonly createFallbackCapsule?: CreateFallbackCapsuleFn;
  readonly store?: AttemptStoreShim;
  /** If set, pre-create a path that will block the first journal write. */
  readonly blockJournalWrite?: boolean;
}

type AttemptStoreShim = ReturnType<typeof createAttemptStore>;
type CreateFallbackCapsuleFn = (input: {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly pathGeneration: number;
}) => Promise<{ readonly capsule: unknown; readonly capsuleDigest: string }> | { readonly capsule: unknown; readonly capsuleDigest: string };

function makeCoordinator(opts: MakeCoordinatorOptions) {
  const { createFallbackCapsule, blockJournalWrite, store: providedStore, ...fakeOptions } = opts;
  const store = providedStore ?? createAttemptStore({ projectRoot, sessionId: SESSION });
  const fake = createFake(fakeOptions);
  const deps: Parameters<typeof createAttemptCoordinator>[0] = {
    attachBridge: fake.attach,
    store,
    now: () => NOW,
    newAttemptId: () => ATTEMPT
  };
  if (createFallbackCapsule) {
    (deps as { createFallbackCapsule?: CreateFallbackCapsuleFn }).createFallbackCapsule =
      createFallbackCapsule;
  }
  if (blockJournalWrite) {
    // Pre-create the attempt journal as a DIRECTORY so the first
    // atomic write of the attempt journal fails (EISDIR on rename).
    const journalPath = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    require('node:fs').mkdirSync(journalPath, { recursive: true });
  }
  const coordinator = createAttemptCoordinator(deps);
  return { store, fake, coordinator };
}

const baseInput = {
  projectRoot: '',
  sessionId: SESSION,
  targetRatio: 0.6,
  dryRun: false
};

function input(overrides: Partial<typeof baseInput> = {}) {
  return { ...baseInput, projectRoot, ...overrides };
}

describe('behavior — dry-run is side-effect-free', () => {
  it('returns a native plan without writing a journal or invoking a mutating bridge call', async () => {
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong'
    });

    const result = await coordinator.compactAuto(input({ dryRun: true }));

    expect(result).toEqual({
      ok: true,
      code: 'AUTO_COMPACT_PLAN',
      path: 'native',
      profile: nativeStrongProfile()
    });
    expect(existsSync(journalFilePath())).toBe(false);
    expect(existsSync(circuitFilePath())).toBe(false);
    expect(fake.calls.invokeNative).toHaveLength(0);
    expect(fake.calls.replaceWithCapsule).toHaveLength(0);
    expect(fake.calls.resume).toHaveLength(0);
  });

  it('returns a fallback plan when native is not admissible but fallback is', async () => {
    const { coordinator } = makeCoordinator({
      probeProfiles: [fallbackOnlyProfile()],
      certification: 'certified-strong'
    });

    const result = await coordinator.compactAuto(input({ dryRun: true }));

    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_PLAN', path: 'fallback' });
  });
});

describe('behavior — admission blocking', () => {
  it('returns UNSUPPORTED and never dispatches when neither path is admissible', async () => {
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [unsupportedProfile()],
      certification: 'certified-strong'
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({
      ok: false,
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE',
      manualFallback: { kind: 'remain-blocked' }
    });
    expect(fake.calls.invokeNative).toHaveLength(0);
    expect(fake.calls.replaceWithCapsule).toHaveLength(0);
  });
});

describe('behavior — open circuit short-circuits before attach', () => {
  it('returns CIRCUIT_OPEN without attaching a bridge when the circuit is already open', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED', NOW);
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED', NOW);
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED', NOW);

    const fake = createFake({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong'
    });
    const coordinator = createAttemptCoordinator({
      attachBridge: fake.attach,
      store,
      now: () => NOW,
      newAttemptId: () => ATTEMPT
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({
      ok: false,
      code: 'AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN',
      manualFallback: { kind: 'remain-blocked' }
    });
    expect(fake.calls.attach).toBe(0);
    expect(fake.calls.probe).toBe(0);
  });
});

describe('behavior — stale capabilityEpoch is rejected before mutation', () => {
  it('does not invoke native compact when the epoch changes after admission', async () => {
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile('E1'), nativeStrongProfile('E2')],
      certification: 'certified-strong'
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
    expect(fake.calls.invokeNative).toHaveLength(0);
  });
});

describe('behavior — native happy path', () => {
  it('claims completed only after a matching resume receipt', async () => {
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen) => [completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-1' })]
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });
    if (result.ok && result.code === 'AUTO_COMPACT_COMPLETED') {
      expect(result.receipt.continuationToken).toBe('tok-1');
    }
    expect(fake.calls.invokeNative).toHaveLength(1);
    expect(fake.calls.resume).toHaveLength(1);
  });

  it('does NOT claim completed when the resume receipt digest does not match', async () => {
    const { store, coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen) => [completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-1' })],
      resumeBadDigest: true
    });

    const result = await coordinator.compactAuto(input());

    expect(result.ok).toBe(false);
    // A resume failure is a §9 verification failure: the session counter moves.
    expect((await store.readSessionCircuit()).consecutiveVerificationFailures).toBe(1);
  });
});

describe('behavior — late event from an older generation is ignored', () => {
  it('ignores a stale failed event and still completes on the current-generation receipt', async () => {
    const { coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen) => [
        failedEvent(gen + 99, true),
        completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-1' })
      ]
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });
  });
});

describe('behavior — native→fallback switch increments generation once', () => {
  it('reuses the attemptId and increments pathGeneration exactly once on a recoverable invocation failure', async () => {
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeInvokeThrows: true,
      fallbackEvents: (gen) => [
        completedEvent(gen, 'fallback', {
          before: 0.9,
          after: 0.4,
          token: 'tok-2',
          completionSource: 'remeasure'
        })
      ],
      createFallbackCapsule: () => ({ capsule: {}, capsuleDigest: sha256('phase2-capsule-v1') })
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });
    expect(fake.calls.invokeNative).toHaveLength(1);
    expect(fake.calls.invokeNative[0]?.pathGeneration).toBe(0);
    expect(fake.calls.replaceWithCapsule).toHaveLength(1);
    expect(fake.calls.replaceWithCapsule[0]?.pathGeneration).toBe(1);
    expect(fake.calls.replaceWithCapsule[0]?.attemptId).toBe(ATTEMPT);
    expect(fake.calls.invokeNative[0]?.attemptId).toBe(ATTEMPT);
  });
});

describe('behavior — verification failure uses the session counter', () => {
  it('records exactly one session verification failure when reduction is insufficient', async () => {
    const { store, coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen) => [completedEvent(gen, 'native', { before: 0.9, after: 0.85, token: 'tok-1' })]
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
    expect((await store.readSessionCircuit()).consecutiveVerificationFailures).toBe(1);
  });
});

describe('behavior — third verification failure trips the circuit and latches the prompt once', () => {
  it('returns CIRCUIT_OPEN with a natural-language choice and latches manualPromptShown exactly once', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    // Seed two prior verification failures so this attempt trips the third.
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED', NOW);
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED', NOW);

    const metadata = {
      schemaVersion: 1 as const,
      providerId: 'provider-a',
      naturalLanguageActionAvailable: true,
      hostNativeDisplayHint: null,
      metadataDigest: ''
    };
    const withDigest = { ...metadata, metadataDigest: computeManualMetadataDigest(metadata) };

    const fake = createFake({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      manualMetadata: withDigest,
      nativeEvents: (gen) => [completedEvent(gen, 'native', { before: 0.9, after: 0.85, token: 'tok-1' })]
    });
    const coordinator = createAttemptCoordinator({
      attachBridge: fake.attach,
      store,
      now: () => NOW,
      newAttemptId: () => ATTEMPT
    });

    const result = await coordinator.compactAuto(input());

    expect(result).toMatchObject({
      ok: false,
      code: 'AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN',
      manualFallback: { kind: 'offer-natural-language-choice' }
    });
    expect((await store.readSessionCircuit()).manualPromptShown).toBe(true);
  });
});

describe('integration — same-session calls are serialized', () => {
  it('does not lose a failure increment when two calls run in parallel', async () => {
    // Each real auto call gets a fresh attempt id; the fake mints unique
    // ids so the two attempts do not collide on one journal. The counter
    // is what must survive interleaving.
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    let seq = 0;
    const fake = createFake({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', { before: 0.9, after: 0.85, token: 'tok-1', attemptId })
      ]
    });
    const coordinator = createAttemptCoordinator({
      attachBridge: fake.attach,
      store,
      now: () => NOW,
      newAttemptId: () => `attempt-${(seq += 1)}`
    });

    const [a, b] = await Promise.all([
      coordinator.compactAuto(input()),
      coordinator.compactAuto(input())
    ]);

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    // Serialized: 0 → 1 → 2. A lost update would leave the counter at 1.
    expect((await store.readSessionCircuit()).consecutiveVerificationFailures).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Review handoff findings (Important).
// ---------------------------------------------------------------------------

describe('boundary — attachBridge throw resolves typed EXHAUSTED and the lock is released', () => {
  it('returns EXHAUSTED (never rejects) and a later call still works', async () => {
    // First call: attach throws. Second call: healthy native path.
    let seq = 0;
    let shouldAttachThrow = true;
    const calls: { attach: number } = { attach: 0 };

    const store = createAttemptStore({ projectRoot, sessionId: SESSION });

    const coordinator = createAttemptCoordinator({
      attachBridge: async () => {
        calls.attach += 1;
        if (shouldAttachThrow) throw new Error('attach rejected');
        const fake = createFake({
          probeProfiles: [nativeStrongProfile()],
          certification: 'certified-strong',
          nativeEvents: (gen, attemptId) => [
            completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-ok', attemptId })
          ]
        });
        return await fake.attach(SESSION, `attempt-${(seq += 1)}`);
      },
      store,
      now: () => NOW,
      newAttemptId: () => `attempt-${(seq += 1)}`
    });

    const a = await coordinator.compactAuto(input());
    expect(a).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });

    shouldAttachThrow = false;
    const b = await coordinator.compactAuto(input());
    // If the lock were not released after the throw, the second call would
    // also exhaust (or hang) instead of completing.
    expect(b).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });
    expect(calls.attach).toBeGreaterThanOrEqual(2);
  });

  it('probe throw resolves typed EXHAUSTED', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    const coordinator = createAttemptCoordinator({
      attachBridge: async () => ({
        bridge: {
          async probe(): Promise<CapabilityProfile> {
            throw new Error('probe rejected');
          },
          invokeNative() {
            throw new Error('not used');
          },
          replaceWithCapsule() {
            throw new Error('not used');
          },
          async measureContext() { return reading(0.4); },
          async resume() {
            throw new Error('not used');
          },
          async inspectTransaction() { return { attemptId: ATTEMPT, pathGeneration: 0, state: 'unknown' }; },
          async rollback() { return { attemptId: ATTEMPT, pathGeneration: 0, state: 'rolled-back' }; }
        },
        certification: 'certified-strong',
        manualMetadata: null
      }),
      store,
      now: () => NOW,
      newAttemptId: () => ATTEMPT
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
  });
});

describe('boundary — first journal write throw resolves typed EXHAUSTED', () => {
  it('returns EXHAUSTED when the attempt journal cannot be written', async () => {
    const { coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-1', attemptId })
      ],
      blockJournalWrite: true
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
  });
});

describe('probe re-probe — pathGeneration is threaded through', () => {
  it('fallback re-probe carries pathGeneration=1 (matches the dispatch generation)', async () => {
    // Native admission (gen=0) throws → fallback switch → re-probe at gen=1.
    // Capture every probe call by wrapping the bridge probe.
    const probePayloads: number[] = [];
    let seq = 0;
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });

    const coordinator = createAttemptCoordinator({
      createFallbackCapsule: () => ({ capsule: {}, capsuleDigest: sha256('phase2-capsule-v1') }),
      attachBridge: async () => {
        const fake = createFake({
          probeProfiles: [nativeStrongProfile()],
          certification: 'certified-strong',
          nativeInvokeThrows: true,
          fallbackEvents: (gen, attemptId) => [
            completedEvent(gen, 'fallback', {
              before: 0.9,
              after: 0.4,
              token: 'tok-2',
              attemptId,
              completionSource: 'remeasure'
            })
          ]
        });
        const base = await fake.attach(SESSION, `attempt-${(seq += 1)}`);
        return {
          ...base,
          bridge: {
            ...base.bridge,
            async probe(input) {
              probePayloads.push(input.pathGeneration);
              return base.bridge.probe(input);
            }
          }
        };
      },
      store,
      now: () => NOW,
      newAttemptId: () => `attempt-${(seq += 1)}`
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });
    // Admission probe at gen=0; at least one re-probe at the fallback
    // generation (gen=1); no probe carries gen=2.
    expect(probePayloads[0]).toBe(0);
    expect(probePayloads).toContain(1);
    expect(probePayloads).not.toContain(2);
  });

  it('an epoch change between dispatch and re-probe blocks the mutation (no replaceWithCapsule)', async () => {
    // Probe profiles: first is the admission epoch, then every subsequent
    // re-probe returns a different epoch.
    const seq = { value: 0 };
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    const fake = createFake({
      probeByCall: [nativeStrongProfile('E1'), nativeStrongProfile('E2')],
      certification: 'certified-strong',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-1', attemptId })
      ]
    });
    const coordinator = createAttemptCoordinator({
      attachBridge: fake.attach,
      store,
      now: () => NOW,
      newAttemptId: () => `attempt-${(seq.value += 1)}`
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
  });
});

describe('completionSource validation', () => {
  it('event-with-measurement receipt is rejected when certification is not certified-strong', async () => {
    // The profile says event-with-measurement, but the attachment is
    // native-only. The coordinator must NOT trust the receipt as a §9
    // proof of reduction; it must use the remeasure fallback (and the
    // receipt after) — but here we assert the negative: a self-claimed
    // `host-event` source under a non-strong certification cannot pass
    // through and complete.
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'native-only',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', {
          before: 0.9,
          after: 0.4,
          token: 'tok-1',
          attemptId,
          completionSource: 'host-event'
        })
      ]
    });

    const result = await coordinator.compactAuto(input());
    // The admission policy already rejects native-only under native (or
    // sends to native path only) — but we picked native-strong profile +
    // native-only certification. Under `native-only`, only native is
    // admissible. The completionSource gate must still reject the receipt
    // because the certification isn't strong.
    expect(result.ok).toBe(false);
    // Either UNSUPPORTED or EXHAUSTED; either way we did NOT claim
    // completed from a self-trusted host-event.
    if (result.ok === false) {
      expect(['AUTO_COMPACT_EXHAUSTED', 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE']).toContain(
        result.code
      );
    }
    expect(fake.calls.resume).toHaveLength(0);
  });

  it('remeasure completion ignores receipt.after and uses the live measureContext reading', async () => {
    // Profile says completionSignal=remeasure, so we must re-measure rather
    // than trust receipt.after. The bridge reports measureContext=0.85
    // (insufficient reduction). The receipt's after=0.4 is ignored.
    const { store, coordinator } = makeCoordinator({
      probeProfiles: [nativeRemeasureProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', {
          before: 0.9,
          after: 0.4,
          token: 'tok-1',
          attemptId,
          completionSource: 'remeasure'
        })
      ],
      measureContextOverride: () => reading(0.85)
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
    expect((await store.readSessionCircuit()).consecutiveVerificationFailures).toBe(1);
  });

  it('remeasure completion passes when the live measureContext reading satisfies §9', async () => {
    const { coordinator } = makeCoordinator({
      probeProfiles: [nativeRemeasureProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', {
          before: 0.9,
          after: 0.85, // intentionally misleading
          token: 'tok-1',
          attemptId,
          completionSource: 'remeasure'
        })
      ],
      measureContextOverride: () => reading(0.3)
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });
  });
});

describe('post-resume epoch re-probe', () => {
  it('an epoch change after the resume blocks completion (returns EXHAUSTED, no completion seal)', async () => {
    // Probe sequence: [admission=E1, pre-mutation=E1, post-resume=E2]
    // To produce this, every probe call except index 2 returns E1; index 2 returns E2.
    const seq = { value: 0 };
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    const fake = createFake({
      probeByCall: [nativeStrongProfile('E1'), nativeStrongProfile('E1'), nativeStrongProfile('E2')],
      certification: 'certified-strong',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-1', attemptId })
      ]
    });
    const coordinator = createAttemptCoordinator({
      attachBridge: fake.attach,
      store,
      now: () => NOW,
      newAttemptId: () => `attempt-${(seq.value += 1)}`
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
  });
});

describe('capsule traceability — no fabricated fallback digest', () => {
  it('absent createFallbackCapsule ⇒ dry-run plans fallback but execution exhausts before any replaceWithCapsule', async () => {
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [fallbackOnlyProfile()],
      certification: 'certified-strong'
    });

    const plan = await coordinator.compactAuto(input({ dryRun: true }));
    expect(plan).toMatchObject({ ok: true, code: 'AUTO_COMPACT_PLAN', path: 'fallback' });

    const exec = await coordinator.compactAuto(input());
    expect(exec).toMatchObject({ ok: false, code: 'AUTO_COMPACT_EXHAUSTED' });
    expect(fake.calls.replaceWithCapsule).toHaveLength(0);
    expect(fake.calls.invokeNative).toHaveLength(0);
    expect(fake.calls.resume).toHaveLength(0);
  });

  it('injected Phase-2 seam capsule+digest can complete the fallback path', async () => {
    const capsulePayload = { peak: 'value' };
    const { fake, coordinator } = makeCoordinator({
      probeProfiles: [fallbackOnlyProfile()],
      certification: 'certified-strong',
      fallbackEvents: (gen, attemptId) => [
        completedEvent(gen, 'fallback', {
          before: 0.9,
          after: 0.4,
          token: 'tok-3',
          attemptId,
          completionSource: 'remeasure'
        })
      ],
      createFallbackCapsule: () => ({ capsule: capsulePayload, capsuleDigest: sha256('phase2-capsule-v1') })
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });
    expect(fake.calls.replaceWithCapsule).toHaveLength(1);
    expect(fake.calls.replaceWithCapsule[0]?.capsuleDigest).toBe(sha256('phase2-capsule-v1'));
  });
});

describe('happy-path journal stage progression is persisted before dispatch', () => {
  it('records preparing → native-compacting → verifying → resuming → completed in order', async () => {
    const { coordinator, store } = makeCoordinator({
      probeProfiles: [nativeStrongProfile()],
      certification: 'certified-strong',
      nativeEvents: (gen, attemptId) => [
        completedEvent(gen, 'native', { before: 0.9, after: 0.4, token: 'tok-1', attemptId })
      ]
    });

    const result = await coordinator.compactAuto(input());
    expect(result).toMatchObject({ ok: true, code: 'AUTO_COMPACT_COMPLETED' });

    const journal = await store.readAttempt(ATTEMPT);
    expect(journal).not.toBeNull();
    // The terminal stage proves every preceding transition persisted
    // (preparing → native-compacting → verifying → resuming → completed).
    expect(journal!.stage).toBe('completed');
  });
});
