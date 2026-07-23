# Phase 4 — Official Host Bridges and Mainstream AI CLI Expansion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. A host provider may be implemented only after its discovery record passes the relevant gates.

**Goal:** Select the first host by verified capability rather than brand, implement an official current-session bridge, prove same-TUI progress and strong compact in a real host, then repeat the evidence-driven process for mainstream AI CLIs without changing compact-core.

**Architecture:** Each provider isolates its official host SDK/API, session attachment, progress rendering, receipt translation, and bridge implementation. Documentation permits development; only real-host E2E evidence grants certification. Capability gaps produce `native-only`, `safe-handoff`, or `unsupported`, never invented APIs.

**Tech Stack:** Host-official integration surface selected after discovery, TypeScript, the Phase 3 conformance harness, Vitest real-host harness where supported.

## Global Constraints

Inherit [`../2026-07-23-auto-compact.md`](../2026-07-23-auto-compact.md). Do not preselect Claude Code, Z-Code, Codex, Copilot, Cursor, Trae, or another host. Observing `/compact` in a TUI is not a programmatic API. Screen/keyboard/stdin automation cannot establish certification.

---

## Task 4.1: Inventory official current-session integration capabilities

**Files per candidate:**
- Create: `docs/compact-providers/discovery/<provider-id>.md`
- Create: `tests/fixtures/compact-conformance/discovery/<provider-id>.json`
- No production provider code yet

**Discovery record:**

```ts
interface HostDiscoveryRecord {
  readonly schemaVersion: 1;
  readonly providerId: string;
  readonly hostVersion: string;
  readonly documentationRetrievedAt: string;
  readonly officialDocumentation: readonly string[];
  readonly integrationMechanism: string;
  readonly capabilities: Readonly<Record<
    'sessionAttachment' | 'contextMeasurement' | 'nativeCompact' |
    'nativeCompletion' | 'inPlaceReplacement' | 'rollback' |
    'sameUiProgress' | 'automaticContinuation',
    { readonly state: 'proven' | 'absent' | 'unknown'; readonly evidence: readonly string[] }
  >>;
  readonly maximumCandidateLevel: CertificationLevel;
}
```

**Gates:**

- D0 official supported integration exists.
- D1 opaque receipt proves attachment to the current session.
- D2 native compact is callable and observable in that session.
- D3 capsule can replace context in place with rollback.
- D4 progress renders in the same active TUI.
- D5 measurement/completion proves reduction.
- D6 automatic same-UI resume returns a bound receipt.
- D7 level is derived: all gates → `certified-strong`; no D3 but full native path → `native-only`; new UI only → `safe-handoff`; otherwise `unsupported`.

- [ ] **Step 1: Run current official-documentation research for each candidate**

Record exact host/version/API symbols, URLs, retrieval date, and unresolved unknowns. Never copy installer code or execute an external integration without separate authorization.

- [ ] **Step 2: Add a failing discovery-schema validation test**

```bash
pnpm exec vitest run tests/unit/services/compact-conformance/host-discovery-record.test.ts
```

Expected: FAIL until the fixture is complete and valid.

- [ ] **Step 3: Build the smallest official attachment probe for candidates passing D0**

The probe must run through the host's documented extension/plugin/SDK path and return an opaque session receipt. Binary/path/env detection alone fails D1.

- [ ] **Step 4: Validate and rank candidates**

```bash
pnpm exec vitest run tests/unit/services/compact-conformance/host-discovery-record.test.ts
node ./bin/peaks.js compact provider discover --provider <id> --json
```

Choose the candidate with the highest provable level, then lowest implementation cost. If none passes D1/D4/D5/D6, stop provider implementation and record the honest unsupported result.

- [ ] **Step 5: Commit each candidate independently**

```bash
git add docs/compact-providers/discovery/<provider-id>.md tests/fixtures/compact-conformance/discovery/<provider-id>.json

git commit -m "docs(compact): record official integration discovery for <provider-id>"
```

---

## Task 4.2: Implement the first passing provider through official APIs

**Files (replace `<provider-id>` only after Task 4.1):**
- Create: `src/services/compact-providers/hosts/<provider-id>/provider.ts`
- Create: `src/services/compact-providers/hosts/<provider-id>/bridge.ts`
- Create: `src/services/compact-providers/hosts/<provider-id>/official-host-client.ts`
- Create: `src/services/compact-providers/hosts/<provider-id>/session-attachment.ts`
- Create: `src/services/compact-providers/hosts/<provider-id>/progress-adapter.ts`
- Create: `src/services/compact-providers/hosts/<provider-id>/receipt-translator.ts`
- Test: `tests/contract/compact-providers/<provider-id>.contract.test.ts`

**Responsibilities:**

- `official-host-client.ts` is the only host SDK/API import.
- `session-attachment.ts` proves current-session identity.
- `progress-adapter.ts` maps canonical events to the official host-owned progress surface.
- `receipt-translator.ts` validates and normalizes measurement/completion/rollback/resume receipts.
- `bridge.ts` implements protocol, not policy.
- `provider.ts` supplies metadata, `canAttach`, and bridge construction.

- [ ] **Step 1: Write failing provider contract tests**

Pin the exact discovered APIs; current-session attachment; capability profile no stronger than evidence; canonical progress mapping; terminal event uniqueness; stale epoch rejection; and no binary/stdin/keyboard fallback.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/contract/compact-providers/<provider-id>.contract.test.ts
```

- [ ] **Step 3: Implement only proven capabilities**

If D2 passed, wait for completion/remeasure before emitting completed. If D3 did not pass, `replaceWithCapsule` must remain unavailable and certification cannot exceed `native-only`. Indeterminate native progress is allowed if visibly rendered; never fabricate token percentages.

- [ ] **Step 4: Verify contract and core isolation**

```bash
pnpm exec vitest run tests/contract/compact-providers/<provider-id>.contract.test.ts tests/integration/compact-provider-zero-core-change.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-providers/hosts/<provider-id> tests/contract/compact-providers/<provider-id>.contract.test.ts

git commit -m "feat(compact): add official <provider-id> host bridge"
```

---

## Task 4.3: Prove real same-TUI behavior and progress

**Files:**
- Create: `tests/e2e/compact-providers/<provider-id>.real-host.test.ts`
- Create: `tests/e2e/compact-providers/<provider-id>.harness.ts`
- Runtime evidence: `.peaks/_runtime/<sessionId>/compact-evidence/<attemptId>/...`

**Evidence index:**

```text
capability-profile.json
event-sequence.json
measurements.json
ui-identity.json
continuity.json
side-effects.json
recovery.json
evidence-index.json
```

- [ ] **Step 1: Write the real-host E2E with explicit preconditions**

Skip is reported as skipped and blocks strong certification; it never passes. Build a long measured session, capture UI identity, freeze the authoritative next action and its idempotency key, then trigger `peaks compact auto` through the attached bridge.

- [ ] **Step 2: Run and observe the initial failure**

```bash
pnpm exec vitest run tests/e2e/compact-providers/<provider-id>.real-host.test.ts
```

Expected before complete integration: FAIL or SKIP with a named missing capability, never false green.

- [ ] **Step 3: Satisfy the full evidence sequence**

Prove:

```ts
expect(after.ratio).toBeLessThan(Math.min(before.ratio * 0.70, 0.60));
expect(afterUiIdentity).toEqual(beforeUiIdentity);
expect(progressReached100OnlyAfterResume).toBe(true);
expect(sideEffectCount).toBe(1);
```

Inject native failure and verify one generation increment; replacement failure and same-UI rollback when fallback exists; restart at replacing/verifying/resuming; stale event rejection; three validation failures opening the circuit; one manual observation after user-triggered native compact.

- [ ] **Step 4: Run conformance and produce sanitized evidence**

```bash
node ./bin/peaks.js compact provider conform --provider <provider-id> --evidence-dir .peaks/_runtime/<sessionId>/compact-evidence/<attemptId> --json
node ./bin/peaks.js compact provider certify --provider <provider-id> --evidence-index .peaks/_runtime/<sessionId>/compact-evidence/<attemptId>/evidence-index.json --json
```

Expected level is computed from passing cases. A screenshot/video may supplement but cannot replace identity, measurement, and idempotency evidence.

- [ ] **Step 5: Commit evidence separately from implementation**

Commit only sanitized fixtures/docs permitted by repository policy, never raw conversations/tokens/capsules.

```bash
git commit -m "test(compact): certify <provider-id> with real-host evidence"
```

---

## Task 4.4: Register the certified provider without core edits

**Files:**
- Modify: `src/services/compact-providers/built-in-providers.ts`
- Test: `tests/integration/compact-provider-zero-core-change.test.ts`
- Test: `tests/unit/services/compact-core/vendor-neutrality.test.ts`

- [ ] **Step 1: Write failing registration assertions**

Uncertified provider blocked; valid manifest attaches; expired/mismatched manifest blocked with no legacy fallback; compact-core source/import hash unchanged; provider level constrains path.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/integration/compact-provider-zero-core-change.test.ts tests/unit/services/compact-core/vendor-neutrality.test.ts
```

- [ ] **Step 3: Add one data-driven registration entry**

No coordinator branch or provider import inside compact-core.

- [ ] **Step 4: Verify**

```bash
pnpm exec vitest run tests/contract/compact-providers/<provider-id>.contract.test.ts tests/integration/compact-provider-zero-core-change.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/services/compact-providers/built-in-providers.ts tests/integration/compact-provider-zero-core-change.test.ts

git commit -m "feat(compact): register certified <provider-id> provider"
```

---

## Task 4.5: Repeat discovery-to-certification for mainstream hosts

Create one RD→QA slice series per host. Never combine providers in one implementation commit.

**Per-provider commit series:**

```text
docs(compact): record official integration discovery for <id>
test(compact): add <id> conformance harness
feat(compact): add official <id> host bridge
test(compact): add <id> real-host evidence
feat(compact): register certified <id> provider
```

**Ordering:** strongest provable official capability first, not a hardcoded market list. `safe-handoff` always requires natural-language consent; `unsupported` remains checkpoint/status only.

- [ ] **Step 1: Repeat Task 4.1 discovery**
- [ ] **Step 2: Implement only if D1 passes**
- [ ] **Step 3: Run contract and real E2E**
- [ ] **Step 4: Certify computed level**
- [ ] **Step 5: Verify zero compact-core diff and commit registration**

Per provider:

```bash
pnpm exec vitest run tests/contract/compact-providers/<id>.contract.test.ts
pnpm exec vitest run tests/e2e/compact-providers/<id>.real-host.test.ts
pnpm exec vitest run tests/integration/compact-provider-zero-core-change.test.ts
```

---

## Task 4.6: Update product surfaces with capability levels, not blanket claims

**Files:**
- Modify: `README.md`
- Modify: `README-en.md`
- Modify: `CHANGELOG.md`
- Create/update: `docs/compact-providers/README.md`
- Test: `tests/unit/docs/compact-provider-claims.test.ts`

- [ ] **Step 1: Write failing documentation tests**

Fail on blanket “supports strong auto compact on all hosts,” obsolete command names, `claude --compact`, or claims that spawn/hook install proves completion. Require a capability-level table and three-strike circuit/manual fallback description.

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run tests/unit/docs/compact-provider-claims.test.ts
```

- [ ] **Step 3: Update docs from actual manifests/evidence**

Document `certified-strong`, `native-only`, `safe-handoff`, and `unsupported` honestly. The user-facing path remains natural language; LLM executes CLI primitives.

- [ ] **Step 4: Run release verification**

```bash
pnpm exec vitest run tests/unit/docs/compact-provider-claims.test.ts
pnpm test:full
pnpm lint:silent-warning
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add README.md README-en.md CHANGELOG.md docs/compact-providers tests/unit/docs/compact-provider-claims.test.ts

git commit -m "docs(compact): publish evidence-backed host capabilities"
```

---

## Phase 4 Final Gate

- Same UI identity proved through official integration evidence.
- Progress is visibly rendered by the host and reaches 100% only after resume.
- Context reduction formula passes.
- Same Peaks session/job/request/gates and exact next action continue.
- Side effect occurs once across crashes/retries.
- Three validation failures open the persistent circuit and stop token-consuming retries.
- Provider certification equals evidence; no skipped strong case counts as passing.
- Adding each provider leaves compact-core unchanged.

```bash
pnpm test:full
pnpm lint:silent-warning
pnpm build
peaks scan file-size --project . --json
peaks workflow verify-pipeline --rid <rid> --project . --json
```
