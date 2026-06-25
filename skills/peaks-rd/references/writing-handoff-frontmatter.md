# Writing handoff frontmatter (peaks-rd → peaks-qa)

Every RD handoff artifact carries a **YAML frontmatter block** so peaks-qa (and downstream roles) can mechanically cross-check decisions, risks, and gate evidence. The body below the frontmatter is free-form prose (markdown).

## Path

`.peaks/_runtime/change/<changeId>/rd/<requestId>.md` — the canonical RD handoff path. Filename uses the change-id slug embedded by the writer (`peaks request init --apply` handles this).

## Required frontmatter fields

```yaml
---
requestId: 2026-06-25-slice-topology-multipass
scope:
  - src/services/slice/schema-router.ts
  - src/services/audit/audit-goal-service.ts
files:
  - src/services/slice/schema-router.ts
  - src/services/audit/audit-goal-service.ts
decisions:
  - id: D1
    summary: "Route v1/v2 envelopes via SchemaRouter instead of branching in prompts"
    rationale: "Single source of truth; SchemaRouter already lives in src/services/slice/"
risks:
  - id: R1
    description: "v1 fallback path untested when sliceIds collide with v2 parentSliceIds"
    mitigation: "Added 3 collision cases to v1-fallback.test.ts"
nextActions:
  - "peaks-qa reads this handoff and runs the regression matrix"
  - "If Gate C passes, transition to txt handoff"
gateEvidence:
  projectScan: .peaks/_runtime/change/<changeId>/rd/project-scan.md
  techDoc: .peaks/_runtime/change/<changeId>/rd/tech-doc.md
  codeReview: .peaks/_runtime/change/<changeId>/rd/code-review.md
  securityReview: .peaks/_runtime/change/<changeId>/rd/security-review.md
  perfBaseline: .peaks/_runtime/change/<changeId>/rd/perf-baseline.md
schemaVersion: '1.0'
---
```

## Field rules

- `requestId` — kebab-case; matches the PRD `requestId`.
- `scope` / `files` — absolute repo-relative paths (`src/...`). Sorted alphabetically.
- `decisions[]` — every decision an LLM made that an implementer could question. `id` is local; `summary` is one line; `rationale` is ≤ 2 sentences.
- `risks[]` — same shape; `mitigation` is required. A risk without a mitigation is a red line (gate blocked).
- `nextActions[]` — verb-first; what peaks-qa should do next, in order.
- `gateEvidence` — paths to the gate files peaks-qa will validate. Missing keys → Gate C failure.
- `schemaVersion: '1.0'` — pinned; bump only when the field set changes.

## Validation

The frontmatter MUST parse as valid YAML. The regression test `tests/unit/artifacts/handoff-frontmatter-shape.test.ts` (≥ 4 cases) enforces (a) required fields present, (b) `gateEvidence` keys match the per-request-type matrix in `peaks-rd/SKILL.md` Gate C table, (c) `schemaVersion: '1.0'`. Run before commit:

```bash
./node_modules/.bin/vitest run tests/unit/artifacts/handoff-frontmatter-shape.test.ts
```

## Body (prose, free-form)

Markdown below the frontmatter is the implementation narrative: what changed, why this slice, what the next role should know. Do NOT restate frontmatter fields in prose.
