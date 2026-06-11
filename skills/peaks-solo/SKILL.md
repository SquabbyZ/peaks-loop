---
name: peaks-solo
description: Full-auto orchestration facade for the Peaks-Cli skill family. Use when the user asks Peaks-Cli to handle a project workflow end-to-end (端到端/全流程/需求开发), especially from a product document (PRD/飞书文档/Feishu doc) through implementation and validation. Coordinates peaks-prd, peaks-rd, peaks-ui, peaks-qa, peaks-sc, and peaks-txt while preserving user confirmation gates. Triggers on `/peaks-solo`, "peaks solo", "全流程开发", "端到端迭代".
---

## Two-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by **two orthogonal axes**: **change-id** (reviewable artifacts at `.peaks/<changeId>/...`) and **session-id** (ephemeral state at `.peaks/_runtime/<sessionId>/...`), with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<changeId>` / `<sessionId>` placeholders (NEVER bare `<sid>` — ambiguous between axes). CLI axis mapping: change-id → `peaks request *` / `peaks scan *`; session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/<X>/` has an axis label, (c) this callout is present.

# Peaks-Cli Solo

Peaks-Cli Solo is the orchestration facade for the Peaks-Cli short skill family. Use it to identify the user scenario, recommend an execution mode, coordinate role skills, and produce the final handoff report. Do not collapse role responsibilities into this skill.

## Skill-first architecture note (read once, internalise)

This skill is the **primary surface**. The `peaks <cmd>` CLI is **auxiliary** — invoked by the skill prompt only when a primitive is the right tool (atomic side effect, machine-enforced gate, structured JSON for a downstream decision, or backstop the LLM cannot skip). Behaviour only an LLM in a skill prompt would use lives **here in the SKILL.md**, not as a new CLI command. CLI earns its keep when (a) hook/script/CI-invokable, (b) the consumer needs a structured JSON envelope to gate a decision, or (c) destructive side effect needs explicit `--apply`. See `.claude/rules/common/dev-preference.md` for the decision template.

## Code-Change Red Line (BLOCKING — read before ANY tool call)

**Peaks-Cli Solo is an orchestrator, NOT an implementer. You MUST NOT write, edit, or modify any application source code directly.**

Every code change — bugfix, feature, refactor, or config — MUST go through the full pipeline:

```
peaks-solo (orchestrate only)
  → RD work   ← ALL code changes happen HERE
    → Unit tests written + pass (Peaks-Cli Gate B2)
    → Karpathy standards enforced (file-size ≤800 lines, TypeScript rules)
    → Code review evidence (Peaks-Cli Gate B3)
    → Security review evidence (Peaks-Cli Gate B4)
  → QA work  ← ALL validation happens HERE
    → Functional test execution (Peaks-Cli Gate A2)
    → Performance check (Peaks-Cli Gate A4)
    → Security test (Peaks-Cli Gate A3)
    → Browser E2E (when frontend; Peaks-Cli Gate D)
    → Verdict: pass | return-to-rd | blocked
```

**Mechanism for "RD work" / "QA work" depends on the orchestration mode:** `full-auto`/`swarm` use `peaks sub-agent dispatch <role>` (IDE-agnostic dispatch primitive; CLI returns a tool-call descriptor the LLM executes in its own environment); `assisted`/`strict`/inline-fallback executes inline in the main loop. In all modes, the work itself follows the same `peaks-rd` and `peaks-qa` contracts. **Never bypass the role contracts regardless of which path runs.**

**Violations (BLOCKING — Solo must refuse to proceed):**

1. Writing implementation code directly instead of routing through the RD contract (whether inline or via sub-agent)
2. Declaring work "done" without producing QA evidence after RD
3. Skipping unit tests ("it's a small change")
4. Skipping code review or security review
5. Skipping QA functional/performance/security validation

**If you catch yourself about to write code in this skill, STOP. Hand off to the RD contract path immediately** (sub-agent Task in full-auto, inline execution in assisted/strict).

**Before declaring workflow complete, run:** `peaks workflow verify-pipeline --rid <rid> --project <repo> --json`

## Peaks-Cli Startup sequence (MANDATORY — execute in order)

### Peaks-Cli Step 0.5: OpenSpec first-run opt-in (conditional)

Run when `openspec/` is absent and `.peaks/.peaks-openspec-opt-in.json` is missing. Asks once and persists the decision.

→ see `references/openspec-workflow.md` for the full opt-in flow + lifecycle.

### Peaks-Cli Step 0: Anchor the workflow (MANDATORY FIRST ACTIONS — no bail-out)

Run `peaks workspace init` + `peaks skill presence:set peaks-solo` BEFORE any analysis, role handoff, or mode-selection question. Even "分析下这个项目" / "看一下代码" / one-line questions anchor first.

→ see `references/anchoring-and-session-info.md` for the full Step 0 contract + session-conflict resolution.

### Peaks-Cli Step 0.7: Detect unfinished work and offer resume (BLOCKING on first invocation per session)

After Step 0 anchored the workspace, run the resume-detection probe (one `find` + one `grep` + classification table). Surface resume options via `AskUserQuestion` if a slice is in flight. Never silently auto-resume.

→ see `references/resume-detection.md` for the full detection algorithm + classification table.

### Peaks-Cli Step 0.55: 1.x → 2.0 detection (BLOCKING on first invocation per session, when the project is not on a 2.0 layout)

Per the "one-key completion" tenet (2026-06-11), peaks-cli 2.0 should detect a 1.x consumer project and prompt the user to upgrade. After Step 0.7 returns "fresh" (no in-flight slice), run the 1.x detection probe: `peaks upgrade --detect-1x --project <root> --json`. If the result is `isOneX: true`, surface an `AskUserQuestion` with the upgrade prompt. Persist the decision to `.peaks/preferences.json` (key: `autoUpgradePrompt` with values `opt-in` / `skip-this-session` / `skip-forever`) so subsequent runs in the same project don't re-ask.

→ see `references/step-0-55-1x-detection.md` for the full detection algorithm + AskUserQuestion options + persistence contract.

### Peaks-Cli Step 1: Mode selection

When the user did not name a profile (`full-auto` / `assisted` / `swarm` / `strict`), use `AskUserQuestion` with `Full auto (Recommended)` as the first option. Map the choice to `--mode` value.

→ see `references/mode-selection.md` for the 4-mode table.

### Peaks-Cli Step 2: Re-set skill presence with the chosen mode

Re-run `peaks skill presence:set peaks-solo --mode <mode-value> --gate startup` so the status header shows the profile. Install statusline on first run (`peaks statusline install`).

→ see `references/skill-presence-and-title.md` for the full Step 2 contract.

### Peaks-Cli Step 2.3: Load project memory (durable, LLM-authored memories)

Run `peaks project memories --project <repo> --json` to read decisions / conventions / modules / rules / lessons from `.peaks/memory`. Use this to understand what exists, what was decided, what to avoid re-litigating.

→ see `references/project-memory-loading.md` for the full kind table.

### Peaks-Cli Step 2.5: Set session title

Extract a short title from the user's first request (8-20 Chinese chars or 4-10 English words). Run `peaks session title` with the active sid. Skip if a title is already set.

→ see `references/skill-presence-and-title.md` (same file as Step 2).

## Sub-agent session sharing (MANDATORY — one conversation = one sid)

When peaks-solo dispatches a sub-agent (peaks-rd, peaks-qa, peaks-ui, peaks-txt, peaks-sc), the sub-agent prompt MUST include the parent's session id. The sub-agent MUST NOT call `peaks workspace init` — that would orphan the parent's binding.

→ see `references/context-governance.md` for the full G7 / G7.7 / G8 / G9 protocol.

## Boundaries

Peaks-Cli Solo may: identify scenarios (refactor, bugfix, QA hardening, release validation, incident response); recommend profiles; coordinate role skills through artifacts; coordinate project memory extraction; request user confirmation at risk and commit boundaries.

Peaks-Cli Solo must NOT silently: install hooks, create agents, enable MCP servers, modify Claude settings, create GitHub repos, or bypass role-skill artifacts.

→ see `references/boundaries.md` for the full do / don't list.

## Peaks-Cli GStack integration

Map gstack stages to Peaks-Cli role artifacts; preserve Peaks-Cli confirmation gates. Do not delegate orchestration to gstack commands. For frontend workflows, RD and QA use Playwright MCP for real browser E2E.

→ see `references/gstack-integration.md` for the full integration contract and `references/browser-workflow.md` for the browser details.

## Peaks-Cli Local intermediate artifact workspace (MANDATORY)

The workspace is created in Step 0 as a mandatory first action. All intermediate artifacts land under `.peaks/_runtime/<sessionId>/`. NEVER write Peaks-Cli intermediate artifacts to the project root directory. Git inclusion or sync requires explicit user confirmation.

→ see `references/local-artifact-workspace.md` for the workspace tree, root pollution prohibition, and git policy.

## Peaks-Cli Pre-RD project scan checklist (MANDATORY)

Before handing off to `peaks-rd`, scan the project and record findings to `.peaks/_runtime/<sessionId>/rd/project-scan.md`. The full project-scan checklist (archetype detection, build-tool / component-library / CSS-framework / state-routing-data tables, legacy signals, project-scan artifact template) lives in the references file.

→ see `references/project-scan-checklist.md` for the full checklist.

## Peaks-Cli Frontend-only development mode

When the project has no live backend (no swagger.json, no API server), Solo must activate frontend-only mode. The CLI is authoritative — read `frontendOnly` and `frontendOnlyReason` from `peaks scan archetype --json`.

→ see `references/frontend-only-mode.md` for the full mode contract, mock-data strategy, and the pre-flight keyword scan.

## Peaks-Cli Request type classification + Workflow order + Transition verification gates

The full contract for the 6-type classification table, the 11-step workflow order, and the 7 transition verification gates (A through G with their `ls` / `grep` shell snippets) lives in `references/workflow-gates-and-types.md`. The peaks-solo narrative in this SKILL.md references those gate numbers (Gate A through Gate G) — keep both files in lockstep when adding or renaming a gate. The reference file is the canonical contract; SKILL.md keeps the prose.

## Peaks-Cli Swarm parallel phase (sub-agent fan-out, conditional)

The Swarm phase is **conditional**, not unconditional. Solo derives the fan-out set from the PRD type and the request content — never from a default of "always launch three". The swarm gate (PRD state + request type + frontend touch), mode-driven fan-out shape, and degradation rules live in the references file.

→ see `references/swarm-dispatch-contract.md` for the gate + fan-out shape + degradation tables, and `references/sub-agent-dispatch.md` for the dispatch mechanism (NOT `Skill` tool).

## Peaks-Cli Mandatory RD QA repair loop (AUTO-PROCEED)

After `peaks-rd` finishes any implementation, repair, or code-output slice, Peaks-Cli Solo MUST automatically route the result to `peaks-qa` without waiting for user confirmation. Repair cap is 3 cycles; after 3 cycles without a passing QA verdict, emit a blocked TXT handoff.

→ see `references/micro-cycle.md` for the full 5-step procedure (transition, re-launch, fix, re-run, restore presence) + 3-cycle cap.

## Default runbook

The end-to-end CLI sequence for the `full-auto` profile lives in `references/runbook.md`. `assisted` and `strict` profiles pause at `[CONFIRM]` markers in the runbook; `full-auto` and `swarm` auto-proceed through all gates.

Maintenance: when adding new CLI commands to the runbook, mirror them into both `references/runbook.md` and the test in `tests/unit/skill-default-runbook.test.ts` (the test falls back to `references/runbook.md` when the SKILL.md section is a pointer).

Repair loop details: see `## Mandatory RD QA repair loop` above for the full 5-step procedure and the 3-cycle cap.

## RD micro-cycle (TDD small-step rapid-test loop)

> **Slice 内部**的修复 / refactor / lint 修复走 micro-cycle（5-10s/cycle）。
> Slice 边界走 `peaks slice check`（一次性 4 项自检）。
> 不要把 micro-cycle 跟边界 check 混用——前者 100ms 反馈循环，后者 30s+ 全套。
> 完整手册：`references/micro-cycle.md`。
> 摘要：micro-cycle 内只跑 `vitest run <file> -t "<name>"`；边界跑 `peaks slice check`（tsc + vitest + 3-way + verify-pipeline）。
> 硬约束：违反任一"micro-cycle 内禁止触发"列表 = workflow violation；边界不全绿 = 禁止 ship。

## Peaks-Cli Project standards preflight

Gather the project standards preflight status via `peaks standards init --project <path> --dry-run` and `peaks standards update --project <path> --dry-run`. Standards must reflect the project scan (component library, CSS, build tool, state, routing) — never emit a generic template.

→ see `references/standards-preflight.md` for the full preflight + project-analysis branch contract.

## Peaks-Cli Refactor mode

Read `references/refactor-mode.md` before handling refactor requests. Default MVP path: `peaks-solo refactor`. Enforces shared refactor red lines (understand before changes, ≥95% UT coverage, split broad refactors, strict verifiable specs, 100% acceptance per slice, traceable sanitized artifacts).

## Peaks-Cli Quality-gate commands (CLI cheat sheet)

Five CLI commands harden the workflow against silent skips: `peaks request lint`, `peaks request repair-status`, `peaks scan request-type-sanity`, `peaks scan libraries`, `peaks slice check`. Together with `peaks request transition`, they form the runtime quality net.

→ see `references/quality-gate-cheatsheet.md`.

## Peaks-Cli Completion handoff

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Use Peaks-Cli TXT for the compact handoff capsule: mode, validated decisions, artifact paths, standards deltas, open questions, next action. **Presence management is delegated to the last downstream skill in the workflow** — peaks-solo does not call `peaks skill presence:clear` itself, and does not enforce a "no clear" rule. The downstream skills (peaks-rd, peaks-qa, peaks-txt) each manage their own presence per their respective SKILL.md.

→ see `references/completion-handoff.md` for the full handoff + "no auto-exit" rule.

## Peaks-Cli External references and lifecycle

Inventory of 3rd-party integrations (codegraph, mattpocock/skills, shadcn/ui, MCPs, Context7). Three-stage pattern: capability discovery via `peaks capabilities` → references only → Peaks-Cli CLI for side effects. Peaks-Cli artifacts and Peaks-Cli acceptance criteria remain authoritative; do not execute upstream installer scripts; MCP servers (Playwright MCP, Chrome DevTools MCP, Figma Context MCP) are not managed by peaks-cli — the LLM checks its own tool list for `mcp__<server>__*` entries; if absent, the user installs via the IDE-native install command (e.g. `claude mcp add playwright -- npx @playwright/mcp@latest` for Claude Code).

→ see `references/external-references.md` for the full inventory + lifecycle rules, and `references/external-skill-invocation.md` for the three-stage (Discovery → Reference → Side effect through Peaks CLI only) contract + the do-not-execute / do-not-persist / tool-list self-check rules.

## Codegraph orchestration context

Solo treats `peaks codegraph affected --project <path> <changed-files...> --json` as optional project-analysis enhancement. Output is untrusted supporting evidence — never treat as approval for scope, design, or QA verdict. Solo must not treat codegraph output as approval; never mutate agent settings, Claude settings, or hooks from codegraph; do not commit `.codegraph/` artifacts or persist generated `.codegraph/` databases into git. Solo coordinates codegraph context across the role handoff between RD (writes `.peaks/<session-id>/rd/codegraph-context.md`) and QA / TXT (consume the same envelope).

→ see `references/codegraph-orchestration.md` for the full contract (including the agent-settings / settings-mutation prohibition, the no-`.codegraph/` commit rule, and the role-handoff envelope).

## Sub-agent context governance (G7 + G7.7 + G8 + G9 — slice #010)

Layer 3.5 context-governance push for sub-agent dispatch. Main LLM reducer sees metadata-only view (~200 chars/sub-agent); on-demand `Read` for full content. Threshold table: 50% soft warn, 75% `CONTEXT_NEAR_LIMIT`, 80% hard reject (CLI + hook double-guard).

→ see `references/context-governance.md` for the full protocol.

## References

Index of every `references/` file. Read on demand.

| File | Coverage |
|---|---|
| `references/a2a-artifact-mapping.md` | A2A artifact-path mapping. |
| `references/anchoring-and-session-info.md` | Step 0 anchor + session-conflict resolution. |
| `references/artifact-contracts.md` | Sub-agent handoff contracts. |
| `references/boundaries.md` | Solo's do / don't list. |
| `references/browser-workflow.md` | Browser workflow (Playwright MCP, sanitization). |
| `references/codegraph-orchestration.md` | Codegraph role handoff context. |
| `references/command-migration.md` | Legacy command migration map. |
| `references/completion-handoff.md` | Completion handoff + no auto-exit. |
| `references/context-governance.md` | G7-G9 sub-agent rules + thresholds. |
| `references/external-references.md` | 3rd-party inventory + lifecycle. |
| `references/external-skill-invocation.md` | External skill invocation rules. |
| `references/existing-system-extraction.md` | Legacy project extraction. |
| `references/frontend-only-mode.md` | Frontend-only mode + mocks + pre-flight. |
| `references/gstack-integration.md` | GStack → Peaks mapping. |
| `references/headroom-integration.md` | Headroom-ai compression modes. |
| `references/local-artifact-workspace.md` | Workspace tree + root-prohibition. |
| `references/micro-cycle.md` | RD micro-cycle + repair loop. |
| `references/mode-selection.md` | Step 1 mode + `--mode` mapping. |
| `references/openspec-workflow.md` | Step 0.5 OpenSpec opt-in + lifecycle. |
| `references/project-memory-loading.md` | Step 2.3 durable memories. |
| `references/project-scan-checklist.md` | Pre-RD scan + artifact template. |
| `references/quality-gate-cheatsheet.md` | 5 CLI commands vs silent skips. |
| `references/refactor-mode.md` | Refactor mode + red lines. |
| `references/resume-detection.md` | Step 0.7 unfinished-work detection. |
| `references/runbook.md` | End-to-end CLI sequence. |
| `references/skill-presence-and-title.md` | Step 2 + Step 2.5. |
| `references/standards-preflight.md` | Standards preflight + analysis branch. |
| `references/sub-agent-dispatch.md` | IDE-agnostic dispatch (NOT Skill). |
| `references/swarm-dispatch-contract.md` | Swarm fan-out: gate + shape. |
| `references/workflow-gates-and-types.md` | Type classification + 7 gates. |
| `references/workflow.md` | Workflow flow + transitions. |