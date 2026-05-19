# Spec Delta: peaks-rd

## ADDED Requirements

### Requirement: RD swarm dry-run plan command

The CLI SHALL provide `peaks swarm plan --skill rd --change-id <id> --goal "<goal>" --max-workers <n> --dry-run --json` to generate a development swarm dry-run graph.

#### Scenario: Generate RD dry-run graph

- **GIVEN** a valid change id and non-empty development goal
- **AND** dry-run mode is requested
- **AND** the required tech gate is approved or not required
- **WHEN** the user runs `peaks swarm plan --skill rd --change-id checkout-refactor --goal "Implement approved checkout refactor" --max-workers 40 --dry-run --json`
- **THEN** the command returns JSON containing an RD task graph
- **AND** the graph contains discovery, planning, implementation candidates, quality gates, and reducer waves
- **AND** the graph targets 25-40 workers when the scope supports it
- **AND** every task includes a task id, worker kind, purpose, inputs, outputs, dependencies, conflict group, target area, and expected evidence
- **AND** the command does not launch agents or modify source files

#### Scenario: Reject unsupported skill

- **GIVEN** a valid change id and goal
- **WHEN** the user runs `peaks swarm plan --skill qa --dry-run --json`
- **THEN** the command fails with an unsupported-skill error for the MVP
- **AND** no task graph is generated

#### Scenario: Reject non-dry-run mode

- **GIVEN** a valid change id and goal
- **WHEN** the user runs `peaks swarm plan --skill rd` without `--dry-run`
- **THEN** the command fails with an unsupported-mode error
- **AND** no agents are launched

### Requirement: RD tech approval gate

The RD planner SHALL block when the change requires a technical plan and `peaks tech status` is not approved.

#### Scenario: Tech approval required and missing

- **GIVEN** the change is a new feature, large refactor, contract/API/schema change, public API/CLI change, CI/deployment/config change, security boundary change, multi-module coordinated refactor, or unsafe conflict graph
- **AND** `peaks tech status --change-id <id>` is not approved
- **WHEN** the user runs `peaks swarm plan --skill rd --change-id <id> --goal "<goal>" --dry-run --json`
- **THEN** the command returns a blocked response
- **AND** the response includes `tech-approval-required` as a blocked reason
- **AND** the response includes next actions to run or approve `peaks tech`

#### Scenario: Tech approval not required

- **GIVEN** the change is a bug fix, small hotfix, local refactor, or goal with clear implementation path
- **WHEN** the user runs `peaks swarm plan --skill rd --change-id <id> --goal "<goal>" --dry-run --json`
- **THEN** the planner may generate an RD graph without an approved tech plan
- **AND** the response records why the tech gate was skipped

### Requirement: RD artifact path planning

The RD planner SHALL plan swarm outputs under the Peaks artifact workspace.

#### Scenario: Artifact workspace configured

- **GIVEN** a configured artifact workspace
- **WHEN** the RD graph is generated
- **THEN** planned outputs are under `.peaks/changes/<change-id>/swarm/` relative to the artifact workspace
- **AND** wave manifests, worker briefs, task graph, and reducer report paths are included

#### Scenario: Artifact workspace unavailable for persistent output

- **GIVEN** no configured artifact workspace
- **AND** persistent artifact output is requested
- **WHEN** the RD planner runs
- **THEN** the command blocks with an artifact-workspace-unavailable reason
- **AND** it does not create `.peaks/changes/<change-id>/swarm/` inside the target repository

### Requirement: RD worker count safety

The RD planner SHALL explain when it cannot generate the target 25-40 worker graph.

#### Scenario: Worker count below target

- **GIVEN** `--max-workers` is lower than 25
- **WHEN** the user runs RD swarm planning
- **THEN** the planner blocks or returns a clear small-scope explanation
- **AND** the response records why the worker count is below target

#### Scenario: Worker count above cap

- **GIVEN** `--max-workers` is greater than 40
- **WHEN** the user runs RD swarm planning
- **THEN** the planner caps at 40 or rejects the value with explicit behavior documented in tests
