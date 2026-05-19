# Spec Delta: peaks-solo

## ADDED Requirements

### Requirement: Autonomous workflow goal package

Peaks Solo SHALL coordinate `peaks-prd` to create or validate an autonomous workflow goal package before autonomous RD swarm planning starts.

#### Scenario: Create autonomous goal package

- **GIVEN** a valid change id and user goal
- **WHEN** the user requests autonomous Peaks execution
- **THEN** Peaks returns a goal package containing goal, non-goals, preserved behavior, acceptance criteria, done condition, resume condition, and risk notes
- **AND** the package is suitable for downstream RD and QA planning
- **AND** the package does not launch agents or modify source files

#### Scenario: Recommend Claude Code goal condition

- **GIVEN** the runtime supports Claude Code `/goal` or an equivalent session-level completion loop
- **WHEN** Peaks creates an autonomous goal package
- **THEN** Peaks includes a recommended completion condition
- **AND** Peaks marks the completion condition as session-scoped and non-durable
- **AND** Peaks records that durable progress belongs in Peaks artifacts

### Requirement: Capability reuse before custom build

Peaks Solo SHALL prefer existing curated capabilities before proposing custom implementation from scratch.

#### Scenario: Curated capability sources are considered

- **GIVEN** `docs/accessRepo.md`, `docs/mcpServer.md`, and local `skills/*/SKILL.md` exist
- **WHEN** Peaks plans autonomous execution
- **THEN** Peaks includes relevant existing skills, MCP servers, repositories, or docs as candidate capabilities
- **AND** the candidate set reflects the user-curated categories from `docs/accessRepo.md`, including code standards, project scanning, frontend/browser validation, MiniMax-oriented execution helpers, cross-session memory, UI/design resources, OpenSpec, and swarm/orchestration references
- **AND** each candidate records source, purpose, trust level, activation requirement, and risk
- **AND** Peaks does not install, enable, or invoke unavailable capabilities in dry-run mode

#### Scenario: Capability requires user-visible side effect

- **GIVEN** a candidate capability requires installation, credentials, settings mutation, external network calls, or target repo mutation
- **WHEN** Peaks generates the plan
- **THEN** the plan marks the capability as requiring explicit approval before activation
- **AND** no side effect occurs during dry-run planning
