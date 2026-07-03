---
name: peaks-solo
description: Full-auto orchestration facade for the Peaks-Loop skill family. Use when the user asks Peaks-Loop to handle a project workflow end-to-end (端到端/全流程/需求开发), especially from a product document (PRD/飞书文档/Feishu doc) through implementation and validation. Coordinates peaks-prd, peaks-rd, peaks-ui, peaks-qa, peaks-sc, and peaks-txt while preserving user confirmation gates. Triggers on `/peaks-solo`, "peaks solo", "全流程开发", "端到端迭代".
---

## Single-scope-axis naming convention (2.7.1)

The `.peaks/` workspace has a **single scope axis** (session-id) plus a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<sessionId>` (NEVER bare `<sid>`). Reviewable artifacts live at `.peaks/_runtime/<sessionId>/<role>/...` (gitignored); the change-id is an optional filename slug and does NOT route filesystem writes. CLI: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. OpenSpec's `openspec/changes/<change-id>/` vocabulary (L4) is preserved. Test `skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) axis labels, (c) this callout.

## Karpathy guidance (Slice 1/6 — karpathy prompt-injection-lift)

Every sub-agent dispatch (`peaks-prd`, `peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-sc`, `peaks-txt`) MUST receive the 4 Karpathy guidelines. Append the verbatim block from `peaks-rd/references/rd-sub-agent-dispatch.md` §"Karpathy-guidelines context" to the dispatch prompt. Canonical skill id: `andrej-karpathy-skills:karpathy-guidelines`. Summary: **#1 Think Before Coding**, **#2 Simplicity First**, **#3 Surgical Changes**, **#4 Goal-Driven Execution**.

## Hard ban (effective 2.8.3 — read every session, no exceptions)

Never create `.peaks/_runtime/<YYYY-MM-DD-*>/` at the top level of `.peaks/`. ALL reviewable artifact dirs live under `.peaks/_runtime/<sessionId>/<role>/...` (gitignored) — never as siblings of `.peaks/_runtime/`. `peaks workspace init` creates only `.peaks/_runtime/<sessionId>/session.json`. If you find yourself about to write a date-prefixed directory directly under `.peaks/`, STOP and reroute under `.peaks/_runtime/<sessionId>/`. The `.gitignore` rule + vitest guard at `tests/unit/workspace/top-level-change-id-guard.test.ts` enforce this.

# Peaks-Loop Solo

Peaks-Loop Solo is the orchestration facade for the Peaks-Loop short skill family. Use it to identify the user scenario, recommend an execution mode, coordinate role skills, and produce the final handoff report. Do not collapse role responsibilities into this skill.

## 产品定位(2026-06-28 校准)

> peaks-loop 真实定位 = 24h AI 程序员编排器;user 角色 = 业务/产品审阅者,不参与技术决策。详见 `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`。

## Skill-first architecture note (read once, internalise)

This skill is the **primary surface**. The `peaks <cmd>` CLI is **auxiliary** — invoked by the skill prompt only when a primitive is the right tool. Behaviour only an LLM in a skill prompt would use lives **here in the SKILL.md**.

## Code-Change Red Line (BLOCKING — read before ANY tool call)

**Peaks-Loop Solo is an orchestrator, NOT an implementer. You MUST NOT write, edit, or modify any application source code directly.** Every code change goes through `peaks-solo → RD → QA → verdict`. **If you catch yourself about to write code, STOP.** Hand off to RD. Before declaring workflow complete, run `peaks workflow verify-pipeline --rid <rid> --project <repo> --json`.

## Peaks-Loop Startup sequence (MANDATORY — execute in order)

### Peaks-Loop Slice 011 — workspace consolidate + session checkpoint/resume

`peaks workspace consolidate` is the slice-011 umbrella primitive. `peaks session checkpoint` (context-overflow defense) and `peaks session resume` surface as Step 0.75 + Step N. See `references/cross-date-session-check.md`.

### Peaks-Loop Step 0.75: Resume from checkpoint (BLOCKING on same-day re-invocation)

When a NEW conversation opens on a session whose `lastActivity` is from today AND `.peaks/_runtime/<sessionId>/checkpoints/` has `*.json`, surface via `peaks session info --active --json` + `peaks session resume --from <path> --project <repo>`. Prompt via `AskUserQuestion` (resume / fresh); if "resume", prepend the block. Step 0.75 is no-op on precondition fail. See `references/checkpoint-resume.md`.

### Peaks-Loop Step N: Periodic checkpoint (auto-fire, no user action)

Proactive context-overflow defense. CLI: `peaks session checkpoint [--reason <r>] [...flags]`. Fire `--reason periodic` every 20 tool calls (G1 hard-coded), `--reason artifact-written` per PRD/RD/QA/TXT write. See `references/periodic-checkpoint.md` (otherwise `tests/unit/solo/checkpoint-periodic-frequency.test.ts` fails).

### Peaks-Loop Step 0.5: OpenSpec first-run opt-in (conditional)

Run when `openspec/` is absent and `.peaks/.peaks-openspec-opt-in.json` is missing. Asks once and persists the decision.

→ see `references/openspec-workflow.md` for the full opt-in flow + lifecycle.

### Peaks-Loop Step 0.6: Audit + Goal (NEW)

Invoke peaks-audit after need expressed; store approved goal at `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json`. **All autonomous work requires approved goal.** → `references/audit-goal-gate.md`.

### Peaks-Loop Step N+1: Final Review (NEW)

After autonomous work (RD, QA, security, perf), invoke peaks-final-review for 4-dim evidence. All 4 pass → final delivery; else loop back. See `references/final-review-gate.md`.

### Peaks-Loop Step N+2: Main-session context monitor (D6 + slice 2026-07-02)

After every 4th tool call, probe via `peaks solo context-now --project <repo> --json`. Thresholds: 50% / **0.85 pre-compact / 0.95 red-line** (v2.13.0). **In Job mode ≥ 0.85 is MANDATORY auto-compact** (not advisory): Solo MUST call `peaks session auto-compact --execute --project <repo>` autonomously. Pass `--enforce-job-mode` to force the MANDATORY semantics in single-rid mode too (`job-shape.json` auto-enables it). **≥ 0.95** red line: next Bash/Task call fires `peaks session auto-compact-hook` (PreToolUse), in-band spawning `claude --compact`. **Karpathy §4 exception**: compact red line keeps runner alive → zero-intervention wins; LLM MUST NOT ask user to run `/compact`. Honor `--in-flight-batch` (D6.e).

### Peaks-Loop Step 0: Anchor the workflow (MANDATORY FIRST ACTIONS — no bail-out)

Run `peaks workspace init` + `peaks skill presence:set peaks-solo` BEFORE any analysis, role handoff, or mode-selection question. Even "分析下这个项目" / "看一下代码" / one-line questions anchor first.

→ see `references/anchoring-and-session-info.md` for the full Step 0 contract + session-conflict resolution.

#### Step 0 bypass — Claude Code [Fact-Forcing Gate] (slice 2.0.1-bug3)

`peaks workspace init` materializes `.claude/settings.local.json` (a PreToolUse hook allow-list for `.peaks/**` paths and `peaks <subcommand>` Bash) so the [Fact-Forcing Gate] does not block Step 0. Pass `--no-claude-hooks` to opt out.

→ see `references/anchoring-and-session-info.md` for the full bypass contract, recovery flow, and anti-bail-out rule.

### Peaks-Loop Step 0.7: Detect unfinished work and offer resume (BLOCKING on first invocation per session)

After Step 0, run the resume-detection probe; surface via `AskUserQuestion` if a slice is in flight.

**v3.1.2 resume rule:** if `.peaks/_runtime/<sessionId>/job/<jid>/progress.json` exists, read it FIRST and surface `Next: slice #N of M (<currentSlice>)`. `peaks job progress --job-id <jid> [--allow-missing]` is the canonical reader; the same JSON is surfaced by `peaks solo gate-step-08` on every Bash call.

**v2.11.0 D7 override:** if user just `/compact`ed, run `peaks solo post-compact-detect --project <repo> --json` FIRST; `shouldAutoResume: true` skips AskUserQuestion (D7.b). Log to `.peaks/_runtime/<sessionId>/txt/auto-decisions.md`.

→ see `references/resume-detection.md`.

### Peaks-Loop Step 0.55: 1.x → 2.0 detection (BLOCKING on first invocation per session, when the project is not on a 2.0 layout)

After Step 0.7 returns "fresh", run `peaks upgrade --detect-1x --project <root> --json`. If `isOneX: true`, surface `AskUserQuestion`. Persist to `.peaks/preferences.json`. → `references/step-0-55-1x-detection.md`.

### Peaks-Loop Step 0.8 — Job 启动 (BLOCKING on LLM judgement — v3.1.1 patch + v3.1.2 mechanical gates)

The CLI is a **recorder + gate** for job-shape (the LLM judges). LLM calls `peaks solo detect-job --is-job <bool> --rationale <text> --suggested-job-id <jid> --suggested-strategy <single|rotating> --confidence <high|medium|low>`, which writes `.peaks/_runtime/<sessionId>/job-shape.json`. Downstream steps call `read-job-shape` and refuse if missing.

**Hard rule (v3.1.1 red-line #10):** LLM MUST NOT skip `peaks solo detect-job`. If `read-job-shape` throws `JOB_SHAPE_NOT_DECIDED`, record a decision before proceeding.

**v3.1.2 mechanical gates** (recorder-only was bypassed twice):

- **PreToolUse hook** — `peaks workspace init` installs the `Bash` matcher `peaks solo gate-step-08 --project .`. Exits 0 when `job-shape.json` exists (also emits `Next: slice #N+1 of M` from `progress.json`); exits 2 BLOCKED when missing AND prompt matches a fail-closed backup regex; otherwise 0 (allow).
- **Size-fear ban** — `peaks solo emit-handoff` refuses a final handoff while `remaining > 0` under Job mode.
- **Forced auto-compact** — `peaks solo context-now --enforce-job-mode` (auto-enabled on `isJob=true`) returns `auto-compact-now` at ≥ 0.85; **In Job mode ≥ 0.85 is MANDATORY auto-compact** (not advisory).
- **On-disk slice progress** — `peaks job checkpoint --state done` writes `progress.json`; `peaks job progress --job-id <jid> [--allow-missing]` is the canonical reader.

Full mechanics (judgement criteria, hook table, backup-regex rationale, hook wiring) at `references/step-0-8-gate.md`.

### Peaks-Loop Step 0.81 — per-slice 收尾

After commit: `peaks job checkpoint --slice-id <rid> --state done --commit-sha $(git rev-parse HEAD)` → `peaks job status` → loop (remaining>0 → Step 1; ==0 → Step 8/9/10/11; blocked → Step 0.85).

### Peaks-Loop Step 0.85 — slice 阻塞处理

Trigger: `repair-status` atCap=true, context-now red-line ≥5min, or `subagent-cleanup` fails twice. Action: `peaks job block --slice-id <rid> --reason "<reason>"` then STOP with TXT handoff.

### Peaks-Loop Step 0.86 — main session rotation

Active in rotating mode; fires every `rotateEvery` slices or on-demand via `peaks job rotate-now`. Sequence: cycle-summary → checkpoint rotate-marker → `peaks session rotate` → next turn resumes via `peaks session resume --job-id <jid>`.

### Peaks-Loop Step 0.87 — sub-agent cleanup gate

After every `peaks sub-agent dispatch --batch-id <id>` inside a Job, BEFORE next slice checkpoint: `peaks job subagent-cleanup --job-id <jid> --batch-id <id> --force`. Non-zero → block.

→ see `references/job-loop.md` for state machine, visibility, rotation cadence, cross-day recovery, 9 red lines.

### Peaks-Loop Step 1: Mode selection

Use `AskUserQuestion` with `Full auto (Recommended)` first when user did not name a profile OR skill presence is stale (run `peaks skill presence:check-stale --project <path> --json` first; `stale: true` ⇒ re-ask). → `references/mode-selection.md`, `references/fast-mode.md`, `references/mode-selection-with-stale-presence.md`.

### Peaks-Loop Step 2: Re-set skill presence with the chosen mode

Re-run `peaks skill presence:set peaks-solo --mode <mode-value> --gate startup`. Install statusline on first run (`peaks statusline install`). → `references/skill-presence-and-title.md`.

### Peaks-Loop Step 2.3: Load project memory (durable, LLM-authored memories)

Run `peaks project memories --project <repo> --json` to read decisions / conventions / modules / rules / lessons from `.peaks/memory`. → `references/project-memory-loading.md`.

### Peaks-Loop Step 2.5: Set session title

Extract a short title from the user's first request (8-20 Chinese chars or 4-10 English words). Run `peaks session title` with the active sid. Skip if a title is already set. → `references/skill-presence-and-title.md` (same file as Step 2).

## Sub-agent session sharing (MANDATORY — one conversation = one sid)

When peaks-solo dispatches a sub-agent (peaks-rd, peaks-qa, peaks-ui, peaks-txt, peaks-sc), the prompt MUST include the parent's sid. The sub-agent MUST NOT call `peaks workspace init` (would orphan the parent's binding).

## Boundaries

Peaks-Loop Solo may: identify scenarios, recommend profiles, coordinate role skills through artifacts, coordinate project memory extraction, request user confirmation at risk/commit boundaries. Peaks-Loop Solo must NOT silently install hooks / create agents / enable MCP / modify Claude settings / create GitHub repos / bypass role-skill artifacts. → `references/boundaries.md`.

## Peaks-Loop GStack integration

Map gstack stages to Peaks-Loop role artifacts; preserve confirmation gates. → `references/gstack-integration.md` + `references/browser-workflow.md`.

## Peaks-Loop Local intermediate artifact workspace (MANDATORY)

Step 0 creates the workspace; all intermediate artifacts land under `.peaks/_runtime/<sessionId>/`. NEVER write Peaks-Loop intermediate artifacts to the project root.

## Peaks-Loop Pre-RD project scan checklist (MANDATORY)

Before handing off to `peaks-rd`, scan the project and record findings to `.peaks/_runtime/<sessionId>/rd/project-scan.md`. → `references/project-scan-checklist.md`.

## Peaks-Loop Frontend-only development mode

When the project has no live backend (no swagger.json, no API server), Solo must activate frontend-only mode. The CLI is authoritative — read `frontendOnly` and `frontendOnlyReason` from `peaks scan archetype --json`. → `references/frontend-only-mode.md`.

## Peaks-Loop Request type classification + Workflow order + Transition verification gates

The contract for the 6-type classification table, the 11-step workflow order, and the 7 transition verification gates (A through G with their `ls` / `grep` shell snippets) lives in `references/workflow-gates-and-types.md`. The peaks-solo narrative references those gate numbers (Gate A through Gate G) — keep both files in lockstep when adding or renaming a gate.

## Peaks-Loop Default sub-agent fan-out (≥ 2 leaves/topological level → `--from-dag`)

> **Slice 5:** when the slice DAG has ≥ 2 leaves at one topological level, dispatch via `peaks sub-agent dispatch --from-dag <dag-file>` (wall-time ≈ max, not sum).

Write DAG → `.peaks/_runtime/<sessionId>/sc/slice-dag.json`, run `peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>` once; orchestrator emits N parallel `buildToolCall` (`dispatchCount === N`).

> **2026-06-28 校准:** 主路径 = 唯一蜂群;config/docs/chore 跳过不打断。详见 `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`。

### Hard constraint: fan-out is mandatory (slice 2026-06-24-audit-5th-p2)

> **No serial opt-out.** `preferences.fanout.defaultMode = 'serial'` was removed in 2.8.4; legacy values auto-migrate to `fan-out`.

→ see `references/swarm-dispatch-contract.md`, `references/sub-agent-dispatch.md` (NOT `Skill` tool), `references/fanout-mandatory.md`.

## Slice 调度:分层并行 + 上游同步(2026-06-28 校准)

> 分层并行(G12)+ 上游同步(G11)见 `.peaks/memory/peaks-loop-fork-sync-and-layered-parallel.md`。

## Peaks-Loop Mandatory RD QA repair loop (AUTO-PROCEED)

After `peaks-rd` finishes, Solo MUST auto-route to `peaks-qa` without waiting for confirmation. Cap: 3 cycles; on 3rd failure emit blocked TXT handoff. Full 5-step procedure at `references/micro-cycle.md`.

## Default runbook

The end-to-end CLI sequence for `full-auto` lives in `references/runbook.md`. `assisted`/`strict` pause at `[CONFIRM]`; `full-auto`/`swarm` auto-proceed.

When adding new CLI commands, mirror into `references/runbook.md` and `tests/unit/skill-default-runbook.test.ts` (test falls back to the reference).

## RD micro-cycle (TDD small-step rapid-test loop)

> **Slice 内部**的修复 / refactor / lint 修复走 micro-cycle（5-10s/cycle）；Slice 边界走 `peaks slice check`。完整手册：`references/micro-cycle.md`。

## Peaks-Loop Project standards preflight

Gather via `peaks standards init/update --project <path> --dry-run`. Standards must reflect the project scan (component library, CSS, build tool, state, routing) — never emit a generic template.

## Peaks-Loop Refactor mode

Read `references/refactor-mode.md` first. Default MVP: `peaks-solo refactor`. Red lines: understand before changes, ≥95% UT coverage, split broad refactors, strict verifiable specs, 100% acceptance per slice.

## Peaks-Loop Quality-gate commands (CLI cheat sheet)

Five CLI commands harden the workflow against silent skips: `peaks request lint`, `peaks request repair-status`, `peaks scan request-type-sanity`, `peaks scan libraries`, `peaks slice check` (plus `peaks request transition`). See `references/quality-gate-cheatsheet.md`.

## Peaks-Loop Completion handoff

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Use Peaks-Loop TXT for the compact handoff capsule. **Presence management is delegated to the last downstream skill** — peaks-solo does not call `peaks skill presence:clear` itself.

## Peaks-Loop Step 11: Memory sediment (BLOCKING on workflow complete)

> **Hard rule.** Solo MUST NOT declare a workflow complete until Step 11 has produced ≥ 1 file in `.peaks/memory/` (the durable, LLM-authored memory store) OR the user has explicitly approved a no-sediment outcome via AskUserQuestion. Applies to **all modes** including `assisted` and `strict` — `assisted` previously skipped Step 10 because there was no `[CONFIRM]` gate; Step 11 fixes that.

### Substeps (BLOCKING)

**11a — Gate A (txt/ inventory):** `find .peaks/_runtime/<sessionId>/txt/ -type f -name '*.md' | head`. If **0 files** → STOP. Dispatch `peaks-txt` first to write `handoff.md`, then return to 11c.

**11b — Gate B (memory block embed scan):** `grep -c 'peaks-memory:start' .peaks/_runtime/<sessionId>/txt/handoff.md || true`. If **0 AND this session surfaced a stable project fact** (decision / convention / approved refactor / hard rule), STOP and tell peaks-txt to embed at least one `<!-- peaks-memory:start -->` block first.

**11c — Canonical extract** (the only CLI that writes `.peaks/memory/`): `peaks memory extract --project <repo> --artifact .peaks/_runtime/<sessionId>/txt/handoff.md --apply --json`. `--apply` is REQUIRED (without it the command only previews — no files land).

**11d — Gate C (zero-write outcome):** If `extractedCount === 0` after 11c, fire AskUserQuestion:

> "本次 solo 未沉淀任何 `.peaks/memory` 文件。可选: (a) 回去在 handoff.md 嵌入至少 1 个 `peaks-memory:start` block 后重试; (b) 显式接受 no-sediment 并记录为 lesson; (c) 取消完成。"

Default option = (a). Solo MUST NOT silently accept (b) without user pick. Full bash + flow at `references/runbook.md` §Step 11.

**Why this step exists:** audit 2026-07-03 confirmed 2 consecutive sessions produced zero `.peaks/memory/` files despite completing RD + QA + handoff artifacts; `assisted` mode silently skipped runbook Step 10 (no STOP condition). **Why `peaks memory extract` (not `peaks project memories:extract`):** the artifact-scoped extract is canonical; the batch-scoped sibling is for non-handoff flows. Always use `peaks memory extract --apply`.

## Peaks-Loop External references and lifecycle

3rd-party integrations (codegraph, mattpocock/skills, shadcn/ui, MCPs, Context7) follow Discovery → Reference → Side effect through Peaks CLI only. Run `peaks capabilities` for capability discovery; treat external skills as reference material only. MCP servers (Playwright / Chrome DevTools / Figma) are user-installed — check the tool list for `mcp__<server>__*` entries. Do not execute upstream installer / run upstream commands / persist sensitive examples / install upstream resources directly — funnel side effects through the Peaks CLI surface. Peaks-Loop Solo gates remain authoritative. → `references/external-references.md` + `references/external-skill-invocation.md`.

## Codegraph orchestration context

`peaks codegraph affected` is an optional project-analysis enhancement (untrusted supporting evidence) for role handoff. Solo must not treat codegraph output as approval for scope, design, or QA verdict. Never mutate agent settings / hooks from codegraph; do not commit `.codegraph/` artifacts. RD writes `.peaks/_runtime/<sessionId>/rd/codegraph-context.md`; QA / TXT consume the same envelope. → `references/codegraph-orchestration.md`.

## Sub-agent context governance (G7 + G7.7 + G8 + G9 — slice #010)

Main LLM reducer sees metadata-only view (~200 chars/sub-agent); on-demand `Read` for full content. Threshold table: 50% soft warn, 75% `CONTEXT_NEAR_LIMIT`, 80% hard reject (CLI + hook double-guard). → `references/context-governance.md`.

## Sub-agent cross-batch signal — G8.4 share / shared-read / await (slice 2026-06-23-audit-3rd)

Three CLI primitives let sibling sub-agents coordinate: `peaks sub-agent share / shared-read / await` (last-write-wins, ≤ 1KB warn / ≥ 64KB reject). Channel file gitignored under `.peaks/_sub_agents/<sessionId>/shared/`.

## References

Index of every `references/` file. Read on demand.

| File | Coverage |
|---|---|
| `references/dag-orchestrator.md` | DAG-aware sub-agent dispatch. |
| `references/a2a-artifact-mapping.md` | A2A artifact-path mapping. |
| `references/anchoring-and-session-info.md` | Step 0 + session-conflict. |
| `references/artifact-contracts.md` | Sub-agent handoff contracts. |
| `references/boundaries.md` | Solo's do / don't list. |
| `references/browser-workflow.md` | Browser workflow (Playwright MCP). |
| `references/codegraph-orchestration.md` | Codegraph role handoff. |
| `references/command-migration.md` | Legacy command migration. |
| `references/completion-handoff.md` | Completion handoff. |
| `references/context-governance.md` | G7-G9 sub-agent thresholds. |
| `references/external-references.md` | 3rd-party inventory + lifecycle. |
| `references/external-skill-invocation.md` | External skill invocation. |
| `references/existing-system-extraction.md` | Legacy project extraction. |
| `references/frontend-only-mode.md` | Frontend-only mode + mocks. |
| `references/gstack-integration.md` | GStack → Peaks mapping. |
| `references/headroom-integration.md` | Headroom-ai compression. |
| `references/local-artifact-workspace.md` | Workspace tree + root-prohibition. |
| `references/micro-cycle.md` | RD micro-cycle + repair loop. |
| `references/mode-selection.md` | Step 1 mode + `--mode`. |
| `references/openspec-workflow.md` | Step 0.5 OpenSpec. |
| `references/playwright-mcp-multi-terminal.md` | Multi-terminal Playwright MCP. |
| `references/project-memory-loading.md` | Step 2.3 memories. |
| `references/project-scan-checklist.md` | Pre-RD scan + template. |
| `references/quality-gate-cheatsheet.md` | 5 CLI commands. |
| `references/refactor-mode.md` | Refactor mode + red lines. |
| `references/resume-detection.md` | Step 0.7 unfinished-work. |
| `references/runbook.md` | End-to-end CLI sequence. |
| `references/job-loop.md` | Step 0.8 / 0.81 / 0.85 / 0.86 / 0.87 deep-dive. |
| `references/skill-presence-and-title.md` | Step 2 + Step 2.5. |
| `references/standards-preflight.md` | Standards preflight. |
| `references/sub-agent-dispatch.md` | IDE-agnostic dispatch. |
| `references/swarm-dispatch-contract.md` | Swarm fan-out gate + shape. |
| `references/workflow-gates-and-types.md` | Type classification + 7 gates. |
| `references/workflow.md` | Workflow flow + transitions. |