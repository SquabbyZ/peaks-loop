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

## GStack integration

Use gstack as a concrete orchestration reference for the full `Think → Plan → Build → Review → Test → Ship → Reflect` loop:

- map gstack role reviews to Peaks PRD, RD, UI, QA, SC, and TXT artifacts;
- map `/autoplan`-style review pipelines to Peaks mode selection and role handoffs;
- map `/retro` to Peaks TXT final context and reusable lessons;
- preserve Peaks confirmation gates, artifact workspace boundaries, and role separation instead of delegating orchestration to gstack commands.

For frontend workflows, Peaks Solo must ensure QA uses `gstack/browse/dist/browse` for real browser end-to-end validation. Prefer headed or handoff mode when visual/UI behavior matters, and verify that a visible browser actually opened when user login or visual inspection is required. If browser validation reports page, console, network, render, or visible UI errors, route the workflow back to RD for fixes before QA can pass.

## Local intermediate artifact workspace

Peaks Solo should establish or discover a local `.peaks/<session-id>/` workspace before role handoffs. Store PRD/RD/UI/QA/SC/TXT intermediate artifacts there by default, with role subdirectories such as `prd/`, `rd/`, `ui/`, `qa/`, `sc/`, and `txt/`.

Do not default to a git-backed local artifact repository, external artifact sync, or automatic commits for intermediate artifacts. Only include `.peaks` artifacts in git, sync them elsewhere, or create external artifact repositories after explicit user confirmation or an active profile that clearly authorizes it.

## End-to-end code workflow gates

When Peaks Solo coordinates development in a code repository, keep this order explicit:

1. standards preflight;
2. PRD/RD scope and spec artifacts;
3. OpenSpec change artifacts for non-trivial work when `openspec/` already exists or the user approves adding it;
4. RD implementation slices;
5. unit tests for new/changed behavior, with focused new-code coverage accepted for legacy low-coverage repos;
6. code review and security review with CRITICAL/HIGH issues fixed before progression; marked-blocked CRITICAL/HIGH issues only allow a blocked handoff, not QA or completion;
7. RD post-check dry-run;
8. QA validation, including API checks and `gstack/browse/dist/browse` browser E2E for frontend;
9. QA security and performance checks plus validation report;
10. TXT final handoff capsule, including reusable skill-usage lessons when the workflow revealed new habits or preferences.

Do not close the Solo workflow as complete if RD or QA artifacts lack required test, review, security, dry-run, OpenSpec, browser, report, or performance evidence. Do not close a workflow that changed Peaks skill behavior without a `peaks-txt` capsule capturing reusable usage lessons and artifact paths.

## Mode selection

When the user invokes Peaks Solo without explicitly selecting an execution profile, use `AskUserQuestion` before orchestration starts. Present the recommended full-auto path as the first/default option, and give every option a practical description so users can choose quickly.

Offer these profiles unless the active command narrows the valid set:

1. **Full auto (Recommended, Solo profile)** — Peaks handles planning, role coordination, validation, and compact handoff end-to-end while preserving required confirmation gates for risky or shared-state actions.
2. **Assisted** — Peaks proposes plans, artifacts, and checks, then pauses for user decisions at major workflow boundaries.
3. **Swarm** — Peaks maximizes safe parallel role/worker execution for larger RD or QA workloads while keeping reducer validation and artifact boundaries explicit.
4. **Strict** — Peaks uses the most conservative gates: explicit confirmations, strict slice specs, coverage evidence, QA acceptance, and commit boundaries before continuing.

If the user already names a profile, do not ask again unless the request crosses a risk boundary or the named profile conflicts with required Peaks gates.

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
7. require code changes and intermediate artifacts to be traceable in local `.peaks/<session-id>/` storage before the next slice; commit or sync artifacts only when explicitly authorized.

## Completion handoff

After a Peaks Solo workflow reaches final validation, refresh the project-local standards from the current scan-backed evidence before the handoff closes. Route project-local `CLAUDE.md` and project-local `.claude/rules/**` writes through `peaks standards init` or `peaks standards update`; do not hand-write standards mutations. If write authorization exists, apply an incremental merge of scan-backed changes into existing project-local standards. Preserve existing hand-maintained content unless the user explicitly confirms deletion or rewrite. If write authorization or the CLI path is unavailable, keep the standards output as the next action instead of writing it.

Use Peaks TXT for the final, blocked, or interrupted handoff capsule. Keep that capsule compact: current mode, validated decisions, artifact paths, standards deltas, open questions, and next action. Do not restate the full workflow log when a short handoff plus artifact links will do.

## Optional capabilities

When built-in guidance is insufficient, use capability discovery rather than reimplementing specialist workflows. Ask for user consent before token-heavy discovery unless the active profile permits it.

Reference: `references/workflow.md`.
