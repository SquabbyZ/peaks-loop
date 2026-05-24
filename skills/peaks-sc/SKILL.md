---
name: peaks-sc
description: Source control, sync, and change-control skill for Peaks. Use when a workflow needs change impact, artifact retention, commit boundaries, GitHub artifact repository pointers, sync state, or rollback evidence.
---

# Peaks SC

Peaks SC records how product, RD, QA, code, and artifacts move together.

## Responsibilities

- produce change-impact artifacts;
- record commit boundaries;
- ensure intermediate artifacts are retained locally first;
- track artifact repository pointers when external sync or git retention is explicitly authorized;
- record sync state and rollback points.

## Refactor role

Each refactor slice must leave a traceable local artifact boundary in `.peaks/<session-id>/` by default. A git commit boundary containing code changes and PRD/RD/QA/TXT intermediate artifacts is required only when the user or active profile explicitly authorizes committing artifacts.

## GStack integration

Use gstack as a concrete source-control and release workflow reference for the `Ship → Reflect` stages:

- map `/ship` and `/land-and-deploy` concepts to Peaks commit boundaries, sync state, rollback points, and artifact retention;
- map checkpoint discipline to traceable code-plus-artifact slices;
- do not create PRs, merge, deploy, or mutate shared state unless the active Peaks workflow and user confirmation explicitly allow it.

## Project memory backup

Project `.claude/memory` is the primary source for durable project memory. At approved checkpoints, use `peaks memory sync --project <path> --workspace <artifact-workspace> --apply` to back up the full project memory directory into the artifact repository workspace; do not treat the artifact backup as a second writable memory source.

## OpenSpec-derived commit boundaries

When `openspec/changes/<id>/tasks.md` exists, derive commit boundaries from it through the Peaks CLI instead of redesigning them:

- `peaks openspec to-rd <id> --project <repo> --json` returns `commitBoundaries[]`, one entry per tasks.md heading.
- Default to one commit per heading. Each commit message references the change-id and the section heading.
- If implementation produces diffs outside any todo, surface that as out-of-scope before closing SC.

Concrete rules: `references/openspec-commit-boundaries.md`.

## Default runbook

Use this sequence when SC owns the change-control pass for a refactor or release slice. SC never edits code or tests; it only records boundary evidence through the Peaks CLI.

```bash
# 1. Derive commit boundaries from OpenSpec when openspec/ exists
peaks openspec to-rd <change-id> --project <repo> --json

# 2. Inventory artifacts already produced by other roles for this session
peaks artifacts status --project <repo> --json
peaks artifacts workspace --workspace <session-id> --json

# 3. Record change impact for the slice
peaks sc impact --change-id <change-id> --module <module> --file <path> --json

# 4. Record retention evidence linking PRD / RD / QA / coverage / review artifacts
peaks sc retention --slice-id <slice-id> --prd <prd-path> --rd <rd-path> --qa <qa-path> --json

# 5. Validate retention completeness
peaks sc validate --slice-id <slice-id> --json

# 6. Record the commit boundary for the slice
peaks sc boundary --slice-id <slice-id> --artifact <artifact-path> --code <code-file> --json

# 7. Sync memory and artifacts only when the user or active profile authorizes durable writes
peaks memory sync --project <repo> --workspace <workspace> --apply --json
peaks artifacts sync --workspace <workspace> --apply --json
```

The final two `--apply` calls require explicit authorization. Without it, default to `--dry-run` or omit the sync calls entirely and keep the boundary evidence local under `.peaks/<session-id>/`.

## Boundaries

Do not implement code or test logic. Do not create GitHub repositories directly from the skill body. Use the Peaks CLI artifact commands.

Reference: `references/artifact-retention.md`.
