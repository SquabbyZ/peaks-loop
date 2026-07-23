# Phase 3 — Host Bridge Certification and Conformance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Do not implement a real provider in this phase.

**Goal:** Build a certification-gated provider registry and reusable conformance harness, then disable every legacy path that can claim compact success without acting on the current host session.

**Architecture:** Providers register through a protocol-specific registry separate from IDE settings and legacy process adapters. A local manifest binds certification to provider implementation, observed capabilities, evidence digest, suite version, and expiry. A fake-host harness proves the suite catches violations; real-host evidence is Phase 4.

**Tech Stack:** TypeScript, Zod/JSON Schema, Vitest, Commander, SHA-256, existing atomic JSON utilities.

## Global Constraints

Inherit [`../2026-07-23-auto-compact.md`](../2026-07-23-auto-compact.md). Provider metadata may identify a host, but `compact-core` never imports or branches on it. Mock evidence cannot grant a real-host certification level.

---

## Task 3.1: Define provider and certification manifest schemas

**Files:**
- Create: `src/services/compact-providers/compact-capability-provider.ts`
- Create: `src/services/compact-providers/provider-manifest-schema.ts`
- Create: `schemas/compact-provider-manifest.schema.json`
- Test: `tests/unit/services/compact-providers/provider-manifest-schema.test.ts`

**Interfaces:**

```ts
export type CertificationLevel = 'certified-strong' | 'native-only' | 'safe-handoff' | 'unsupported';

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

export interface CompactProviderCertification {
  readonly providerId: string;
  readonly protocolVersion: 1;
  readonly implementationVersion: string;
  readonly implementationDigest: string;
  readonly capabilityHash: string;
  readonly certificationLevel: CertificationLevel;
  readonly conformanceSuiteVersion: string;
  readonly evidenceDigest: string;
  readonly evidenceIndexPath: string;
  readonly certifiedAt: string;
  readonly expiresAt: string;
}
```

Manifest path: `.peaks/_runtime/compact-providers.json`. It contains no commands, tokens, transcripts, or capsule bodies.

- [ ] **Step 1: Write failing schema tests**

Reject unknown protocol, unknown fields, malformed hashes/dates, expired entries, path escapes, command-like fields, and inconsistent manifest digest.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-providers/provider-manifest-schema.test.ts
```

- [ ] **Step 3: Implement Zod and generated JSON schema**

Canonical hash excludes only `manifestDigest`.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-providers/provider-manifest-schema.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-providers schemas/compact-provider-manifest.schema.json tests/unit/services/compact-providers

git commit -m "feat(compact): define provider certification manifest"
```

---

## Task 3.2: Build certified provider loading

**Files:**
- Create: `src/services/compact-providers/provider-manifest-store.ts`
- Create: `src/services/compact-providers/provider-certification-policy.ts`
- Create: `src/services/compact-providers/compact-provider-registry.ts`
- Test: `tests/unit/services/compact-providers/provider-manifest-store.test.ts`
- Test: `tests/unit/services/compact-providers/provider-certification-policy.test.ts`
- Test: `tests/unit/services/compact-providers/compact-provider-registry.test.ts`

**Interfaces:**

```ts
export interface CertifiedBridgeAttachment {
  readonly providerId: string;
  readonly certificationLevel: CertificationLevel;
  readonly capabilityProfile: CapabilityProfile;
  readonly capabilityHash: string;
  readonly bridge: HostCompactBridge;
}

export class CompactProviderRegistry {
  register(provider: CompactCapabilityProvider): void;
  list(): readonly CompactProviderMetadata[];
  attach(session: HostSessionDescriptor, manifest: CompactProviderManifest): Promise<CertifiedBridgeAttachment>;
}
```

- [ ] **Step 1: Write failing registry/policy tests**

Duplicate IDs fail; deterministic registration order; `canAttach` errors isolated; binary/env presence alone cannot attach; implementation/evidence/capability/manifest hash mismatch fails; expiry fails; runtime profile can reduce but not elevate certification; `safe-handoff` returns consent-required, never executable strong attachment.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-providers
```

- [ ] **Step 3: Implement store, policy, registry**

Probe after attachment and compare live capability hash. Treat `capabilityEpoch` as attempt freshness, not installation identity.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-providers
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-providers tests/unit/services/compact-providers

git commit -m "feat(compact): gate provider attachment on certification"
```

---

## Task 3.3: Create the reusable conformance evidence model

**Files:**
- Create: `src/services/compact-conformance/conformance-types.ts`
- Create: `src/services/compact-conformance/evidence-schema.ts`
- Create: `src/services/compact-conformance/evidence-recorder.ts`
- Create: `schemas/compact-conformance-evidence.schema.json`
- Test: `tests/unit/services/compact-conformance/evidence-recorder.test.ts`

**Interfaces:**

```ts
export interface CompactConformanceCaseResult {
  readonly caseId: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly evidence: readonly EvidencePointer[];
  readonly failureCode?: string;
}
```

Evidence per attempt belongs under `.peaks/_runtime/<sessionId>/compact-evidence/<attemptId>/` and must be sanitized before becoming a stable certification fixture.

- [ ] **Step 1: Write failing evidence tests**

Reject raw transcript, continuation token, capsule body, secret patterns, missing digest, outside-root evidence path, and skipped case represented as passed.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-conformance/evidence-recorder.test.ts
```

- [ ] **Step 3: Implement schema and recorder**

Use pointer/hash metadata, never raw sensitive content.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-conformance/evidence-recorder.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-conformance schemas/compact-conformance-evidence.schema.json tests/unit/services/compact-conformance

git commit -m "feat(compact): record sanitized conformance evidence"
```

---

## Task 3.4: Implement the conformance runner and certification evaluator

**Files:**
- Create: `src/services/compact-conformance/conformance-cases.ts`
- Create: `src/services/compact-conformance/conformance-runner.ts`
- Create: `src/services/compact-conformance/certification-evaluator.ts`
- Create: `tests/helpers/compact-conformance/fake-host-harness.ts`
- Test: `tests/unit/services/compact-conformance/conformance-runner.test.ts`
- Test: `tests/unit/services/compact-conformance/certification-evaluator.test.ts`

**Required cases:**

```text
CAP-001       declared capabilities equal observable behavior
ATTACH-001    current-session attachment proved
NATIVE-001    native invocation occurs in attached session
EVENT-001     attempt/generation order and one terminal event
PROGRESS-001  monotonic progress, no premature 100%
UI-001        same UI identity
FALLBACK-001  capsule replacement is in-place
ROLLBACK-001  replacement failure restores old context
MEASURE-001   after < min(before * 0.70, 0.60)
RESUME-001    token-bound same-UI resume
IDEMPOTENCY-001 next action exactly once
CRASH-001/2/3 replacing/verifying/resuming recovery
STALE-001     stale capability epoch aborts
GENERATION-001 late events cannot complete next generation
PRIVACY-001   no raw sensitive evidence
CIRCUIT-001   three failures stop calls and one manual observation only
```

- [ ] **Step 1: Write failing runner/evaluator tests**

Positive fake host passes; separately inject each violation and prove the matching case fails. Skipped strong cases prevent `certified-strong`. Map exact case sets to all four certification levels.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-conformance/conformance-runner.test.ts tests/unit/services/compact-conformance/certification-evaluator.test.ts
```

- [ ] **Step 3: Implement cases and evaluator**

The evaluator computes the maximum level; callers cannot request or force one.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-conformance
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-conformance tests/helpers/compact-conformance tests/unit/services/compact-conformance

git commit -m "test(compact): add provider conformance suite"
```

---

## Task 3.5: Add provider discovery/conformance/certification CLI

**Files:**
- Create: `src/cli/commands/compact-provider-command.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/unit/cli/compact-provider-command.test.ts`
- Test: `tests/integration/compact-provider-certification-cli.test.ts`

**Internal commands:**

```text
peaks compact provider discover --provider <id> --json
peaks compact provider conform --provider <id> --evidence-dir <path> --json
peaks compact provider certify --provider <id> --evidence-index <path> --json
```

These are LLM/CI primitives, not commands the user must type.

- [ ] **Step 1: Write failing CLI tests**

Discover cannot certify; conform writes sanitized evidence; certify recomputes all digests; mock evidence cannot certify a real host; no force/skip/vendor-command options; unknown provider reports unsupported without prompting for JSON.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/cli/compact-provider-command.test.ts tests/integration/compact-provider-certification-cli.test.ts
```

- [ ] **Step 3: Implement handlers and register once under existing compact group**

Avoid duplicate top-level `compact` registration; export a function that receives the existing Commander `compact` command.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/cli/compact-provider-command.test.ts tests/integration/compact-provider-certification-cli.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/compact-provider-command.ts src/cli/program.ts tests/unit/cli/compact-provider-command.test.ts tests/integration/compact-provider-certification-cli.test.ts

git commit -m "feat(compact): add provider certification commands"
```

---

## Task 3.6: Prove provider addition requires zero compact-core changes

**Files:**
- Create: `src/services/compact-providers/built-in-providers.ts`
- Create: `tests/integration/compact-provider-zero-core-change.test.ts`
- Modify: `tests/unit/services/compact-core/vendor-neutrality.test.ts`

- [ ] **Step 1: Write failing registration tests**

Register two fake providers as data; assert coordinator source hash is unchanged; scan core imports for provider/IDE/runtime modules; uncertified/expired provider remains blocked; adding provider requires only provider and registry data files.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/integration/compact-provider-zero-core-change.test.ts tests/unit/services/compact-core/vendor-neutrality.test.ts
```

- [ ] **Step 3: Implement data-driven registration**

No built-in real provider yet; expose an empty/default provider array and a test injection seam.

- [ ] **Step 4: Verify Phase 3**

```bash
pnpm exec vitest run tests/unit/services/compact-providers tests/unit/services/compact-conformance tests/integration/compact-provider-certification-cli.test.ts tests/integration/compact-provider-zero-core-change.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
pnpm lint:silent-warning
peaks scan file-size --project . --json
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-providers/built-in-providers.ts tests/integration/compact-provider-zero-core-change.test.ts tests/unit/services/compact-core/vendor-neutrality.test.ts

git commit -m "test(compact): enforce zero-core-change provider registration"
```

---

## Phase 3 Gate

```bash
pnpm exec vitest run tests/unit/services/compact-core tests/unit/services/compact-providers tests/unit/services/compact-conformance tests/integration/compact-core tests/integration/compact-provider-certification-cli.test.ts tests/integration/compact-provider-zero-core-change.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
pnpm lint:silent-warning
peaks scan file-size --project . --json
pnpm build
```

Expected: only valid certified attachments execute, fake harness catches every specified violation, and no legacy spawn/hook path can silently bypass the framework.
