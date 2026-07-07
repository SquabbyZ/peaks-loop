# M2 — Loop–Bee Relation Design Notes

> Slice sediment for the Loop Engineering crystallization plan. Companion
> to `docs/superpowers/plans/2026-07-07-loop-engineering/m2-loop-bee-relation.md`.
> This file is the first sediment the M8 dogfood will crystallize into a
> real `loop_release` + `bee_release` + `loop_bee_relation` triple.

## What landed (M2)

- **New table:** `loop_bee_relation` (FK to `loop_release(id)` TEXT and
  `bee_release(id)` INTEGER).
- **Four roles:** `main` / `supporting` / `candidate` / `retired`.
- **Integrity rules (spec §4.6):**
  - At most one `main` bee per loop — enforced at storage layer via
    `CREATE UNIQUE INDEX ... WHERE role = 'main'` AND at the service
    layer via `LoopBeeRelationIntegrityError("TWO_MAIN_BEES")`.
  - FK to `loop_release(id)` — DB-level + service-level check.
  - FK to `bee_release(id)` — DB-level + service-level check.
  - No relation to a retired loop — service-level check
    (`LoopBeeRelationIntegrityError("LOOP_RETIRED")`).
  - `(loop_release_id, bee_release_id)` UNIQUE — DB-level + service
    friendly error (`DUP_RELATION`).
- **Schema:** `peaks.loop-bee-relation/1`.
- **Migration:** `src/services/skillhub/migrations/003-loop-bee-relation.sql`.
- **Files (M2):**
  - `src/services/loop/loop-bee-relation-types.ts`
  - `src/services/loop/loop-bee-relation-store.ts`
  - `src/services/loop/loop-bee-relation-service.ts`
  - `src/services/skillhub/migrations/003-loop-bee-relation.sql`
  - `tests/unit/loop/loop-bee-relation.test.ts`

## Design decisions

### D1. FK target on `bee_release` is `bee_release.id` (INTEGER), not `bee_name`

The 4.x schema has `bee_release.id INTEGER PRIMARY KEY AUTOINCREMENT`
and `UNIQUE(bee_name, version)`. Existing 4.x FK references in
`001-initial.sql` all point at `bee_release(id)`, so the new relation
follows the same convention. A `bee_release_id` is therefore a 32-bit
positive integer; the Zod schema validates the range.

**Why not `bee_name`?** Because a single bee name can have many versions;
the relation is between a *release* of a loop and a *release* of a bee
(per the §4.6 spec language "FK to bee"). The integer id is the natural
release identifier in the existing schema.

### D2. Partial unique index `WHERE role = 'main'`

SQLite supports partial unique indexes. We use one to enforce "at most
one `main` per loop" at the storage layer. The service layer adds a
friendlier error path on top: instead of leaking SQLITE_CONSTRAINT text
up to the CLI, it raises `LoopBeeRelationIntegrityError("TWO_MAIN_BEES")`.

**Trade-off:** `updateRole` to `main` on a loop that already has a `main`
row also trips this index; the service surfaces it as
`TWO_MAIN_BEES` (consistent with the create path). The retirement
pattern (retire main → promote supporting → main) is the supported
flow.

### D3. "No relation to a retired loop" is service-level, not DB-level

The retirement rule needs to read `loop_release.lifecycle_status`. A
SQL-level constraint (e.g. a CHECK with a subquery) would couple the
`loop_bee_relation` schema to `loop_release` columns and produce
generic SQLITE_CONSTRAINT errors. We keep the DB clean and put the
check in `LoopBeeRelationService.create`.

**Trade-off:** A direct `INSERT INTO loop_bee_relation` (bypassing the
service) would not catch a retired loop. M5's crystallization prompt
will only call the service, so the boundary is enforced in practice.

### D4. Server-stamped `id` and `created_at`

The service never accepts `id` or `created_at` from the input — both
are stamped by `insertLoopBeeRelation` from the autoincrement PK and
`new Date().toISOString()`. This closes the backdate hole that would
otherwise let a malicious LLM rewrite audit history.

### D5. Reason is NL, mandatory, and LLM-authored

`reason` is a non-empty, trimmed string ≤ 2000 chars. The crystallization
prompt (M5) is responsible for producing the reason; the Zod schema
rejects empty reasons as a defense against callers that bypass the
prompt.

## Open questions deferred

- **M3** adds `shareable` / `desktop_visible` on `bee_release`. None
  of those touch `loop_bee_relation`.
- **M4** adds `evolution_evaluation.target_release_id` — it does not
  join through `loop_bee_relation`; it points at any release row
  directly. M2 does not need to know about it.
- **M5** (crystallization event + brief) is the first writer that
  produces a `(loop, main_bee)` pair in a single transaction. M2
  exposes only the service primitives; the transaction boundary lives
  in M5.
- **Cascade behavior:** `ON DELETE CASCADE` on both FKs. If a loop or
  bee row is ever deleted (none of M1..M9 currently deletes rows; the
  4.x code never deletes either), the relation rows go with it. M7's
  share bundle may want different behavior — revisit then.

## Self-check (M2 exit)

- `loop_bee_relation` table exists with `schema_version = peaks.loop-bee-relation/1`.
- All four roles insertable.
- Two `main` rows for the same loop → rejected with TWO_MAIN_BEES.
- Relation to a retired loop → rejected with LOOP_RETIRED.
- FK violation (missing loop / missing bee) → rejected with
  FK_LOOP_NOT_FOUND / FK_BEE_NOT_FOUND.
- Duplicate (loop, bee) pair → rejected with DUP_RELATION.
- 4.x `bee_release` column set unchanged after the migration
  (AC-3 verified in two tests).
- All new tests green under vitest.

## Next slice

M3 — Bee Release extended fields (`shareable`, `share_excluded_paths`,
`desktop_visible`, `export_bundle_format`). Out of M2 scope; lands
additive optional fields on `loop_release` and `bee_release`.

End of M2 design notes.