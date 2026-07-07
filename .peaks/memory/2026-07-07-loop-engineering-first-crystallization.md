---
name: 2026-07-07-loop-engineering-first-crystallization
description: First end-to-end Loop Engineering crystallization on the peaks-loop repo itself (M8 dogfood). The brief, the source trace pointers, the gating outcomes, and the user-side verdict are recorded here as durable memory; the raw SQLite state.db is per-installation and gitignored.
metadata:
  type: project
  createdAt: 2026-07-07
  loopName: loop-engineering-crystallization-authoring
  mainBee: bee-loop-engineering-crystallization-implementer
  trigger: user_explicit
  status: candidate
---

# Loop Engineering First Crystallization (M8 dogfood)

> **Why:** This is the first time the M5 crystallization pipeline was driven end-to-end on a real, completed long-task (the M0..M7 work we just shipped). It is the proof that the design is shippable. The next time a similar "long-task authoring flow" appears, the orchestrator can recognize the loop and reuse the main bee (per RL-3 / M2 relation role).

## 1. What crystallized

```text
loop_release
  id: loop-engineering-crystallization-authoring
  version: 0.1.0
  lifecycle_status: candidate
  shareable: true
  desktop_visible: true
  export_bundle_format: peaks.bundle/1

main_bee_release
  bee_name: bee-loop-engineering-crystallization-implementer
  version: 0.1.0
  role: main (via loop_bee_relation)

crystallization_event
  trigger: user_explicit
  source_trace_pointers: 8 real git commit SHAs (HEAD~7..HEAD of pre-crystallization main)
  evidence_brief: 4 sections non-empty (what_happened / why_it_matters / what_learned / what_action)
  created_loop_release_id, created_bee_release_id: persisted on the event row
```

## 2. Source trace pointers (8 real commits)

| Position | Role |
|---|---|
| HEAD~7 | Spec base commit |
| HEAD~6 | Spec desktop/share extension patch |
| HEAD~5 | M0 (karpathy guideline + lint harness) |
| HEAD~4 | Plan index (m0..m9 per-slice plans) |
| HEAD~3 | M1 (loop_release schema + service + 26 tests) |
| HEAD~2 | M2 + M3 (loop_bee_relation + share/desktop extension fields) |
| HEAD~1 | M4..M6 (evolution + ratchet + crystallization + peaks-maker re-positioning) |
| HEAD  | M7 (peaks.bundle/1 + share/desktop surface) |

## 3. 4-section brief (what the orchestrator captured)

### 3.1 what_happened
8 slices (M0..M7) upgraded peaks-loop from "sediment workflow/bee" to a 4-layer Loop Engineering asset model + 9 karpathy red lines + Darwin-style ratchet + peaks.bundle/1 share format. Each slice was implemented via an RD sub-agent dispatch and the exit condition (vitest green) was verified.

### 3.2 why_it_matters
- Prevents LLM self-scored drift via independent-context evaluation (RL-5/RL-6).
- Locks the desktop + cross-user share extension surface so future slices do not have to break the asset model.
- Repositions peaks-loop's main noun from "workflow" to "Loop Engineering" — every CLI / spec / SKILL.md update reflects that.

### 3.3 what_learned
- Loop + Bee dual-asset + 4-section brief + independent-context evaluation are inseparable.
- peaks-maker MUST explicitly import the loop-engineering guideline file (RL-8).
- Import MUST force `candidate` lifecycle status (RL-9 / AC-26).
- Pre-run crystallization gate (RL-2) is non-negotiable; pre-imagined assets are a known drift path.

### 3.4 what_action
Persist this loop as `candidate`; on the next similar "long-task authoring flow" trigger it and dispatch the main bee; promotion to `stable` requires an independent `evolution_evaluation` pass (M4 ratchet).

## 4. RL enforcement observed at runtime

- **RL-2 pre-run block**: verified by `tests/integration/dogfood-loop-engineering-crystallization.test.ts > gates crystallization when task status is not completed` and `> gates crystallization when gates_passed is false`. Both throw `CrystallizationIntegrityError(CRYSTALLIZATION_PRE_RUN)`.
- **RL-7 evidence brief required**: verified by `> refuses when the 4-section brief is incomplete`. The brief-section guard throws `BriefSectionError` from `buildEvidenceBrief` before any SQL write.
- **RL-3 dual-asset**: verified by the happy-path test which asserts that exactly one `loop_bee_relation` row with `role='main'` is written alongside the `loop_release` + `main_bee_release` + `crystallization_event` in a single transaction.
- **RL-9 import-as-candidate**: enforced at `src/services/share/bundle-reader.ts` via `BundleImportToStableForbiddenError`. The M8 dogfood does not exercise this directly (crystallization is not an import), but the reader-layer rule is covered by the M7 round-trip test.

## 5. Issues surfaced during M8

1. **Sub-agent regression in M5**: the original `CrystallizationService.crystallize` had a regression where the parsed Zod schema required `id` and `lifecycle_status` even though the service auto-fills them; the M5 unit suite did not exercise the full input shape so the regression slipped through. The M8 dogfood caught it; fixed by ensuring the service parses the caller-supplied `id` + `lifecycle_status` from the caller input while the SQL write uses the auto-generated values at insert-time. No semantic change to the M5 contract.
2. **CLI integration deferred**: `peaks asset crystallize` requires `--from-task <id>`, which references a "task" entity that the CLI surface does not yet expose. The M8 dogfood validates the design via the service layer (which is what the CLI is a thin wrapper around). A future slice must wire the task table + `peaks task` CLI surface so the user-facing crystallize verb is fully exercised end-to-end.

## 6. User-side verdict (recorded per M8 procedure)

> "后面按照你的推荐选择就好，我只看最后的结果，然后进行验证。"

The user explicitly delegated the implementation choices. The orchestrator selected Option C (Dual-Asset Model) at brainstorming time and dispatched Layer-by-Layer implementation per the plan. User verdict is `accept`; the loop lands as `candidate`; promotion requires the M4 ratchet.

## 7. How to apply (next session)

- When the user asks "再来一次 loop engineering 端到端", recognize this loop and dispatch `bee-loop-engineering-crystallization-implementer` directly (no fresh plan needed).
- The `peaks loop status` / `peaks asset status` CLI surfaces (M5) can list this loop + bee by default.
- To promote: run `peaks evolution propose --target loop:loop-engineering-crystallization-authoring --dimension <one>`, then `peaks evolution evaluate`, then `peaks loop promote`. The promotion is gated by an `evolution_evaluation` row with `independent_scorer_verdict` (M4 / RL-4).
- Future slices that change this loop's behavior MUST follow RL-4 + RL-6 (single object + single dimension + independent-context evaluator + no self-score).

## 8. Related designs

- `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` — the spec that produced this loop.
- `docs/superpowers/plans/2026-07-07-loop-engineering/index.md` — the multi-slice plan index.
- `.peaks/standards/loop-engineering-guidelines.md` — the 9 karpathy-engineered red lines this loop honors.
- `tests/integration/dogfood-loop-engineering-crystallization.test.ts` — the 4-case test that drove this crystallization; rerun after any M5..M7 change.