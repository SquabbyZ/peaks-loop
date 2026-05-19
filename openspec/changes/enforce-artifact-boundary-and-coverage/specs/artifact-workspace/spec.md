# Spec Delta: artifact-workspace

## ADDED Requirements

### Requirement: Artifact outputs stay outside target repository by default

Peaks planner commands SHALL store or preview `.peaks/changes/<change-id>/...` outputs in the configured Peaks artifact workspace, not in the target code repository by default.

#### Scenario: Configured artifact workspace

- **GIVEN** a Peaks artifact workspace is configured
- **WHEN** a planner command produces artifact paths
- **THEN** every `.peaks/changes/<change-id>/...` path resolves under the artifact workspace
- **AND** JSON output uses normalized `/` separators
- **AND** the target repository is not used for runtime orchestration artifacts

#### Scenario: Target repository not configured as artifact workspace

- **GIVEN** a target repository at `repo-a`
- **AND** no explicit artifact workspace points to `repo-a`
- **WHEN** a planner command runs
- **THEN** the command must not create `repo-a/.peaks/changes/<change-id>/...`

#### Scenario: Target repository explicitly configured as artifact workspace

- **GIVEN** the user explicitly configures the target repository as the artifact workspace
- **WHEN** a planner command persists artifacts
- **THEN** writing under that repository is allowed
- **AND** the response records that the artifact workspace is the target repository

### Requirement: Artifact workspace unavailable behavior

Planner commands SHALL make missing artifact workspace state explicit.

#### Scenario: Preview-only dry-run can proceed

- **GIVEN** no artifact workspace is configured
- **AND** the command can return preview output without persisted evidence
- **WHEN** the command runs in dry-run mode
- **THEN** the command returns preview output
- **AND** the response includes next actions to configure artifact storage
- **AND** no files are written under the target repository

#### Scenario: Persistent output requires artifact workspace

- **GIVEN** no artifact workspace is configured
- **AND** the command requires persisted artifacts or evidence
- **WHEN** the command runs
- **THEN** the command returns a blocked response
- **AND** the blocked reason includes `artifact-workspace-unavailable`
- **AND** no files are written under the target repository

### Requirement: Change id validation

Planner commands SHALL reject unsafe change ids before generating paths.

#### Scenario: Valid change id

- **GIVEN** a change id containing only letters, numbers, dot, underscore, or dash
- **AND** the id is not `.` or `..`
- **WHEN** a planner command validates the id
- **THEN** validation succeeds

#### Scenario: Unsafe change id

- **GIVEN** a change id containing `/`, `\`, path traversal, a drive prefix, or a URL-like prefix
- **WHEN** a planner command validates the id
- **THEN** validation fails
- **AND** no paths are generated from that id
