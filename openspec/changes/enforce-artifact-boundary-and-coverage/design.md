# Design: artifact boundary and coverage gate

## Goal

Create shared requirements that future dry-run planner commands can rely on without each command inventing its own artifact and quality semantics.

## Artifact Boundary

`.peaks/changes/<change-id>/...` is Peaks orchestration state, not product source. It belongs in the configured Peaks artifact workspace.

The target repository should contain:

- source code
- tests
- intentional project documentation
- necessary configuration

The target repository should not contain runtime orchestration outputs such as:

- swarm task graphs
- worker briefs
- worker reports
- reducer reports
- tech review reports
- final reports

## Path Validation

Use a single validation helper for `change-id` and artifact-relative paths.

`change-id` MUST:

- be non-empty
- match a conservative identifier pattern such as `[A-Za-z0-9._-]+`
- reject `.` and `..`
- reject `/`, `\`, drive prefixes, URL-like strings, and path traversal

Artifact-relative paths MUST:

- be generated from trusted templates, not arbitrary user input
- normalize separators to `/` for JSON output
- remain under the artifact workspace after resolution

## Workspace Unavailable Behavior

Commands have two allowed behaviors when the artifact workspace is unavailable:

1. Preview-only response for non-persistent dry-run planning.
2. Blocked response when the user requested persistent artifacts or when downstream commands require persisted evidence.

Commands MUST NOT silently fall back to writing under the target repository.

## Completion Gate

Feature completion for this MVP requires:

```bash
pnpm test
pnpm typecheck
pnpm test:coverage
```

Coverage thresholds for included modules remain:

```text
statements: 100
branches: 100
functions: 100
lines: 100
```

Do not mark work complete by excluding new modules from coverage to avoid testing them.

## Testing

Add focused unit tests for shared helpers before adding planner commands:

- valid and invalid `change-id` values
- artifact-relative path normalization
- path containment under artifact workspace
- workspace unavailable response shape
- coverage config still requires 100% thresholds
