---
name: peaks-rd
description: Research and development skill for Peaks. Use for engineering analysis, refactor planning, project scanning, code standards, unit-test coverage gates, implementation contracts, task graphs, and RD handoffs. Always use this for Peaks-Cli refactor workflows.
---

## Two-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by **two orthogonal axes**: **change-id** (reviewable artifacts at `.peaks/<changeId>/...`) and **session-id** (ephemeral state at `.peaks/_runtime/<sessionId>/...`), with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<changeId>` / `<sessionId>` placeholders (NEVER bare `<sid>`). CLI axis mapping: change-id → `peaks request *` / `peaks scan *`; session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/<X>/` has an axis label, (c) this callout is present.

# Peaks-Cli RD

Peaks-Cli RD owns engineering analysis, implementation planning, and refactor execution contracts.

## Hard contracts for browser self-test (BLOCKING — read before any browser_take_screenshot / login flow)

For frontend / UI-affecting slices, RD's self-test uses the Playwright MCP headed browser. LLM checks its own tool list for the Playwright MCP entry; if absent, surface the install command (`claude mcp add playwright -- npx @playwright/mcp@latest`) and report the gate blocked. Do not silently downgrade to screenshots-only, manual steps, or chrome-devtools-mcp. Two contracts: (1) self-test screenshots land under `.peaks/_runtime/<sessionId>/qa/screenshots/`, (2) login / CAPTCHA / SSO / MFA is a hard block — surface with `AskUserQuestion`. Same in spirit as `peaks-qa`'s; RD and QA share the headed-browser path.

→ see `references/browser-self-test-contracts.md`.

## Sub-agent dispatch (when launched by peaks-solo swarm)

When this skill is launched as a sub-agent via `peaks sub-agent dispatch <role>` (then the LLM executes the returned toolCall) from `peaks-solo`, the following sections of THIS skill are **suspended** for the sub-agent run: Session id (use parent's), Skill presence (do NOT call `peaks skill presence:set peaks-rd`), Workspace initialization (already done by Solo), Mode selection, Statusline install.

What the sub-agent MUST still do: read PRD via `peaks request show`, run standards preflight (dry-run only), write planning artefact (`rd/tech-doc.md` for feature/refactor; `rd/bug-analysis.md` for bugfix; skip for config/docs/chore), return compact JSON envelope.

→ see `references/rd-sub-agent-dispatch.md` for the full contract + hard prohibitions.

## Skill presence (MANDATORY first action — main-loop context only)

When this skill is running in the main Claude session (not as a sub-agent — i.e. user invoked `peaks-rd` directly, or `peaks-solo` is executing the role inline in assisted/strict mode), before any analysis or tool call, immediately run `peaks skill presence:set peaks-rd --project <repo> --mode <mode> --gate startup`. Install statusline on first run. Read durable project memory via `peaks project memories --project <repo> --json`.

→ see `references/skill-presence-and-title.md` for the full contract.

## Responsibilities

- scan the current project before changes;
- prefer existing project standards over built-in language standards;
- enforce the 95% UT coverage refactor gate;
- split broad refactors by minimal functional slices;
- generate refactor options, risk matrix, rollback plan, and task graph preview;
- implement only after strict specs and confirmations exist.

## Mandatory per-request artifact

Every RD invocation — feature, bug, refactor, clarification — must write a durable artifact at `.peaks/<session-id>/rd/requests/<request-id>.md` (the canonical placeholder form: `<session-id>` is the active session id at runtime, `<request-id>` follows the `YYYY-MM-DD-<kebab-slug>` format; the runtime path is `.peaks/_runtime/<session-id>/rd/requests/<request-id>.md`). This is the canonical engineering record for that request; handoff to QA/SC is blocked while the artifact is missing or its state is `draft` or `spec-locked` without implementation evidence. Codegraph context lives at `.peaks/<session-id>/rd/codegraph-context.md`.

→ see `references/artifact-per-request.md` for the template + the "two RD artifact files" rule (per-slice vs per-session scope).

## Default runbook

See `references/rd-runbook.md` for the full 9-step runbook (steps #0–#8) with every CLI invocation, project-scan BLOCKING rule, component-library detection, CSS framework conflict check, and 6 transition gates.

## RD gate index

You cannot declare a phase complete from memory. Each gate below is a `ls` or `grep` command you **MUST run** and whose output you **MUST see** before proceeding. CLI enforcement: the gates are ALSO enforced by `peaks request transition`, which fails with `code: PREREQUISITES_MISSING` if any are absent. Per-type required files: see the table at the top of `references/rd-transition-gates.md`.

Gate index: A (project-scan), A2 (tech-doc path verification), A3 (CLAUDE.md + .claude/rules), B (tech-doc + request artifact), B2 (unit tests on changed surface), B3 (code-review.md), B4 (security-review.md), B5 (lint — no unfilled placeholders), B6 (request-type-sanity), B7 (repair-status — 3-cycle cap), B8 (diff-vs-scope), B9 (perf-baseline).

→ see `references/rd-transition-gates.md` for the full per-gate contract + `ls` / `grep` shell snippets.

## Project standards preflight

Before RD planning or implementation work in a code repository, call `peaks standards init --project <path> --dry-run` and `peaks standards update --project <path> --dry-run`. If `CLAUDE.md` is missing, treat creation as the preferred path. Apply only when write authorization exists; otherwise keep the CLI output as a preflight next action.

→ see `references/rd-standards-preflight.md` for the full preflight contract.

## Library version awareness (3rd-party breaking-change gate)

After `peaks scan libraries` lands the dependency list under `## Library versions` in `rd/project-scan.md`, RD MUST cross-check the slice's diff against `schemas/library-breaking-changes.data.json` before writing any 3rd-party API call. On a hit, warn in the handoff + persist a `lesson` memory. Check `schemas/library-breaking-changes.meta.json` for freshness before reading the data.

→ see `references/library-version-awareness.md` for the full 4-step process + data-freshness check.

## GStack integration and code dry-runs

Map gstack stages to Peaks-Cli RD risk matrices, task graphs, and slice contracts. Adapt gstack concepts into Peaks-Cli artifacts rather than invoking gstack commands as runtime dependencies. Dry-run repeatedly: before planning, after each implementation slice, after tests/CR/security, before handoff.

→ see `references/rd-gstack-integration.md` for the full integration contract.

## Requirement boundary red-line self-check

Before every code or mock change, RD must write and then enforce a red-line scope check in the RD artifact:

1. name the exact product requirement, route, UI surface, API path, data model, and path/glob patterns that are in scope (write under `## Red-line scope` with `In-scope:` / `Out-of-scope:` subheaders);
2. name adjacent surfaces explicitly out of scope (list pages, delete/update flows, unrelated API endpoints, existing data records, auth, permissions, shared runtime config);
3. reject any implementation that modifies, deletes, mocks, or replaces out-of-scope behavior just to make validation pass;
4. for API/mock work, mock only the exact request path and method required by the approved slice;
5. before handoff, run `peaks scan diff-vs-scope --rid <rid> --project <repo>` (Peaks-Cli Gate B8). The CLI auto-allows test files and `.peaks/` artifacts.

## Mandatory tech-doc output (RD-side)

**BLOCKING — Do not hand off to QA without this file.** Every RD invocation that touches code MUST produce a tech-doc artifact at `.peaks/_runtime/<sessionId>/rd/tech-doc.md`. If this file is missing at QA handoff, the handoff is invalid.

→ see `references/mandatory-tech-doc.md` for the minimum sections (architecture / component / data flow / CSS / API / dependencies) + CSS framework change rules.

## Mandatory perf-baseline output (RD-side perf gate)

**BLOCKING — Do not hand off to QA without a perf-baseline file when the slice has a user-visible performance surface.** The QA stage's Gate A4 (performance check) needs a stable reference to diff against; without an RD-side baseline, the first time Gate A4 runs it has nothing to compare against. **Slice 025**: the perf baseline is stable across slices within a session and is refreshed on trigger; use `peaks workflow plan refresh perf --apply` for refreshes.

→ see `references/mandatory-perf-baseline.md` for the full "when this applies" + `peaks perf baseline --apply` workflow + slice-025 refresh contract.

## Implementation completion gates

RD cannot mark a development slice complete until all of these are true. Each gate below maps to a hard verification gate in the Transition Verification Gates section — run the corresponding command, see the output. The gates (0, 0.5, 0.6, 1, 2, 3, 4, 5, 6, 6.5, 7, 8, 9, 10, 11, 12) are listed in `references/rd-runbook.md` §7.

If any gate fails, return to development for fixes or hand off as blocked. Do not describe the work as done, shippable, or ready for QA.

## Parallel review fan-out (code-reviewer + security-reviewer + perf-baseline-reviewer + qa-test-cases-writer)

**When RD reaches the end of implementation, the four review activities run in parallel via `peaks sub-agent dispatch <role>`, not sequentially.** This is the same fan-out pattern peaks-solo uses for the post-PRD swarm. The four sub-agents are `code-reviewer` (code-review evidence), `security-reviewer` (security-review evidence), `perf-baseline-reviewer` (perf-baseline measurement), and `qa-test-cases-writer` (qa/test-cases/<rid>.md). Feature / refactor: all four. Bugfix: code-reviewer + security-reviewer + qa-test-cases-writer always; perf-baseline-reviewer only when perf-shaped. Config / docs / chore: no fan-out. B3 augmentation: ocr soft-optional → `peaks code-review run-ocr --json` → merge into `code-review.md`; → `references/ocr-integration.md`.

### Peaks-Cli Gate C — type-specific RD evidence

The CLI gate at `rd:qa-handoff` is the authoritative check. Missing any required file → DO NOT attempt the qa-handoff transition; CLI will reject with `PREREQUISITES_MISSING`.

| Request type | Required RD evidence (under `.peaks/<id>/`) |
|---|---|
| feature / refactor | `rd/tech-doc.md` + `rd/code-review.md` + `rd/security-review.md` + `rd/perf-baseline.md` + `qa/test-cases/<rid>.md` |
| bugfix | `rd/bug-analysis.md` + `rd/code-review.md` + `rd/security-review.md` + `qa/test-cases/<rid>.md` (rd/perf-baseline.md only when perf-shaped) |
| config | `rd/security-review.md` |
| docs / chore | (no extra evidence required) |

→ see `references/rd-fanout-contracts.md` for the 4 sub-agents' contracts + hard prohibitions + aggregation + degradation.

## Refactor hard gates

If a request is refactor, cleanup, architecture adjustment, module split, or technical debt work: scan project structure and existing standards; locate or run UT coverage; block implementation unless coverage is >= 95%; treat missing, unknown, or unverifiable coverage as failing; generate intermediate artifacts before implementation; call or consume peaks-prd and peaks-qa artifacts even in direct RD mode; require strict slice spec before each slice; require 100% acceptance for the slice; require code changes and intermediate artifacts to be traceable in local `.peaks/_runtime/<sessionId>/` storage before continuing.

→ see `references/refactor-workflow.md` for the full workflow + required artifacts list.

## Unit-test coverage red line

The 100% coverage target on testable files is meaningful coverage, not a score to chase. RD must not write coverage-padding tests. Rules: defensive guards for unreachable cases → remove the guard; IO/platform glue that cannot be tested cleanly → add to `coverage.exclude`; real behavior a caller relies on → write a behavior-framed test; if the only way to 100% is a padding test, lower the target or simplify the production code. Test names must describe behavior, not coverage targets. RD slice handoff must record the coverage verdict in the RD request artifact.

## OpenSpec usage

For non-trivial RD changes, use OpenSpec when the project already has `openspec/` or the user approves adding OpenSpec. In repositories that already contain `openspec/`, missing OpenSpec change artifacts are a blocking pre-implementation issue, not an optional suggestion.

Create or update `openspec/changes/<change-id>/proposal.md`, `design.md`, `tasks.md`, and `specs/**/spec.md` before implementation slices begin. If the repository uses a different existing OpenSpec layout, follow that layout and record the file paths in the RD handoff.

OpenSpec artifacts are durable project specification files, not Peaks-Cli runtime swarm artifacts. They may live in the target repository root under `openspec/changes/...`. Swarm/runtime outputs such as task graphs, worker briefs, worker reports, reducer reports, scan reports, validation evidence, and compact handoffs must remain in the configured Peaks-Cli artifact workspace outside the target repository.

Peaks-Cli PRD/RD/QA gates remain authoritative: OpenSpec structures the durable spec, while Peaks-Cli artifacts still carry role handoffs, coverage gates, QA evidence, swarm coordination, and execution state.

→ see `references/openspec-cli.md` for the CLI recipes.

## Mock data placement rules (BLOCKING — framework-aware)

When the project-scan in `.peaks/<changeId>/rd/project-scan.md` identifies a frontend framework, mock data MUST follow the framework's built-in mock mechanism. **Never write mock data inline in component files.**

→ see `references/mock-data-placement.md` for the full framework-to-mock-directory mapping + hard rules + verification gate.

## Frontend project generation

When RD work creates a frontend application and the user has not specified a technology stack, default to React + Vite + shadcn/ui with `peaks shadcn init --preset [CODE] --template vite`. Application projects generated through this skill must not contain JavaScript source or config files. Generate TypeScript only.

→ see `references/frontend-project-generation.md` for the full scaffold protocol.

## Artifact and standards output

When project identification or scanning produces reports, matrices, maps, plans, or validation files, write them under the configured Peaks-Cli artifact workspace (default: `.peaks/_runtime/<sessionId>/rd/`). Do not default to a git-backed artifact repository or external artifact sync. Route standards mutations through `peaks standards init/update`; do not hand-write. Do not update user-global `~/.claude/rules/**` from this workflow.

→ see `references/artifact-and-standards-output.md` for the full contract.

## Compact handoff

Before RD work stops, finishes, blocks, or hands off to another role, emit a short resumable capsule: mode, scope, coverage status, validated decisions, current slice, artifact paths, blockers, and next action. Link to scan reports, matrices, plans, and task graphs instead of restating them.

→ see `references/compact-handoff.md`.

## External references

## Codegraph project analysis

Codegraph is local project-analysis evidence, scoped to red-line scope boundaries (changed files / symbols) and read via `peaks codegraph affected --project <path> <changed-files...> --json`. Peaks-Cli RD gates remain authoritative; codegraph is untrusted supporting evidence. Do not let codegraph output drive scope, design, or QA verdict decisions, and never mutate agent settings, Claude settings, or hooks from codegraph. Do not commit `.codegraph/` artifacts or persist generated `.codegraph/` databases into git. Codegraph context is written to `.peaks/<session-id>/rd/codegraph-context.md` for handoff to QA / TXT.

## Matt Pocock skills integration

Matt Pocock skills (`diagnose` / `triage` / `tdd` / `improve-codebase-architecture` / `prototype`): engineering references only. Inspect before applying; Peaks-Cli RD gates remain authoritative. Understand Anything: `peaks understand status/show --json`. Codegraph: local analysis only, never commit `.codegraph/` artifacts. Other external resources: `peaks capabilities --source access-repo/mcp-server --json` for capability discovery.

→ see `references/external-references.md` + `references/matt-pocock-integration.md` + `references/codegraph-project-analysis.md`.

## Boundaries

Do not bypass PRD/QA artifacts. Do not install hooks, agents, MCP, or settings. Ask the Peaks-Cli CLI to handle runtime side effects.

Do not bypass the parallel review fan-out when the slice has a code-review / security-review / perf-baseline surface — see `## Parallel review fan-out` above. The three review activities are fan-out, not sequential; sequential re-implementation of the same logic by the main RD loop defeats the wall-clock benefit and is treated as a red-line violation.

## Sub-agent context governance (G7 + G7.7 + G8 + G9 — slice #010)

RD sub-agent prompt template MUST include the G7 path convention + G8.6 share protocol. Detailed protocol: `skills/peaks-solo/references/context-governance.md` + `skills/peaks-solo/references/headroom-integration.md`.

→ see `references/rd-context-governance.md` for the full G7 / G8.6 / G9 protocol + RD sub-agent prompt template.

## References

Index of every `references/` file in this skill. Read on demand.

| File | Coverage |
|---|---|
| `references/artifact-and-standards-output.md` | Artifact + standards output contract. |
| `references/artifact-contracts.md` | Sub-agent handoff artifact contracts. |
| `references/artifact-per-request.md` | RD per-request artifact + per-slice vs per-session scope. |
| `references/browser-self-test-contracts.md` | Browser self-test contracts (1) + (2). |
| `references/codegraph-project-analysis.md` | Codegraph local analysis (untrusted evidence). |
| `references/command-migration.md` | Legacy command migration map. |
| `references/compact-handoff.md` | RD compact handoff capsule. |
| `references/external-references.md` | External 3rd-party inventory. |
| `references/frontend-project-generation.md` | React + Vite + shadcn/ui default. |
| `references/library-version-awareness.md` | Breaking-change gate + freshness check. |
| `references/mandatory-perf-baseline.md` | RD-side perf baseline + `peaks perf baseline` workflow. |
| `references/mandatory-tech-doc.md` | RD tech-doc minimum sections + CSS rules. |
| `references/matt-pocock-integration.md` | Matt Pocock skills as references. |
| `references/mock-data-placement.md` | Framework-to-mock-directory mapping + rules. |
| `references/openspec-cli.md` | OpenSpec CLI recipes. |
| `references/parallel-review-fanout.md` | 4-way parallel review fan-out. |
| `references/rd-context-governance.md` | G7 + G8.6 + G9 RD sub-agent protocol. |
| `references/rd-gstack-integration.md` | GStack → Peaks mapping + dry-run cadence. |
| `references/rd-runbook.md` | Default 9-step runbook (steps #0–#8). |
| `references/rd-standards-preflight.md` | Standards preflight dry-run contract. |
| `references/rd-sub-agent-dispatch.md` | Sub-agent suspended sections + contract. |
| `references/rd-transition-gates.md` | Per-gate A-A3-B-B9 contract. |
| `references/refactor-workflow.md` | Refactor hard gates + required artifacts. |
| `references/skill-presence-and-title.md` | RD skill presence (main loop only). |