# Writing PRDs for multi-pass slice topology (peaks-slice-decompose v2)

Multi-pass topology (Pass 1 service-level → Pass 2 file-level) requires PRDs whose acceptance criteria (ACs) align with slice boundaries. Badly-shaped ACs force peaks-slice-decompose to invent cross-cutting slices that span multiple services — those slices become un-implementable in a single CC dispatch.

## Rule 1 — one AC per `parentSliceId`-aligned work unit

Each AC must map to a single Pass 1 slice (service or module). If an AC requires changes in 2+ services, split it into 2+ ACs — one per service. The slice router rejects (with an audit flag) any AC that doesn't resolve to a single `parentSliceId`.

## Rule 2 — avoid cross-cutting ACs

Cross-cutting ACs (e.g. "logging must work across all services") either become shared infrastructure (a Pass 0 slice, declared explicitly) or get dropped to a follow-up change. Do not embed them in feature ACs; they break parallelism.

## Rule 3 — tag ACs by pass

In a multi-pass PRD, mark each AC title with its pass:

```markdown
### AC-1 [pass-1] Service `audit-goal-service` exposes `AuditGoalService.approve(rid)`
### AC-2 [pass-1] Service `slice-topology-service` exposes v2 envelope via SchemaRouter
### AC-3 [pass-2] File `schema-router.ts` handles v1 fallback when schemaVersion === "1.0"
### AC-4 [pass-2] File `audit-goal-service.ts` persists approved goal to canonical path
```

The `[pass-1]` / `[pass-2]` prefix is the routing tag peaks-slice-decompose reads when emitting slices. Omitting the tag → slice falls into Pass 1 by default; explicit tag is required for Pass 2.

## Rule 4 — separate sections for multi-pass PRDs

Use distinct sections:

```markdown
## Pass 1 — service-level ACs
## Pass 2 — file-level ACs
## Cross-cutting (Pass 0 if any)
```

Each section's ACs are independently sliceable. Pass 1 slices must complete before Pass 2 dispatch (Pass 2 child slices depend on Pass 1 parent outputs).

## Rule 5 — when NOT to multi-pass

Single-service feature → single-pass PRD. Do not force a Pass 2 layer if the work stays in one service. The slice router will emit a degenerate single-pass envelope; no harm done, but the AC tags stay `[pass-1]` only.

## Verifiable success

- Every AC has a `[pass-1]` or `[pass-2]` prefix.
- No AC spans 2+ services.
- Pass 2 ACs each name a file path under one of the Pass 1 services.
- A `peaks slice audit-prd --rid <rid>` (when present) returns zero cross-cutting flags.

See `../peaks-slice-decompose/SKILL.md` for the envelope contract and `../peaks-rd/references/reading-v2-slice-results.md` for the RD-side read.
