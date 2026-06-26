---
schemaVersion: 1
---

# Business Knowledge — peaks-cli v2.11.0 baseline

> Auto-bootstrap of `.peaks/project-scan/business-knowledge.md` (v2.11.0 D3).
> Schema: `BusinessKnowledge { concepts: BusinessConcept[] }` at
> `src/services/prd/project-scan-types.ts`. The peaks-txt sediment step (Group C)
> appends new concepts idempotently by `(concept, sourceRid)`.

| Concept | Definition | Source | Decided | Evidence |
|---|---|---|---|---|
| D1 | Immutable shared handoff from peaks-prd (sha256-locked body, frontmatter `schemaVersion: 2`). Written at `.peaks/_runtime/<sid>/prd/handoff.md`. Source of truth for RD + QA + 4 audit sub-agents. | `001-v2-11-rd-techdoc-removal-and-runtime-friction` | `2026-06-26T03:05:30Z` | `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md` |
| D2 | Half-white-box merged audit output — code-review + security-review + perf-baseline + qa-test-cases all consolidated into ONE file per slice. Reduces LLM context overhead and avoids split-brain conclusions. | `001-v2-11-rd-techdoc-removal-and-runtime-friction` | `2026-06-26T03:05:30Z` | `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md` |
| D3 | project-scan bidirectional learning loop. peaks-prd READS `.peaks/project-scan/{project-scan.md, business-knowledge.md}` before brainstorm; peaks-txt SEDIMENTS new decisions into `business-knowledge.md` after every successful slice. Schema is owned by `services/prd/project-scan-types.ts`. | `001-v2-11-rd-techdoc-removal-and-runtime-friction` | `2026-06-26T03:05:30Z` | `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md` |
| D4 | ECC code-review via Agent tool (not Skill tool). The Skill tool has no structured output envelope; the Agent tool returns a JSON-enforced result that the 5-way fan-out aggregator can merge deterministically. | `001-v2-11-rd-techdoc-removal-and-runtime-friction` | `2026-06-26T03:05:30Z` | `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md` |
| D5 | full-auto / swarm mode auto-proceed on user recommendation (3 hard-floor categories still ask via AskUserQuestion: auth scope, destructive ops, irreversible bills). assisted / strict always ask. | `001-v2-11-rd-techdoc-removal-and-runtime-friction` | `2026-06-26T03:05:30Z` | `.peaks/memory/2026-06-26-v2-11-full-auto-self-decision.md` |
| D6 | Main-session context monitor + IDE-aware compact trigger. Fires when context ≥ 75% (warning) or ≥ 90% (auto-compact recommendation). Coexists with peaks-cli periodic checkpoint (Step N, every 20 tool calls). | `001-v2-11-rd-techdoc-removal-and-runtime-friction` | `2026-06-26T03:05:30Z` | `.peaks/memory/2026-06-26-v2-11-main-session-context-monitor.md` |
| D7 | Post-compact auto-resume contract. On same-session re-invocation with no fresh checkpoint file, falls back to memory-files (`peaks project memories --project <repo> --json`) + RD artifact Status section + working-tree diff. D7.b override: all modes auto-proceed on resume regardless of mode. D7.c skips: Steps 0.5/0.55/0.6/1/2/2.5 (already done pre-compact). | `001-v2-11-rd-techdoc-removal-and-runtime-friction` | `2026-06-26T03:05:30Z` | `.peaks/memory/2026-06-26-v2-11-post-compact-resume.md` |
| G1 | peaks-prd handoff redefinition: D1-immutable, sha256-verified, schemaVersion: 2; new service `services/prd/handoff-service.ts` (init/write/read/verify/show); new CLI `peaks prd handoff init\|verify\|show`; legacy `peaks prd write-handoff` subcommand name is FORBIDDEN in help text (AC-1). | `001-v2-11-cc-group-b-prd-handoff-and-project-scan` | `2026-06-26T04:56:00Z` | `.peaks/_runtime/2026-06-26-session-a28d69/rd/requests/001-v2-11-cc-group-b-prd-handoff-and-project-scan.md` |
| G2 | peaks-prd reads project-scan.md + business-knowledge.md BEFORE brainstorm (Step 0.8 in SKILL.md). First-run bootstrap writes the two template files if absent; logs `first-run bootstrap` to skip duplication on subsequent runs. | `001-v2-11-cc-group-b-prd-handoff-and-project-scan` | `2026-06-26T04:56:00Z` | `.peaks/_runtime/2026-06-26-session-a28d69/rd/requests/001-v2-11-cc-group-b-prd-handoff-and-project-scan.md` |
| G3 | Legacy `src/services/handoff/` module (slice-025 slice-dag handoff) CO-EXISTS with new `src/services/prd/` module. AC-1 forbids the CLI subcommand NAME `peaks prd write-handoff` only; underlying module rename is out-of-scope for v2.11.0. | `001-v2-11-cc-group-b-prd-handoff-and-project-scan` | `2026-06-26T04:56:00Z` | `.peaks/_runtime/2026-06-26-session-a28d69/rd/requests/001-v2-11-cc-group-b-prd-handoff-and-project-scan.md` |

## How to consume

```bash
peaks project knowledge --project <repo> --json
peaks project knowledge --project <repo> --filter handoff --json
```

## How to append (peaks-txt sediment step — Group C)

Match by `(concept, sourceRid)` — if a row with the same `concept` already
exists, UPDATE `definition` + `decidedAt`; otherwise APPEND a new row. Never
DELETE. Never reorder. Always preserve the D-row + G-row separation.

## Refresh procedure

1. After every successful slice, peaks-txt sediment step appends the new concept(s)
2. After every major dependency bump, re-run `peaks scan libraries` and update D1-D7 evidence links if any moved
3. Schema migration: if `BusinessConcept` shape changes, bump `schemaVersion` and write a migration note