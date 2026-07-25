# Change: enforce-artifact-boundary-and-coverage

## Why

The tech and RD swarm MVPs depend on two cross-cutting guarantees: Peaks artifacts must stay outside the target code repository by default, and newly included implementation modules must be backed by 100% unit coverage. These guarantees should be explicit before adding more planner commands.

## What Changes

- Define a shared artifact workspace boundary for `.peaks/changes/<change-id>/...` outputs.
- Define validation for change ids and artifact-relative paths.
- Require dry-run commands to preview or persist artifacts only in the Peaks artifact workspace.
- Define the quality gate: `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` must pass.
- Preserve 100% coverage thresholds for included unit-tested modules.

## Out of Scope

- Implementing remote artifact repo sync beyond existing workspace capabilities.
- Automatically committing or pushing artifacts.
- Changing unrelated coverage exclusions.
- Adding UI workflows.

## Dependencies

- This should land before or together with `add-tech-dry-run-gate` and `add-rd-swarm-dry-run-planner`.

## Risks

- A too-strict artifact workspace requirement could block useful dry-run previews.
- A too-permissive fallback could pollute the target repository with orchestration state.
- Coverage thresholds may be bypassed if new modules are excluded instead of tested.

## Acceptance Criteria

- Planner commands never write `.peaks/changes/<change-id>/...` inside the target repository unless it is explicitly configured as the artifact workspace.
- Missing artifact workspace produces explicit preview-only or blocked responses depending on the command mode.
- Invalid change ids and path traversal are rejected.
- `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` are the completion checks.
- Included new/changed unit-tested modules reach 100% statements, branches, functions, and lines.
