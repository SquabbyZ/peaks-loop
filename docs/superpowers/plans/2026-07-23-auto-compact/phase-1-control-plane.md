# Phase 1 — Capability-First Compact Control Plane

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Every task is an RD→QA slice and every implementation step begins with a failing test.

**Goal:** Ship a vendor-neutral protocol, deterministic admission/verification policy, atomic attempt journal, persistent three-validation-failure circuit, public compact CLI, and honest migration away from impossible commands and unverified host execution.

**Architecture:** `compact-core` owns immutable protocol types and pure policy. `AttemptCoordinator` persists each transition before side effects, consumes an injected certified bridge, and records verification failures across attempt IDs at session scope. Commander exposes one LLM-facing path while existing surfaces delegate or return explicit deprecation/unsupported envelopes.

**Tech Stack:** TypeScript 5.7, Zod 3, Node.js atomic filesystem primitives, Commander 12, Vitest 4.

## Global Constraints

Inherit all constraints from [`../2026-07-23-auto-compact.md`](../2026-07-23-auto-compact.md). In this phase specifically:

- Do not import `src/services/ide/**`, `src/services/runtime/**`, or `src/services/adapter/**` from `compact-core`.
- Do not add a real host provider yet.
- `safe-handoff` never auto-runs.
- The session circuit counter cannot be reset by choosing a new `attemptId` or restarting the process.
- Core never contains `/compact` or host instructions; manual display hints arrive as opaque certified provider metadata.

---

## Task 1.1: Freeze the compact protocol and admission policy

**Files:**
- Create: `src/services/compact-core/protocol/capability-profile.ts`
- Create: `src/services/compact-core/protocol/bridge-requests.ts`
- Create: `src/services/compact-core/protocol/bridge-receipts.ts`
- Create: `src/services/compact-core/protocol/compact-events.ts`
- Create: `src/services/compact-core/protocol/host-compact-bridge.ts`
- Create: `src/services/compact-core/compact-policy.ts`
- Create: `src/services/compact-core/index.ts`
- Test: `tests/unit/services/compact-core/protocol.test.ts`
- Test: `tests/unit/services/compact-core/compact-policy.test.ts`
- Test: `tests/unit/services/compact-core/vendor-neutrality.test.ts`

**Interfaces:**

```ts
export interface CapabilityProfile {
  readonly schemaVersion: 1;
  readonly contextMeasurement: 'exact' | 'estimated' | 'none';
  readonly nativeCompact: 'invoke-and-observe' | 'invoke-only' | 'none';
  readonly contextReplacement: 'in-place' | 'none';
  readonly progressSurface: 'native' | 'host-rendered' | 'none';
  readonly continuation: 'same-ui' | 'new-ui' | 'none';
  readonly completionSignal: 'event-with-measurement' | 'remeasure' | 'none';
  readonly rollbackSupport: 'transactional' | 'snapshot-restore' | 'none';
  readonly capabilityEpoch: string;
}

export type CompactPathDecision =
  | { readonly kind: 'native' }
  | { readonly kind: 'fallback' }
  | { readonly kind: 'safe-handoff-consent-required' }
  | { readonly kind: 'blocked'; readonly code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE' };

export function decideCompactPath(input: {
  readonly profile: CapabilityProfile;
  readonly certification: 'certified-strong' | 'native-only' | 'safe-handoff' | 'unsupported';
}): CompactPathDecision;
```

`HostCompactBridge` must expose `probe`, `invokeNative`, `replaceWithCapsule`, `measureContext`, `resume`, `inspectTransaction`, and `rollback`. Every request/event/receipt carries `attemptId` and `pathGeneration`; mutating requests also carry `capabilityEpoch`.

- [ ] **Step 1: Write failing protocol and policy tests**

Cover these exact cases:

```ts
expect(decideCompactPath({ profile: nativeProfile, certification: 'native-only' }))
  .toEqual({ kind: 'native' });
expect(decideCompactPath({ profile: fallbackProfile, certification: 'certified-strong' }))
  .toEqual({ kind: 'fallback' });
expect(decideCompactPath({ profile: newUiProfile, certification: 'safe-handoff' }))
  .toEqual({ kind: 'safe-handoff-consent-required' });
expect(decideCompactPath({ profile: invokeOnlyProfile, certification: 'native-only' }).kind)
  .toBe('blocked');
```

Also assert every event carries attempt/generation identity and the core source tree contains none of the forbidden terms listed in the design.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm exec vitest run tests/unit/services/compact-core/protocol.test.ts tests/unit/services/compact-core/compact-policy.test.ts tests/unit/services/compact-core/vendor-neutrality.test.ts
```

Expected: FAIL because `src/services/compact-core/**` does not exist.

- [ ] **Step 3: Implement the minimal types and pure decision matrix**

Use discriminated unions; do not add optional escape hatches. Native requires invoke-and-observe, same UI, progress, and a completion signal. Fallback additionally requires in-place replacement and rollback. `new-ui` can only produce the consent-required result.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm exec vitest run tests/unit/services/compact-core/protocol.test.ts tests/unit/services/compact-core/compact-policy.test.ts tests/unit/services/compact-core/vendor-neutrality.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core tests/unit/services/compact-core

git commit -m "feat(compact): define capability-first protocol"
```

---

## Task 1.2: Persist atomic attempt journals and session failure state

**Files:**
- Create: `src/services/compact-core/attempt-schema.ts`
- Create: `src/services/compact-core/attempt-store.ts`
- Test: `tests/unit/services/compact-core/attempt-store.test.ts`

**Interfaces:**

```ts
export const COMPACT_STAGES = [
  'probing', 'preparing', 'checkpointing', 'native-compacting',
  'fallback-summarizing', 'replacing', 'verifying', 'resuming',
  'recovering', 'retrying', 'rolled-back', 'blocked', 'completed'
] as const;

export interface CompactAttemptJournal {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly stage: typeof COMPACT_STAGES[number];
  readonly verificationFailureCount: number;
  readonly capabilityEpoch: string;
  readonly sealedIdempotencyKeys: readonly string[];
  readonly lastFailureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CompactSessionCircuitState {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly consecutiveVerificationFailures: number;
  readonly circuit: 'closed' | 'open';
  readonly openedAt: string | null;
  readonly lastAttemptId: string | null;
  readonly manualPromptShown: boolean;
}
```

Paths:

```text
.peaks/_runtime/<sessionId>/compact-attempts/<attemptId>.journal.json
.peaks/_runtime/<sessionId>/compact-attempts/session-circuit.json
```

- [ ] **Step 1: Write failing store tests**

Test valid writes, corrupt shape rejection, monotonic generation/stage updates, atomic temp+rename, `0o600`, no-follow reads, and persistence of session failure count across a new store instance and a different attempt ID.

- [ ] **Step 2: Verify tests fail**

```bash
pnpm exec vitest run tests/unit/services/compact-core/attempt-store.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement Zod schemas and store**

Reuse the security pattern from `src/services/ide/shared/atomic-json.ts`; add path-segment validation for `sessionId` and `attemptId` before joining. Reject stage regression unless the transition is explicitly recovery-related.

- [ ] **Step 4: Verify focused tests**

```bash
pnpm exec vitest run tests/unit/services/compact-core/attempt-store.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/attempt-schema.ts src/services/compact-core/attempt-store.ts tests/unit/services/compact-core/attempt-store.test.ts

git commit -m "feat(compact): persist atomic attempt journals"
```

---

## Task 1.3: Implement verification and the persistent three-strike circuit

**Files:**
- Create: `src/services/compact-core/context-verifier.ts`
- Create: `src/services/compact-core/circuit-breaker.ts`
- Test: `tests/unit/services/compact-core/context-verifier.test.ts`
- Test: `tests/unit/services/compact-core/circuit-breaker.test.ts`

**Interfaces:**

```ts
export function verifyContextReduction(input: {
  readonly before: ContextMeasurement;
  readonly after: ContextMeasurement;
  readonly targetRatio?: number;
}): { readonly passed: boolean; readonly requiredMaximum: number };

export type CircuitDecision =
  | { readonly kind: 'continue'; readonly failureCount: 1 | 2 }
  | { readonly kind: 'open'; readonly failureCount: 3; readonly code: 'AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN' }
  | { readonly kind: 'already-open'; readonly failureCount: number };

export function recordVerificationFailure(store: AttemptStore, input: {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly failureCode: string;
  readonly now: Date;
}): CircuitDecision;

export function closeCircuitAfterVerifiedManualCompact(...): void;
```

- [ ] **Step 1: Write failing tests**

Pin the formula:

```ts
const requiredMaximum = Math.min(before.ratio * 0.70, targetRatio ?? 0.60);
expect(verifyContextReduction({ before, after }).passed).toBe(after.ratio < requiredMaximum);
```

Test failures 1 and 2 continue, failure 3 opens; failure 4 remains open without scheduling anything; new attempt ID cannot reset; process restart cannot reset; only a verified manual compact closes and zeroes the count.

- [ ] **Step 2: Run failing tests**

```bash
pnpm exec vitest run tests/unit/services/compact-core/context-verifier.test.ts tests/unit/services/compact-core/circuit-breaker.test.ts
```

- [ ] **Step 3: Implement minimal pure verification and store-backed circuit**

Do not start timers, model calls, or bridge calls here. The returned `open` decision is the sole gate consumed by the coordinator.

- [ ] **Step 4: Verify tests and typecheck**

```bash
pnpm exec vitest run tests/unit/services/compact-core/context-verifier.test.ts tests/unit/services/compact-core/circuit-breaker.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/context-verifier.ts src/services/compact-core/circuit-breaker.ts tests/unit/services/compact-core

git commit -m "feat(compact): open circuit after three failed validations"
```

---

## Task 1.4: Define the two-level manual fallback without core host commands

**Files:**
- Create: `src/services/compact-core/manual-fallback.ts`
- Test: `tests/unit/services/compact-core/manual-fallback.test.ts`

**Interfaces:**

```ts
export interface CertifiedManualCompactMetadata {
  readonly schemaVersion: 1;
  readonly providerId: string;
  readonly naturalLanguageActionAvailable: boolean;
  readonly hostNativeDisplayHint: string | null;
  readonly metadataDigest: string;
}

export type ManualFallbackDecision =
  | { readonly kind: 'offer-natural-language-choice'; readonly label: '手动压缩当前会话' }
  | { readonly kind: 'show-host-native-hint-once'; readonly hint: string }
  | { readonly kind: 'remain-blocked' };
```

- [ ] **Step 1: Write failing tests**

Test priority: natural-language choice first; host hint only when bridge mapping is unavailable; hint only once; null/unverified metadata remains blocked; returned hint is opaque and never parsed as a command; after manual verification failure remain blocked and do not prompt again.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/manual-fallback.test.ts
```

- [ ] **Step 3: Implement decision function**

The function accepts already-certified metadata plus session circuit state. It never detects a host and never supplies its own hint.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/manual-fallback.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/manual-fallback.ts tests/unit/services/compact-core/manual-fallback.test.ts

git commit -m "feat(compact): add circuit-open manual fallback policy"
```

---

## Task 1.5: Build the coordinator skeleton and dry-run execution plan

**Files:**
- Create: `src/services/compact-core/attempt-coordinator.ts`
- Test: `tests/unit/services/compact-core/attempt-coordinator.test.ts`

**Interfaces:**

```ts
export interface CompactCoordinatorDependencies {
  readonly attachBridge: (sessionId: string, attemptId: string) => Promise<CertifiedBridgeAttachment>;
  readonly store: AttemptStore;
  readonly now: () => Date;
  readonly newAttemptId: () => string;
}

export interface CompactAutoInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly targetRatio: number;
  readonly dryRun: boolean;
}

export type CompactAutoResult =
  | { readonly ok: true; readonly code: 'AUTO_COMPACT_PLAN'; readonly path: 'native' | 'fallback'; readonly profile: CapabilityProfile }
  | { readonly ok: true; readonly code: 'AUTO_COMPACT_COMPLETED'; readonly receipt: CompactCompletionReceipt }
  | { readonly ok: false; readonly code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE' | 'AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN' | 'AUTO_COMPACT_EXHAUSTED'; readonly manualFallback: ManualFallbackDecision };
```

- [ ] **Step 1: Write failing tests**

Cover dry-run no side effects; native path selection; fallback selection; open-circuit early return before bridge attach; stale `capabilityEpoch`; generation increment on native→fallback; late event from old generation ignored; verification failure uses session counter; success closes only after resume receipt matches.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/attempt-coordinator.test.ts
```

- [ ] **Step 3: Implement minimal coordinator skeleton**

For Phase 1, bridge operations may be injected fakes and fallback capsule creation is a dependency seam completed in Phase 2. Persist each stage before dispatch. Never claim completed before verification plus resume.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/attempt-coordinator.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/attempt-coordinator.ts tests/unit/services/compact-core/attempt-coordinator.test.ts

git commit -m "feat(compact): coordinate verified compact attempts"
```

---

## Task 1.6: Expose `peaks compact auto|status|capabilities`

**Files:**
- Modify: `src/cli/commands/compact-command.ts`
- Test: `tests/unit/cli/compact-command.test.ts`
- Test: `tests/integration/compact-auto-cli.test.ts`

**CLI contract:**

```text
peaks compact auto --project <path> [--dry-run] [--target-ratio <0..1>] [--json]
peaks compact status --project <path> [--json]
peaks compact capabilities --project <path> [--json]
```

- [ ] **Step 1: Extend failing CLI tests**

Assert help lists all three commands; unknown `--execute` and vendor flags fail; dry-run emits `compact.auto` without files; status reports attempt/circuit state; capabilities reports certified profile or unsupported without a vendor parameter. Execute every `nextActions` command returned by fixtures.

- [ ] **Step 2: Run and see failure**

```bash
pnpm exec vitest run tests/unit/cli/compact-command.test.ts tests/integration/compact-auto-cli.test.ts
```

- [ ] **Step 3: Add Commander handlers**

Resolve canonical project/session using existing helpers. Parse target ratio with Zod and default to `0.60`. Handlers delegate to coordinator/status services only; no host detection.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/cli/compact-command.test.ts tests/integration/compact-auto-cli.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/compact-command.ts tests/unit/cli/compact-command.test.ts tests/integration/compact-auto-cli.test.ts

git commit -m "feat(compact): expose verified auto compact commands"
```

---

## Task 1.7: Remove false-positive execution and repair every command reference

**Files:**
- Modify: `src/cli/commands/code-commands.ts`
- Modify: `src/cli/commands/session-auto-compact-hook-command.ts`
- Modify: `src/cli/commands/runtime-commands.ts`
- Modify: `src/services/code/auto-compact-orchestrator.ts`
- Modify: `src/services/context/auto-compact-dispatcher.ts`
- Modify: `src/services/ide/ide-types.ts`
- Modify: `src/services/ide/adapters/claude-code-adapter.ts`
- Modify: `src/services/hooks/auto-compact-hook-install.ts`
- Modify: `skills/peaks-code/SKILL.md`
- Modify: `skills/peaks-code/references/startup-sequence.md`
- Modify: `skills/peaks-code/references/runbook.md`
- Modify: `skills/peaks-code/references/periodic-checkpoint.md`
- Modify: `skills/peaks-code/references/step-0-8-gate.md`
- Modify: relevant compact/hook/runtime tests
- Create: `tests/unit/skills/compact-command-references.test.ts`

- [ ] **Step 1: Write failing migration tests**

Search all runtime next-actions, help, SKILL, and runbook text. Fail on nonexistent `peaks session auto-compact --execute`, `peaks code auto-compact --execute`, `peaks context now`, or any claim that host CLI spawn proves completion. Assert old hook never calls `child_process.spawn`; old aliases delegate or return explicit deprecation/unsupported.

- [ ] **Step 2: Verify tests fail against current code**

```bash
pnpm exec vitest run tests/unit/skills/compact-command-references.test.ts tests/unit/cli/session-auto-compact-hook-command.test.ts tests/unit/services/context/auto-compact-dispatcher-ide-native.test.ts
```

- [ ] **Step 3: Make the surgical migration**

Point internal next actions at `peaks compact auto`; make old execution paths non-authoritative. Preserve compatibility only where it does not bypass certification or verification. Do not add the never-existing command as an alias.

- [ ] **Step 4: Run migration and regression tests**

```bash
pnpm exec vitest run tests/unit/skills/compact-command-references.test.ts tests/unit/cli/compact-command.test.ts tests/unit/cli/session-auto-compact-hook-command.test.ts tests/unit/services/context tests/unit/services/hooks
pnpm exec tsc -p tsconfig.json --noEmit
pnpm lint:silent-warning
peaks scan file-size --project . --json
```

- [ ] **Step 5: Commit**

```bash
git add src skills tests

git commit -m "fix(compact): remove unverified legacy execution paths"
```

---

## Phase 1 Gate

```bash
pnpm exec vitest run tests/unit/services/compact-core tests/unit/cli/compact-command.test.ts tests/unit/skills/compact-command-references.test.ts tests/integration/compact-auto-cli.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
pnpm lint:silent-warning
peaks scan file-size --project . --json
pnpm build
```

Expected: all commands exist, dry-run has zero side effects, no false strong-success path remains, and the circuit stays open after three failures until one verified manual compact closes it.
