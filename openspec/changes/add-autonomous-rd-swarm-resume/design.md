# Design: autonomous RD swarm resume planning

## Goal

Introduce a dry-run planning layer that turns a user-approved product goal into a resumable autonomous RD swarm plan. The plan should let top-tier models define direction and acceptance while lower-cost execution models work from strict briefs, checkpoints, and validation evidence.

## Product Artifact: Autonomous Goal Package

`peaks-prd` should produce or validate a focused goal package before RD autonomy starts:

- `changeId`: safe change identifier.
- `goal`: user-facing outcome.
- `nonGoals`: behaviors and areas not to change.
- `preservedBehavior`: product behavior that must remain stable.
- `acceptanceCriteria`: observable pass/fail criteria.
- `doneCondition`: concise condition suitable for Claude Code `/goal` or equivalent loop evaluators.
- `resumeCondition`: what must be true after compact/session resume before work continues.
- `riskNotes`: risks that require user confirmation.
- `capabilityPolicy`: whether Peaks may use curated skills, MCPs, browser tools, repo search, or external docs.

## RD Autonomy Model

`peaks-rd` should consume the goal package and create a dry-run plan with:

- `autonomyMode`: `dry-run`, `assisted`, or future `execute`.
- `swarmMode`: enabled by default for RD when safe.
- `maxWorkers`: target worker cap, defaulting to the existing RD swarm policy.
- `checkpoints`: ordered milestones that survive compact/session continuation.
- `workerQueue`: planned worker briefs, dependencies, conflict groups, and status placeholders.
- `evidence`: required validation outputs, review reports, coverage reports, and reducer reports.
- `resumeInstructions`: exact steps a future session should perform before continuing.
- `goalCommand`: optional Claude Code `/goal` condition string when the environment supports it.

## `/goal` Integration

Claude Code `/goal` should be treated as a session-level accelerator:

- Peaks may emit a recommended `/goal` condition.
- Peaks must not rely on `/goal` as the only source of truth.
- Peaks artifacts remain the durable record for progress, checkpoints, and evidence.
- After compact or `--continue`, Peaks should re-read artifacts, reconstruct pending workers, and verify evidence before continuing.

## Capability Reuse

Before planning custom implementation, Peaks should consult curated capability sources:

- `docs/accessRepo.md` for reusable repos and external project ideas.
- `docs/mcpServer.md` for MCP servers such as Context7, Playwright MCP, Chrome DevTools, searchcode, MySQL MCP, and Figma context.
- Existing local `skills/*/SKILL.md` entries.
- Seed capability catalog where available.

`docs/accessRepo.md` should be treated as a user-curated capability map, not as a dependency list to install blindly. The current categories include:

- Claude Code development standards, CR, and security review resources.
- Concise-code and expert TypeScript/engineering skill resources.
- Project scanning tools.
- React/frontend agent skills and browser-based frontend validation resources.
- MiniMax frontend-oriented skills for lower-cost model execution.
- Cross-session memory/context systems.
- shadcn/UI and design-component resources.
- Skill evaluation resources.
- Claude Code best-practice references.
- OpenSpec references.
- Git/context intelligence resources.
- UI design, landing-page, design platform, and one-person-company/product resources.
- Swarm/federated agent orchestration references such as Ruflo.
- Official Anthropic, Vercel, and Azure skill collections.

Capability selection should record:

- `source`: doc path, local skill, MCP registry, or known repo.
- `purpose`: docs lookup, code standards, project scanning, frontend implementation, browser validation, design context, UI component reuse, skill evaluation, repo search, database inspection, memory/context, product direction, or swarm coordination.
- `trustLevel`: local, curated, third-party, or unknown.
- `activation`: available, needs install, needs credentials, or not available.
- `risk`: token cost, network access, credential use, settings mutation, or target repo mutation.

The first implementation should only plan capability use. It must not install, enable, or call external systems unless the existing user/session explicitly allows that operation.

## Artifact Layout

Plan output paths are relative to the Peaks artifact workspace:

```text
.peaks/changes/<change-id>/prd/autonomous-goal-package.json
.peaks/changes/<change-id>/prd/autonomous-goal-package.md
.peaks/changes/<change-id>/swarm/autonomous-rd-plan.json
.peaks/changes/<change-id>/swarm/checkpoints/checkpoint-<n>.json
.peaks/changes/<change-id>/swarm/workers/<task-id>/brief.md
.peaks/changes/<change-id>/swarm/evidence/validation-report.md
.peaks/changes/<change-id>/swarm/resume-instructions.md
```

## CLI Shape

MVP can be exposed through a dry-run command such as:

```bash
peaks workflow autonomous \
  --mode solo \
  --change-id <id> \
  --goal "<goal>" \
  --max-workers 40 \
  --dry-run \
  --json
```

Alternative: extend `peaks workflow route` with an `--autonomous` option only if that keeps the result envelope stable.

## Testing

Use TDD when implementation starts. Cover:

- goal package generation with done/resume conditions.
- `/goal` recommendation is present but marked non-durable.
- capability reuse list includes docs/accessRepo.md and docs/mcpServer.md inputs.
- unavailable artifact workspace returns preview-safe next actions.
- invalid change id and empty goal fail.
- dry-run constraints prohibit worker launch and settings mutation.
- resumed state requires checkpoint and evidence verification.

All included modules must reach 100% statements, branches, functions, and lines.
