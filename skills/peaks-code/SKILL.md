---
name: peaks-code
description: Code-domain loop engineering orchestrator for the Peaks-Loop skill family. Use when the user asks Peaks-Loop to handle a code-repo workflow end-to-end (端到端/全流程/需求开发), especially from a product document (PRD/飞书文档/Feishu doc) through implementation and validation. Coordinates peaks-prd, peaks-rd, peaks-qa, peaks-ui, peaks-sc, and peaks-txt while preserving user confirmation gates. Triggers on `/peaks-code`, "peaks code", "全流程开发", "端到端迭代". General primitives (peaks-resume / peaks-status / peaks-test) are sibling skills, not children.
---

## Scope (RL-8 — red line, locked 2026-07-08)

`peaks-code` is a **code-domain long-task loop engineering orchestrator; not a general-purpose orchestrator.**

This is RL-8 from the Loop Engineering crystallization design
(`docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` §0.4 and §10 RL-8).
The boundary is closed under this slice:

- **In scope:** end-to-end code-domain workflows — repository scanning, RD planning, code implementation via RD, QA verification, UI changes inside a code repo, source-control handoff, and code-repo context packaging. Coordinated role skills: `peaks-prd`, `peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-sc`, `peaks-txt`.
- **Out of scope:** research / content / product / medical / non-code domains. Each of those ships as an independent `peaks-*` skill that imports `.peaks/standards/loop-engineering-guidelines.md` and passes `peaks skill lint --category loop-engineering-readiness`. They are **not** subclasses or variants of `peaks-code`.
- **Failure modes this rule prevents:** (a) `peaks-code` widening into a general orchestrator; (b) non-code capabilities being smuggled into `peaks-code`; (c) other domains being expressed as "peaks-code variants".
- **Self-check:** before any new peak-* capability is added here, ask "is this code-domain?" If the answer is no, the right move is a new `peaks-*` skill, not an extension of `peaks-code`.

## Single-scope-axis naming convention (2.7.1)

The `.peaks/` workspace has a **single scope axis** (session-id) plus a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<sessionId>` (NEVER bare `<sid>`). Reviewable artifacts live at `.peaks/_runtime/<sessionId>/<role>/...` (gitignored); the change-id is an optional filename slug and does NOT route filesystem writes. CLI: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Test `skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) axis labels, (c) this callout.

## Karpathy guidance (Slice 1/6 — karpathy prompt-injection-lift)

Every sub-agent dispatch (`peaks-prd`, `peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-sc`, `peaks-txt`) MUST receive the 4 Karpathy guidelines. Append the verbatim block from `peaks-rd/references/rd-sub-agent-dispatch.md` §"Karpathy-guidelines context" to the dispatch prompt. Canonical skill id: `andrej-karpathy-skills:karpathy-guidelines`. Summary: **#1 Think Before Coding**, **#2 Simplicity First**, **#3 Surgical Changes**, **#4 Goal-Driven Execution**.

## Hard ban (effective 2.8.3 — read every session, no exceptions)

Never create `.peaks/_runtime/<YYYY-MM-DD-*>/` at the top level of `.peaks/`. ALL reviewable artifact dirs live under `.peaks/_runtime/<sessionId>/<role>/...` (gitignored) — never as siblings of `.peaks/_runtime/`. `peaks workspace init` creates only `.peaks/_runtime/<sessionId>/session.json`. If you find yourself about to write a date-prefixed directory directly under `.peaks/`, STOP and reroute under `.peaks/_runtime/<sessionId>/`. The `.gitignore` rule + vitest guard at `tests/unit/workspace/top-level-change-id-guard.test.ts` enforce this.

# Peaks-Loop Code

Peaks-Loop Code is the orchestration facade for the Peaks-Loop short skill family. Use it to identify the user scenario, recommend an execution mode, coordinate role skills, and produce the final handoff report. Do not collapse role responsibilities into this skill.

## 产品定位(2026-06-28 校准)

> peaks-loop 真实定位 = 24h AI 程序员编排器;user 角色 = 业务/产品审阅者,不参与技术决策。详见 `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`。

## Skill-first architecture note (read once, internalise)

This skill is the **primary surface**. The `peaks <cmd>` CLI is **auxiliary** — invoked by the skill prompt only when a primitive is the right tool. Behaviour only an LLM in a skill prompt would use lives **here in the SKILL.md**.

## Code-Change Red Line (BLOCKING — read before ANY tool call)

**Peaks-Loop Code is an orchestrator, NOT an implementer. You MUST NOT write, edit, or modify any application source code directly.** Every code change goes through `peaks-code → RD → QA → verdict`. **If you catch yourself about to write code, STOP.** Hand off to RD. Before declaring workflow complete, run `peaks workflow verify-pipeline --rid <rid> --project <repo> --json`.

## 24h mode (orchestrator flag, NOT a new skill)

> **Why this is a flag.** peaks-code is the orchestrator; 24h mode is a *flag* the orchestrator can flip, not a sibling skill. See `.peaks/memory/2026-07-28-peaks-code-loop-skill-proposal.md` for the RL-8 tension analysis. The 24h mode state machine is owned by `peaks session 24h-mode ...` (rid-020a). peaks-code is the consumer; it does not own a new top-level surface.

### State machine (6 states, rid-020a shipped)

`IDLE → BRAINSTORM → USER_CONFIRM → 24H_ACTIVE → WAITING_USER → HANDOFF`. The CLI surface is `peaks session 24h-mode {state,transition,attempts,reset}`; the LLM is the decision-maker. The persisted snapshot lives at `.peaks/_runtime/<sessionId>/24h-state.json` (read-only for peaks-code; write only via the CLI).

### 5 auto-engage triggers (T1..T5)

1. **T1** — user NL keyword: `24h / 通宵跑 / 通宵 / 夜跑 / 夜机 / 不计成本 / 不停机`.
2. **T2** — at least 30 active slices AND ≥ 6h wall-clock since the last handoff.
3. **T3** — ≥ 3 monotonic-guard fires AND ≥ 10 slices remaining.
4. **T4** — session gap ≥ 4h (resume from a previous long-run).
5. **T5** — ≥ 3 active slices for 24h-mode restart.

T3 and T4 auto-engage 24H_ACTIVE. T1/T2/T5 surface for LLM judgement via `peaks session 24h-mode transition --state 24H_ACTIVE --reason <text>`.

### 3 decision buckets

- **Bucket A — auto-engage 24H_ACTIVE** (T3 / T4 only). No brainstorming gate; skip the reference-only bridge.
- **Bucket B — reference-only brainstorming bridge** (non-T3/T4). Run the existing 11-step runbook through the brainstorming sub-step, then continue.
- **Bucket C — user-confirm gate** (T1/T2/T5). Surface `peaks session 24h-mode transition --state USER_CONFIRM`; the LLM surfaces AskUserQuestion.

### Integration surfaces (rid-020b)

- `peaks code run --24h` — T3/T4 path auto-engages; non-T3/T4 routes through Bucket B.
- `peaks dashboard long-run --since 24h` — read-only indicator view (dispatch / autoCompact / monotonicTrigger / subAgentFailure / checkpointFrequency).
- `peaks session 24h-mode state|transition|attempts|reset` — state-machine backbone (rid-020a).

### Red lines (peaks-code side)

- No auto-compact prose ban. Never write "ask the user to compact" / "prompt the user to run `/compact`" / "the user should run `peaks compact auto` manually" / "the user is responsible for context management" / legacy 50/75/90 percent tiers. The 0.85 / 0.95 contract is mandatory.
- SquabbyZ sole-author rule: no `Co-Authored-By: Claude/Anthropic` trailer in any commit.
- 24h mode is a flag on `peaks-code`; it MUST NOT introduce a sibling `peaks-24h` skill or a competing CLI top-level verb.

## 24h mode spill/hydrate (opt-in experimental, rid-032)

When 24h mode is active and an in-flight sub-agent batch is detected, the LLM MAY persist its current turn context to disk through the `session spill-demo` helper, supplying the active session identifier and optionally the batch identifier.

This creates a `SpillRecord` in `.peaks/_runtime/<sessionId>/spill/` with a sample payload. The LLM can coordinate richer payload support in a future slice. When the batch lands, the LLM MAY inspect the 24h-mode state through the existing session state surface and continue from the hydrated record.

The hydrate round-trip is idempotent, and the existing in-flight deferral still works without spill/hydrate.

**This is opt-in experimental.** The LLM is not required to call spill/hydrate. Real production behavior remains governed by the existing in-flight deferral branch in the orchestrator, which rid-032 does not modify.

## Peaks-Loop Superpowers 协作边界 (BRIDGE — MANDATORY, effective 2026-07-24)

This chapter pins the boundary between `peaks-code` and the **superpowers** skill family (`brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `verification-before-completion`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `receiving-code-review`, `using-superpowers`, `using-git-worktrees`, `finishing-a-development-branch`). Boundary is closed under slice 2026-07-24-peaks-code-bridge-002-rootcause.

- superpowers skills are **reference material**, not workflows peaks-code runs. They may NOT auto-replace peaks-rd, peaks-qa, peaks-ui, peaks-sc, or peaks-txt.
- When a user (or the IDE) suggests invoking `superpowers:brainstorming` or `superpowers:writing-plans`, peaks-code MUST:
  1. Run the superpowers skill as a **reference** to seed its own PRD/RD artefacts.
  2. Re-author the resulting plan as a peaks-rd PRD artefact under `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md`.
  3. Continue peaks-code's 11-step sequence from Step 3 (sub-agent fan-out) — never the superpowers plan execution.
- `superpowers:writing-plans` and `superpowers:executing-plans` are **NOT** dispatched directly. peaks-rd is the only authoritative planner / executor pair. (`writing-plans` upstream SKILL.md is superpowers-owned and is intentionally NOT edited — peaks-code/SKILL.md + runbook + boundaries + external-skill-invocation carry the bridge.)
- Any peaks-managed hook entry emitted by `peaks hooks install` MUST originate from `src/services/hooks/*.sh` in the peaks-loop repo. LLM-improvised hook scripts are forbidden (001-bridge root cause).
- Before any LLM edit to `~/.claude/skills/<skill>/*`, verify the path is a junction (`fsutil reparsepoint query` on Windows / `readlink` on POSIX). If it is a real directory, STOP and re-route via `peaks skill sync` after a junction rebuild — never write to a real directory (would pollute the npm sync chain).
- Mandatory closure: every peaks-code request MUST finish `peaks request transition` through `spec-locked → implemented → qa-handoff → handed-off` plus `peaks memory extract`. Half-finished state files are treated as pollution and the LLM MUST NOT exit without a transition note.

**Self-check (read before any tool call):** *Is the tool I am about to call a superpowers auto-runner, or a peaks-rd / peaks-qa sub-agent dispatch?* If it would short-circuit peaks-rd, STOP and dispatch via `peaks sub-agent dispatch rd`.

## Peaks-Loop Startup sequence (MANDATORY — execute in order)

Full content extracted to **`references/startup-sequence.md`** (Steps 0 / 0.5-0.87 / 1 / 2 / 2.3 / 2.5 / N / N+1 / N+2 + sub-agent sharing + boundaries). Read that file in full at session start; the sequence is MANDATORY.

## Peaks-Loop Step 0.8 — Job-shape detection (BLOCKING on LLM judgement)

> **BLOCKING on LLM judgement.** Before Step 1 mode selection, Code MUST surface a Job-shape decision via `peaks code detect-job` and persist it to `.peaks/_runtime/<sessionId>/job-shape.json`. The CLI is a recorder + gate — the LLM makes the judgement; downstream steps call `read-job-shape` and refuse if missing. See `references/step-0-8-gate.md` for the full contract (LLM criteria, action sequence, hard rule red-line #10). Failure mode: skipping `peaks code detect-job` blocks the workflow at the next `read-job-shape` call (`JOB_SHAPE_NOT_DECIDED`).

**v3.1.2 mechanical gates** (the recorder-only design was bypassed twice under load; the gate must be un-bypassable):

1. **PreToolUse hook — `peaks code gate-step-08`.** Installed by `peaks workspace init` on the `Bash` matcher; checks `job-shape.json` presence + fail-closed backup regex. If `job-shape.json` exists AND `progress.json` exists, surfaces `Next: slice #N of M (<currentSlice>)` so the LLM cannot wake up cold.
2. **Size-fear ban — `peaks code emit-handoff`.** Refuses to emit a final handoff while `remaining > 0` under Job mode. Pass `--force-under-job` only with explicit user approval.
3. **On-disk slice progress — `peaks job progress`.** `peaks job checkpoint --state done` writes `progress.json`. `peaks job progress --job-id <jid> [--allow-missing]` is the canonical reader; `peaks code gate-step-08` also surfaces it on every Bash call.
4. **Forced auto-compact — `--enforce-job-mode`.** `peaks code context-now --enforce-job-mode` returns `action: 'auto-compact-now'` at ≥ 0.85. **Job mode at ≥ 0.85 is MANDATORY auto-compact** — Code MUST call `peaks compact auto --execute` without confirmation.

**Step 0.7 resume rule (read-FIRST):** on resume, `peaks code gate-step-08` reads `progress.json` first and surfaces `Next: slice #N of M (<currentSlice>)` so the orchestrator picks up at the right slice without re-reading the artifact tree.

### Peaks-Loop Step N+2: Auto-compact at the warning line (v2.13.0 zero-pause contract)

> **Zero-pause contract.** When context usage crosses the pre-compact threshold, peaks-loop **automatically fires `peaks compact auto --execute` — the LLM does NOT prompt the user to run `/compact` manually**. This is the single biggest UX regression vector in the system: a stale prose that says "ask the user to compact" will silently send the LLM into "wait for human" mode and stall the entire workflow. The v2.13.0 contract makes auto-compact a system responsibility, not a user action.

**Thresholds (v2.13.0, replacing legacy 50/75/90):**

| ratio zone | zone name | action |
|---|---|---|
| `< 0.85` | normal | skip — LLM keeps working, no action |
| `0.85 ≤ ratio < 0.95` | **pre-compact zone** | `peaks compact auto --execute` fires **automatically** (deferred only if an in-flight sub-agent batch is still running; fires the moment the batch lands). The LLM does not prompt the user. |
| `ratio ≥ 0.95` | **red-line (Karpathy §4 compact-red-line exception)** | synchronous gate — `peaks compact auto --execute` is invoked immediately; `peaks code context-now` returns `action: 'red-line'` and refuses to advance until ratio drops below 0.85. **Karpathy §4 treats this as an automatic exception** — the LLM cannot opt out. |

**Probe primitive (single source of truth):** `peaks code context-now --json`. Do NOT use `peaks context check --prompt-size` (deprecated, pre-v2.13.0 surface; will silently under-report ratio). The CLI returns `{ ratio, action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line' }` — Code reads `action` and dispatches `peaks compact auto --execute` on `auto-compact-now` or `red-line` without any user confirmation.

**Enforcement layers (defense in depth — no single layer is the gate):**

1. `src/services/code/auto-compact-orchestrator.ts` — `evaluateAutoCompactDecision` default-returns `shouldCompact: true` for both `pre-compact` and `red-line` zones. The only deferral is `inFlightBatch.hasInFlightBatch` (D6.e); no LLM / human approval branch.
2. `--enforce-job-mode` (v3.1.2) — Job mode elevates ≥0.85 to MANDATORY regardless of in-flight batch (see Step 0.8 §4 above).
3. `peaks code gate-step-08` (PreToolUse hook) — surfaces `auto-compact-now` on every Bash call when ratio is in the zone, so the LLM cannot wake up cold and forget.
4. The Karpathy §4 exception: `peaks compact auto --execute` is fired *by the orchestrator*, not by the user running `/compact`. If you find yourself about to write prose that says "ask the user to compact" or "prompt the user to run `/compact`", STOP — that is the regression.

**Anti-pattern (regression marker — DO NOT introduce):** any of these strings in skills/* or comments signals the zero-pause contract has been broken:

- "ask the user to compact"
- "prompt the user to run `/compact`"
- "the user should run `peaks compact auto` manually"
- "the user is responsible for context management"
- legacy pre-v2.13.0 thresholds (mid / seventy-five / ninety percent tiers; current is 0.85 / 0.95)

If the prose audit (`peaks audit red-lines`) flags any of the above, the slice is **blocked** until the prose is rewritten.

## CLI Drift Index (sediment 2026-07-09)

> **Reading guide:** Verified against peaks-loop 4.0.0-beta.6. Each drift below is annotated inline at the relevant step with a `> CLI reality check`. On `error: unknown option ...`, **read the inline reality check first** before guessing.

| Drift ID | Step | Symptom | Fix | Inline location |
|---|---|---|---|---|
| **D-001** | 0.8 | `peaks code detect-job --is-job ...` rejected with `error: unknown option '--is-job'` | Use `peaks job init --job-id <jid> --slice-list <list> --main-loop-strategy <single\|rotating>` | §Step 0.8 first paragraph |
| **D-002** | 2.5 | `peaks session title --session-id <sid> ...` rejected with `error: unknown option '--session-id'` (this is the bare `<sid>` anti-pattern) | sid is positional: `peaks session title <sessionId> "<title>" --json` | §Step 2.5 |
| **D-003** | 0.8 | `JOB_SHAPE_NOT_DECIDED` exception expected but never thrown | Current behavior is `peaks job status` reports `done: 0` passively — treat as recoverable miss, not hard error | §Step 0.8 third paragraph |
| **D-010** | 11c | `peaks memory extract` returns `extractedCount: 0` despite `<!-- peaks-memory:start -->` existing | Block requires YAML frontmatter (`title:` + `kind:` + `---`) + closing `<!-- peaks-memory:end -->`. Bare `peaks-memory:start` is parsed silently but produces no writes | §Step 11c + 11d |

> **Sediment lesson (master record):** `.peaks/memory/peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010.md`

## Peaks-Loop GStack integration

Map gstack stages to Peaks-Loop role artifacts; preserve confirmation gates. → `references/gstack-integration.md` + `references/browser-workflow.md`.

## Peaks-Loop Local intermediate artifact workspace (MANDATORY)

Step 0 creates the workspace; all intermediate artifacts land under `.peaks/_runtime/<sessionId>/`. NEVER write Peaks-Loop intermediate artifacts to the project root.

## Peaks-Loop Pre-RD project scan checklist (MANDATORY)

Before handing off to `peaks-rd`, scan the project and record findings to `.peaks/project-scan/project-scan.md` (project-level, git-tracked; sibling of `.peaks/PROJECT.md`). Slice 2026-07-15-project-scan-bootstrap (G1 + G2): `peaks workspace init` and `peaks project context` both bootstrap this file automatically; only re-run the manual flow when the scan output is genuinely out of date. → `references/project-scan-checklist.md`.

> **Slice 2026-07-15-project-scan-bootstrap G4b / AC9:** after `peaks workspace init`, the consumer project's `.peaks/project-scan/` directory carries 5 files: `project-scan.md` (generated by the scan logic) + `business-knowledge.md` + `security-template.md` + `perf-template.md` + `audit-output-schema.md` (the 4 audit/business templates bundled at `src/services/workspace/templates/project-scan/*.md`, copied on init; idempotent — existing files preserved unless `--force-project-scan-templates`). RD / UI / TXT / QA read from this tree; nothing else.

## Peaks-Loop Frontend-only development mode

When the project has no live backend (no swagger.json, no API server), Code must activate frontend-only mode. The CLI is authoritative — read `frontendOnly` and `frontendOnlyReason` from `peaks scan archetype --json`. → `references/frontend-only-mode.md`.

## Peaks-Loop Request type classification + Workflow order + Transition verification gates

The 6-type table + 11-step order + 7 transition gates (A-G) live in `references/workflow-gates-and-types.md`. peaks-code narrative references Gate A-G — keep both files in lockstep.

## Peaks-Loop Default sub-agent fan-out (≥ 2 leaves/topological level → `--from-dag`)

> **Slice 5:** when the slice DAG has ≥ 2 leaves at one topological level, dispatch via `peaks sub-agent dispatch --from-dag <dag-file>` (wall-time ≈ max, not sum).

Write DAG → `.peaks/_runtime/<sessionId>/sc/slice-dag.json`, run `peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>` once; orchestrator emits N parallel `buildToolCall` (`dispatchCount === N`). 主路径 = 唯一蜂群;config/docs/chore 跳过不打断。详见 `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`。

### Hard constraint: fan-out is mandatory (slice 2026-06-24-audit-5th-p2)

> **No serial opt-out.** `preferences.fanout.defaultMode = 'serial'` was removed in 2.8.4; legacy values auto-migrate to `fan-out`.

→ see `references/swarm-dispatch-contract.md`, `references/sub-agent-dispatch.md` (NOT `Skill` tool), `references/fanout-mandatory.md`.

## Slice 调度:分层并行 + 上游同步(2026-06-28 校准)

> 分层并行(G12)+ 上游同步(G11)见 `.peaks/memory/peaks-loop-fork-sync-and-layered-parallel.md`。

## Peaks-Loop Mandatory RD QA repair loop (AUTO-PROCEED)

After `peaks-rd` finishes, Code MUST auto-route to `peaks-qa` without waiting for confirmation. Cap: 3 cycles; on 3rd failure emit blocked TXT handoff. Full 5-step procedure at `references/micro-cycle.md`.

## Default runbook

The end-to-end CLI sequence for `full-auto` lives in `references/runbook.md`. `assisted`/`strict` pause at `[CONFIRM]`; `full-auto`/`swarm` auto-proceed.

When adding new CLI commands, mirror into `references/runbook.md` and `tests/unit/skill-default-runbook.test.ts` (test falls back to the reference).

## RD micro-cycle (TDD small-step rapid-test loop)

> **Slice 内部**的修复 / refactor / lint 修复走 micro-cycle（5-10s/cycle）；Slice 边界走 `peaks slice check`。完整手册：`references/micro-cycle.md`。

## Peaks-Loop Project standards preflight

Gather via `peaks standards init/update --project <path> --dry-run`. Standards must reflect the project scan (component library, CSS, build tool, state, routing) — never emit a generic template.

## Peaks-Loop Refactor mode

Read `references/refactor-mode.md` first. Default MVP: `peaks-code refactor`. Red lines: understand before changes, ≥95% UT coverage, split broad refactors, strict verifiable specs, 100% acceptance per slice.

## Peaks-Loop Quality-gate commands (CLI cheat sheet)

Five CLI commands harden the workflow against silent skips: `peaks request lint`, `peaks request repair-status`, `peaks scan request-type-sanity`, `peaks scan libraries`, `peaks slice check` (plus `peaks request transition`). See `references/quality-gate-cheatsheet.md`.

## Peaks-Loop Completion handoff

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Use Peaks-Loop TXT for the compact handoff capsule. **Presence management is delegated to the last downstream skill** — peaks-code does not call `peaks skill presence:clear` itself.

## Peaks-Loop Step 11: Memory sediment (BLOCKING on workflow complete)

> **Hard rule.** Code MUST NOT declare a workflow complete until Step 11 has produced ≥ 1 file in `.peaks/memory/` OR the user has explicitly approved a no-sediment outcome via AskUserQuestion. Canonical CLI: `peaks memory extract --project <repo> --artifact .peaks/_runtime/<sessionId>/txt/handoff.md --apply --json` (the artifact-scoped extract; the batch-scoped sibling `peaks project memories:extract` is for non-handoff flows only). Substeps 11a/11b/11c/11d (Gate A/B/C), D-010 fix root cause check → `references/step-11-memory-sediment.md` + `references/runbook.md` §Step 11.

## Peaks-Loop External references and lifecycle

3rd-party integrations (codegraph, mattpocock/skills, shadcn/ui, MCPs, Context7) follow Discovery → Reference → Side effect through Peaks CLI only. Run `peaks capabilities` for capability discovery; treat external skills as reference material only. MCP servers (Playwright / Chrome DevTools / Figma) are user-installed — check the tool list for `mcp__<server>__*` entries. Do not execute upstream installer / run upstream commands / persist sensitive examples / install upstream resources directly — funnel side effects through the Peaks CLI surface. Peaks-Loop Code gates remain authoritative. → `references/external-references.md` + `references/external-skill-invocation.md`.

## Codegraph orchestration context

`peaks codegraph affected` is an optional project-analysis enhancement (untrusted supporting evidence) for role handoff. Code must not treat codegraph output as approval for scope, design, or QA verdict. Never mutate agent settings / hooks from codegraph; do not commit `.codegraph/` artifacts. RD writes `.peaks/_runtime/<sessionId>/rd/codegraph-context.md`; QA / TXT consume the same envelope. → `references/codegraph-orchestration.md`.

## Sub-agent context governance (G7 + G7.7 + G8 + G9 — slice #010)

Main LLM reducer sees metadata-only view (~200 chars/sub-agent); on-demand `Read` for full content. Threshold table: 50% soft warn, 75% `CONTEXT_NEAR_LIMIT`, 80% hard reject (CLI + hook double-guard). → `references/context-governance.md`.

## Sub-agent cross-batch signal — G8.4 share / shared-read / await

Three CLI primitives: `peaks sub-agent share / shared-read / await` (last-write-wins, ≤ 1KB warn / ≥ 64KB reject). Channel gitignored under `.peaks/_sub_agents/<sessionId>/shared/`.

## References

Index of every `references/` file. Read on demand.

| File | Coverage |
|---|---|
| `references/dag-orchestrator.md` | DAG-aware sub-agent dispatch. |
| `references/a2a-artifact-mapping.md` | A2A artifact-path mapping. |
| `references/anchoring-and-session-info.md` | Step 0 + session-conflict. |
| `references/artifact-contracts.md` | Sub-agent handoff contracts. |
| `references/boundaries.md` | Code's do / don't list. |
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