# Implementation Plan

## Phase 1: Foundation

- Initialize Node + TypeScript CLI package.
- Provide `bin/peaks.js` entrypoint.
- Add Vitest and coverage thresholds.
- Add shared CLI output envelope and service layer.
- Add skill registry derived from `skills/*/SKILL.md`.

## Phase 2: Skill family skeleton

Create official-style skill directories:

- `peaks-solo`
- `peaks-prd`
- `peaks-ui`
- `peaks-rd`
- `peaks-qa`
- `peaks-sc`
- `peaks-txt`

Each skill starts with lean `SKILL.md` plus references for workflow, artifact contracts, and command migration.

## Phase 3: CLI doctor and JSON API

Implement:

- `peaks skill list`
- `peaks doctor`
- `peaks profile list`
- `peaks proxy test`
- `peaks artifacts status/init --dry-run`
- `peaks refactor --solo|--rd --dry-run`

All commands should support `--json` where useful.

## Phase 4: Runtime capability management

Add dry-run-first support for:

- capability discovery and installation plans
- external skills via `find-skills`
- MCP status and sync plans
- hook profiles
- agent/swarm profiles
- sync apply/doctor/rollback

## Phase 5: Refactor-first dogfood

Use a real project to validate:

- coverage gate >= 95%
- minimal functional slices
- strict slice specs
- artifact retention
- commit boundary
- GitHub/GitLab artifact repository flow

## Non-goals for the first pass

- Do not implement real code rewriting.
- Do not auto-install hooks or agents by default.
- Do not replace cc-switch.
- Do not silently create GitHub/GitLab repositories.
- Do not hardcode a second skill registry.
