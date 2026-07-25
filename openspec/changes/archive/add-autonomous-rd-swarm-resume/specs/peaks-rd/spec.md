# Spec Delta: peaks-rd

## ADDED Requirements

### Requirement: Resumable autonomous RD swarm plan

Peaks RD SHALL generate a dry-run autonomous swarm plan that can resume after compact, session continuation, or interruption.

#### Scenario: Generate resumable RD plan

- **GIVEN** an autonomous goal package and valid change id
- **AND** dry-run mode is requested
- **WHEN** Peaks RD plans autonomous swarm execution
- **THEN** the plan contains checkpoints, worker queue placeholders, dependencies, conflict groups, evidence requirements, resume instructions, and planned artifact paths
- **AND** the plan states that worker execution is not launched in dry-run mode
- **AND** the plan records how many workers may run when execution mode is later approved

#### Scenario: Resume after compact or session continuation

- **GIVEN** a previous autonomous RD plan exists
- **WHEN** Peaks resumes after compact, `--continue`, or a new session
- **THEN** Peaks verifies checkpoint state, worker queue state, and validation evidence before continuing
- **AND** Peaks blocks continuation if required checkpoint or evidence artifacts are missing
- **AND** Peaks reports next actions to recover safely

### Requirement: Durable state is artifact-backed

Peaks RD SHALL treat Peaks artifacts as the durable state source for autonomous swarm progress.

#### Scenario: Claude Code goal is active

- **GIVEN** Claude Code `/goal` is active in the current session
- **WHEN** Peaks RD generates or resumes an autonomous plan
- **THEN** Peaks may use the goal condition as an execution accelerator
- **AND** Peaks still stores or plans checkpoint, queue, and evidence state under `.peaks/changes/<change-id>/...`
- **AND** Peaks does not assume `/goal` can reconstruct missing artifacts

#### Scenario: Artifact workspace unavailable

- **GIVEN** no valid artifact workspace is configured
- **WHEN** autonomous RD planning requires durable state
- **THEN** Peaks returns a preview-safe or blocked result with `artifact-workspace-unavailable`
- **AND** Peaks does not write `.peaks/changes/<change-id>/...` into the target source repository

### Requirement: Autonomous RD swarm safety controls

Peaks RD SHALL preserve safety gates for autonomous execution.

#### Scenario: Safety constraints are present

- **GIVEN** an autonomous RD plan is generated
- **THEN** the plan includes constraints for dry-run-only, no target repo mutation, no settings mutation, no unapproved external capability activation, and evidence-before-resume
- **AND** quality and reducer checks remain required before marking the plan complete

#### Scenario: Worker conflict boundaries are required

- **GIVEN** multiple workers are planned
- **THEN** every worker has a conflict group, dependencies, expected evidence, and an artifact-bound brief path
- **AND** reducer workers depend on implementation and quality evidence
