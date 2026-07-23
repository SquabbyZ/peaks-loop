# Phase 2 — Peaks Fallback Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. This phase begins only after Phase 1 Task 1.1 freezes the protocol.

**Goal:** Build Peaks-Loop's deterministic bounded convergence capsule and prove fallback compaction, same-UI progress semantics, rollback, exact-once resume, and crash recovery against a mock host bridge.

**Architecture:** Pure capsule modules convert the authoritative Peaks workflow cursor into a bounded, digest-locked artifact. `FallbackCoordinator` passes it to an injected bridge transaction, validates canonical progress and context reduction, seals side-effect keys, and resumes only after all receipts match. Real host behavior remains Phase 4.

**Tech Stack:** TypeScript, Node.js crypto/fs, Zod, Vitest; reuse Phase 1 protocol and attempt store.

## Global Constraints

Inherit [`../2026-07-23-auto-compact.md`](../2026-07-23-auto-compact.md). This phase contains no host names or APIs, no CLI work, and no edits to legacy IDE/runtime adapters.

---

## Task 2.1: Define capsule schemas and canonical digest

**Files:**
- Create: `src/services/compact-core/capsule-types.ts`
- Create: `src/services/compact-core/capsule-digest.ts`
- Modify: `src/services/compact-core/index.ts`
- Test: `tests/unit/services/compact-core/capsule-types.test.ts`
- Test: `tests/unit/services/compact-core/capsule-digest.test.ts`

**Interfaces:**

```ts
export interface ConvergenceCapsule {
  readonly schemaVersion: 1;
  readonly capsuleId: string;
  readonly compactAttemptId: string;
  readonly sourceSessionId: string;
  readonly goal: ApprovedGoal;
  readonly mode: 'full-auto' | 'assisted' | 'strict' | 'swarm';
  readonly activeJob: JobCursor | null;
  readonly activeRequest: RequestCursor | null;
  readonly completedGates: readonly GateReceipt[];
  readonly activeTasks: readonly TaskSnapshot[];
  readonly decisions: readonly DecisionRecord[];
  readonly openQuestions: readonly OpenQuestion[];
  readonly failureHistory: readonly FailureRecord[];
  readonly artifactIndex: readonly ArtifactPointer[];
  readonly nextAction: NextAction;
  readonly idempotency: IdempotencyEnvelope;
  readonly sourceContextMeasurement: ContextMeasurement;
  readonly digest: string;
}

export function digestCapsule(input: Omit<ConvergenceCapsule, 'digest'>): string;
export function verifyCapsuleDigest(capsule: ConvergenceCapsule): boolean;
```

- [ ] **Step 1: Write failing Zod/digest tests**

Reject missing required fields, unknown schema versions, malformed 64-hex hashes, invalid ratios, and extra fields. Prove key-order-independent digest, field mutation changes digest, and circular/non-JSON-safe input is rejected.

- [ ] **Step 2: Run failing tests**

```bash
pnpm exec vitest run tests/unit/services/compact-core/capsule-types.test.ts tests/unit/services/compact-core/capsule-digest.test.ts
```

- [ ] **Step 3: Implement schemas and canonical SHA-256**

Canonicalize object keys recursively while preserving array order. Exclude only the top-level `digest` field from the hash.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/capsule-types.test.ts tests/unit/services/compact-core/capsule-digest.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core tests/unit/services/compact-core

git commit -m "feat(compact): define digest-locked convergence capsule"
```

---

## Task 2.2: Build deterministic bounded reduction

**Files:**
- Create: `src/services/compact-core/capsule-builder.ts`
- Create: `src/services/compact-core/capsule-reducer.ts`
- Test: `tests/unit/services/compact-core/capsule-builder.test.ts`
- Test: `tests/unit/services/compact-core/capsule-reducer.test.ts`

**Interfaces:**

```ts
export interface CapsuleBuildInput {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly cursor: WorkflowCursorSnapshot;
  readonly sourceContextMeasurement: ContextMeasurement;
  readonly sealedIdempotencyKeys: readonly string[];
}

export function buildCapsule(input: CapsuleBuildInput): ConvergenceCapsule;
export function reduceCapsule(input: ConvergenceCapsule, maxUtf8Bytes: number): ConvergenceCapsule;
```

**Mandatory retention:** goal, mode, active job/request, completed gates, blocking questions, active tasks, and the single next action.

**Drop order:** duplicate failure details → artifact metadata beyond path/hash/summary → decisions outside the active path → oldest non-blocking history. Re-digest after every reduction.

- [ ] **Step 1: Write failing builder/reducer tests**

Test deterministic capsule ID, exact field mapping, one authoritative next action, budget under cap unchanged, drop order, byte-for-byte determinism, idempotent reduction, and inability to fit mandatory fields returning `CAPSULE_BUDGET_EXCEEDED` rather than deleting them.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/capsule-builder.test.ts tests/unit/services/compact-core/capsule-reducer.test.ts
```

- [ ] **Step 3: Implement minimal pure builder and reducer**

No filesystem reads or model calls. Inputs already contain authoritative workflow state.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/capsule-builder.test.ts tests/unit/services/compact-core/capsule-reducer.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/capsule-builder.ts src/services/compact-core/capsule-reducer.ts tests/unit/services/compact-core

git commit -m "feat(compact): build bounded deterministic capsules"
```

---

## Task 2.3: Validate artifact pointers and project boundaries

**Files:**
- Create: `src/services/compact-core/artifact-pointers.ts`
- Test: `tests/unit/services/compact-core/artifact-pointers.test.ts`

**Interfaces:**

```ts
export async function createArtifactPointer(input: {
  readonly projectRoot: string;
  readonly path: string;
  readonly summary: string;
}): Promise<ArtifactPointer>;

export async function verifyArtifactPointer(input: {
  readonly projectRoot: string;
  readonly pointer: ArtifactPointer;
}): Promise<void>;
```

- [ ] **Step 1: Write failing security tests**

Cover relative in-root files, absolute outside-root path, `..`, symlink and Windows junction escape, missing file, changed hash, directory input, and summary over 256 characters.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/artifact-pointers.test.ts
```

- [ ] **Step 3: Implement no-follow/realpath validation and SHA-256**

Reuse existing safe-path patterns; normalize only after proving containment.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/artifact-pointers.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/artifact-pointers.ts tests/unit/services/compact-core/artifact-pointers.test.ts

git commit -m "feat(compact): secure capsule artifact pointers"
```

---

## Task 2.4: Seal idempotency keys and next-action locks

**Files:**
- Create: `src/services/compact-core/idempotency-store.ts`
- Create: `src/services/compact-core/next-action.ts`
- Test: `tests/unit/services/compact-core/idempotency-store.test.ts`
- Test: `tests/unit/services/compact-core/next-action.test.ts`

**Interfaces:**

```ts
export function deriveIdempotencyKey(input: {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly sideEffectName: string;
  readonly sourceContentHash: string;
}): string;

export class IdempotencyStore {
  isSealed(key: string): boolean;
  seal(key: string): void;
}
```

Store path: `.peaks/_runtime/<sessionId>/compact-attempts/<attemptId>.sealed.json`.

- [ ] **Step 1: Write failing tests**

Use a known hash vector, session/generation isolation, replay rejection, atomic append semantics, restart persistence, and lock exclusion for two attempts trying to dispatch the same side effect.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/idempotency-store.test.ts tests/unit/services/compact-core/next-action.test.ts
```

- [ ] **Step 3: Implement**

Use separator-delimited UTF-8 hashing and atomic JSON updates. The raw continuation token is never persisted; persist only its digest.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/idempotency-store.test.ts tests/unit/services/compact-core/next-action.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/idempotency-store.ts src/services/compact-core/next-action.ts tests/unit/services/compact-core

git commit -m "feat(compact): enforce exact-once resume actions"
```

---

## Task 2.5: Implement canonical progress semantics

**Files:**
- Create: `src/services/compact-core/progress-protocol.ts`
- Test: `tests/unit/services/compact-core/progress-protocol.test.ts`

**Interfaces:**

```ts
export const COMPACT_STAGE_WEIGHTS = {
  preparing: 10,
  checkpointing: 15,
  summarizing: 25,
  replacing: 20,
  verifying: 20,
  resuming: 10
} as const;

export class CompactProgressTracker {
  accept(event: CompactEvent): CompactProgressSnapshot;
}
```

- [ ] **Step 1: Write failing progress tests**

Assert stage order, monotonic work units, stale generation rejection, exactly one terminal event, no 100% before verified resume, indeterminate stage support without fabricated percentage, and failure after terminal rejected.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/progress-protocol.test.ts
```

- [ ] **Step 3: Implement tracker**

Core emits semantic events only; no ANSI or widget code.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/progress-protocol.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/progress-protocol.ts tests/unit/services/compact-core/progress-protocol.test.ts

git commit -m "feat(compact): add monotonic compact progress protocol"
```

---

## Task 2.6: Build the mock bridge and fallback coordinator

**Files:**
- Create: `tests/helpers/compact-core/mock-host-bridge.ts`
- Create: `src/services/compact-core/fallback-coordinator.ts`
- Test: `tests/unit/services/compact-core/fallback-coordinator.test.ts`

**Interfaces:**

```ts
export interface FallbackCoordinationInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly bridge: HostCompactBridge;
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly capabilityEpoch: string;
  readonly capsule: ConvergenceCapsule;
  readonly targetRatio: number;
  readonly continuationToken: string;
}

export async function runFallbackCompaction(
  input: FallbackCoordinationInput
): Promise<FallbackCoordinationResult>;
```

- [ ] **Step 1: Write failing coordinator tests**

Happy path; tampered capsule never touches bridge; replacement failure rolls back; receipt attempt/generation/epoch mismatch blocks; context not reduced records failure; third validation failure opens circuit with no further bridge calls; resume retries once with same token; side effect executes once.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/fallback-coordinator.test.ts
```

- [ ] **Step 3: Implement coordinator and deterministic test bridge**

Persist stage before every side effect. Validate capsule digest immediately before replacement. Require a rollback receipt on replacement failure.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/unit/services/compact-core/fallback-coordinator.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/fallback-coordinator.ts tests/helpers/compact-core/mock-host-bridge.ts tests/unit/services/compact-core/fallback-coordinator.test.ts

git commit -m "feat(compact): coordinate transactional fallback compact"
```

---

## Task 2.7: Recover interrupted fallback attempts

**Files:**
- Create: `src/services/compact-core/recovery.ts`
- Test: `tests/unit/services/compact-core/recovery.test.ts`
- Test: `tests/integration/compact-core/crash-recovery.test.ts`
- Test: `tests/integration/compact-core/fallback-e2e-mock.test.ts`

**Interfaces:**

```ts
export async function recoverCompactAttempt(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly bridge: HostCompactBridge;
}): Promise<CompactRecoveryResult>;
```

- [ ] **Step 1: Write failing recovery/E2E tests**

`replacing` inspects transaction then verifies or rolls back; `verifying` remeasures; `resuming` retries the identical token once; `completed` is no-op; open circuit never resumes automatically; full mock path builds/reduces/digests/seals/replaces/verifies/resumes and leaves a completed journal.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/services/compact-core/recovery.test.ts tests/integration/compact-core/crash-recovery.test.ts tests/integration/compact-core/fallback-e2e-mock.test.ts
```

- [ ] **Step 3: Implement journal-driven recovery**

Do not mutate journal unless a new stage completes. Query bridge transaction state before replaying replacement.

- [ ] **Step 4: Run all Phase 2 tests**

```bash
pnpm exec vitest run tests/unit/services/compact-core tests/integration/compact-core
pnpm exec tsc -p tsconfig.json --noEmit
pnpm lint:silent-warning
peaks scan file-size --project . --json
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-core/recovery.ts tests/unit/services/compact-core/recovery.test.ts tests/integration/compact-core

git commit -m "feat(compact): recover interrupted fallback attempts"
```

---

## Phase 2 Gate

```bash
pnpm exec vitest run --coverage tests/unit/services/compact-core tests/integration/compact-core
pnpm exec tsc -p tsconfig.json --noEmit
pnpm lint:silent-warning
peaks scan file-size --project . --json
pnpm build
```

Expected: mock fallback proves same-UI receipt semantics, monotonic progress, target reduction, rollback, exact-once resume, and restart recovery without a single host-specific string in compact-core.
