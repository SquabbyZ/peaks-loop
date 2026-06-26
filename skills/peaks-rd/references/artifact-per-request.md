# RD per-request artifact contract

Every RD invocation must leave one durable artifact under the workflow-local workspace so the engineering decisions and slice contracts are traceable later.

## Required path

```
.peaks/_runtime/<session-id>/rd/requests/<request-id>.md
```

Use the `<request-id>` PRD assigned (`YYYY-MM-DD-<kebab-slug>`). RD may also produce companion artifacts (task graph JSON, scan report, coverage evidence, slice spec, dry-run output) under the same `rd/` workspace and link to them from this file.

## Required content

```markdown
# RD Request <request-id>

- linked-prd: .peaks/_runtime/<session-id>/prd/requests/<request-id>.md
- linked-ui:  .peaks/_runtime/<session-id>/ui/requests/<request-id>.md  (when UI involved)
- type: feature | bug | refactor | clarification

## Red-line scope

- in-scope files / routes / API paths / data models
- explicit out-of-scope surfaces (do not modify, mock, delete, or replace)

## Standards preflight

- `peaks standards init/update --project <path> --dry-run` output paths and status
- planned application: apply | review-only | blocked

## OpenSpec linkage (when openspec/ exists)

- change-id: <openspec change id>
- entry validate: `peaks openspec validate <change-id>` data.valid status
- to-rd projection: `peaks openspec to-rd <change-id>` artifact path
- exit validate (after implementation): status

## Coverage status

- current total UT coverage: <percent>
- new/changed code coverage: <percent>
- gate verdict: pass | legacy-accepted | blocked

## Slice contract

For each slice in this request:

- slice id
- functional boundary
- pre-refactor behavior summary
- target structure
- unit-test requirements
- acceptance checks (100% required per slice)
- rollback plan
- commit boundary (one per slice; aligned with OpenSpec tasks.md section when available)

## Implementation evidence

- diff paths
- test commands + outputs
- code review findings + fixes
- security review findings + fixes
- dry-run output

## MCP usage (when external docs lookup was used)

- capabilityId / tool / sanitized args
- artifact path of stored result
- no secrets, no full network bodies

## Handoff

- to peaks-qa: <link to QA request artifact>
- to peaks-sc: <link to SC commit-boundary artifact>

## Status

- created: <ISO timestamp>
- last update: <ISO timestamp>
- state: draft | spec-locked | implemented | qa-handoff | blocked
```

## Rules

- Do not skip the RD artifact for "trivial" fixes. Even a one-line bug fix needs the red-line scope and acceptance checks recorded.
- Refactor work requires UT coverage ≥ 95% before slicing begins; record the verdict in this artifact, not just in chat.
- Sanitize MCP/network/browser evidence before writing.
- Do not commit unless the user or active profile authorizes durable retention.
- Handoff to QA is blocked while state is `draft` or `spec-locked` without implementation evidence.

---

## Two RD artifact files — do not confuse them

> Body of `## Two RD artifact files`. RD has two distinct artifact files, and the most common regression is to write the per-slice content into the per-session file. They serve different readers and live in different places:

| File | Scope | Reader | Required content |
|---|---|---|---|
| `.peaks/_runtime/<sessionId>/prd/handoff.md` | per-slice — immutable peaks-prd source of truth (v2.11.0+) | RD, QA, all sub-agents | Goals, non-goals, acceptance criteria, architecture, slice graph, mock strategy, cross-cutting decisions. sha256-hashed in frontmatter; sub-agents verify the hash before reading. |
| `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md` | per-slice — one request, one planning artifact | QA, SC, the lint gate | Red-line scope, in-scope / out-of-scope, unit-test requirements, **Implementation evidence** (file list, `pnpm test` output, git diff excerpts), MCP usage, handoff, status. **This is the file the lint gate checks for placeholders.** |
| `.peaks/_runtime/<sessionId>/rd/code-review.md` | per-session — the engineering review | QA, the human reviewer | Code review findings + fixes. |
| `.peaks/_runtime/<sessionId>/rd/security-review.md` | per-session — the security review | QA | Security review findings + fixes. |

> **v2.11.0 change (Group A):** `rd/tech-doc.md` is removed. The per-slice source of truth moves to the immutable peaks-prd handoff (`prd/handoff.md`); the per-slice planning record is `rd/requests/<rid>.md`. The "per-session" content category is no longer RD's responsibility — it lives upstream in the PRD handoff.

**Failure mode the lint gate catches**: the LLM writes the actual implementation content into a side file and leaves `rd/requests/<rid>.md` as the default template (with placeholder sections like "Implementation evidence: 留待 RD 实施阶段补充" and "MCP usage: N/A"). The lint gate then fails the slice with 6+ lint errors on the `<rid>.md` template even though the actual content lives elsewhere.

**Rule**:
- **Per-slice content** (red-line scope, in-scope / out-of-scope, the implementation evidence list, the unit-test assertions, the handoff) → **belongs in `rd/requests/<rid>.md`**.
- **Source-of-truth architecture content** (goals, non-goals, ACs, slice graph, mock strategy, cross-cutting decisions) → **belongs in `prd/handoff.md`** (immutable, sha256-hashed).
- When in doubt: copy the per-slice content into the `<rid>.md` artifact's "Implementation evidence" section after writing it to the handoff. The two files can carry overlapping context; the gate only enforces that `<rid>.md` is not empty placeholders.
