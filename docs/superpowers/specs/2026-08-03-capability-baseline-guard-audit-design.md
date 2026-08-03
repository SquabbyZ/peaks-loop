# Capability Baseline / Guard / Audit Design

**Date:** 2026-08-03
**Status:** Approved design; implementation not started
**Author:** SquabbyZ (sole author; no Co-Authored-By trailer per project red rule)

## Goal

Protect 15 P0 core user journeys from silent capability / behavior drift across
many AI-driven iterations. Three layers, each with a single responsibility:

1. **Capability Baseline** — frozen, user-signed product semantics per journey.
2. **Capability Guard** — pure-function contract runner that turns the baseline
   into executable checks (CLI envelopes, golden output, hook assertions, etc.).
3. **Capability Audit** — independent-context cross-version scorer that compares
   current behavior to the frozen baseline and emits
   `consistent | drifted | inconclusive`.

The three layers together close the "修 Bug 导致功能偏移" risk that motivated
this design, without replacing the existing
`peaks-final-review` 4-dimension review (`functional-completeness`,
`problem-resolution`, `no-new-bugs`, `existing-functionality-intact`).
A new 5th dimension `capability-consistency` is appended to the final review
and consumes the audit output.

## Hard constraints (no exceptions)

- `Human-NL-Choice-Only` (project red rule effective 2026-07-04) — every
  irreversible decision (`baseline freeze`, `baseline freeze-update`,
  `baseline rollback`, `baseline reset`) must surface an `AskUserQuestion`
  prompt. LLM may not auto-accept on the user's behalf.
- `Two-Forms-Only` (project red rule effective 2026-07-04) — the user only
  picks options or types natural language. No CLI verb, no manifest authoring.
- **No `Co-Authored-By` trailer in any commit** in this repository.
- All baseline file writers MUST set `signedBy === "SquabbyZ"` and
  `signedAt` to an ISO timestamp; the gate fails the run otherwise.

## P0 journey inventory (frozen at design time)

| # | Journey | Locked product promise |
|---|---|---|
| J01 | Natural-language triage | User only describes intent or picks an option; the system picks the skill and runs the underlying CLI on the user's behalf. |
| J02 | End-to-end code delivery | A user requirement moves through goal bind, RD, implementation, QA, and final review; every hard gate stops the slice on failure. |
| J03 | Bug fix closed loop | A reproducible failure mode is captured as a regression test, fixed, and proven not to break adjacent capabilities. |
| J04 | Pre-work audit + goal binding | A user-approved goal (intent, scope, non-goals, success criteria, red lines) exists before implementation and is not silently rewritten. |
| J05 | 4-dimension final review | Before any slice exits, all four dimensions (functional / problem / no-new / intact) are evidenced; ambiguous items surface to the user. |
| J06 | Resume after interruption | After compaction, session exit, or restart, the system locates the deepest completed gate and offers a resume option. |
| J07 | Universal test execution | The user only says "run tests"; the LLM runs the correct suite and reports results honestly. No fake green. |
| J08 | Loop Engineering asset sediment + replay | A successful run is promoted only after gates pass and a regression-skeptic check; replays are gated by anti-drift evaluation. |
| J09 | Natural-language SOP creation with gates | A user describes a procedure; the system generates, validates, and registers a runnable SOP with checkable gates. |
| J10 | IDE install + adapter | LLM can install, switch, check, and uninstall hooks / statusline / handle; permission gaps escalate honestly, no silent fake success. |
| J11 | Project health check | Audit + L3 doctor + convert to OpenSpec change records; failures stop. |
| J12 | Concurrent sub-agent isolation | Dispatch / worktree lease / heartbeat / release / GC form a complete lifecycle without conflict or leak. |
| J13 | Content production closed loop | Draft → edit → tone check → publish → archive moves through the gates. |
| J14 | Issue-sweep closed loop | Triage → classify → reference merged-PRs → fix → commit → PR draft. |
| J15 | OpenSpec coverage-evidence archive gate | A change is archived only when its `Capability Mapping` block matches the c8 coverage summary. |

All 15 are **P0 — first-batch blocking**. There is no P1 cohort in v0.1.

## Behaviour contract

### 1. Baseline layer — `capability-baseline`

#### 1.1 Storage layout

```text
openspec/
  baselines/
    current/
      capability-baseline.json     # frozen main copy (git-tracked)
      capability-baseline.lock     # hash + signedBy + signedAt
    history/
      <version>/                   # snapshot per freeze / freeze-update
        capability-baseline.json
        capability-baseline.lock
.peaks/
  _runtime/
    <sessionId>/
      baselines/
        current.json               # runtime pointer (gitignored)
        decisions/
          <timestamp>.json         # immutable user-decision records
      capability-audit/
        <audit-id>.json            # audit results (valid 24h)
        index.json                 # audit index
```

#### 1.2 Row shape (TypeScript)

```ts
type JourneyId = 'J01' | 'J02' | 'J03' | 'J04' | 'J05'
                | 'J06' | 'J07' | 'J08' | 'J09' | 'J10'
                | 'J11' | 'J12' | 'J13' | 'J14' | 'J15';

interface CapabilityBaselineRow {
  journeyId: JourneyId;
  intent: string;                  // why the user needs this journey
  observable: {
    inputs:  ReadonlyArray<InputCase>;
    outputs: ReadonlyArray<OutputCase>;
    errors:  ReadonlyArray<ErrorCase>;
  };
  invariants:       ReadonlyArray<string>; // always-true conditions
  forbiddenChanges: ReadonlyArray<string>; // any breach counts as drift
  sourceFiles:      ReadonlyArray<string>; // implementation locations
  signedBy: 'SquabbyZ';
  signedAt: string; // ISO timestamp
  baselineHash: string;             // sha256 over JSON of the row
  version: string;                  // peaks-loop version
}
```

#### 1.3 Baseline error codes

| Code | Trigger | Response |
|---|---|---|
| `BASELINE_NOT_FOUND` | `current/capability-baseline.json` missing | Guard + audit refuse to run; prompt `peaks baseline freeze`. |
| `BASELINE_HASH_MISMATCH` | `lock` hash does not match `capability-baseline.json` | Treated as corrupted; all guards and audits fail. |
| `BASELINE_NOT_SIGNED` | `signedBy !== "SquabbyZ"` or `signedAt` missing | Same as above. |
| `BASELINE_INCOMPLETE` | Some P0 journey rows missing | Unfrozen journeys are `skipped`; only frozen ones gate. |
| `BASELINE_HISTORY_GAP` | `current/` differs from `history/<ver>/` | `freeze-update` refuses to run; history must be repaired first. |

#### 1.4 Baseline operations

| Command | Effect | User-signed |
|---|---|---|
| `peaks baseline freeze` | First-time freeze of all 15 P0 journeys from current implementation | ✅ |
| `peaks baseline list` | List frozen rows | ❌ |
| `peaks baseline show <journeyId>` | Show one row | ❌ |
| `peaks baseline diff` | Show current implementation vs. frozen baseline | ❌ |
| `peaks baseline freeze-update` | Apply an intentional change to one or more rows | ✅ |
| `peaks baseline rollback --to <version>` | Revert to a historical snapshot | ✅ |
| `peaks baseline reset` | Wipe and require re-freeze (3-step confirmation) | ✅ |
| `peaks baseline run-guard [--journey <id>]` | Run guard contracts | ❌ |
| `peaks baseline audit` | Run independent-context audit | ❌ |

`freeze` and `freeze-update` use a **two-step confirmation**:
1. Show the diff (which invariants are changing).
2. Require a confirmation passphrase (analogous to `git push`).
`reset` requires **three-step confirmation** plus a forced pre-reset snapshot.

### 2. Guard layer — `capability-guard-runner`

The guard is a **pure function** module. It does not call any LLM and does
not mutate the baseline. Its job: turn a `CapabilityBaselineRow` into a
`GuardRunResult` and never lie.

#### 2.1 Contract kinds and journey mapping

| Kind | Used by journeys | Where it runs |
|---|---|---|
| `cli-envelope` | J01, J02, J04, J07, J10, J11 | `peaks` CLI invocation + envelope shape compare |
| `workflow-trace` | J02, J05, J06, J13, J14 | orchestrator state-machine trace |
| `hook-assertion` | J04, J10 | PreToolUse / PostToolUse hook behaviour |
| `cli-output-golden` | J07, J11, J15 | byte-equal snapshot of CLI output |
| `asset-roundtrip` | J08 | sediment → replay → behaviour match |
| `concurrency-lease` | J12 | spawn / heartbeat / release / GC lifecycle |
| `sop-register` | J09 | write / load / gate validation |
| `spec-coverage` | J15 | proposal.md ↔ c8 coverage summary mapping |
| `envelope-arg-shapes` | J01, J10 | super-command routing NL paths |

#### 2.2 Contract shape

```ts
interface GuardContract {
  journeyId: JourneyId;
  kind: ContractKind;
  source: {
    baselineRow: JourneyId;     // MUST reference a baseline row
    invariant:  string;         // MUST reference an invariant id
  };
  execute: (ctx: GuardContext) => Promise<GuardRunResult>;
  evidence: {
    kind: ContractKind;
    artifact: string;           // test or snapshot path
  };
}
```

A contract without `source.baselineRow` is refused by the runner
(`GUARD_CONTRACT_MISSING_BASELINE_REF`).

#### 2.3 Guard result

```ts
interface GuardRunResult {
  journeyId: JourneyId;
  contract: ContractKind;
  status:   'pass' | 'fail' | 'skipped';
  diff?: {
    before: string;
    after:  string;
    reason: string;             // human-readable, e.g. "invariant J03#2 broken"
  };
  artifactPath: string;
}
```

#### 2.4 Guard error codes

| Code | Trigger |
|---|---|
| `GUARD_CONTRACT_MISSING_BASELINE_REF` | Contract has no baseline reference |
| `GUARD_DIFF_DETECTED` | Output deviates from baseline |
| `GUARD_TEST_FLAKY` | Same contract produces different results across runs (no fake green) |

### 3. Audit layer — `capability-audit-service`

The audit runs in an **independent context** — a separate system prompt and a
session distinct from the slice being audited. Its job: cross-check the guard
output, the baseline row, and `karpathy-reviewer` verdict, then emit a single
verdict per row.

#### 3.1 Audit result

```ts
interface CapabilityAuditResult {
  auditId: string;
  auditedAt: string;            // ISO; >24h old ⇒ stale
  verdict: 'consistent' | 'drifted' | 'inconclusive';
  dimensions: ReadonlyArray<{
    journeyId: JourneyId;
    consistencyScore: number;   // 0..1
    evidence: ReadonlyArray<{
      kind: 'guard-run' | 'independent-eval' | 'karpathy-cross-check';
      ref: string;              // path / id reference
      summary: string;
    }>;
  }>;
  crossCheck: {
    guardVsAudit:   'agree' | 'diverge' | 'partial';
    karpathyVsAudit: 'agree' | 'diverge' | 'partial';
  };
  requiresUserDecision: boolean;
}
```

#### 3.2 Audit error codes

| Code | Trigger | Response |
|---|---|---|
| `AUDIT_GUARD_NOT_RUN` | No guard run in last 24h | verdict = `inconclusive`; nothing written |
| `AUDIT_CROSS_CHECK_DIVERGE` | guard / independent / karpathy disagree | verdict = `inconclusive`; trigger `regression-skeptic-runner` |
| `AUDIT_LLM_UNAVAILABLE` | Independent scorer unavailable | verdict = `inconclusive`; nothing written |

#### 3.3 5th-dimension rule for `prepareFinalReview`

The new dimension `capability-consistency` is appended to the final review.
Verdict logic (deterministic, no LLM):

```text
auditResult === null                        → inconclusive
auditResult.auditedAt > 24h ago             → inconclusive
auditResult.verdict === 'consistent'        → pass
auditResult.verdict === 'inconclusive'      → inconclusive
auditResult.verdict === 'drifted'           → fail
auditResult.crossCheck.guardVsAudit
  === 'diverge'                             → inconclusive
```

A `fail` verdict on `capability-consistency` causes `allPass = false` and
surfaces to the human regardless of the other 4 dimensions.

### 4. User-decision catalogue (Human-NL-Choice-Only)

| Decision point | When | Options (must use `AskUserQuestion`) |
|---|---|---|
| First freeze | After slice 1+2, before slice 3 | (a) accept · (b) edit then freeze · (c) do not freeze |
| Accept guard failure | CI shows a guard red | (a) update baseline (requires `freeze-update`) · (b) reject and require slice rollback · (c) mark `accepted-with-caveat` |
| Audit `inconclusive` | Three-way check diverges | (a) re-run audit · (b) escalate to human verdict (write to `.peaks/memory/`) · (c) force continue (24h-mode only) |
| Audit `drifted` | Cross-version drift found | (a) block release and emit rollback rid · (b) accept drift and update baseline · (c) open special audit rid |
| Rollback baseline | Revoke a `freeze-update` | (a) full revert · (b) partial (one journeyId) · (c) cancel |

All decisions land at `.peaks/_runtime/<sessionId>/baselines/decisions/<ts>.json`
and are immutable.

### 5. Glossary lock (enforced)

| Concept | Locked term | Forbidden aliases |
|---|---|---|
| Three layers | `capability baseline` / `capability guard` / `capability audit` | `drift-system`, `behavior-locker`, `anti-drift` |
| P0 journey | `P0 journey` | `critical-journey`, `core-flow` (narration only) |
| Baseline | `capability baseline` | `golden-spec`, `behavior-baseline`, `reference-behavior` |
| Contract | `guard contract` | `invariant-test`, `behavior-assertion` |
| Audit | `capability audit` | `independent-review`, `cross-version-check` |
| 5th dim | `capability-consistency` | `drift-free`, `anti-drift-dim` |

The glossary is enforced by `tests/unit/standards/capability-glossary.test.ts`.

### 6. Scope: v0.1 (this design)

**In scope**:
- Baseline storage + freeze / freeze-update / rollback / reset.
- 15 P0 journey rows.
- 15 guard contracts (one per journey) + their integration tests.
- Independent audit service with karpathy / regression-skeptic cross-check.
- `peaks baseline` CLI command family.
- 5th dimension injected into `prepareFinalReview`.
- Hookup to `peaks release-pack` (auto-diff + auto-audit before packaging).
- New red line `RL-10 — Capability Baseline / Guard / Audit` in
  `.peaks/standards/loop-engineering-guidelines.md`.

**Out of scope (deferred to v0.2+)**:
- P1 journeys (none in v0.1).
- Cross-machine / cross-repo baseline sync.
- Pure statistical drift detection (no LLM in the loop is forbidden here).
- Desktop UI accelerator for the `peaks baseline` flow.

## Component changes

| File / area | Change |
|---|---|
| `src/services/capability-baseline/` (new) | Pure baseline store + validator. No LLM. |
| `src/services/capability-guard-runner/` (new) | Pure function contract executor. No LLM. |
| `src/services/capability-audit-service/` (new) | Independent-context audit; calls `karpathy-reviewer` + `regression-skeptic-runner` via existing runners. |
| `src/cli/commands/baseline-commands.ts` (new) | `peaks baseline` family of subcommands (freeze / list / show / diff / freeze-update / rollback / reset / run-guard / audit). |
| `src/services/final-review/final-review-service.ts` | Add 5th dimension `capability-consistency` with deterministic verdict rule. |
| `src/services/final-review/final-review-types.ts` | Add `DimensionKind = 'capability-consistency'` and update `REQUIRED_DIMENSIONS`. |
| `src/services/release/release-pack-service.ts` | Run `peaks baseline diff` + `peaks baseline audit` before packaging; refuse to pack on red. |
| `.github/workflows/publish.yml` | Append `gate-capability-baseline` step after `gate-cli-version`; reads `capability-baseline.lock`, refuses publish on hash mismatch or missing signature. |
| `.peaks/standards/loop-engineering-guidelines.md` | Add `RL-10 — Capability Baseline / Guard / Audit` in the karpathy 4-section form. |
| `tests/unit/capability-baseline/` (new) | Store / freeze / freeze-update / rollback / reset / validator. |
| `tests/integration/capability-guard/` (new) | One file per journey: `J01-envelope-arg-shapes.test.ts` … `J15-spec-coverage.test.ts`. Each file: positive / negative / audit-cross cases. |
| `tests/integration/capability-audit/` (new) | `independent-eval.test.ts`, `cross-check-divergence.test.ts`, `staleness.test.ts`, `5th-dim-injection.test.ts`. |
| `tests/unit/standards/capability-glossary.test.ts` (new) | Enforce the locked glossary. |
| `docs/superpowers/specs/2026-08-03-capability-baseline-guard-audit-design.md` (this file) | Design anchor. |
| `.peaks/memory/2026-08-03-capability-baseline-design.md` | Sediment for discoverability. |

## Implementation slices (5, each independently shippable)

1. **Slice 1 — Baseline store + freeze CLI**: `capability-baseline` module,
   6 baseline CLI subcommands, unit tests, no CI hookup yet.
2. **Slice 2 — First freeze of 15 journeys**: produce
   `openspec/baselines/current/capability-baseline.json` for 4.0.8 with
   user-approved rows; no CI yet.
3. **Slice 3 — Guard runner + 1 sample contract** (J01): proves the contract
   mechanism, including diff reporting.
4. **Slice 4 — 14 remaining contracts + CI hookup**: all 15 journey files
   land; CI runs guards in `test:integration`; red = block.
5. **Slice 5 — Audit + 5th dimension**: independent-context audit,
   `prepareFinalReview` 5th dim, `peaks release-pack` auto-audit,
   `gate-capability-baseline` in `publish.yml`. Closes the C-plan loop.

## Verification

### Unit

- `baseline-store` round-trip; `signedBy` enforced; hash matches; missing
  signature is a hard fail.
- `baseline-validator` accepts exactly 15 P0 rows, no extras, no missing.
- `baseline-freeze` + `baseline-freeze-update` + `baseline-rollback` produce
  immutable `history/` snapshots.
- `guard-runner` is pure: same input ⇒ same result, no FS / network
  side-effects beyond reading fixtures.
- Glossary test passes on locked terms, fails on forbidden aliases.

### Integration (per journey guard contract)

- Positive: baseline satisfied ⇒ `status: 'pass'`.
- Negative: deliberate change to one invariant ⇒ `status: 'fail'` +
  `diff.reason` names the broken invariant + the offending file.
- Cross: guard fail ⇒ `peaks baseline audit` is auto-invoked and returns
  `inconclusive` (because guard / independent / karpathy disagree).
- 5th-dim: a `drifted` audit causes the 5th dimension to be `fail`, even
  when the other 4 dimensions are `pass`.

### Live (after slice 5)

- `peaks baseline diff` on a clean main ⇒ empty.
- `peaks baseline audit` on a clean main ⇒ `consistent` for all 15 rows.
- A breaking change to J03 invariants ⇒ CI red, audit `inconclusive`,
  final review's 5th dim `fail`, release blocked.
- `peaks baseline freeze-update --journey J03` with user passphrase ⇒
  baseline updated, history snapshot created, CI green again.

## Behaviour compatibility

- The existing 4-dimension final review is unchanged; the 5th dim is
  appended, not a replacement.
- The existing OpenSpec `Capability Mapping` mechanism is reused — each
  `CapabilityBaselineRow` corresponds to one OpenSpec capability row.
- `peaks openspec archive` gains an additional pre-check: the
  `capability-baseline.lock` for the row's `journeyId` must still be present
  and hash-clean. This composes with `Fix-6A` / `Fix-6B` rather than
  replacing them.
- The `karpathy-reviewer` agent and `regression-skeptic-runner` are invoked
  by the audit service, but their prompts and contracts are unchanged.
- `peaks memory extract` continues to write to `.peaks/memory/`; this design
  does not move or rename any existing sediment.
- No LLM call is added inside `capability-guard-runner`; this is the
  anti-fake-green anchor for the whole design.

## Risk register

| Risk | Mitigation |
|---|---|
| LLM self-drift sneaks past guard | Guard runner is pure; no LLM call inside; results come from real CLI / test invocations. |
| Independent audit is just a second LLM in the same shell | Audit runs in a separate system prompt + session; cross-checks include `karpathy-reviewer` which is invoked via the existing independent reviewer. |
| Baseline drift via silent `freeze-update` | Two-step confirmation + passphrase; `history/` snapshot is mandatory; CI validates `signedBy`. |
| Contract flakes give false alarm | `GUARD_TEST_FLAKY` keeps the result out of the audit; not a `pass` and not a `fail`. |
| 5th dim becomes a rubber-stamp | `AUDIT_GUARD_NOT_RUN` or stale audit ⇒ `inconclusive`; LLM cannot auto-pass. |
| Scope creep into P1 / cross-repo | Explicit "Out of scope" block above; P1 not in v0.1. |
| Unterminated Co-Authored-By trailer in any commit | Project red rule; CI lint already covers it; no change here. |
