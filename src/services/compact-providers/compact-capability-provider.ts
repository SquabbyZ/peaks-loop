/**
 * Compact Capability Provider — vendor-neutral host bridge registry (Phase 3).
 *
 * Defines the `CompactCapabilityProvider` interface: a thin, vendor-neutral
 * wrapper around an official host integration (Claude Code, Z-Code, Codex,
 * Cursor, Trae, custom). The core never branches on `providerId`; it only
 * consumes the resulting `CertifiedBridgeAttachment` and `CapabilityProfile`.
 *
 * Red rule: nothing in this module may import a host SDK, name a vendor
 * binary, or branch on a vendor discriminator. Enforced by
 * `tests/unit/services/compact-core/vendor-neutrality.test.ts`.
 */

import type { HostCompactBridge } from '../compact-core/protocol/host-compact-bridge.js';
import type { ProviderCertification } from '../compact-core/compact-policy.js';

/**
 * Opaque session descriptor. Providers use it to decide whether they can
 * attach to the current session. The core never reads it back.
 */
export interface HostSessionDescriptor {
  readonly sessionId: string;
  readonly projectRoot: string;
}

/**
 * The single contract every host bridge must implement. Bridges returned
 * by `createBridge` must satisfy the `HostCompactBridge` interface in
 * compact-core (design §4.4 / §4.5).
 */
export interface CompactProviderMetadata {
  readonly providerId: string;
  readonly protocolVersion: 1;
  readonly implementationVersion: string;
  readonly implementationDigest: string;
}

export interface CompactCapabilityProvider {
  readonly metadata: CompactProviderMetadata;
  canAttach(session: HostSessionDescriptor): Promise<boolean>;
  createBridge(session: HostSessionDescriptor): Promise<HostCompactBridge>;
}

/**
 * The certification record attached to a certified manifest entry. The
 * `certificationLevel` is one of `ProviderCertification` (design §12.3);
 * the surrounding envelope carries the metadata that gates attachment
 * (expiry, capability hash, evidence digest, etc.).
 */
export interface CompactProviderCertification {
  readonly providerId: string;
  readonly protocolVersion: 1;
  readonly implementationVersion: string;
  readonly implementationDigest: string;
  readonly capabilityHash: string;
  readonly certificationLevel: ProviderCertification;
  readonly conformanceSuiteVersion: string;
  readonly evidenceDigest: string;
  readonly evidenceIndexPath: string;
  readonly certifiedAt: string;
  readonly expiresAt: string;
}

/** Bundle returned by `loadCertifiedProvider` after all integrity checks pass. */
export interface LoadedProvider {
  readonly provider: CompactCapabilityProvider;
  readonly certification: CompactProviderCertification;
}
