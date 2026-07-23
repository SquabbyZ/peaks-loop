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
  opts: { before: number; after: number; token: string; attemptId?: string }
): CompactEvent {
  const attemptId = opts.attemptId ?? ATTEMPT;
  const receipt: CompactCompletionReceipt = {
    attemptId,
    pathGeneration: gen,
    path,
    sameUi: true,
    before: reading(opts.before),
    after: reading(opts.after),
    completionSource: 'host-event',
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
  readonly probeProfiles: readonly CapabilityProfile[];
  readonly certification: ProviderCertification;
  readonly manualMetadata?: CertifiedBridgeAttachment['manualMetadata'];
  readonly nativeInvokeThrows?: boolean;
  readonly nativeEvents?: (gen: number, attemptId: string) => readonly CompactEvent[];
  readonly fallbackEvents?: (gen: number, attemptId: string) => readonly CompactEvent[];
  readonly resumeBadDigest?: boolean;
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
      const index = Math.min(calls.probe, options.probeProfiles.length - 1);
      calls.probe += 1;
      return options.probeProfiles[index] as CapabilityProfile;
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

function makeCoordinator(fakeAttach: FakeOptions) {
  const store = createAttemptStore({ projectRoot, sessionId: SESSION });
  const fake = createFake(fakeAttach);
  const coordinator = createAttemptCoordinator({
    attachBridge: fake.attach,
    store,
    now: () => NOW,
    newAttemptId: () => ATTEMPT
  });
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
      fallbackEvents: (gen) => [completedEvent(gen, 'fallback', { before: 0.9, after: 0.4, token: 'tok-2' })]
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
