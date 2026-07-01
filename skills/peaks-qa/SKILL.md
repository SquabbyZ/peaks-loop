---
name: peaks-qa
description: QA and verification skill for Peaks. Use when a workflow needs unit-test coverage evidence, regression matrices, baseline reports, validation reports, acceptance checks, or refactor verification gates.
---

## Single-scope-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by a **single scope axis** (session-id, at `.peaks/_runtime/<sessionId>/...`) with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<sessionId>` placeholders (NEVER bare `<sid>`). The peaks-loop change-id axis was removed in slice `2026-06-29-change-id-root-removal`; reviewable artifacts now live under `.peaks/_runtime/<sessionId>/<role>/...` only. OpenSpec's independent `openspec/changes/<change-id>/` vocabulary (L4) is preserved untouched. CLI mapping: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/_runtime/<X>/` has an axis label, (c) this callout is present.

## peaks-context auto-build (v3.0)

QA workflow automatically runs `peaks context build --audience peaks-qa` before the LLM is invoked. No manual setup needed.

# Peaks-Loop QA

Peaks-Loop QA proves that planned changes are protected and accepted.

## Pre-flight: gateguard-fact-force conflict (BLOCKING — read before any Edit/Write of a `.peaks/**` file)

The `gateguard-fact-force` hook is a **third-party** PreToolUse hook (ECC_GATEGUARD, NOT peaks-loop) that fires on Edit / Write / MultiEdit and demands a 4-fact questionnaire before allowing the edit. When this skill is mid-flow and the LLM edits `.peaks/_runtime/<sessionId>/qa/requests/*.md` (or any other `.peaks/**` file) via the Edit/Write tool, the questionnaire demands facts that **do not apply to QA envelope templates**:

1. `imports/requirers` — none (QA envelopes are not imported by any code)
2. `public functions/classes affected` — none (QA envelopes are not source code)
3. `data files read/written` — none (QA envelopes are pure markdown reports)
4. `user instruction verbatim` — already in the conversation context

The fix must land in the gateguard repo, not peaks-loop. In the meantime:

- **Diagnostic**: `peaks doctor --json` includes a `integration:gateguard-peaks-conflict` check (slice 026). `ok: true` means the hook is absent OR a `.peaks/**` skip pattern is configured; `ok: false` means gateguard is installed without a `.peaks/**` skip.
- **Workaround before any Edit/Write of a `.peaks/**` file**: set `ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force` in the shell, OR `ECC_GATEGUARD=off` to disable the whole gateguard system. The peaks-loop `peaks gate enforce` hook is unaffected by these env vars.
- **CLI bypass**: when the workflow's write path goes through `peaks request init --apply` or `peaks workflow plan read|refresh|detect-trigger` rather than the LLM's Edit tool, the gateguard hook does not fire.

Do NOT debug peaks-loop's `peaks gate enforce` / `peaks hook handle` code when the user reports `[Fact-Forcing Gate]` — those are Bash-only by design (`src/cli/commands/hook-handle.ts:90`). The error is from gateguard, not peaks-loop.

## Hard contracts for browser validation (BLOCKING — read before any browser_take_screenshot / login flow)

These two contracts are non-negotiable. The previous prose-only phrasing let the LLM skip the browser gate entirely when an auth wall appeared, and let screenshots land in the project root because the LLM forgot to pass `filename`. Both fail modes are blocking violations.

**Contract 1 — Screenshot path is mandatory:** every Playwright `browser_take_screenshot` MUST pass `filename` whose absolute path is **inside** `.peaks/_runtime/<sessionId>/qa/screenshots/`. Project-root `.png` is a violation. Enforced by `ls .peaks/_runtime/<session-id>/qa/screenshots/*.png` + `find . -maxdepth 1 -name '*.png'`.

**Contract 2 — Login / CAPTCHA / SSO / MFA is a hard block, not a skip:** surface the wall with `AskUserQuestion` and pick one of three paths (login now / skip browser validation / cancel workflow). Do not infer login completion from DOM state. Do not route through Chrome DevTools MCP as a substitute.

→ see `references/browser-validation-contracts.md` for the full contract + AskUserQuestion options.

## Scope directory (slice 10 — read scopeDir from envelope)

The canonical scope dir for this request is provided as `envelope.data.scopeDir` (absolute path). Write all session-id-scoped files under that path. **NEVER** construct paths like `.peaks/_runtime/<scope>/...` from frontmatter (where `<scope>` is a date-stamped session id, NOT a peaks-loop change-id — the change-id axis was removed in slice `2026-06-29-change-id-root-removal`). The path has already been resolved by the CLI.

## Sub-agent dispatch (when launched by peaks-solo swarm)

When this skill is launched as a sub-agent via `peaks sub-agent dispatch <role>` (then the LLM executes the returned toolCall) from `peaks-solo`, the following sections of THIS skill are **suspended** for the sub-agent run: Session id, Skill presence, Workspace initialization, Mode selection, Statusline install. The sub-agent must NOT call `peaks request init` (Solo already initialised the slot), and must write `.peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md` with test cases that link to PRD acceptance items. Return only a compact JSON envelope.

> **v2.15.0+ 校准:** 每个 slice 完成,user 必介入做**业务审阅**(4-5 项业务/产品清单:业务流程 / 需求覆盖 / 边界 case / UI 装配 / 能合入下版吗),**不是技术审阅**。业务审过 → 进 final;业务不通过 → 返工。详见 `.peaks/memory/peaks-loop-slice-review-and-qa-perspective.md`。

→ see `references/qa-sub-agent-dispatch.md` for the full contract + hard prohibitions.

## Plan/Result split (slice 025)

Project-level security + perf plans live at `.peaks/_runtime/<sessionId>/qa/security-test-plan.md` and `qa/perf-baseline.md`; the per-rid slice result references them by hash. CLI: `peaks workflow plan read|refresh|detect-trigger <security|perf> --project <repo>`. AC1–AC8 from PRD-025.

→ see `references/qa-security-test-plan.md` + `references/qa-perf-test-plan.md` for the full split contract.

## QA fan-out (业务 only — v2.11.0 D1)

When peaks-qa is the **main loop** (i.e. it is the active skill and is about to run its own sub-agent dispatch, rather than being a sub-agent itself), it fans out only the **business verification** sub-agent: `qa-business`. Security and performance review are **NOT** peaks-qa's responsibility in v2.11.0 — they are owned by peaks-rd's 4-way audit fan-out (code-review + security-review + perf-baseline + karpathy-review) and the rd-side evidence files (`rd/security-review.md`, `rd/perf-baseline.md`). peaks-qa reads those files by reference; it does NOT re-do them.

> **v2.15.0+ 校准:** `qa-business` 只跑业务/产品视角的 6 项验收清单(业务流程 / 需求覆盖 / 边界 case / UI 装配 / 异常态语调 / 能上线吗),**不跑技术指标**(覆盖率 / 性能 / 安全)。技术指标由 RD 4-way fan-out 自决,QA 只读 `rd/security-review.md` + `rd/perf-baseline.md`。详见 `.peaks/memory/peaks-loop-slice-review-and-qa-perspective.md`。

If the PRD or project warrants it, subdivide `qa-business` further into roles like `qa-business-api` / `qa-business-frontend` / `qa-business-regression`. Subdivision must stay ≤ 2 levels deep (RL-4).

→ see `references/qa-fanout-contract.md` for the full contract + heartbeat / batch-id / 30s cadence / 100-truncation / 5min stale.

## Skill presence (MANDATORY first action — main-loop context only)

When this skill is running in the main Claude session (not as a sub-agent), before any analysis or tool call, immediately run `peaks skill presence:set peaks-qa --project <repo> --mode <mode> --gate startup`. Install statusline on first run. Read durable project memory via `peaks project memories --project <repo> --json`.

→ see `references/qa-skill-presence.md` for the full contract.

## Responsibilities

- inspect unit-test coverage evidence;
- define regression matrices;
- produce baseline reports;
- define acceptance checks for refactor slices;
- validate that implementation satisfies the spec;
- verify API behavior and frontend behavior when either surface exists;
- generate a validation report with commands, browser evidence, findings, and residual risks.

**Out of scope (v2.11.0 D1/D4):** peaks-qa does **not** own security review or performance review. Those are owned by peaks-rd's audit fan-out (sub-agents `security-review` and `perf-baseline`) and the rd-side evidence files. peaks-qa reads `rd/security-review.md` and `rd/perf-baseline.md` by reference; it does NOT produce `qa/security-findings.md` or `qa/performance-findings.md` of its own.

## Mandatory per-request artifact

Every QA invocation — feature, bug, refactor, clarification — must write **three separate files** (test cases + test report + request artifact) under `.peaks/_runtime/<session-id>/qa/` (canonical placeholder: `.peaks/_runtime/<session-id>/qa/requests/<request-id>.md`; runtime path is `.peaks/_runtime/<session-id>/qa/...`). Do not merge them into one. Each serves a different reader.

The QA test plan is **derived from the RD handoff's YAML frontmatter** (`decisions[]`, `risks[]`, `files[]`, `gateEvidence`). Read frontmatter mechanically before reading body prose; cross-check decisions ↔ tests and risks ↔ security tests. See `references/reading-handoff-frontmatter.md` for the 5 mechanical checks.

External-skill guard: when QA references external material (mattpocock/skills, gstack, superpowers, etc.) it is reference only — do not execute upstream installer, do not persist sensitive upstream examples. Peaks-Loop artifacts and Peaks-Loop acceptance criteria remain authoritative.

→ see `references/artifact-per-request.md` for the 3-file contract and the do-not-execute upstream guard.

## Default runbook

See `references/qa-runbook.md` for the full 10-step runbook (steps #0–#9) with every CLI invocation, the rd-side pre-drafted test-cases optimization, the dev-server lifecycle requirement, the security/performance check discipline, and the 8 quality-gate CLI checks.

## Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare a phase complete from memory. CLI enforcement: the gates below are ALSO enforced by `peaks request transition`, which fails with `code: PREREQUISITES_MISSING` if any are absent. Per-type required files: feature / refactor → test-cases + test-reports + security-findings + performance-findings; bugfix → test-cases + test-reports + security-findings (perf optional); config → security-findings only; docs / chore → none.

Gate index: A (test-cases), A2 (tests executed), A3 (security reference — v2.11.0: read rd/security-review.md), A4 (performance reference — v2.11.0: read rd/perf-baseline.md), B (test-reports with results), C (all 3 QA files present before verdict: test-cases + test-reports + requests — security/perf evidence live under rd/), D (browser screenshots), E (acceptance coverage scan), F (QA artifact lint).

→ see `references/qa-transition-gates.md` for the full per-gate contract + `ls` / `grep` shell snippets.

## Project standards preflight

Before QA verification in a code repository, call `peaks standards init --project <path> --dry-run` and `peaks standards update --project <path> --dry-run`. Apply only when write authorization exists.

→ see `references/qa-standards-preflight.md` for the full preflight contract.

## Refactor role

For refactors, QA must be involved before implementation. It defines the regression and acceptance surface, then verifies the same surface after implementation.

→ see `references/qa-refactor-role.md`.

## GStack integration

Map gstack stages (`Review → Test → Ship`) to Peaks-Loop regression matrices and validation reports. Keep Peaks-Loop QA as the acceptance authority; gstack is reference only.

→ see `references/qa-gstack-integration.md`.

## Requirement boundary recheck

Before QA passes or returns work to RD, it must independently recheck the implementation against the approved requirement boundary: compare PRD/RD/OpenSpec/diff; strictly fail QA if the change modifies out-of-scope surfaces; API/mock validation must exercise only the approved request paths; browser E2E must avoid destructive interactions; record a "red-line boundary check" section in the validation report.

→ see `references/requirement-boundary-recheck.md` for the full 5-step contract.

## Mandatory test-case generation

QA must generate test cases, not merely inspect existing ones. Every QA invocation that validates code changes must produce a test-case artifact at `.peaks/_runtime/<sessionId>/qa/test-cases/<request-id>.md`. Minimum categories: Unit / Integration / UI regression. Each test case MUST have an `**Acceptance:**` field linking to PRD acceptance IDs (A1, A2, ...). The `peaks scan acceptance-coverage` command enforces coverage.

**Pre-drafted test cases (slice 004 optimization):** when peaks-rd's 4-way parallel fan-out ran a `qa-test-cases-writer` sub-agent, the test plan is pre-drafted at `.peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md` and shipped through the rd:qa-handoff gate. QA main loop is aware of this and treats the pre-drafted file as the canonical starting point. **Missing** the pre-drafted file (sub-agent failed, or the slice was a config/docs/chore that did not fan out) → QA drafts it inline as before, falling back to the standard generation flow.

> **v2.15.0+ 校准:** 业务验证层(user 必审) = 4-5 项业务/产品清单。技术验证层(AI 自决) = 覆盖率 / P99 / 安全扫描 / 自动化。两层解耦:技术不过 → AI 内部重跑;业务不过 → user 反馈修。user **不看**技术指标。详见 `.peaks/memory/peaks-loop-slice-review-and-qa-perspective.md` G5。

→ see `references/test-case-generation.md` for the full format + acceptance-linkage contract.

## Mandatory test-report output

Every QA invocation must produce a test-report artifact at `.peaks/_runtime/<sessionId>/qa/test-reports/<request-id>.md` (separate from test-cases + request artifact). Minimum sections: Summary, Test execution results, Coverage evidence, Browser validation, Security findings, Performance findings, Residual risks, Red-line boundary check.

→ see `references/test-report-output.md` for the full minimum-sections contract.

## Mandatory validation gates

QA cannot pass a change until the report contains evidence for every applicable gate. The 9 gates (0 test-case generation, 1 test-report, 2 unit tests, 3 API validation, 4 frontend browser validation, 5 browser-error feedback loop, 8 library version regressions, 9 validation report, 10 acceptance coverage) are mapped to Peaks-Loop Gates A/A2/B/C/D/E/F. **v2.11.0 D1/D4 trim:** Gates A3 (security) and A4 (performance) are no longer peaks-qa's responsibility — security review and performance baseline live under peaks-rd's audit fan-out (rd/security-review.md + rd/perf-baseline.md) and are cited by reference from the test report.

If Playwright MCP is unavailable, the LLM checks its own tool list for the Playwright MCP server entry; if absent, the LLM tells the user the install command (`claude mcp add playwright -- npx @playwright/mcp@latest` for Claude Code) and marks the gate blocked with the missing capability. Screenshots, logs, manual steps, or other tools must not substitute for the mandatory frontend browser gate. Do not silently downgrade frontend validation to API-only testing.

> **v2.15.0+ 校准:** 存量项目无 UT 兜底,QA 验证必须有"轻量回归"(G14):5-10 分钟跑 10 条关键路径(关键路径来源:prd 业务场景块 / 老板强调的流程 / 历史事故 / G13 影响面扫描),**不跑完整 E2E 1-2 小时**。上线后必须走"观察期"(G15):灰度 → 监控 → 反馈聚合 → 紧急修复 → 修复回灌关键路径(防下次再犯)。详见 `.peaks/memory/peaks-loop-fast-iteration-quality-loop.md`。

## Local intermediate artifacts

QA reports, sanitized browser evidence, logs, matrices, and validation summaries should be written to `.peaks/_runtime/<sessionId>/qa/` by default, or to the Peaks-Loop CLI-provided local artifact workspace. Do not store login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs containing PII or SSO/MFA material. Do not default to git-backed storage or external artifact sync.

→ see `references/qa-local-artifacts.md`.

## Compact handoff

Before QA work stops, finishes, blocks, or hands off, emit a short resumable capsule: validation surface, coverage status, commands run, pass/fail summary, artifact paths, residual risks, blockers, and next action. Link to logs, coverage reports, regression matrices, browser evidence, and validation reports instead of pasting full outputs.

→ see `references/qa-compact-handoff.md`.

## Matt Pocock skills integration

When capability discovery exposes `mattpocock/skills`, use `tdd` / `triage` / `grill-with-docs` as QA references only. Inspect upstream content before applying; Peaks-Loop QA acceptance authority remains.

→ see `references/qa-matt-pocock-integration.md` for the full contract.

## Codegraph regression focus

QA may use `peaks codegraph affected --project <path> <changed-files...> --json` as regression-surface evidence. External analysis cannot pass QA by itself — treat output as untrusted supporting evidence. External skill guidance cannot pass QA by itself — treat as supporting evidence, not a verdict. QA reads `.peaks/_runtime/<session-id>/rd/codegraph-context.md` (or `qa/codegraph-context.md`) as input but never mutate agent settings, Claude settings, or hooks from it; QA does not commit `.codegraph/` artifacts or persist generated `.codegraph/` databases into git.

→ see `references/codegraph-regression-focus.md`.

## External capability guidance

Use `peaks capabilities --source access-repo --json` and `--source mcp-server --json` before recommending browser or validation tooling. Playwright MCP is the required path for controlled headed browser and E2E validation. Chrome DevTools MCP is an optional secondary surface for CDP inspection only. Agent Browser can support browser walkthroughs, but never submit forms, purchase, delete, or mutate authenticated state without explicit confirmation.

→ see `references/external-capability-guidance.md` for the full inventory.

## OpenSpec validation gate

When the target repository has `openspec/`, QA must run validation on the change pack before passing or before archiving a shipped change. `data.valid === true` is mandatory. `peaks openspec archive <id> [--apply]` is the optional terminator after QA accepts a shipped change.

→ see `references/openspec-validation-gate.md` for the full contract + `--prefer-external` fallback rules.

## Boundaries

Do not own product scope or implementation. Do not modify runtime configuration. Reference: `references/regression-gates.md`.

## Sub-agent context governance (G7 + G7.7 + G8 + G9 — slice #010)

QA sub-agents (qa / qa-business / qa-perf / qa-security) follow the same G7 metadata-only + G8.6 share protocol as RD. Detailed: `skills/peaks-solo/references/context-governance.md`.

→ see `references/qa-context-governance.md` for the full G7 / G8.6 / G9 protocol + QA sub-agent prompt template.

## References

Index of every `references/` file in this skill. Read on demand.

| File | Coverage |
|---|---|
| `references/artifact-contracts.md` | Sub-agent handoff artifact contracts. |
| `references/artifact-per-request.md` | QA 3-file per-request artifact contract. |
| `references/browser-validation-contracts.md` | Browser contracts (1) + (2) + AskUserQuestion. |
| `references/codegraph-regression-focus.md` | Codegraph regression-surface evidence. |
| `references/command-migration.md` | Legacy command migration map. |
| `references/external-capability-guidance.md` | Playwright / Chrome DevTools / Agent Browser. |
| `references/openspec-validation-gate.md` | OpenSpec validation + archive gate. |
| `references/qa-compact-handoff.md` | QA compact handoff capsule. |
| `references/qa-context-governance.md` | G7 + G8.6 + G9 QA sub-agent protocol. |
| `references/qa-fanout-contract.md` | QA 业务+性能+安全 concurrent fan-out. |
| `references/qa-gstack-integration.md` | GStack → Peaks QA mapping. |
| `references/qa-local-artifacts.md` | `.peaks/_runtime/<sessionId>/qa/` storage. |
| `references/qa-matt-pocock-integration.md` | Matt Pocock skills as references. |
| `references/qa-refactor-role.md` | QA refactor role. |
| `references/qa-runbook.md` | Default 10-step QA runbook. |
| `references/qa-security-test-plan.md` | Slice 025 project-level security test plan. |
| `references/reading-handoff-frontmatter.md` | Mechanical cross-checks for RD handoff frontmatter (decisions↔tests, risks↔security, files↔diff). |
| `references/qa-perf-test-plan.md` | Slice 025 project-level perf baseline. |
| `references/qa-skill-presence.md` | QA skill presence (main loop only). |
| `references/qa-standards-preflight.md` | Standards preflight dry-run contract. |
| `references/qa-sub-agent-dispatch.md` | Sub-agent suspended sections + contract. |
| `references/qa-transition-gates.md` | Per-gate A-A4-B-C-D-E-F contract. |
| `references/regression-gates.md` | Regression gates (preserved). |
| `references/requirement-boundary-recheck.md` | 5-step requirement boundary recheck. |
| `references/test-case-generation.md` | Test case categories + format + acceptance linkage. |
| `references/test-report-output.md` | Test report minimum 8 sections. |