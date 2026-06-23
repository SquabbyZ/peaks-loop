---
name: peaks-solo
description: Full-auto orchestration facade for the Peaks-Cli skill family. Use when the user asks Peaks-Cli to handle a project workflow end-to-end (端到端/全流程/需求开发), especially from a product document (PRD/飞书文档/Feishu doc) through implementation and validation. Coordinates peaks-prd, peaks-rd, peaks-ui, peaks-qa, peaks-sc, and peaks-txt while preserving user confirmation gates. Triggers on `/peaks-solo`, "peaks solo", "全流程开发", "端到端迭代".
---

## Two-axis naming convention (2.7.1)

> **Read once at the top of this file.**

The `.peaks/` workspace has **two axes**: **change-id** (git-tracked artifacts at `.peaks/<changeId>/<role>/...`) and **session-id** (gitignored state at `.peaks/_runtime/<sessionId>/...`), with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<changeId>` / `<sessionId>` (NEVER bare `<sid>`). CLI axis: change-id → `peaks request *` / `peaks scan *`; session-id → `peaks session *`; sub-agent → `peaks sub-agent *`.

**2.7.1:** `recordBypass` / `isBypassLimitReached` wrote `.peaks/<sid>/...` at root — fixed to `.peaks/_runtime/<sid>/` (`request-commands.ts:410`). `getChangeArtifactRoot` removed. Test `skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) axis labels, (c) this callout.

## Hard ban (effective 2.8.3 — read every session, no exceptions)

Never create `.peaks/<change-id>/` or `.peaks/<YYYY-MM-DD-*>/` at the top level of `.peaks/`. The 2.8.0+ two-axis convention requires ALL change-id / session-id artifacts to live under `.peaks/_runtime/<sessionId>/<role>/...` (gitignored) — never as siblings of `.peaks/_runtime/`. The `peaks workspace init --change-id <id>` flow writes the **binding** to `.peaks/_runtime/current-change` (a plain text file containing the change-id) and embeds the change-id as a filename slug in the reviewable artifacts under `.peaks/_runtime/<sessionId>/<role>/requests/<rid>-<change-id>.md`. Reviewable artifact files still land under `.peaks/<changeId>/<role>/` (created lazily by the writer), but that dir is git-tracked and lives UNDER `.peaks/_runtime/`, not at top level. If you find yourself about to write a date-prefixed directory directly under `.peaks/`, STOP and reroute under `.peaks/_runtime/<sessionId>/`. The `.gitignore` rule `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` will block the write at commit time; the vitest guard at `tests/unit/workspace/top-level-change-id-guard.test.ts` (8 cases, including CLI help-text) will fail the suite if a regression sneaks through.

## Karpathy guidance (Slice 1/6 — karpathy prompt-injection-lift)

> **Read once per Solo invocation; the 4 Karpathy guidelines are mandatory context for every sub-agent Solo dispatches.**

Every sub-agent Solo dispatches (`peaks-prd`, `peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-sc`, `peaks-txt`) MUST receive the 4 Karpathy guidelines. Solo's responsibility: when constructing the dispatch prompt, append the verbatim context block from `peaks-rd/references/rd-sub-agent-dispatch.md` §"Karpathy-guidelines context" (the block is the canonical injection source shared across all RD-spawned sub-agents). Solo MUST NOT silently drop the block. The full guidelines text lives at `andrej-karpathy-skills:karpathy-guidelines` (skill id). Summary of the 4: **#1 Think Before Coding** (surface assumptions, name tradeoffs), **#2 Simplicity First** (minimum code, no speculative features, 800-line file cap, `peaks scan file-size` gate), **#3 Surgical Changes** (touch only what the request requires, clean up only your own orphans), **#4 Goal-Driven Execution** (verifiable ACs, plan + verify checkpoints). Cross-references: Slice 1 PRD §AC-1 / `tests/unit/skills/karpathy-prompt-injection.test.ts`. The canonical skill id is `andrej-karpathy-skills:karpathy-guidelines`.

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

### Peaks-Cli Slice 011 — workspace consolidate + session checkpoint/resume

`peaks workspace consolidate` is the slice-011 umbrella primitive. The two complementary skills it depends on — `peaks session checkpoint` (proactive context-overflow defense) and `peaks session resume` (cross-session continuity) — are surfaced in SKILL.md as Step 0.75 and Step N headings (slice 2.5.0, sub-fix A). See `references/cross-date-session-check.md` for the umbrella. IDE-agnostic.

### Peaks-Cli Step 0.75: Resume from checkpoint (BLOCKING on same-day re-invocation)

When a NEW conversation opens on a session whose `lastActivity` is from today AND `.peaks/_runtime/<sessionId>/checkpoints/` contains at least one `*.json`, the LLM should surface the most recent checkpoint so the user can resume mid-session without losing context. Run `peaks session info --active --json` to resolve the canonical session id, then `peaks session resume --from <path> --project <repo>` to emit a markdown "resume context" block. The LLM's responsibility: prompt the user via IDE-native `AskUserQuestion` (resume / start fresh), and if "resume", prepend the emitted block to its own prompt. Honors the user choice on "fresh" — the on-disk checkpoint stays untouched for the next invocation. Step 0.75 is a no-op if any precondition fails (no sid, wrong day, no checkpoint). Full probe + decision tree: `references/checkpoint-resume.md`.

### Peaks-Cli Step N: Periodic checkpoint (auto-fire, no user action)

Proactive defense against context overflow. The LLM is the only one that knows when context pressure is high; this step gives it a clear trigger table and a single CLI to call. CLI: `peaks session checkpoint [--reason <r>] [--session-id <sessionId>] [--project <path>] [--current-plan <text>] [--open-questions <list>] [--recent-decisions <list>] [--recent-artifact-paths <list>] [--git-status <text>] [--skills-active <list>] [--todo-state <list>] [--json]`. LLM: keep a running tool-call counter, fire `--reason periodic` every ~20 tool calls, `--reason artifact-written` after each PRD/RD/QA/TXT artifact, `--reason context-fill` when context feels full, `--reason user-pause` on "save" / "pause", `--reason user-close` before any session-end handoff. CLI is idempotent and self-pruning (max 10 retained by mtime). See `references/periodic-checkpoint.md`.

### Peaks-Cli Step 0.5: OpenSpec first-run opt-in (conditional)

Run when `openspec/` is absent and `.peaks/.peaks-openspec-opt-in.json` is missing. Asks once and persists the decision.

→ see `references/openspec-workflow.md` for the full opt-in flow + lifecycle.

### Peaks-Cli Step 0: Anchor the workflow (MANDATORY FIRST ACTIONS — no bail-out)

Run `peaks workspace init` + `peaks skill presence:set peaks-solo` BEFORE any analysis, role handoff, or mode-selection question. Even "分析下这个项目" / "看一下代码" / one-line questions anchor first.

→ see `references/anchoring-and-session-info.md` for the full Step 0 contract + session-conflict resolution.

#### Step 0 bypass — Claude Code [Fact-Forcing Gate] (slice 2.0.1-bug3)

`peaks workspace init` materializes `.claude/settings.local.json` (a PreToolUse hook allow-list for `.peaks/**` paths and `peaks <subcommand>` Bash) so the [Fact-Forcing Gate] does not block Step 0. Pass `--no-claude-hooks` to opt out.

→ see `references/anchoring-and-session-info.md` for the full bypass contract, recovery flow, and anti-bail-out rule.

### Peaks-Cli Step 0.7: Detect unfinished work and offer resume (BLOCKING on first invocation per session)

After Step 0 anchored the workspace, run the resume-detection probe (one `find` + one `grep` + classification table). Surface resume options via `AskUserQuestion` if a slice is in flight. Never silently auto-resume.

→ see `references/resume-detection.md` for the full detection algorithm + classification table.

### Peaks-Cli Step 0.55: 1.x → 2.0 detection (BLOCKING on first invocation per session, when the project is not on a 2.0 layout)

Per the "one-key completion" tenet, peaks-cli 2.0 detects 1.x consumers and prompts upgrade. After Step 0.7 returns "fresh", run `peaks upgrade --detect-1x --project <root> --json`. If `isOneX: true`, surface `AskUserQuestion`. Persist to `.peaks/preferences.json` (`autoUpgradePrompt`: opt-in / skip-this-session / skip-forever).

→ see `references/step-0-55-1x-detection.md` for the full detection algorithm + AskUserQuestion options + persistence contract.

### Peaks-Cli Step 1: Mode selection

When the user did not name a profile (`full-auto` / `assisted` / `swarm` / `strict`), use `AskUserQuestion` with `Full auto (Recommended)` as the first option. Map the choice to `--mode` value.

→ see `references/mode-selection.md` + `references/fast-mode.md` (slice 2 hot-fix mode).

### Peaks-Cli Step 2: Re-set skill presence with the chosen mode

Re-run `peaks skill presence:set peaks-solo --mode <mode-value> --gate startup`. Install statusline on first run (`peaks statusline install`).

→ see `references/skill-presence-and-title.md`.

### Peaks-Cli Step 2.3: Load project memory (durable, LLM-authored memories)

Run `peaks project memories --project <repo> --json` to read decisions / conventions / modules / rules / lessons from `.peaks/memory`. Use this to understand what exists, what was decided, what to avoid re-litigating.

→ see `references/project-memory-loading.md` for the full kind table.

### Peaks-Cli Step 2.5: Set session title

Extract a short title from the user's first request (8-20 Chinese chars or 4-10 English words). Run `peaks session title` with the active sid. Skip if a title is already set.

→ see `references/skill-presence-and-title.md` (same file as Step 2).

## Sub-agent session sharing (MANDATORY — one conversation = one sid)

When peaks-solo dispatches a sub-agent (peaks-rd, peaks-qa, peaks-ui, peaks-txt, peaks-sc), the prompt MUST include the parent's sid. The sub-agent MUST NOT call `peaks workspace init` (would orphan the parent's binding). See `references/context-governance.md`.

## Boundaries

Peaks-Cli Solo may: identify scenarios (refactor, bugfix, QA hardening, release validation, incident response); recommend profiles; coordinate role skills through artifacts; coordinate project memory extraction; request user confirmation at risk and commit boundaries.

Peaks-Cli Solo must NOT silently install hooks, create agents, enable MCP servers, modify Claude settings, create GitHub repos, or bypass role-skill artifacts.

→ see `references/boundaries.md` for the full do / don't list.

## Peaks-Cli GStack integration

Map gstack stages to Peaks-Cli role artifacts; preserve confirmation gates. Do not delegate orchestration to gstack commands. RD and QA use Playwright MCP for browser E2E.

→ see `references/gstack-integration.md` and `references/browser-workflow.md`.

## Peaks-Cli Local intermediate artifact workspace (MANDATORY)

The workspace is created in Step 0 as a mandatory first action. All intermediate artifacts land under `.peaks/_runtime/<sessionId>/`. NEVER write Peaks-Cli intermediate artifacts to the project root directory. Git inclusion or sync requires explicit user confirmation.

→ see `references/local-artifact-workspace.md` for the workspace tree, root pollution prohibition, and git policy.

## Peaks-Cli Pre-RD project scan checklist (MANDATORY)

Before handing off to `peaks-rd`, scan the project and record findings to `.peaks/_runtime/<sessionId>/rd/project-scan.md`. The full project-scan checklist (archetype detection, build-tool / component-library / CSS-framework / state-routing-data tables, legacy signals, artifact template) lives in the references file.

→ see `references/project-scan-checklist.md` for the full checklist.

## Peaks-Cli Frontend-only development mode

When the project has no live backend (no swagger.json, no API server), Solo must activate frontend-only mode. The CLI is authoritative — read `frontendOnly` and `frontendOnlyReason` from `peaks scan archetype --json`.

→ see `references/frontend-only-mode.md` for the full mode contract, mock-data strategy, and the pre-flight keyword scan.

## Peaks-Cli Request type classification + Workflow order + Transition verification gates

The full contract for the 6-type classification table, the 11-step workflow order, and the 7 transition verification gates (A through G with their `ls` / `grep` shell snippets) lives in `references/workflow-gates-and-types.md`. The peaks-solo narrative in this SKILL.md references those gate numbers (Gate A through Gate G) — keep both files in lockstep when adding or renaming a gate. The reference file is the canonical contract; SKILL.md keeps the prose.

## Peaks-Cli Default sub-agent fan-out (≥ 2 leaves/topological level → `--from-dag`)

> **Slice 5:** when the slice DAG has ≥ 2 leaves at one topological level, dispatch via `peaks sub-agent dispatch --from-dag <dag-file>` (wall-time ≈ max, not sum).

Write DAG → `.peaks/_runtime/<sessionId>/sc/slice-dag.json`, run `peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>` once; orchestrator emits N parallel `buildToolCall` (`dispatchCount === N`). No N serial `peaks sub-agent dispatch <role>` calls. Exceptions: `config|docs|chore` → skip Swarm; all attempts in a level fail → degrade per table.

### Fan-out opt-out (slice 2026-06-23-audit-p0)

> Backward-compatible escape hatch via `preferences.fanout.defaultMode = 'serial'` (see `references/fanout-opt-out.md`).

→ see `references/swarm-dispatch-contract.md` for the canonical gate logic + degradation tables, `references/sub-agent-dispatch.md` for the dispatch mechanism (NOT `Skill` tool), and `references/fanout-opt-out.md` for the opt-out contract.

## Peaks-Cli Mandatory RD QA repair loop (AUTO-PROCEED)

After `peaks-rd` finishes implementation, repair, or code-output, Solo MUST auto-route to `peaks-qa` without waiting for confirmation. Cap: 3 cycles; on 3rd failure emit blocked TXT handoff.

→ see `references/micro-cycle.md` for the full 5-step procedure (transition, re-launch, fix, re-run, restore presence) + 3-cycle cap.

## Default runbook

The end-to-end CLI sequence for `full-auto` lives in `references/runbook.md`. `assisted`/`strict` pause at `[CONFIRM]`; `full-auto`/`swarm` auto-proceed.

When adding new CLI commands, mirror into `references/runbook.md` and `tests/unit/skill-default-runbook.test.ts` (test falls back to the reference).

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

Read `references/refactor-mode.md` first. Default MVP: `peaks-solo refactor`. Red lines: understand before changes, ≥95% UT coverage, split broad refactors, strict verifiable specs, 100% acceptance per slice, traceable sanitized artifacts.

## Peaks-Cli Quality-gate commands (CLI cheat sheet)

Five CLI commands harden the workflow against silent skips: `peaks request lint`, `peaks request repair-status`, `peaks scan request-type-sanity`, `peaks scan libraries`, `peaks slice check` (plus `peaks request transition`). See `references/quality-gate-cheatsheet.md`.

## Peaks-Cli Completion handoff

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Use Peaks-Cli TXT for the compact handoff capsule: mode, validated decisions, artifact paths, standards deltas, open questions, next action. **Presence management is delegated to the last downstream skill** — peaks-solo does not call `peaks skill presence:clear` itself.

→ see `references/completion-handoff.md`.

## Peaks-Cli External references and lifecycle

3rd-party integrations (codegraph, mattpocock/skills, shadcn/ui, MCPs, Context7) follow Discovery → Reference → Side effect through Peaks CLI only. Before naming external skills, run `peaks capabilities` for capability discovery; treat all external skills as reference material only. Peaks-Cli artifacts and ACs remain authoritative; do not execute upstream installers; MCP servers (Playwright / Chrome DevTools / Figma) are user-installed — the LLM checks its own tool list for `mcp__<server>__*` entries.

→ see `references/external-references.md` and `references/external-skill-invocation.md`.

## Codegraph orchestration context

`peaks codegraph affected` is an optional project-analysis enhancement; treat output as untrusted supporting evidence. Solo must not treat codegraph output as approval for scope, design, or QA verdict. Never mutate agent settings, Claude settings, or hooks from codegraph; do not commit `.codegraph/` artifacts. RD writes `.peaks/<session-id>/rd/codegraph-context.md`; QA / TXT consume the same envelope in the role handoff.

→ see `references/codegraph-orchestration.md`.

## Sub-agent context governance (G7 + G7.7 + G8 + G9 — slice #010)

Layer 3.5 context-governance push for sub-agent dispatch. Main LLM reducer sees metadata-only view (~200 chars/sub-agent); on-demand `Read` for full content. Threshold table: 50% soft warn, 75% `CONTEXT_NEAR_LIMIT`, 80% hard reject (CLI + hook double-guard). See `references/context-governance.md`.

→ see `references/context-governance.md` for the full protocol.

## Sub-agent cross-batch signal — G8.4 share / shared-read / await (slice 2026-06-23-audit-3rd)

Three CLI primitives complement `dispatch` and let sibling sub-agents (within the same batch) coordinate without peer-to-peer messaging (pseudo-swarm property 3). All three are LLM-invoked from peaks-rd / peaks-qa / peaks-ui / peaks-txt skills; the LLM-side runner executes the returned tool calls.

- **`peaks sub-agent share --batch <batchId> --key <role>.<event> --value <jsonObject> [--from <role>]`** — write one entry to the per-batch shared channel (≤ 1KB soft warn, ≥ 64KB hard reject). Dispatcher-mediated; last-write-wins per key.
- **`peaks sub-agent shared-read --batch <batchId> [--since <iso>] [--key <glob>]`** — read sibling entries (glob `*` supported, e.g. `rd.*`).
- **`peaks sub-agent await --batch <batchId> [--timeout <ms>]`** — block until the batch finishes (or `--timeout`); claude-code 1.2 MVP only; other IDEs fall back to LLM-side await (1.3).

Batch lifecycle contract: the LLM receives a `batchId` from the `dispatch` envelope. Sub-agents `share` events; the parent LLM `shared-read`s between dispatch levels (slice-dag) or before `await`. The channel file is gitignored under `.peaks/_sub_agents/<sid>/shared/`.

## References

Index of every `references/` file. Read on demand.

| File | Coverage |
|---|---|
| `references/dag-orchestrator.md` | DAG-aware sub-agent dispatch (2.7.0 slice-dag-dispatcher MVP). |
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
| `references/playwright-mcp-multi-terminal.md` | Multi-terminal Playwright MCP (start/ls/stop, port walk, conflict). |
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