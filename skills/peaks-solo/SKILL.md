---
name: peaks-solo
description: Full-auto orchestration facade for the Peaks skill family. Use when the user asks Peaks to handle a project workflow end-to-end, especially refactoring via `peaks-solo refactor`, coordinating peaks-prd, peaks-rd, peaks-qa, peaks-sc, and peaks-txt while preserving user confirmation gates.
---

# Peaks Solo

Peaks Solo is the orchestration facade for the Peaks short skill family.

Use this skill to identify the user scenario, recommend an execution mode, coordinate role skills, and produce the final handoff report. Do not collapse role responsibilities into this skill.

## Boundaries

Peaks Solo may:

- identify scenarios such as refactor, bugfix, QA hardening, release validation, and incident response;
- recommend Solo, Assisted, Swarm, or Strict profiles;
- coordinate Peaks role skills through artifacts;
- coordinate project memory extraction from stable skill artifact sections;
- request user confirmation at risk and commit boundaries;
- read CLI doctor/profile/artifact reports.

Peaks Solo must not silently:

- install hooks;
- create agents;
- enable MCP servers;
- modify Claude settings;
- create GitHub repositories;
- bypass role-skill artifacts.

Use the Peaks CLI for runtime side effects.

## Project standards preflight

Before orchestrating an end-to-end code repository workflow, gather the project standards preflight status from RD and QA by calling the Peaks CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

Use `standards init` for first-time creation and `standards update` for existing `CLAUDE.md` append/review behavior. Apply only when write authorization exists; otherwise keep the CLI output as the next action and continue only when the selected workflow can safely proceed without writing standards. Do not hand-write standards file mutations inside the skill.

## Refactor mode

Read `references/refactor-mode.md` before handling refactor requests.

Default MVP path: `peaks-solo refactor`.

It must enforce the shared refactor red lines:

1. understand the project before changes;
2. require UT coverage >= 95%;
3. treat unknown coverage as failing;
4. split broad refactors into minimal functional slices;
5. require strict verifiable specs before each slice;
6. require 100% acceptance for each slice;
7. require code and intermediate artifacts to be committed before the next slice.

## Optional capabilities

When built-in guidance is insufficient, use capability discovery rather than reimplementing specialist workflows. Ask for user consent before token-heavy discovery unless the active profile permits it.

Reference: `references/workflow.md`.
