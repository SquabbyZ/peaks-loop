# RD per-request artifact contract

Every RD invocation must leave one durable artifact under the workflow-local workspace so the engineering decisions and slice contracts are traceable later.

## Required path

```
.peaks/<session-id>/rd/requests/<request-id>.md
```

Use the `<request-id>` PRD assigned (`YYYY-MM-DD-<kebab-slug>`). RD may also produce companion artifacts (task graph JSON, scan report, coverage evidence, slice spec, dry-run output) under the same `rd/` workspace and link to them from this file.

## Required content

```markdown
# RD Request <request-id>

- linked-prd: .peaks/<session-id>/prd/requests/<request-id>.md
- linked-ui:  .peaks/<session-id>/ui/requests/<request-id>.md  (when UI involved)
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
