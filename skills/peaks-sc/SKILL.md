---
name: peaks-sc
description: Source control, sync, and change-control skill for Peaks. Use when a workflow needs change impact, artifact retention, commit boundaries, GitHub artifact repository pointers, sync state, or rollback evidence.
---

# Peaks SC

Peaks SC records how product, RD, QA, code, and artifacts move together.

## Responsibilities

- produce change-impact artifacts;
- record commit boundaries;
- ensure intermediate artifacts are retained with code changes;
- track artifact repository pointers;
- record sync state and rollback points.

## Refactor role

Each refactor slice must leave a traceable commit boundary containing code changes and PRD/RD/QA/TXT intermediate artifacts.

## GStack integration

Use gstack as a concrete source-control and release workflow reference for the `Ship → Reflect` stages:

- map `/ship` and `/land-and-deploy` concepts to Peaks commit boundaries, sync state, rollback points, and artifact retention;
- map checkpoint discipline to traceable code-plus-artifact slices;
- do not create PRs, merge, deploy, or mutate shared state unless the active Peaks workflow and user confirmation explicitly allow it.

## Project memory backup

Project `.claude/memory` is the primary source for durable project memory. At approved checkpoints, use `peaks memory sync --project <path> --workspace <artifact-workspace> --apply` to back up the full project memory directory into the artifact repository workspace; do not treat the artifact backup as a second writable memory source.

## Boundaries

Do not implement code or test logic. Do not create GitHub repositories directly from the skill body. Use the Peaks CLI artifact commands.

Reference: `references/artifact-retention.md`.
