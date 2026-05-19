# Design: peaks-rd swarm dry-run planner

## Goal

Implement a dry-run planner that converts a development goal and approved tech gate state into a large but safe RD task graph. The first version plans work only; it does not execute workers.

## Data Model

Define focused TypeScript types under a new RD/swarm service area, for example `src/services/swarm/` or `src/services/rd/`:

- `RdSwarmPlanRequest`
  - `skill: 'rd'`
  - `changeId: string`
  - `goal: string`
  - `maxWorkers: number`
  - `dryRun: true`
  - `requiresTechApproval?: boolean`
- `RdTaskGraph`
  - `changeId`
  - `goal`
  - `workerTarget`
  - `waves`
  - `tasks`
  - `conflictGroups`
  - `artifactRoot`
  - `gateStatus`
  - `blockedReasons`
  - `nextActions`
- `RdTask`
  - `taskId`
  - `wave`
  - `workerKind`
  - `purpose`
  - `inputs`
  - `outputs`
  - `dependsOn`
  - `conflictGroup`
  - `targetArea`
  - `expectedEvidence`
- `RdConflictGroup`
  - `groupId`
  - `ownedPaths`
  - `parallelismPolicy`
  - `reason`

## Wave Template

`peaks swarm plan --skill rd` MUST include these dry-run waves:

1. Discovery
   - `rd-frontend-scan`
   - `rd-backend-scan`
   - `rd-test-scan`
   - `rd-contract-scan`
   - `rd-platform-scan`
   - `rd-risk-scan`
   - `rd-dependency-scan`
   - `rd-ci-scan`
2. Planning
   - `rd-frontend-slicer`
   - `rd-backend-slicer`
   - `rd-unit-test-slicer`
   - `rd-integration-test-slicer`
   - `rd-contract-planner`
   - `rd-config-planner`
   - `rd-file-owner-planner`
   - `rd-quality-gate-planner`
3. Implementation candidates
   - `rd-impl-frontend-001..N`
   - `rd-impl-backend-001..N`
   - `rd-impl-contract-001`
   - `rd-impl-config-001`
   - `rd-impl-unit-test-001..N`
   - `rd-impl-integration-test-001..N`
   - `rd-impl-platform-001`
   - `rd-impl-ci-001`
   - `rd-impl-docs-001`
4. Quality gates
   - `rd-code-review-worker`
   - `rd-security-review-worker`
   - `rd-typecheck-worker`
   - `rd-coverage-worker`
   - `rd-regression-worker`
   - `rd-performance-worker`
   - `rd-docs-review-worker`
5. Reducer
   - `rd-reducer-worker`

## Worker Count Strategy

The planner SHOULD target 25-40 workers. For MVP, use a deterministic template that expands implementation candidate workers up to `maxWorkers` while preserving the required waves.

Rules:

- Reject `maxWorkers` lower than 25 unless the planner returns a clear explanation that the change scope is too small.
- Cap worker count at 40.
- Prefer many small ownership slices over broad workers.
- Keep quality gate and reducer workers dependent on implementation candidates.
- Assign conflict groups so many workers can execute safely in parallel.

## Tech Approval Gate

The planner MUST call or reuse tech status logic when `requiresTechApproval` is true or when the workflow router determines the change needs tech approval.

Tech approval is required for:

- New feature development.
- Large refactors.
- Frontend/backend contract, API, or schema changes.
- Public API or CLI contract changes.
- Data structure, config, CI, deployment, platform, token, permission, or security boundary changes.
- More than three modules requiring coordinated refactor.
- Conflict groups too dense for safe parallel execution.

Simple bug fixes, small hotfixes, local refactors, and implementation-path-clear changes may skip the tech gate.

## Artifact Layout

Plan output paths are relative to the Peaks artifact workspace:

```text
.peaks/changes/<change-id>/swarm/task-graph.json
.peaks/changes/<change-id>/swarm/waves/wave-1-discovery.json
.peaks/changes/<change-id>/swarm/waves/wave-2-planning.json
.peaks/changes/<change-id>/swarm/waves/wave-3-implementation-candidates.json
.peaks/changes/<change-id>/swarm/waves/wave-4-quality-gates.json
.peaks/changes/<change-id>/swarm/waves/wave-5-reducer.json
.peaks/changes/<change-id>/swarm/workers/<task-id>/brief.md
.peaks/changes/<change-id>/swarm/reducer-report.md
```

## CLI Shape

```bash
peaks swarm plan --skill rd --change-id <id> --goal "<goal>" --max-workers 40 --dry-run --json
```

Only `--skill rd` is required for MVP. Other skills should return a clear unsupported-skill error.

## Testing

Use TDD. Cover:

- Valid graph contains required waves.
- Graph targets 25-40 workers when `max-workers` supports it.
- `max-workers` above 40 is capped or rejected with explicit behavior.
- `max-workers` below 25 blocks unless a small-scope explanation is returned.
- Tech gate required and missing blocks planning.
- Tech gate not required allows planning.
- Artifact paths are workspace-relative and normalized.
- Invalid `change-id` fails.
- CLI JSON envelope and unsupported skill behavior.

All included modules must reach 100% statements, branches, functions, and lines.
