# M2 — Loop–Bee Relation

**Goal:** Add the `loop_bee_relation` table that binds a `loop_release` to one or more `bee_release`s with a `main` / `supporting` / `candidate` / `retired` role. This is the explicit coupling that the current 4.x sediment pool lacks.

**Architecture:** New table in SkillHub; Zod schema; service that enforces (a) at most one `main` relation per loop, (b) referential integrity on `loop_release_id` and `bee_release_id`, (c) no relation to a retired loop. No CLI verb (M5).

**Tech Stack:** TypeScript, Zod, better-sqlite3.

**Inherits from:** M1 (consumes `loop_release_id`).

**File Structure (M2):**
- `src/services/loop/loop-bee-relation-types.ts` (Zod schema, role union)
- `src/services/loop/loop-bee-relation-store.ts` (migration, FK constraints)
- `src/services/loop/loop-bee-relation-service.ts` (create / listByLoop / listByBee / updateRole / remove)
- `tests/unit/loop/loop-bee-relation.test.ts` (AC-2 + integrity tests)

**Validation (M2 exit):** AC-2 — `loop_bee_relation` supports `main / supporting / candidate / retired` roles; a loop cannot have two `main` bees; FK to `loop_release` and `bee_release` enforced.

**Out of scope:** share/desktop fields (M3), evolution evaluation (M4), CLI (M5).

**Karpathy 4-section form (M2 introduces no new red line; the existing RL-3 is the rule this slice enforces):**
- Failure modes: loop has no main bee; loop has two main bees; bee is linked to a retired loop.
- Rewrite: every `crystallization_event` write must include exactly one `(loop, main_bee)` pair in `loop_bee_relation`.
- Self-check: `loop_bee_relation.listByLoop(loopId, role='main').length === 1`.
- Out-of-scope: simple repeatable steps that do not need a loop (bee alone).
