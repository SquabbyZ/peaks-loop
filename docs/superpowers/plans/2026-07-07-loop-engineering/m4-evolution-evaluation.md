# M4 — Evolution Evaluation + Darwin-style Ratchet

**Goal:** Add the `evolution_evaluation` table, the `peaks evolution propose / evaluate / revert` CLI, and the ratchet enforcement (single object, single dimension, score-delta threshold, no self-score, independent-context evaluator, regression skeptic).

**Architecture:**
- New `evolution_evaluation` table (spec §4.4).
- New `src/services/evolution/evolution-service.ts` enforcing:
  - `proposal.author_id != scorer.id` (hard block on self-score; AC-10).
  - Exactly one `target_kind` and one `optimization_dimension` per proposal; multi-object / multi-dimension are rejected (AC-8).
  - Score delta below threshold blocks promotion (AC-11).
- New `src/services/evolution/independent-evaluator-runner.ts` — only sees the evaluation package; never sees the author reasoning (AC-12, AC-13).
- New `src/services/evolution/regression-skeptic-runner.ts` — refutes the proposal; must be a separate sub-agent call (AC-14).
- New `src/cli/commands/evolution-commands.ts` — `propose / evaluate / revert`.

**File Structure (M4):**
- `src/services/evolution/evolution-types.ts`
- `src/services/evolution/evolution-store.ts`
- `src/services/evolution/evolution-service.ts`
- `src/services/evolution/independent-evaluator-runner.ts`
- `src/services/evolution/regression-skeptic-runner.ts`
- `src/cli/commands/evolution-commands.ts`
- `tests/unit/evolution/*.test.ts` (4 files; cover each AC)
- `tests/integration/evolution-ratchet-cli.test.ts`

**Validation (M4 exit):** AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14 — all green.

**Karpathy 4-section form (M4 enforces the existing RL-4 / RL-5 / RL-6; this slice introduces no new red line):**
- Failure modes: a multi-object proposal lands; a self-score attempt lands; a delta-below-threshold promotion lands.
- Rewrite: every `peaks evolution propose` call declares `target_asset`, `single_object: true`, `single_optimization_dimension: true`, `before_score`, `after_score`, `delta_min`, `independent_evaluator: required`, `regression_skeptic: required`, `user_confirmation: required`.
- Self-check: `proposal.target_count === 1 && proposal.dimensions.length === 1 && proposal.author_id !== proposal.scorer_id && delta >= delta_min`.
- Out-of-scope: hotfix (use micro-cycle, not ratchet); user explicit "全量重写" (one round, `delta_min=3.0`, skeptic bless); same target + same dimension within 7 days (blocked).
