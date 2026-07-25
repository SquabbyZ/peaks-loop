# Change: add-rd-swarm-dry-run-planner

## Why

Peaks needs a development swarm planner that can expand an approved technical plan into a large safe parallel execution graph. The goal is to maximize RD throughput while keeping ownership, conflict boundaries, QA, and reducer logic explicit.

## What Changes

- Add `peaks swarm plan --skill rd --change-id <id> --goal "<goal>" --max-workers 40 --dry-run --json`.
- Generate a dry-run RD task graph with discovery, planning, implementation candidates, quality gates, and reducer waves.
- Enforce that tech approval is present whenever the change requires it.
- Produce worker briefs, wave manifests, and reducer output paths under the artifact workspace.
- Keep all output artifact-bound and avoid mutating the target repository.

## Out of Scope

- Launching real workers or agents.
- Editing application source code.
- Auto-merging implementation results.
- UI preview.
- Full OpenSpec runtime integration.

## Dependencies

- `add-tech-dry-run-gate` should exist because RD may depend on approved tech artifacts.
- `enforce-artifact-boundary-and-coverage` should land first or together.

## Risks

- The graph may underutilize safe parallelism if conflict groups are too conservative.
- The graph may overproduce workers if ownership boundaries are too loose.
- The gate may accept unapproved tech states if dependency checks are incomplete.

## Acceptance Criteria

- `peaks swarm plan --skill rd` returns a JSON dry-run graph with at least 25 workers when the change scope supports it.
- The graph covers discovery, planning, implementation candidates, quality gates, and reducer waves.
- The planner blocks when required tech approval is missing.
- The planner blocks when change id is invalid or the artifact workspace is unavailable and persistence is required.
- Dry-run mode does not start agents or change repository source files.
- `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` pass with 100% coverage for included modules.
