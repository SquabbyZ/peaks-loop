# Spec Delta: peaks-tech

## ADDED Requirements

### Requirement: Tech dry-run plan command

The CLI SHALL provide `peaks tech plan --change-id <id> --goal "<goal>" --swarm --dry-run --json` to generate a technical-plan dry-run graph.

#### Scenario: Generate technical dry-run graph

- **GIVEN** a valid change id and non-empty goal
- **AND** dry-run mode is requested
- **WHEN** the user runs `peaks tech plan --change-id checkout-refactor --goal "Refactor checkout API" --swarm --dry-run --json`
- **THEN** the command returns JSON containing a tech task graph
- **AND** the graph contains scan, document, review, and reducer waves
- **AND** every task includes a stable task id, worker kind, purpose, inputs, outputs, dependencies, and conflict group
- **AND** the command does not launch agents or modify target repository source files

#### Scenario: Reject unsupported non-dry-run mode

- **GIVEN** a valid change id and goal
- **WHEN** the user runs `peaks tech plan` without `--dry-run`
- **THEN** the command fails with an unsupported-mode error
- **AND** no artifacts or source files are written

#### Scenario: Reject invalid change id

- **GIVEN** a change id containing path traversal or path separators
- **WHEN** the user runs `peaks tech plan`
- **THEN** the command fails with an invalid-change-id error
- **AND** no artifact paths are produced

### Requirement: Tech artifact path planning

The tech plan command SHALL plan artifact output paths under the Peaks artifact workspace for the current change.

#### Scenario: Artifact workspace configured

- **GIVEN** a configured artifact workspace
- **WHEN** the tech plan is generated
- **THEN** all planned output paths are under `.peaks/changes/<change-id>/architecture/` relative to that artifact workspace
- **AND** the target code repository is not used as artifact storage unless explicitly configured as the artifact workspace

#### Scenario: Artifact workspace unavailable

- **GIVEN** no configured artifact workspace
- **WHEN** the tech plan is generated
- **THEN** the command returns preview output and next actions
- **AND** the command does not create `.peaks/changes/<change-id>/architecture/` in the target repository

### Requirement: Tech status command

The CLI SHALL provide `peaks tech status --change-id <id> --json` to inspect whether technical approval exists for a change.

#### Scenario: Approved tech plan

- **GIVEN** all required tech docs exist in the artifact workspace
- **AND** `tech-review-report.md` exists
- **AND** `tech-approval-record.md` contains the canonical marker `status: approved`
- **WHEN** the user runs `peaks tech status --change-id checkout-refactor --json`
- **THEN** the command returns `approved`
- **AND** the response includes the approval record path

#### Scenario: Missing approval blocks RD

- **GIVEN** required tech docs exist
- **AND** `tech-review-report.md` exists
- **AND** `tech-approval-record.md` is missing or does not contain `status: approved`
- **WHEN** the user runs `peaks tech status --change-id checkout-refactor --json`
- **THEN** the command returns a blocked status
- **AND** the response includes machine-readable blocked reasons

#### Scenario: Missing artifact workspace

- **GIVEN** artifact workspace is not configured
- **WHEN** the user runs `peaks tech status --change-id checkout-refactor --json`
- **THEN** the command returns unavailable status
- **AND** the response includes next actions to configure artifact storage
