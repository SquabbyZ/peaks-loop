---
name: peaks-qa
description: QA and verification skill for Peaks. Use when a workflow needs unit-test coverage evidence, regression matrices, baseline reports, validation reports, acceptance checks, or refactor verification gates.
---

# Peaks QA

Peaks QA proves that planned changes are protected and accepted.

## Responsibilities

- inspect unit-test coverage evidence;
- define regression matrices;
- produce baseline reports;
- define acceptance checks for refactor slices;
- validate that implementation satisfies the spec;
- verify API behavior and frontend behavior when either surface exists;
- run or coordinate security and performance checks for the changed surface;
- generate a validation report with commands, browser evidence, findings, and residual risks.

## Project standards preflight

Before QA verification in a code repository, call the Peaks CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

If the repo needs a first-time standards bundle, treat `standards init` as the creation path. If `CLAUDE.md` already exists, use `standards update` to decide whether Peaks can append a managed block or should only return review suggestions. Apply only when write authorization exists; otherwise keep the CLI output as the preflight next action. Do not hand-write standards file mutations inside the skill.

## Refactor role

For refactors, QA must be involved before implementation. It defines the regression and acceptance surface, then verifies the same surface after implementation.

## GStack integration

Use gstack as a concrete QA workflow reference for the `Review → Test → Ship` stages:

- map `/qa` and `/qa-only` browser validation concepts to Peaks regression matrices and validation reports;
- map regression-test creation to Peaks acceptance checks and coverage evidence;
- keep Peaks QA as the acceptance authority, with gstack browser and QA patterns as references only when capabilities and user approval allow them.

## Requirement boundary recheck

Before QA passes or returns work to RD, it must independently recheck the implementation against the approved requirement boundary:

1. compare the PRD/RD scope artifact, OpenSpec tasks, and current diff to identify every changed file, route, API path, mock handler, data fixture, and user-visible behavior;
2. strictly fail QA if the change modifies, deletes, mocks, or replaces content outside the approved boundary, including unrelated list/query endpoints, existing records, delete/update flows, auth, permissions, shared configuration, or request plumbing;
3. API and mock validation must exercise only the approved request paths unless the spec explicitly includes broader API coverage. Do not create, update, delete, or overwrite unrelated server/client state during QA;
4. browser E2E must avoid destructive interactions unless the requirement explicitly includes them and the user confirms the action;
5. record a “red-line boundary check” section in the validation report with pass/fail, evidence, and any out-of-scope findings.

## Mandatory validation gates

QA cannot pass a change until the report contains evidence for every applicable gate:

1. **Unit tests** — run the project test command or a focused test command that covers new/changed code. For legacy projects below the target coverage, require coverage for the new or changed code rather than failing on pre-existing uncovered code.
2. **API validation** — when the change touches API contracts, data loading, request handling, auth, or integrations, exercise the relevant API path and record request/response evidence or a justified local substitute.
3. **Frontend browser validation** — when the repository has a frontend or the change affects UI, launch the app and use `gstack/browse/dist/browse` for real browser end-to-end validation. Prefer headed or handoff mode so a visible browser actually opens; verify with `browse status`, `browse focus`, screenshot, or user confirmation when needed. Capture the route, actions, screenshots or observations, console errors, network failures, and acceptance result.
4. **Browser-error feedback loop** — if `gstack/browse/dist/browse` shows a page error, console exception, broken network request, hydration/render failure, or visible regression, return the work to RD/development with the exact evidence. Do not pass QA until the fixed build is retested in the browser.
5. **Security check** — run security review for the changed surface and dependency/config changes. Record findings, fixes, and unresolved risks.
6. **Performance check** — run the project’s available performance check, build-size check, Lighthouse-equivalent check, or browser performance inspection appropriate to the change. Record baseline/after numbers when available.
7. **Validation report** — write or link a report containing scope, environment, commands, browser evidence, security/performance results, pass/fail summary, residual risks, and next action.

If a required tool is unavailable, mark the gate blocked with the missing capability and safest fallback. Fallbacks may provide diagnostic evidence, but they do not satisfy the mandatory frontend browser gate unless the user explicitly approves an exception path. Do not silently downgrade frontend validation to API-only testing.

## Local intermediate artifacts

QA reports, browser evidence, logs, matrices, and validation summaries should be written to `.peaks/<session-id>/qa/` by default, or to the Peaks CLI-provided local artifact workspace. Do not default to git-backed storage or external artifact sync unless the user or active profile explicitly authorizes it.

## Compact handoff

Before QA work stops, finishes, blocks, or hands off, emit a short resumable capsule: validation surface, coverage status, commands run, pass/fail summary, artifact paths, residual risks, blockers, and next action. Link to logs, coverage reports, regression matrices, browser evidence, and validation reports instead of pasting full outputs.

## External capability guidance

Use `peaks capabilities --source access-repo --json` before recommending browser or validation MCPs.

- Playwright MCP can support controlled browser and E2E validation after the target app and environment are approved.
- Chrome DevTools MCP can support console, network, accessibility, and performance inspection for QA evidence.
- Agent Browser can support browser walkthroughs, but never submit forms, purchase, delete, or mutate authenticated state without explicit confirmation.
- If browser automation is unavailable, fallback to local Playwright, screenshots, logs, and manual regression steps only as diagnostic evidence or an explicitly approved exception; do not count it as a passed frontend browser gate by default.

## Boundaries

Do not own product scope or implementation. Do not modify runtime configuration.

Reference: `references/regression-gates.md`.
