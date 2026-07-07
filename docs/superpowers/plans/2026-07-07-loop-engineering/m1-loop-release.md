# M1 — Loop Release Schema

> Slice in the Loop Engineering crystallization plan. See `index.md` for the full dependency map and `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` for the spec.

**Goal:** Add the `loop_release` table, Zod schema, and a thin service that can persist a Loop Engineering asset to SkillHub without breaking the 4.x `bee_release` rows.

**Architecture:** New `loop_release` table in SkillHub's relational storage; a Zod schema `LoopRelease` that mirrors spec §4.1; a service `LoopReleaseService` with `create / read / list / search` methods that write through the same `peaks state` boundary as existing `bee_release` writers. No CLI verb in M1 (CLI lands in M5). No new dependency.

**Tech Stack:** TypeScript, Zod, better-sqlite3, existing `peaks state` writer boundary.

---

## Global Constraints (inherited)

- Author identity: every commit is `SquabbyZ <601709253@qq.com>` via global gitconfig. No per-repo user.name / user.email.
- No commit message contains `Co-Authored-By: Claude / Anthropic / ...` (CLAUDE.md red rule).
- TypeScript: no new `any`; explicit domain types; immutable updates; Zod at boundaries.
- Test design: real assertions; no `expect(true).toBe(true)`; no `.skip` for fixing regressions.
- No big JSON BLOB: decompose into relational tables + content-addressed `blobs/`.
- Schema versioning: every new table carries `schema_version`.
- Path safety: never create `.peaks/_runtime/<YYYY-MM-DD-*>/` siblings of `.peaks/_runtime/`.
- Human-NL-Choice-Only: any future CLI verb ships with an LLM driver; the user does not type JSON.
- Karpathy 4-section form: any new red line uses failure modes / rewrite / self-check / out-of-scope.
- No self-scored evolution; single object per round; single optimization dimension per round.
- peaks-code is code-domain only. M1 is in the foundation layer, so it is a cross-cutting concern that touches no peaks-code internals beyond storage.
- M1 must not introduce a CLI verb. CLI lands in M5 (`peaks asset crystallize`).

---

## File Structure (M1)

| File | Action | Responsibility |
|---|---|---|
| `src/services/loop/loop-release-types.ts` | create | Zod schema + TS types for `LoopRelease` (spec §4.1, excluding the share/desktop extension fields that land in M3) |
| `src/services/loop/loop-release-store.ts` | create | SQLite migration: `loop_release` table + indexes on `lifecycle_status` and `scenario` |
| `src/services/loop/loop-release-service.ts` | create | `create / read / list / search` thin wrapper around the store |
| `tests/unit/loop/loop-release.test.ts` | create | Round-trip + lifecycle-status filtering + read of legacy 4.x `bee_release` rows (AC-3) |
| `.peaks/memory/2026-07-07-m1-loop-release-design-notes.md` | create | Slice design notes; first sediment to be crystallized by the M8 dogfood |

No other files. M1 is foundation; the CLI layer comes in M5.

---

## Task Decomposition (M1)

### Task 1.1 — Define `LoopRelease` Zod schema + types

**Files:**
- Create: `src/services/loop/loop-release-types.ts`

**Interfaces:**
- Consumes: spec §4.1 (without the share/desktop extension fields, which land in M3).
- Produces: `LoopReleaseSchema` (Zod), `LoopRelease` (TS), `LoopReleaseInput` (create payload), `LoopReleaseLifecycleStatus` union.

**Steps (bite-sized):**
1. Write the failing test for the Zod schema (rejecting missing `schema_version`, wrong `lifecycle_status`, missing `scenario`).
2. Run the test, see it fail.
3. Write the minimal schema in `loop-release-types.ts` using Zod.
4. Run the test, see it pass.
5. Commit with the project's identity rules.

### Task 1.2 — `loop_release` table migration

**Files:**
- Create: `src/services/loop/loop-release-store.ts`

**Interfaces:**
- Consumes: `LoopRelease` from Task 1.1.
- Produces: `ensureLoopReleaseTable(db)`, `insertLoopRelease(db, input)`, `getLoopRelease(db, id)`, `listLoopReleasesByStatus(db, status)`, `searchLoopReleasesByScenario(db, query)`.

**Steps:**
1. Write the failing test for round-trip insert → read.
2. Implement migration with `CREATE TABLE loop_release (...) IF NOT EXISTS`; column types mirror the Zod schema; primary key is `id TEXT`; index on `lifecycle_status` and `scenario` (full-text).
3. Run migration tests; assert non-breaking coexistence with `bee_release` (AC-3).
4. Commit.

### Task 1.3 — `LoopReleaseService` thin wrapper

**Files:**
- Create: `src/services/loop/loop-release-service.ts`

**Interfaces:**
- Consumes: `LoopRelease` from Task 1.1, store from Task 1.2.
- Produces: `LoopReleaseService.create / read / list / search`; constructor takes the store.

**Steps:**
1. Write failing service test.
2. Implement minimal pass-through.
3. Run tests.
4. Commit.

### Task 1.4 — Slice design notes (first crystallizable artifact)

**Files:**
- Create: `.peaks/memory/2026-07-07-m1-loop-release-design-notes.md`

**Content:** the design decisions, the open questions deferred to later slices (M2, M3, M4), and the next-slice entry point. This file is the *evidence* the M8 dogfood will crystallize into a real `loop_release` + `bee_release`.

**Steps:**
1. Write the notes.
2. Commit.

### Task 1.5 — Slice checkpoint

- `peaks job checkpoint --slice-id m1 --state done --commit-sha $(git rev-parse HEAD)`.
- The next slice is M2; M2 is blocked on M1.

---

## Out of scope for M1

- CLI verbs (M5).
- `shareable` / `share_excluded_paths` / `desktop_visible` / `export_bundle_format` fields (M3).
- `loop_bee_relation` table (M2).
- `evolution_evaluation` table (M4).
- `crystallization_event` table (M5).
- peaks-maker skill re-narration (M6).
- Bundle writer / reader (M7).
- Demote `peaks-workflow` ADR (M9).
- Dogfood crystallization (M8).

---

## Validation (M1 exit conditions)

- AC-1 (M1 portion): `loop_release` table exists with `schema_version = peaks.loop/1`; the Zod schema covers the §4.1 fields except the M3 share/desktop extensions.
- AC-3: existing 4.x `bee_release` rows remain readable after the migration; the new migration does not touch any `bee_release` column.
- All new tests pass; no new `any`; lint passes.

---

## Sub-agent dispatch contract (for the next session)

If the next session dispatches sub-agents to finish M1, the dispatch is:

```text
peaks sub-agent dispatch --role rd
  --task "Implement M1 per docs/superpowers/plans/2026-07-07-loop-engineering/m1-loop-release.md"
  --karpathy-context "Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution"
  --budget-mb 512

peaks sub-agent dispatch --role qa
  --task "Verify M1 against AC-1 / AC-3 in the spec"
  --karpathy-context "Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution"
  --budget-mb 512
```

Each sub-agent receives the parent sid (`2026-07-07-session-2af05f`) and the parent plan path. Sub-agents do NOT call `peaks workspace init` (would orphan the parent binding).

---

## Self-review (M1 plan)

- **Spec coverage:** §3 (Loop Engineering Asset layer), §4.1 (schema), §11.A (AC-1, AC-3).
- **Type consistency:** `LoopRelease` is the only new type; no other slice defines it. M2 consumes `LoopRelease.id` as `loop_release_id`. M3 adds optional fields; M2, M4 do not.
- **Placeholder scan:** none.
- **Scope:** M1 is foundation; downstream slices depend on it. Single editable asset (the `loop_release` table), single optimization dimension (the asset layer), no self-score (the slice ends with `peaks job checkpoint`).
