---
name: peaks-rd
description: Research and development skill for Peaks. Use for engineering analysis, refactor planning, project scanning, code standards, unit-test coverage gates, implementation contracts, task graphs, and RD handoffs. Always use this for Peaks refactor workflows.
---

# Peaks RD

Peaks RD owns engineering analysis, implementation planning, and refactor execution contracts.

## Responsibilities

- scan the current project before changes;
- prefer existing project standards over built-in language standards;
- enforce the 95% UT coverage refactor gate;
- split broad refactors by minimal functional slices;
- generate refactor options, risk matrix, rollback plan, and task graph preview;
- implement only after strict specs and confirmations exist.

## Project standards preflight

Before RD planning or implementation work in a code repository, call the Peaks CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

If `CLAUDE.md` is missing, treat creation as the preferred path. If `CLAUDE.md` already exists, use `standards update` to decide whether to append a managed index block or surface review-only suggestions. Apply only when write authorization exists; otherwise keep the CLI output as a preflight next action. Do not hand-write standards file mutations inside the skill.

## GStack integration and code dry-runs

Use gstack as a concrete engineering workflow reference for `Think → Plan → Build → Review → Test → Ship → Reflect`:

- map plan engineering review to Peaks RD risk matrices, task graphs, and slice contracts;
- map build/review discipline to strict spec-first implementation and code-review gates;
- map investigate/careful/guard concepts to root-cause analysis, risky-action confirmation, and scoped edit boundaries;
- adapt gstack concepts into Peaks artifacts rather than invoking gstack commands as runtime dependencies.

When Peaks RD produces or changes code, dry-run repeatedly instead of only during preflight:

1. run standards dry-runs before planning or implementation;
2. run the relevant Peaks dry-run again after each meaningful implementation slice or standards-affecting decision;
3. run the relevant dry-run before handoff, review, or commit-boundary work;
4. record dry-run command, result, and remaining action in the RD handoff capsule.

## Refactor hard gates

If a request is refactor, cleanup, architecture adjustment, module split, or technical debt work:

1. scan project structure and existing standards;
2. locate or run UT coverage;
3. block implementation unless coverage is >= 95%;
4. treat missing, unknown, or unverifiable coverage as failing;
5. generate intermediate artifacts before implementation;
6. call or consume peaks-prd and peaks-qa artifacts even in direct RD mode;
7. require strict slice spec before each slice;
8. require 100% acceptance for the slice;
9. require code and intermediate artifacts to be committed before continuing.

## OpenSpec usage

For non-trivial RD changes, use OpenSpec when the project already has `openspec/` or the user approves adding OpenSpec. Create or update `openspec/changes/<change-id>/proposal.md`, `design.md`, `tasks.md`, and `specs/**/spec.md` before implementation slices begin.

OpenSpec artifacts are durable project specification files, not Peaks runtime swarm artifacts. They may live in the target repository root under `openspec/changes/...`. Swarm/runtime outputs such as task graphs, worker briefs, worker reports, reducer reports, scan reports, validation evidence, and compact handoffs must remain in the configured Peaks artifact workspace outside the target repository.

Peaks PRD/RD/QA gates remain authoritative: OpenSpec structures the durable spec, while Peaks artifacts still carry role handoffs, coverage gates, QA evidence, swarm coordination, and execution state.

## Frontend project generation

When RD work creates a frontend application and the user has not specified a technology stack, and the current scan plus existing project standards still do not establish a frontend stack, default to React + Vite + shadcn/ui with:

- `pnpm dlx shadcn@latest init --preset [CODE] --template vite`

`[CODE]` is the preset code supplied by the shadcn registry or user workflow; if it is unknown, stop and resolve the intended preset before scaffolding.

If the user specifies a frontend stack or scaffold command, use the specified technology. If the scaffold emits JavaScript, convert generated application files to TypeScript before continuing; if conversion is not practical, ask for a TypeScript-compatible scaffold.

Application projects generated through this skill must not contain JavaScript source or config files. Generate TypeScript only (`.ts`, `.tsx`, and TypeScript config equivalents), including when adapting examples from libraries or templates.

## Artifact and standards output

When project identification or scanning produces reports, matrices, maps, plans, or validation files, write them under the configured Peaks artifact workspace outside the target repository, not the repository root. If the artifact workspace is unknown, stop and resolve it before writing generated outputs. Use one session directory inside that workspace consistently so generated outputs stay grouped.

When project-local `CLAUDE.md` or project-local `.claude/rules/**` is created or updated, route the mutation through `peaks standards init` or `peaks standards update`; do not hand-write standards mutations. Derive the content from the current scan results and existing project standards. Keep only the rules that match the project's languages, frameworks, tooling, and repository layout. Do not emit generic templates, copy-pasted boilerplate, or rules unrelated to the current scan evidence. Do not update user-global `~/.claude/rules/**` from this workflow.

If the scan results are insufficient to justify a rule, leave it out or surface a review-only suggestion instead of writing it into project standards.

## Compact handoff

Before RD work stops, finishes, blocks, or hands off to another role, emit a short resumable capsule: mode, scope, coverage status, validated decisions, current slice, artifact paths, blockers, and next action. Link to scan reports, matrices, plans, and task graphs instead of restating them.

## External capability guidance

Use `peaks capabilities --source access-repo --json` and `peaks capabilities --source mcp-server --json` as the source of truth before recommending external resources.

- Context7 can support current library/API documentation lookup when the map says it is available or the user authorizes MCP access.
- SearchCode can support external code discovery only after confirming the query will not expose secrets or private code.
- everything-claude-code, Claude Code Best Practice, mattpocock/skills, and andrej-karpathy-skills are RD guidance or review references; apply project-local conventions first.
- OpenSpec should structure durable spec-first RD changes when available or approved, but Peaks PRD/RD/QA gates remain authoritative.
- GitNexus remains a future proxied repository-intelligence boundary; do not install or run it directly.

## Boundaries

Do not bypass PRD/QA artifacts. Do not install hooks, agents, MCP, or settings. Ask the Peaks CLI to handle runtime side effects.

Reference: `references/refactor-workflow.md`.
