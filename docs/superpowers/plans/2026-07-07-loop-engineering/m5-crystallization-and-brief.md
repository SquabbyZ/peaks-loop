# M5 — Crystallization Event + Evidence Brief

**Goal:** Add the `crystallization_event` table (spec §4.5), the `evidence_brief` projection (spec §4.7), and the `peaks asset crystallize / dispose / status` CLI. The CLI is the only entry into durable change; pre-run stable creation is blocked (AC-4, AC-5, AC-6, AC-7, AC-15, AC-16, AC-17).

**Architecture:**
- New `crystallization_event` table.
- New `src/services/crystallization/crystallization-service.ts` — gates durable writes on `task_status=completed AND gates_passed AND evidence_collected`.
- New `src/services/crystallization/evidence-brief-builder.ts` — produces the 4-section brief (`what_happened` / `why_it_matters` / `what_learned` / `what_action`); refuses to render a recommendation without all 4 sections.
- New `src/cli/commands/asset-commands.ts` — `crystallize / dispose / status`. Every recommendation is gated on the brief.
- Pre-run blocker: the service refuses to create a stable `loop_release` / `bee_release` if `task_status !== 'completed'`.

**File Structure (M5):**
- `src/services/crystallization/crystallization-types.ts`
- `src/services/crystallization/crystallization-store.ts`
- `src/services/crystallization/crystallization-service.ts`
- `src/services/crystallization/evidence-brief-builder.ts`
- `src/cli/commands/asset-commands.ts`
- `tests/unit/crystallization/*.test.ts` (3 files)
- `tests/integration/asset-crystallize-cli.test.ts`

**Validation (M5 exit):** AC-4..AC-7, AC-15..AC-17. Briefs land on `crystallization_event`; counts may appear in `evidence_bullets` but never replace the brief (RL-7).

**Karpathy 4-section form (M5 enforces RL-2 / RL-3 / RL-7; introduces no new red line):**
- Failure modes: pre-run stable creation; count-only evidence; trace saved as asset; bee created without a loop.
- Rewrite: every `peaks asset crystallize` requires a `task_status=completed` gate, a `crystallization_event` row, a 4-section `evidence_brief`, and the `(loop, main_bee)` pair via `loop_bee_relation`.
- Self-check: `crystallization_event.evidence_brief.sections.length === 4`; `loop_bee_relation.role === 'main'` for the linked bee; `task_status === 'completed'`.
- Out-of-scope: pre-run stable creation; ad-hoc task promotion.
