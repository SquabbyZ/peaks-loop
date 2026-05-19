# Spec Delta: quality-gates

## ADDED Requirements

### Requirement: MVP implementation verification commands

Every implementation change for the tech/RD swarm MVP SHALL pass test, typecheck, and coverage commands before being considered complete.

#### Scenario: Verify implementation completion

- **GIVEN** implementation code has changed
- **WHEN** the implementer marks the work complete
- **THEN** `pnpm test` has passed
- **AND** `pnpm typecheck` has passed
- **AND** `pnpm test:coverage` has passed

### Requirement: 100% coverage for included modules

New or changed modules included in unit coverage SHALL meet 100% statements, branches, functions, and lines.

#### Scenario: Coverage threshold passes

- **GIVEN** new or changed modules are included in coverage
- **WHEN** `pnpm test:coverage` runs
- **THEN** statements coverage is 100%
- **AND** branches coverage is 100%
- **AND** functions coverage is 100%
- **AND** lines coverage is 100%

#### Scenario: Coverage threshold fails

- **GIVEN** any included module is below 100% statements, branches, functions, or lines
- **WHEN** `pnpm test:coverage` runs
- **THEN** the command fails
- **AND** the implementation is not complete

### Requirement: Coverage exclusions are not used to hide new behavior

Implementation work SHALL NOT exclude new behavior from coverage merely to satisfy thresholds.

#### Scenario: New behavior requires tests

- **GIVEN** a new tech, RD, artifact-boundary, or CLI behavior is added
- **WHEN** coverage configuration is updated
- **THEN** the new behavior remains covered by unit tests unless there is a documented non-testable boundary
- **AND** exclusion is not used as a substitute for tests
