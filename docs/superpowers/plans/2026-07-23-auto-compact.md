# Auto Compact Strong-Guarantee Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Peaks-Loop's fragmented, unverified auto-compact paths with a capability-first control plane that can prove context reduction, preserve the same host TUI, render compact progress, resume exactly once, and open a persistent circuit after three failed validations.

**Architecture:** A vendor-free `compact-core` owns policy, attempt state, verification, progress semantics, capsule construction, and recovery. Host-specific providers implement a narrow `HostCompactBridge` through official current-session integration points and are loaded only after conformance certification. The public LLM surface converges on `peaks compact auto|status|capabilities`; legacy commands become honest aliases or non-executable deprecations.

**Tech Stack:** TypeScript 5.7 strict ESM, Node.js 20+, Zod 3, Commander 12, Vitest 4, SHA-256, existing atomic JSON/path-safety utilities. No new runtime dependency is planned.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-07-23-auto-compact-control-plane-design.md`.
- All implementation runs through `peaks-code → peaks-rd → peaks-qa → verdict`; peaks-code never edits application code directly.
- Core code under `src/services/compact-core/**` contains no AI CLI names, binaries, slash commands, vendor conditionals, terminal automation, or host SDK imports.
- Strong success requires same UI, visible progress, measured context reduction, continuity of Peaks session/job/request/gates, and idempotent execution of the single authoritative next action.
- Neither exit code 0, process spawn, hook installation, checkpoint creation, nor an unmeasured completion message proves compact success.
- Native compact is preferred only when the attached bridge offers `invoke-and-observe`; fallback requires in-place replacement, rollback, same-UI continuation, progress, and measurement.
- After three consecutive validation failures in one session, persistently open the circuit, stop automatic compact/model retries, and use the approved two-level manual fallback.
- Normal user interaction remains natural language or multi-choice. The one-time host-native compact hint is allowed only after the three-failure circuit opens and must come from certified capability metadata, never core hardcoding.
- Peaks-Loop remains an enhancement to existing runtimes; it does not create a replacement REPL/TUI.
- Runtime attempt state lives under `.peaks/_runtime/<sessionId>/compact-attempts/`; never create a date/change directory directly under `.peaks/`.
- Files stay below 800 lines; new files should be substantially smaller and single-purpose.
- TypeScript remains strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; no new `any`.
- Use Zod for on-disk and CLI-boundary schemas; use atomic writes and existing path/symlink defenses.
- Each slice follows TDD: failing test → verify failure → minimal implementation → focused green test → typecheck → commit.
- Every commit is authored solely by `SquabbyZ <601709253@qq.com>` and contains no AI attribution trailer.

## Plan Set

| Phase | Plan | Independently testable outcome |
|---|---|---|
| 1 | [`phase-1-control-plane.md`](./2026-07-23-auto-compact/phase-1-control-plane.md) | Public capability-first CLI, attempt journal, verification policy, persistent three-strike circuit, and honest legacy migration |
| 2 | [`phase-2-fallback-engine.md`](./2026-07-23-auto-compact/phase-2-fallback-engine.md) | Deterministic bounded convergence capsule, progress protocol, mock same-UI replacement, idempotency, and crash recovery |
| 3 | [`phase-3-bridge-conformance.md`](./2026-07-23-auto-compact/phase-3-bridge-conformance.md) | Provider manifest, certified registry, reusable conformance suite, and removal of false-positive host execution |
| 4 | [`phase-4-real-hosts.md`](./2026-07-23-auto-compact/phase-4-real-hosts.md) | Official-integration discovery, first evidence-backed host bridge, same-TUI E2E, and repeatable mainstream-host expansion |

## Locked File Structure

```text
src/services/compact-core/
├── protocol/
│   ├── capability-profile.ts
│   ├── bridge-requests.ts
│   ├── bridge-receipts.ts
│   ├── compact-events.ts
│   └── host-compact-bridge.ts
├── compact-policy.ts
├── attempt-schema.ts
├── attempt-store.ts
├── attempt-coordinator.ts
├── context-verifier.ts
├── circuit-breaker.ts
├── manual-fallback.ts
├── capsule-types.ts
├── capsule-builder.ts
├── capsule-reducer.ts
├── capsule-digest.ts
├── artifact-pointers.ts
├── idempotency-store.ts
├── progress-protocol.ts
├── fallback-coordinator.ts
├── recovery.ts
└── index.ts

src/services/compact-providers/
├── compact-capability-provider.ts
├── provider-manifest-schema.ts
├── provider-manifest-store.ts
├── provider-certification-policy.ts
├── compact-provider-registry.ts
├── built-in-providers.ts
└── hosts/<provider-id>/...

src/services/compact-conformance/
├── conformance-types.ts
├── conformance-cases.ts
├── conformance-runner.ts
├── evidence-schema.ts
├── evidence-recorder.ts
└── certification-evaluator.ts

src/cli/commands/
├── compact-command.ts
└── compact-provider-command.ts

schemas/
├── compact-provider-manifest.schema.json
└── compact-conformance-evidence.schema.json
```

## Dependency Order

```text
Phase 1 protocol + policy + journal
  ├─→ Phase 2 capsule/fallback/recovery
  └─→ Phase 3 manifest/registry/conformance
          └─→ Phase 4 official host provider(s)
```

Phase 1 must expose stable protocol signatures before Phase 2/3 code lands. Phase 4 cannot begin provider implementation until its official-integration discovery gate passes.

## RD / QA Slice Boundaries

Each numbered task in the phase files is one RD slice and one fresh QA gate. For every slice:

1. RD reads this index, the approved spec, and only the relevant phase/task.
2. RD follows the Karpathy guidelines: think first, simplest design, surgical diff, goal-driven verification.
3. RD writes the failing test before production code.
4. RD runs the focused test, typecheck, `peaks scan file-size`, and `pnpm lint:silent-warning` where applicable.
5. QA independently checks behavior, security/path handling, vendor neutrality, regression compatibility, and test quality.
6. A failed QA verdict returns to RD; maximum three repair cycles.
7. At phase boundaries, run `peaks slice check`, the full compact-focused suite, and `peaks workflow verify-pipeline` for the active request.

## Cross-Phase Acceptance Gates

### Gate A — Honest control plane

- `peaks compact auto|status|capabilities` are visible and executable.
- Every runtime `next` command is real and tested by execution.
- No existing surface claims compact succeeded from spawn/hook/exit-code alone.
- Three failed validations persistently open the circuit and stop automatic work.

### Gate B — Fallback semantics

- Capsule reduction is deterministic and bounded.
- Goal, active cursors, blockers, completed gates, active tasks, and next action are never trimmed.
- Progress is monotonic; 100% appears only after verification and resume.
- Side effects cannot replay after restart.

### Gate C — Certified provider framework

- Uncertified, stale, expired, or hash-mismatched providers cannot attach.
- Fake-host conformance catches same-UI, progress, measurement, rollback, stale-event, and idempotency violations.
- Adding a provider requires no coordinator branch.

### Gate D — Real-host claim

- Official documentation establishes a supported current-session integration point.
- Real E2E proves same TUI, visible progress, reduction formula, rollback, and exact-once resume.
- Unsupported hosts remain honestly `native-only`, `safe-handoff`, or `unsupported`; skipped tests never count as passing.

## Verification Commands

Run focused commands inside individual tasks, then these boundaries:

```bash
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec vitest run tests/unit/services/compact-core tests/unit/services/compact-providers tests/unit/services/compact-conformance
pnpm exec vitest run tests/integration/compact-core tests/integration/compact-provider-certification-cli.test.ts
pnpm exec vitest run tests/unit/cli/compact-command.test.ts
pnpm lint:silent-warning
peaks scan file-size --project . --json
pnpm build
```

Before final delivery:

```bash
pnpm test:full
pnpm lint:silent-warning
pnpm build
peaks workflow verify-pipeline --rid <rid> --project . --json
```

## Explicit Non-Goals

- No generic “slash-command bridge.”
- No keyboard/stdin/focus injection.
- No child-process spawn presented as parent-session compaction.
- No hardcoded host list in compact-core.
- No new Peaks TUI.
- No automatic new-window handoff in strong mode.
- No `--force-certified`, validation bypass, or user-authored provider manifest.
- No blanket claim that all mainstream AI CLIs support strong compact; certification is evidence-specific.

---

Proceed in phase order. Phase 1 and Phase 2 may be developed in parallel only after the protocol files in Task 1.1 are merged and frozen; Phase 3 framework may proceed in parallel with Phase 2 after the same boundary. Phase 4 is strictly gated by Phase 1–3 and real-host discovery evidence.
