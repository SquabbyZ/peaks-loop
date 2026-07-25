# Change: add-tech-dry-run-gate

## Why

Peaks needs a technical-plan gate before large feature, contract, schema, CI, deployment, platform, or security-boundary work enters RD execution. The gate should let weaker implementation models follow a reviewed technical plan instead of rediscovering architecture from a long prompt.

## What Changes

- Add `peaks tech plan --change-id <id> --goal "<goal>" --swarm --dry-run --json`.
- Add `peaks tech status --change-id <id> --json`.
- Generate a dry-run technical swarm graph with scan, doc, review, and reducer waves.
- Generate artifact paths for tech task graph, waves, worker briefs, review checklist, and approval template.
- Report next actions when artifact workspace is unavailable instead of writing into the target repository.
- Add status checks for required tech docs, review report, and approved approval record.

## Out of Scope

- Launching real agents or workers.
- Writing implementation code into a target repository.
- Automatically approving tech plans.
- Full OpenSpec runtime integration.
- UI preview.

## Dependencies

- `enforce-artifact-boundary-and-coverage` should land first or together.
- Existing CLI result envelope and Vitest setup should be reused.

## Risks

- The command may accidentally write `.peaks/changes/...` into the target repository if artifact workspace resolution is unclear.
- The status gate may become too permissive if approval parsing accepts non-approved records.
- The dry-run graph may be too vague for RD to consume if worker briefs lack inputs, outputs, and conflict boundaries.

## Acceptance Criteria

- `peaks tech plan` returns JSON with stable machine-readable task graph, waves, worker briefs, checklist path, approval template path, and next actions.
- `peaks tech status` reports approved, blocked, or unavailable with explicit reasons.
- No tech plan/status path resolves under the target repository's `.peaks/changes/<change-id>/...` unless that repository is explicitly configured as the artifact workspace.
- Dry-run mode does not launch agents and does not modify source files.
- Invalid `change-id` fails with a clear error.
- `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` pass with 100% coverage for included modules.
