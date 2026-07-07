---
name: m1-loop-release-design-notes
description: M1 slice design notes for the Loop Engineering Asset layer — schema decisions, deferral list, next-slice entry points (M2 / M3 / M4)
kind: design
createdAt: 2026-07-07
sessionId: 2026-07-07-session-2af05f
spec: docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md
plan: docs/superpowers/plans/2026-07-07-loop-engineering/m1-loop-release.md
status: done
---

# M1 — Loop Release Schema: design notes

> First crystallizable artifact for the Loop Engineering Asset layer
> (spec §4.1). The M8 dogfood will eventually crystallize a real
> `loop_release` row + `bee_release` row out of this note. Until then,
> this file is the design record.

## What M1 ships

- `loop_release` table in the existing SkillHub state DB
  (`src/services/skillhub/migrations/002-loop-release.sql`); applied
  automatically by `openStateDb()` since the migration pipeline
  globs `*.sql` in lexicographic order.
- Zod schema `LoopReleaseSchema` + types `LoopRelease`,
  `LoopReleaseInput`, `LoopReleaseLifecycleStatus` at
  `src/services/loop/loop-release-types.ts`.
- Thin store at `src/services/loop/loop-release-store.ts`:
  `ensureLoopReleaseTable`, `insertLoopRelease`, `getLoopRelease`,
  `listLoopReleasesByStatus`, `searchLoopReleasesByScenario`.
- Service at `src/services/loop/loop-release-service.ts`:
  `create / read / list / search`.
- 26-case test suite at `tests/unit/loop/loop-release.test.ts`:
  schema validation, round-trip insert/read, lifecycle-status
  filtering, scenario LIKE search, UNIQUE-constraint enforcement,
  AC-3 non-breaking coexistence with 4.x `bee_release`.

## Schema decisions

1. **JSON columns for arrays, not junction tables (yet).**
   `success_criteria`, `evaluator_policy`, `linked_bees`,
   `run_history`, `crystallization_evidence` are stored as TEXT
   (JSON-serialized). M1 has no real join target for these arrays —
   `loop_bee_relation` is M2's responsibility and `crystallization_event`
   is M5's. Keeping these as TEXT preserves the small-row property
   (no big JSON BLOB; spec §7.1) while letting M2 / M5 add their
   own relational tables when they need joins.

2. **`schema_version` is `z.literal("peaks.loop/1").default(...)`.**
   The literal enforces that no client can claim a different
   schema-version stamp; the default lets callers omit the key in
   the input. Bumping the schema (e.g. to `peaks.loop/2`) requires
   a new migration, a new enum case, and a Zod update — never an
   in-place literal edit.

3. **M3 share/desktop fields are intentionally absent.**
   `shareable`, `share_excluded_paths`, `desktop_visible`,
   `export_bundle_format` are listed in
   `LOOP_RELEASE_M3_RESERVED_FIELDS` so future readers see exactly
   what is NOT yet on the schema. M3 must add these as OPTIONAL
   fields with default values; no breaking change to M1 rows.

4. **`linked_bees` is denormalized on the loop row.** The spec §4.1
   lists it as a Loop Engineering Asset field; the authoritative
   relation lives in `loop_bee_relation` (M2). M1 stores the
   pointer list as JSON; M2 will dual-write (transaction across
   both) when a real relation is created.

5. **No CLI verb (per plan and per spec §7.4 / M5).** M1 is
   foundation-only. CLI verbs `peaks loop *` arrive in M5.

6. **Migration is non-breaking.** `002-loop-release.sql` does not
   touch any `bee_release` column. The AC-3 test snapshots
   `PRAGMA table_info(bee_release)` before vs. after the migration
   to assert this. The existing `retainRelease()` writer path is
   unaffected.

7. **Service pattern matches `retainRelease`.** Constructor takes
   an open `Database.Database`; re-validates input via the Zod
   schema at the boundary (mirrors `lintManifestStrict` in
   `src/services/sediment/manifest-lint.ts`). The store handles
   raw SQL; the service handles the public create/read/list/search
   surface.

8. **`scenario` search is `LIKE`-based in M1.** FTS5 promotion is
   deferred — the spec §7.3 lists the index as
   `loop_release.scenario (full-text)` but does not mandate FTS5
   in M1. LIKE-based search with `COLLATE NOCASE` covers the
   M1 dogfood surface.

## Deferral list (out of M1 scope)

- `loop_bee_relation` table — M2.
- M3 share/desktop extension fields — M3.
- `evolution_evaluation` table + ratchet — M4.
- `crystallization_event` table + brief — M5.
- CLI verb `peaks loop *` — M5.
- peaks-maker re-positioning — M6.
- Bundle writer / reader — M7.
- M8 dogfood (this note being crystallized into a real row).
- Demote peaks-workflow ADR — M9.

## Open questions deferred to later slices

- **Scoring rubric dimensions and weights** for `loop_release`
  (spec §15 open question 1). M1 stores `evaluator_policy` as NL
  strings; the dimension taxonomy lands in M4 alongside the
  ratchet.
- **Default `retire_on_misses_in_row`** (spec §15 open question 2).
  M1 does not enforce it; the ratchet in M4 will.
- **Linked_bees pointer semantics** when M2 introduces the real
  relation table. M1's `linked_bees` is best-effort; M2 must
  define the dual-write / reconciliation policy.
- **Schema migration ordering** with the existing M5 crystallization
  event flow — M1 produces raw rows; M5 wraps them.

## Next-slice entry points

- **M2 (Loop–Bee relation):** start at
  `src/services/skillhub/migrations/003-loop-bee-relation.sql`
  (next lex slot). The relation should FK to both `loop_release.id`
  (TEXT) and `bee_release.id` (INTEGER) and carry a
  `role TEXT CHECK IN ('main','supporting','candidate','retired')`
  column per spec §4.6. Dual-write the `linked_bees` JSON when a
  relation row is created.

- **M3 (Bee Release extended fields):** add
  `shareable`, `share_excluded_paths`, `desktop_visible`,
  `export_bundle_format` to `loop_release` and `bee_release` as
  OPTIONAL with defaults; do not touch the 4.x columns.

- **M5 (CLI):** the verbs `peaks loop init / list / show / search /
  recent / crystallize / promote / retire` land here. The
  `LoopReleaseService` surface in M1 is intentionally tiny so M5
  has a clean foundation to extend.

- **M8 (Dogfood):** crystallize THIS note into a real
  `loop_release` row + `bee_release` row using M5's
  `peaks loop crystallize --from-trace`. The note IS the
  evidence-brief precursor — when M8 ships, this file becomes
  the historical record.

## Self-check (M1 exit conditions vs. plan)

- AC-1 (M1 portion): `loop_release` table exists with
  `schema_version = peaks.loop/1`; the Zod schema covers the §4.1
  fields except M3 share/desktop extensions. **Verified by tests.**
- AC-3: 4.x `bee_release` rows remain readable; the migration
  does not touch any `bee_release` column. **Verified by AC-3
  test case (legacy row + side-by-side insert + column-set
  snapshot).**
- All new tests pass; no new `any`; lint passes. **Verified.**

## File map (M1)

| File | Role |
|---|---|
| `src/services/loop/loop-release-types.ts` | Zod schema + types |
| `src/services/loop/loop-release-store.ts` | SQLite migration re-applier + raw SQL |
| `src/services/loop/loop-release-service.ts` | Public service (create / read / list / search) |
| `src/services/skillhub/migrations/002-loop-release.sql` | Migration applied by `openStateDb()` |
| `tests/unit/loop/loop-release.test.ts` | 26-case test suite |
| `.peaks/memory/2026-07-07-m1-loop-release-design-notes.md` | This file — first crystallizable artifact |

End of M1. Next: M2.