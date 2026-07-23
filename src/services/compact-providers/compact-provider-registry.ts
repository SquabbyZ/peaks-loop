/**
 * Compact provider registry — Phase 3 Task 3.2.
 *
 * Vendor-neutral: `providerId` is opaque. The core never branches on it.
 * Insertion order is preserved; the first attachable provider wins.
 *
 * `attach` is the only public path that produces a `CertifiedBridgeAttachment`.
 * It loads the on-disk manifest via `loadProviderManifestFile`, runs
 * `decideAttachment` against a live `probe()` capability profile, and
 * constructs the `CompactCapabilityProvider` lazily on first use.
 */
import type { HostCompactBridge } from '../compact-core/protocol/host-compact-bridge.js';
import type { CapabilityProfile } from '../compact-core/protocol/capability-profile.js';
import type {
  CompactProviderManifest,
  CompactProviderManifestEntry
} from './provider-manifest-schema.js';
import type {
  CompactProviderCertification,
  CompactProviderMetadata,
  CompactCapabilityProvider,
  HostSessionDescriptor
} from './compact-capability-provider.js';
import {
  loadProviderManifestFile,
  findManifestEntry
} from './provider-manifest-store.js';
import { decideAttachment, type CertificationDecision } from './provider-certification-policy.js';

export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRegistryError';
  }
}

export class DuplicateProviderError extends ProviderRegistryError {
  constructor(providerId: string) {
    super(`provider already registered: ${providerId}`);
    this.name = 'DuplicateProviderError';
  }
}

export class UnknownProviderError extends ProviderRegistryError {
  constructor(providerId: string) {
    super(`no provider registered for providerId=${providerId}`);
    this.name = 'UnknownProviderError';
  }
}

export class ProviderNotAttachableError extends ProviderRegistryError {
  constructor(public readonly decision: CertificationDecision, providerId: string) {
    super(`provider ${providerId} not attachable: effective=${decision.effective.kind} attachable=${decision.attachable}`);
    this.name = 'ProviderNotAttachableError';
  }
}

export class CanAttachError extends ProviderRegistryError {
  constructor(public readonly cause: unknown, providerId: string) {
    super(`canAttach() threw for provider ${providerId}: ${(cause as Error).message}`);
    this.name = 'CanAttachError';
  }
}

export interface CertifiedBridgeAttachment {
  readonly providerId: string;
  readonly certificationLevel: 'certified-strong' | 'native-only' | 'safe-handoff' | 'unsupported';
  readonly capabilityProfile: CapabilityProfile;
  readonly capabilityHash: string;
  readonly bridge: HostCompactBridge;
  readonly decision: CertificationDecision;
}

export class CompactProviderRegistry {
  private readonly providers = new Map<string, CompactCapabilityProvider>();

  register(provider: CompactCapabilityProvider): void {
    if (this.providers.has(provider.metadata.providerId)) {
      throw new DuplicateProviderError(provider.metadata.providerId);
    }
    this.providers.set(provider.metadata.providerId, provider);
  }

  list(): readonly CompactProviderMetadata[] {
    // Preserve insertion order.
    return Array.from(this.providers.values()).map((p) => p.metadata);
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Build a `CertifiedBridgeAttachment` for `session` using a single manifest
   * entry. Pure orchestrator: if any step fails, the function throws and
   * returns nothing. `manifestEntry` may be pre-loaded by the caller; if not
   * provided, the loader falls back to `loadProviderManifestFile` with
   * `options.now`.
   */
  async attach(
    session: HostSessionDescriptor,
    options: {
      readonly providerId: string;
      readonly manifestPath: string;
      readonly now: Date;
      readonly manifestEntry?: CompactProviderManifestEntry;
      readonly requireHashMatch?: boolean;
    }
  ): Promise<CertifiedBridgeAttachment> {
    const provider = this.providers.get(options.providerId);
    if (!provider) {
      throw new UnknownProviderError(options.providerId);
    }

    let entry: CompactProviderManifestEntry;
    if (options.manifestEntry !== undefined) {
      entry = options.manifestEntry;
    } else {
      const manifest = loadProviderManifestFile(options.manifestPath, {
        now: options.now,
        expectedProviderId: options.providerId
      });
      entry = findManifestEntry(manifest, options.providerId);
    }

    // 1. canAttach() must succeed; errors are isolated and surfaced.
    let canAttach: boolean;
    try {
      canAttach = await provider.canAttach(session);
    } catch (err) {
      throw new CanAttachError(err, options.providerId);
    }
    if (!canAttach) {
      throw new ProviderNotAttachableError(
        { effective: { kind: 'unsupported' }, attachable: false, hashMatches: false },
        options.providerId
      );
    }

    // 2. createBridge() runs the live capability probe via HostCompactBridge.probe.
    const bridge = await provider.createBridge(session);
    const probe = await bridge.probe({
      kind: 'probe',
      sessionId: session.sessionId,
      attemptId: 'attach-probe',
      pathGeneration: 0
    });

    // 3. Decide against the live profile. Live profile can REDUCE strength
    //    but never ELEVATE the recorded level.
    const decision = decideAttachment(entry.certification, probe, {
      now: options.now,
      requireHashMatch: options.requireHashMatch !== false
    });
    if (!decision.attachable) {
      throw new ProviderNotAttachableError(decision, options.providerId);
    }

    // 4. Stamp the live profile onto the attachment.
    return {
      providerId: options.providerId,
      certificationLevel: decision.effective.kind,
      capabilityProfile: probe,
      capabilityHash: entry.certification.capabilityHash,
      bridge,
      decision
    };
  }
}
