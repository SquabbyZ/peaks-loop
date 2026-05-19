# Peaks Artifact Protocol Design

## Summary

Peaks is a workflow-first AI engineering orchestration layer. It uses short skills, CLI dry-run operations, and stable intermediate artifacts to reduce capability gaps, collaboration cost, model variance, and semantic drift from user intent to final delivery.

Peaks should play the "Nongfu Spring" role: it curates, evaluates, packages, recommends, and safely enables excellent external skills, MCPs, agents, and workflows. It should not reimplement every specialist capability.

## Product stance

Peaks optimizes for lowering the floor before raising the ceiling.

The first goal is not maximum autonomy. The first goal is to make mixed-model, mixed-client, skill-driven work less likely to drift, fail silently, or depend on a single strong model understanding a long prompt.

Peaks should support engineers and non-engineering product users. Human-facing text follows the user's primary language. Machine-facing contracts use stable English identifiers.

Peaks treats product design, feature positioning, workflow framing, and acceptance definition as higher-uncertainty work than coding. Code usually has executable feedback: it builds or fails, tests pass or fail, and behavior can be verified. Product direction has more ambiguous feedback, so Peaks should spend more interactive human judgment there and automate implementation only after direction is stable.

## Core principles

1. **Artifact protocol over agent chatter**
   Role skills and agents communicate through schema-validated artifacts, not free-form conversation.

2. **Machine layer and presentation layer are separate**
   The machine layer is stable, English-keyed, terse, and schema-first. The presentation layer is localized for the user.

3. **Capability gaps are normal states**
   Missing skills, MCPs, agents, or CLIs must produce explicit availability records, install/enable plans, and fallback routes. Peaks must not pretend a missing capability exists.

4. **Source is not capability**
   A repo, skills.sh package, or MCP collection is a capability source. Concrete agents, skills, MCP servers, workflows, templates, and rules inside it are capability items.

5. **Recommendation is consultative; execution is profile-driven**
   Peaks recommends multiple routes and explains tradeoffs. Once the user selects a route, profile controls automation level.

6. **Solo means user-led direction, not manual labor**
   In solo mode, the user owns product and technical judgment. After direction is approved, engineering execution, review, security checks, smoke tests, and QA should lean automatic.

7. **Non-solo means collaboration**
   Non-solo supports team-style collaboration or a single user intentionally invoking multiple roles, skills, agents, or MCPs together.

8. **Swarm comes after contracts**
   Swarm should accelerate exploration, review, execution, and validation only after tasks, outputs, and validation are artifact-bound.

9. **Reduce model variance**
   Peaks should let weaker and cheaper models execute narrow tasks while stronger models handle synthesis, architecture review, security review, and final acceptance.

10. **Reduce semantic drift**
    Every workflow should preserve traceability from raw user intent to final artifacts, decisions, non-goals, and acceptance checks.

## Target architecture

```text
User intent / docs / logs / code context
        |
        v
IntentTrace
        |
        v
Workflow Facade
(peaks-solo / future peaks-collab / workflow entrypoints)
        |
        v
RecommendationPlan
        |
        +--> CapabilitySource Catalog
        |        |
        |        v
        |   CapabilityItem Catalog
        |
        +--> CapabilityAvailability
        |
        v
User decision / profile selection
        |
        v
WorkflowState
        |
        v
AgentTask(s)
        |
        v
Role + capability artifacts
(PRD / RD / QA / design / security / review / evidence)
        |
        v
Synthesizer
        |
        v
Acceptance / archive / delivery report
```

## Skill taxonomy

### 1. Workflow facade skills

Workflow facade skills identify the scenario, recommend routes, select profiles, coordinate role and capability skills, and summarize decision surfaces.

Examples:

- `peaks-solo`
- future `peaks-collab`
- future workflow-specific facades such as `peaks-refactor`

### 2. Role skills

Role skills represent professional judgment boundaries and produce structured artifacts.

Examples:

- `peaks-prd`
- `peaks-rd`
- `peaks-qa`
- future `peaks-design`
- future `peaks-security`
- future `peaks-dx`

### 3. Capability skills

Capability skills provide reusable task abilities, not whole professional roles.

Examples:

- `peaks-sc`
- `peaks-txt`
- external browser, search, review, summarization, or transformation skills

### 4. Artifact contracts

Artifact contracts define communication, auditability, validation, and rollback boundaries.

Existing contracts include:

- `artifact-manifest.schema.json`
- `context-capsule.schema.json`
- `approval-record.schema.json`
- `change-impact.schema.json`
- `refactor-slice-spec.schema.json`
- `artifact-retention-report.schema.json`

New contracts should extend this family.

## Profile model

Profiles have two separate axes.

### Collaboration axis

- `solo`: user has already made the judgment or wants to drive direction end-to-end.
- `non-solo`: Peaks coordinates team-style collaboration or multiple skills/roles/agents.

### Automation axis

- `manual`: recommendation and guidance only.
- `assisted`: semi-automatic execution with confirmation at risk boundaries.
- `auto`: automated execution for approved low-risk steps, with hard stops for risky side effects.

Recommended named profiles:

- `solo-guided-auto`: default. User-led direction, automatic downstream engineering checks.
- `non-solo-collab`: multiple roles or skills, coordinated through artifacts.
- `non-solo-swarm`: collaboration plus parallel agents for exploration, review, execution, and validation.
- `non-solo-strict`: collaboration plus strict gates, artifact retention, rollback, and commit boundaries.

## Product refactor and code refactor

Refactor workflows must support both product refactor and code refactor.

### Code refactor

The user value remains mostly the same. The goal is better code structure, boundaries, tests, maintainability, and validation.

### Product refactor

The implementation may be acceptable, but the product concept, onboarding, interaction model, information architecture, or usability creates high cognitive cost. The goal is to reduce understanding cost, reshape the user path, and then adjust code where necessary.

Professional tools can be complex. The issue is not complexity itself. The issue is unlayered complexity that prevents early user success.

## Capability sources and items

Peaks must not treat URLs as atomic capabilities.

### CapabilitySource

A source is an external repo, skills.sh package, MCP collection, website, or local install that may contain many useful items.

Examples:

- `affaan-m/everything-claude-code`
- `vercel-labs/agent-skills`
- `anthropics/skills`
- `modelcontextprotocol/servers`
- PulseMCP server pages

### CapabilityItem

An item is a concrete usable capability extracted from a source.

Examples:

- `everything-claude-code.code-review-agent`
- `everything-claude-code.security-review-agent`
- `context7.docs-lookup`
- `playwright-mcp.browser-automation`
- `figma-context.design-ingest`

Recommendation should recommend items, not sources.

## Recommended new schemas

### `capability-source.schema.json`

Represents a repo, MCP collection, website, or installed package.

Key fields:

- `sourceId`
- `sourceType`
- `url`
- `trustSignals`
- `discoveryStatus`
- `items`

### `capability-item.schema.json`

Represents a concrete skill, MCP server, agent, rule, hook, template, workflow, or doc.

Key fields:

- `capabilityId`
- `sourceId`
- `itemType`
- `category`
- `workflows`
- `audience`
- `riskLevel`
- `inputContract`
- `outputContract`
- `fallback`
- `presentation`

### `capability-availability.schema.json`

Represents whether a capability is available in the current runtime.

Key fields:

- `capabilityId`
- `type`
- `status`: `available | missing | installable | disabled | unknown`
- `requiredFor`
- `installPlan`
- `fallback`
- `risk`

### `recommendation-plan.schema.json`

Represents task-aware, user-facing recommendations and machine-readable next actions.

Key fields:

- `intent`
- `workflow`
- `profile`
- `audience`
- `options`
- `requiredCapabilities`
- `availability`
- `fallbacks`
- `decisionRequired`
- `machine`
- `presentation`

### `intent-trace.schema.json`

Tracks semantic continuity from raw user intent to final delivery.

Key fields:

- `rawUserInput`
- `normalizedIntent`
- `confirmedDecisions`
- `nonGoals`
- `derivedRequirements`
- `linkedArtifacts`
- `acceptanceChecks`
- `driftWarnings`

### `workflow-state.schema.json`

Tracks deterministic workflow progress.

Key fields:

- `stateId`
- `workflow`
- `currentState`
- `allowedNextStates`
- `requiredArtifacts`
- `blockedBy`
- `stopConditions`

### `agent-task.schema.json`

Defines narrow work units for mixed-model or swarm execution.

Key fields:

- `taskId`
- `role`
- `inputArtifacts`
- `allowedCapabilities`
- `outputArtifact`
- `stopConditions`
- `language`

### `agent-output-report.schema.json`

Reports task completion, produced artifacts, confidence, blockers, and next actions.

Key fields:

- `taskId`
- `status`
- `artifactsProduced`
- `confidence`
- `blockedBy`
- `nextActions`

### `model-capability-profile.schema.json`

Describes how to assign work across models with different capabilities and cost profiles.

Key fields:

- `modelId`
- `strengths`
- `weaknesses`
- `recommendedRoles`
- `avoidRoles`
- `costTier`
- `contextStrength`
- `schemaFollowingStrength`

## Machine and presentation layers

Artifacts should use this shape where appropriate:

```text
Artifact
├── meta
│   ├── schemaVersion
│   ├── artifactType
│   ├── producer
│   ├── createdAt
│   └── language
├── machine
│   ├── intent
│   ├── workflow
│   ├── capabilities
│   ├── constraints
│   ├── decisions
│   ├── risks
│   └── nextActions
└── presentation
    ├── summary
    ├── options
    ├── warnings
    ├── explanations
    └── archiveText
```

Rules:

- Machine keys, IDs, enums, file paths, command names, and error codes stay stable English.
- Human-readable summaries, recommendations, warnings, archive text, and explanations follow the user's primary language.
- If the user asks in Chinese but pastes English logs, preserve logs as-is and present analysis in Chinese.
- Multi-model and multi-IDE execution must use the machine layer, not localized prose.

## Model portability strategy

The likely long-running development model may be MiniMax 2.7, with stronger models such as Claude or GPT used for review, synthesis, and acceptance. Peaks should support this explicitly.

Recommended division:

- Cheaper or weaker models: scanning, summarization, candidate collection, simple extraction, test gap listing.
- Stronger models: final synthesis, architecture decisions, security review, product review, acceptance judgment.

Peaks should not depend on one strong model understanding the full project. It should reduce model variance with:

- small agent tasks;
- stable schemas;
- workflow states;
- validation;
- golden tests;
- synthesizer consolidation;
- explicit stop conditions.

## Swarm strategy

Swarm is a later acceleration layer, not the first foundation.

Correct order:

1. Artifact protocol.
2. Recommendation plan and capability availability.
3. Intent trace and workflow state.
4. Agent tasks and output reports.
5. Validation and golden tests.
6. Synthesizer.
7. Swarm profiles.

Without artifacts, swarm creates parallel noise. With artifacts, swarm creates parallel capacity.

## Configuration and runtime mode

Peaks should support config-driven operation for future desktop and multi-repo use.

Recommended config layers:

```text
User-global config
  ~/.peaks/config.json
  stores user defaults, provider preferences, known artifact remotes, desktop settings, and token references

Project config
  .peaks/config.json
  stores project-local workflow defaults, artifact repository binding, and non-secret settings

Runtime status
  generated by CLI commands
  stores derived availability/status output, not long-lived secrets
```

Secrets such as GitHub or GitLab tokens should not be committed into project config. Prefer environment variables, OS keychain references, provider CLIs, or user-global encrypted storage. If `config.json` supports tokens, it should store token references rather than raw secrets where possible.

Multi-repo support should be first-class. A user may have multiple code repositories and one or more artifact repositories. Config should model:

- workspace id;
- code repo path;
- artifact repo provider;
- artifact repo remote URL;
- local artifact working copy path;
- default workflow profiles;
- sync status.

Peaks should remain CLI-first for the first implementation. It does not need a long-running Claude Code Router-style service at the beginning. Add a service mode later only when there is a concrete need for desktop UI state, real-time artifact updates, multi-client coordination, webhooks, or background sync.

Possible future command:

```bash
peaks serve --host 127.0.0.1 --port <port> --json
```

The service should wrap the same CLI/service-layer contracts, not fork business logic.

## First implementation scope

The first implementation should not attempt the full product vision. Future capabilities should be reserved in the architecture but implemented incrementally. Peaks should move in small, testable steps: stabilize one contract, one command, and one workflow boundary at a time before expanding.

Build first:

1. Capability source and item catalog structures.
2. Recommendation plan schema.
3. Capability availability schema.
4. Local availability resolver for known local skills and MCP placeholders.
5. `peaks recommend --json` dry-run command.
6. Explicit fallback output for missing capabilities.
7. Unit tests and JSON golden tests.

Defer:

- automatic external skill/MCP installation;
- web-scale skill discovery;
- full source deep indexing;
- real swarm execution;
- product refactor end-to-end workflow;
- WorkBuddy/OpenClaw/Hermes-specific adapters;
- remote artifact repository creation;
- UI dashboards.

## Suggested development phases

### Phase 0: Documentation alignment

Update architecture docs to reflect:

- Peaks Artifact Protocol;
- machine/presentation layer split;
- source vs item distinction;
- lower-floor-first principle;
- model portability;
- product refactor as first-class scenario.

### Phase 1: Capability catalog foundation

Add static seed catalog support for known sources from `docs/accessRepo.md` and `docs/mcpServer.md`.

Do not deep-scan all sources yet. Capture them as `CapabilitySource` entries with manual notes and a few hand-curated `CapabilityItem` entries.

### Phase 2: Recommendation and availability contracts

Add schemas, TS types, services, and doctor validation for:

- recommendation plan;
- capability source;
- capability item;
- capability availability.

### Phase 3: CLI dry-run API

Add:

```bash
peaks recommend --workflow code-refactor --json
peaks recommend --workflow product-refactor --json
peaks capability status --json
```

Every command should return the existing envelope shape.

### Phase 4: Fallback-first workflows

Wire recommendations into existing refactor dry-run output.

Missing capabilities must produce:

- missing item;
- why it matters;
- install/enable plan placeholder;
- fallback path;
- human-readable localized explanation.

### Phase 5: Intent trace and drift checks

Add intent trace artifacts and acceptance checks. Use them to prevent scope expansion and product drift.

### Phase 6: Agent task protocol

Add agent task and output report contracts so weaker models can execute narrow work units.

### Phase 7: Swarm pilot

Pilot swarm inside one workflow after previous phases are stable.

Start with non-mutating parallel tasks:

- source scanning;
- codebase summary;
- test gap analysis;
- capability candidate extraction;
- review perspectives.

### Phase 8: External capability deep indexing

Deep-index complex sources such as `everything-claude-code` into item-level capabilities. Only after item extraction is reliable should Peaks recommend concrete external agents automatically.

## Test strategy

Use unit tests and golden JSON tests first.

Required coverage:

- known workflow produces deterministic recommendation plan;
- missing capability produces explicit fallback;
- available local skill is detected;
- unknown source is not treated as executable capability;
- presentation language follows user language;
- machine layer remains stable English;
- non-goals prevent scope expansion;
- doctor validates new schemas;
- CLI envelope remains stable.

## Acceptance checks

The first implementation is accepted when:

- `peaks recommend --workflow code-refactor --json` returns a valid recommendation plan;
- missing external capabilities are represented as normal availability records;
- output includes both machine and localized presentation layers;
- known complex sources are represented as sources, not single capabilities;
- at least one item from an installed source can be represented as an item;
- doctor validates all new schemas;
- tests cover happy path, missing capability, unknown capability, and localized presentation;
- no command performs installation or remote mutation.
