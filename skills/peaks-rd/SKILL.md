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

## External capability guidance

Use `peaks capabilities --source access-repo --json` and `peaks capabilities --source mcp-server --json` as the source of truth before recommending external resources.

- Context7 can support current library/API documentation lookup when the map says it is available or the user authorizes MCP access.
- SearchCode can support external code discovery only after confirming the query will not expose secrets or private code.
- everything-claude-code, Claude Code Best Practice, mattpocock/skills, and andrej-karpathy-skills are RD guidance or review references; apply project-local conventions first.
- OpenSpec can shape spec-first RD artifacts, but Peaks PRD/RD/QA gates remain authoritative.
- GitNexus remains a future proxied repository-intelligence boundary; do not install or run it directly.

## Boundaries

Do not bypass PRD/QA artifacts. Do not install hooks, agents, MCP, or settings. Ask the Peaks CLI to handle runtime side effects.

Reference: `references/refactor-workflow.md`.
