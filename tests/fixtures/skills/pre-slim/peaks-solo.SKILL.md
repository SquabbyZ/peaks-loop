---
name: peaks-solo
description: Full-auto orchestration facade for the Peaks-Cli skill family. Use when the user asks Peaks-Cli to handle a project workflow end-to-end (端到端/全流程/需求开发), especially from a product document (产品文档/PRD/飞书文档/Feishu doc) through implementation and validation. Coordinates peaks-prd, peaks-rd, peaks-ui, peaks-qa, peaks-sc, and peaks-txt while preserving user confirmation gates. Triggers on `/peaks-solo`, "peaks solo", "全流程开发", "端到端迭代", "根据产品文档开发", "从需求到上线".
---

## Two-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by **two orthogonal axes**. Every path in this SKILL.md uses one of them; mixing them is the original `.peaks/_runtime/<sid>/` / `.peaks/_runtime/<sid>/` bug class this slice corrects.

| Axis | Path root | Holds | When to use |
|---|---|---|---|
| **change-id axis** (reviewable artifacts) | `.peaks/_runtime/<changeId>/...` | PRD, RD plan, code-review, security-review, test-cases, handoff capsules, gate targets | The artifact should be reviewable on its own and survives across sessions for the same change. Change-id is the unit of work. |
| **session-id axis** (ephemeral state) | `.peaks/_runtime/<sessionId>/...` | Session bindings (`.peaks/_runtime/session.json`), live in-flight state, the per-session project-scan and tech-doc scaffold while the session is open | The artifact is session-scoped and only meaningful while the parent session is live. |
| **sub-agent axis** | `.peaks/_sub_agents/<sessionId>/...` | Sub-agent dispatch records, sub-agent heartbeats, per-sub-agent shared channel entries, sub-agent artifact outputs | A sub-agent ran in a parent session. The axis nests under the parent session-id; sub-agent outputs are flushed into the change-id root on commit. |

**Which CLI commands operate on which axis:**

- **change-id axis** (reviewable artifacts): `peaks request init`, `peaks request transition`, `peaks request show`, `peaks request lint`, `peaks request repair-status`, `peaks scan diff-vs-scope`, `peaks scan acceptance-coverage`. Inputs reference `.peaks/_runtime/<changeId>/...`.
- **session-id axis** (ephemeral state): `peaks session info`, `peaks session start`, `peaks session finish`, `peaks session list`. Reads/writes `.peaks/_runtime/<sessionId>/session.json`.
- **sub-agent axis** (under parent session-id): `peaks sub-agent dispatch`, `peaks sub-agent heartbeat`, `peaks sub-agent share`, `peaks sub-agent shared-read`. All output paths are under `.peaks/_sub_agents/<sessionId>/...`.

**Placeholder convention used in this file:**

- `<changeId>` / `<change-id>` — the change-id axis. Use when describing a path that lives at `.peaks/_runtime/<changeId>/...` (root-level, NOT inside `_runtime/`).
- `<sessionId>` / `<session-id>` — the session-id axis. Use when describing a path that lives at `.peaks/_runtime/<sessionId>/...` or `.peaks/_sub_agents/<sessionId>/...`. The long form `<session-id>` is used inside bash / shell examples where `<sessionId>` would break parsing.
- The bare `<sid>` placeholder is **forbidden** in new content — it is ambiguous between the two axes. Legacy occurrences are replaced by this convention; new content must use the right axis label.

**Cross-references:**

- Slice `2026-06-05-change-id-as-unit-of-work` (commits `48958fc` + `928eb53`) — established the change-id axis as the canonical root for reviewable artifacts (`src/shared/change-id.ts:131,335`, `src/services/scan/acceptance-coverage-service.ts:155`).
- Slice `005-session-runtime-dir-regression` (commit `178a47e`) — added the `getSessionDir()` resolver at `src/services/session/getSessionDir.ts` and routed 4 stragglers that were constructing `.peaks/_runtime/${sessionId}` (no `_runtime/`) through the canonical resolver. Defense-in-depth scan: `tests/unit/services/session/session-dir-canonical.test.ts`.
- Slice `006-5th-writer-changeid-path` (this slice) — disambiguates the SKILL.md placeholders and adds the regression test `tests/unit/skills/skills-skill-md-naming.test.ts` that mechanically enforces (a) zero bare `<sid>`, (b) every `.peaks/_runtime/<X>/` reference has an axis label, (c) the "Two-axis naming convention" callout is present in `peaks-solo`, `peaks-rd`, `peaks-qa`.

# Peaks-Cli Solo

Peaks-Cli Solo is the orchestration facade for the Peaks-Cli short skill family.

Use this skill to identify the user scenario, recommend an execution mode, coordinate role skills, and produce the final handoff report. Do not collapse role responsibilities into this skill.

## Skill-first architecture note (read once, internalise)

This skill is the **primary surface**. The `peaks <cmd>` CLI is **auxiliary** — invoked by the skill prompt when a primitive is the right tool (atomic side effect, machine-enforced gate, structured JSON for a downstream decision, or backstop the LLM cannot skip). Concretely:

- Behaviour that only an LLM in a skill prompt would use (e.g. "scan a handoff for memory blocks", "decide if a stable fact deserves persistence") lives **here in the SKILL.md**, not as a new CLI command.
- The CLI earns its keep when it is (a) hook- / script- / CI-invokable, (b) the consumer needs a structured JSON envelope to gate a downstream decision, or (c) it is a destructive side effect that needs an explicit `--apply` opt-in.
- When you reach for `peaks <X> --project <repo> --json` in a runbook step, that command is the **contract** you are calling; the LLM work around it (deciding what to pass, interpreting the response, deciding the next step) is what this skill owns.

See `.claude/rules/common/dev-preference.md` for the full dev policy and the decision template. The user-facing consequence: every iteration on this skill and the rest of the peaks-* family is judged first by "is this skill work or CLI work?", and only the latter opens a new command.

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

**Mechanism for "RD work" / "QA work" depends on the orchestration mode** (full details in "Peaks-Cli Swarm parallel phase" and "How Solo invokes another role"):

| Mode | Swarm side (after PRD) | Repair loop side (RD↔QA) |
|---|---|---|
| `full-auto` / `swarm` | `peaks sub-agent dispatch <role>` — IDE-agnostic dispatch primitive; CLI returns a tool-call descriptor the LLM executes in its own environment | `peaks sub-agent dispatch <role>` per cycle |
| `assisted` / `strict` / inline-fallback | Solo executes the role steps inline in the main loop (the `peaks-solo` skill IS the role's owner) | Solo executes inline |

In all modes, the work itself follows the same `peaks-rd` and `peaks-qa` contracts. The only difference is whether the role's body is being read by a sub-agent Task prompt or by Solo's own main loop. **Never bypass the role contracts regardless of which path runs.**

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

After the workspace is anchored, before project scan, Solo checks whether
the project already has an `openspec/` directory. The lifecycle
(`render → validate → show → to-rd → validate → archive`) only applies
when `openspec/` exists; without it, RD/QA/SC silently skip the
openspec-aware paths and you lose change-proposal tracking, commit
boundaries from `tasks.md`, and the historical archive.

To make that opt-in visible instead of silent, Solo runs:

```bash
# 1. Detect whether the project already has openspec/.
ls <repo>/openspec/changes 2>&1
# 2. If absent, ask the user once — only on the first Solo run in this
#    project. The decision is sticky: write it to .peaks/.peaks-openspec-opt-in.json
#    so subsequent Solo invocations do not re-ask.
test -f <repo>/.peaks/.peaks-openspec-opt-in.json || \
  echo "{\"enabled\": <bool>}" > <repo>/.peaks/.peaks-openspec-opt-in.json
```

**AskUserQuestion** (only when `openspec/` is absent and the opt-in
file is missing):

| Option | What it does |
|---|---|
| Enable OpenSpec for this project (Recommended) | Run `peaks openspec init --project <repo> --apply`. After that, every Solo run uses the change-proposal lifecycle for the same project. |
| Skip for now | Do nothing. Solo proceeds without openspec; the question is re-asked on the next first-run detection. |
| Never ask again for this project | Write `{enabled: false, sticky: true}`. Solo stops asking. The user can re-enable later by removing `.peaks/.peaks-openspec-opt-in.json` and re-running. |

The first option is the recommended default because it gives Solo the
full change-proposal lifecycle (proposal / tasks / design / specs
deltas, archive on ship, commit boundaries from `tasks.md`). It costs
only a single scaffolded directory and pays back the first time the
project needs a real review trail.

If the user picks "Enable", the only required follow-up is to make
sure `openspec/changes/` is added to git (it is part of the project
repo, not a tool-managed artefact). Solo does not run `git add` for
the user; that is the user's commit boundary.

### Peaks-Cli Step 0: Anchor the workflow (MANDATORY FIRST ACTIONS — no bail-out)

The instant Peaks-Cli Solo is invoked, **before** the mode-selection question, before any analysis, and before you decide whether the request "needs" the full pipeline, you MUST run these two commands and see their output:

```bash
# Session ID is auto-generated when omitted; the command returns it in the JSON output.
# Do NOT pass --session-id manually — the CLI is the single source of truth for the
# project session binding. To look up the active session id from a skill / sub-agent,
# use `peaks session info --active --json` (read-only, no side effects). To avoid
# the "two sessions in .peaks/" confusion that bites Solo, always omit --session-id
# here and let the CLI auto-generate.
peaks workspace init --project <repo> --json
peaks skill presence:set peaks-solo --project <repo> --gate startup
```

> `<repo>` is the **git project root** (the directory containing `.git`). In a monorepo / single-repo-multi-package layout, this is the repo root, NOT a sub-package — `.peaks/` lives at the repo root so every package shares one workspace. If unsure, run `git rev-parse --show-toplevel` and use that path. Never let `.peaks/` land inside a sub-package directory.

**There is no request too lightweight to skip this.** "分析下这个项目", "看一下代码", "分析项目", "解释一下架构", a one-line question — all of them still create the workspace and set presence first. The workspace is cheap; a missing `.peaks/` is the #1 reported failure.

**Anti-bail-out rule (BLOCKING):** You MUST NOT exit the peaks-solo workflow, hand control back, or produce a final answer before Step 0 has run. If you catch yourself thinking "this is just analysis, I don't need the workflow" — STOP. Run Step 0, set presence, then continue. A pure-analysis request runs the **lightweight analysis branch** (project scan + standards dry-run + handoff with a Standards-increment section), but it still anchors the workspace and keeps presence active. Declining to anchor is a workflow violation.

**Session conflict resolution (read once, internalise):** If `peaks workspace init` returns `code: "CONFLICTING_SESSION"` with a body like
`{"existingSessionId":"<Y>","requestedSessionId":"<X>"}`, the project is already bound to a different in-flight session `<Y>` (the one you or a prior run was working on). The fix is **NOT** to pass `--allow-session-rebind` to clobber `<Y>` — that destroys an active session's data. Instead: finish or abandon `<Y>` first (use `peaks session list --json` to see what it is, then `peaks session finish --id <Y>` or `peaks session abandon --id <Y>` — see your session command's help for the exact verbs). Only after `<Y>` is closed should you re-run `peaks workspace init`. The same rule applies to `peaks workspace init --session-id "<manually-forged>"` — do not pre-forge session ids; the CLI's auto-generated value is the binding.

`presence:set` accepts no `--mode` here on purpose — mode is unknown until Step 1. It is re-run with the selected mode in Step 2. Setting presence early guarantees the status header/line shows `peaks-solo` from the very first turn even if the user never reaches mode selection.

### Peaks-Cli Step 0.7: Detect unfinished work and offer resume (BLOCKING on first invocation per session)

After Step 0 has anchored the workspace and presence, before Step 1 mode selection, run the resume-detection probe. If the current session has in-flight slice artifacts, the user is most likely "continuing" — surface resume options instead of starting a fresh PRD.

**Why this is a separate step** (per `feedback_peaks_solo_natural_language_primary` — a high-frequency request shape, see also the user's "继续完成刚才为完成的" pattern from session `2026-06-04-session-b60252`): the LLM was previously re-reading 3-5 artifact files to determine workflow state, wasting 3-5k tokens per resume request. This step replaces that work with a single deterministic read.

**Detection logic** (all read-only, no side effects; uses only existing CLIs):

```bash
# 1. Confirm the current session id via the read-only CLI primitive
#    (the on-disk binding file is internal — never `cat` it directly)
sid=$(peaks session info --active --project "$(git rev-parse --show-toplevel)" --json | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sessionId'])")

# 2. Enumerate the session's artifact tree (one `find` call, no new CLI)
find ".peaks/$sid/" -type f 2>/dev/null | sort

# 3. For each role request artifact present, read its `state:` field
#    (one-pass grep; only files that exist)
for f in .peaks/$sid/prd/requests/*.md .peaks/$sid/rd/requests/*.md .peaks/$sid/qa/requests/*.md; do
  [ -f "$f" ] && echo "$f: $(grep -m1 '^state:' "$f" | awk '{print $2}')"
done

# 4. Compute "deepest completed gate" by file-presence + state mapping
#    (see classification table below)
```

**Classification table** (file-presence + state → "deepest completed gate"):

| Files present | State | Deepest completed gate | Resume point (if any) |
|---|---|---|---|
| only `.peaks/$sid/.session.json` | (no slice) | (none) | fresh — skip to Step 1 |
| `prd/requests/<rid>.md` | `state: handed-off` | Gate B (swarm converged) | resume at Step 3 (swarm) — but if swarm already ran and produced `rd/tech-doc.md` / `qa/test-cases/<rid>.md`, drop to deepest |
| `rd/requests/<rid>.md` | `state: qa-handoff` | Gate C (RD done) | resume at Step 6 (QA validation) |
| `qa/requests/<rid>.md` | `state: verdict-issued` | Gate D (QA done) | resume at Step 10 (TXT handoff) |
| `txt/handoff.md` | (any) | Gate E (workflow complete) | this session is closed — user is starting new work |

**Other resume triggers** (file-presence, no state read needed):

| Missing file | Resume at |
|---|---|
| `rd/tech-doc.md` (for `feature`/`refactor`) or `rd/bug-analysis.md` (for `bugfix`) | Step 3b (RD planning) |
| `rd/code-review.md` or `rd/security-review.md` | Step 5 (RD review fan-out) |
| `rd/perf-baseline.md` (for `feature`/`refactor`) | Step 5 (perf baseline) |
| `qa/test-cases/<rid>.md` | Step 6 (QA test-case generation) |
| `qa/test-reports/<rid>.md` or `qa/security-findings.md` or `qa/performance-findings.md` | Step 6 (QA execution) |
| `txt/handoff.md` | Step 10 (TXT handoff) |

**AskUserQuestion** (only if a resume is detected; default option is "Resume from the deepest missing gate"):

| Option | What it does |
|---|---|
| Resume from `<gate>` (Recommended) | Skip ahead to the matching step, preserving all existing artifacts. The LLM does NOT re-read the existing artifacts — it trusts the classification and proceeds. |
| Start a fresh slice | Keep the workspace, treat the current user request as a new slice (new rid). Existing artifacts are preserved but not auto-resumed. |
| Abandon the in-flight slice | Mark the in-flight slice as `deferred` (`peaks request transition … --state deferred`); start a new one. |

**Hard rule: never silently auto-resume.** Resume detection is the discovery; AskUserQuestion is the confirmation. Even if the user's request is "继续完成刚才为完成的" (continue the unfinished work), the skill must run this detection, surface the options, and wait for user confirmation before skipping ahead.

**Hard rule: never auto-resume a slice that is mid-implementation.** Resume only when the deepest completed gate is in {B, C, D, E}. For mid-implementation states (RD `state: implemented`, RD `state: running`, RD `state: spec-locked`, QA `state: running`, QA `state: blocked`), the slice is still in flight — the only valid option is "Resume from in-flight gate" (the user must confirm).

**Strict quality guarantee (per user's hard rule: "严格要保证不能比当前的效果差")**:
- If no in-flight slice is detected, this step is a no-op: zero extra commands beyond the existing Step 0 probe, zero extra token cost.
- If an in-flight slice is detected, the cost is one `find` + one `grep` loop (sub-millisecond) + one `AskUserQuestion` (one round-trip). The savings are 3-5k tokens (the cost of manually re-reading 3-5 artifact files).
- The dogfood test in `tests/unit/skill-resume-mode.test.ts` (8 cases, bash-fixture shim — the legacy interface used by `skills/peaks-solo-resume`) and `tests/unit/services/skill/resume-detector.test.ts` (24 cases, the canonical TypeScript classifier at `src/services/skill/resume-detector.ts`) together cover: (a) fresh / complete / resume:rd-planning / resume:qa-validation / resume:txt-handoff state-based classifications, (b) the "Other resume triggers" overrides (missing `rd/tech-doc.md` → `rd-planning`; missing `rd/code-review.md` or `rd/security-review.md` → `rd-review-fanout`; missing `qa/test-reports/<rid>.md` → `qa-execution`), (c) the mid-implementation distinction (`spec-locked` / `implemented` / `running` / `blocked` all return `in-flight:<state>`), (d) the primary-vs-abandoned filter (multiple RDs → spec-locked wins; single blocked RD stays primary; 2+ all-abandoned → fresh), (e) the legacy `.peaks/_runtime/<sessionId>/` path fallback, and (f) determinism across two invocations on the same fixture.

### Peaks-Cli Step 1: Mode selection

After Step 0 has anchored the workspace and presence, when the user invokes Peaks-Cli Solo without explicitly naming an execution profile, use `AskUserQuestion` to pick the profile. Present the recommended full-auto path as the first/default option with a practical description for each:

1. **Full auto (Recommended)** — Peaks-Cli handles planning, role coordination, validation, and compact handoff end-to-end while preserving required confirmation gates for risky or shared-state actions.
2. **Assisted** — Peaks-Cli proposes plans, artifacts, and checks, then pauses for user decisions at major workflow boundaries.
3. **Swarm** — Peaks-Cli maximizes safe parallel role/worker execution for larger RD or QA workloads while keeping reducer validation and artifact boundaries explicit.
4. **Strict** — Peaks-Cli uses the most conservative gates: explicit confirmations, strict slice specs, coverage evidence, QA acceptance, and commit boundaries before continuing.

Map the user's selection to the `--mode` flag value (used by `peaks skill presence:set`; `presence:set --mode` accepts any string, so the name matches the user-facing label rather than overloading "solo" which is also the skill name):

| User selects | `--mode` value |
|---|---|
| Full auto | `full-auto` |
| Assisted | `assisted` |
| Swarm | `swarm` |
| Strict | `strict` |

> Note: `peaks workflow route --mode solo|team` is a **different** CLI dimension (solo developer vs team flow) and is unrelated to the profile choice here. Do not conflate them.

If the user already names a profile in their invocation (e.g. `/peaks-solo --full-auto`, "用全自动模式"), skip this question and use the named profile directly.

### Peaks-Cli Step 2: Re-set skill presence with the chosen mode

Step 0 already set presence with no mode. Now that the mode is known (user selected or explicitly named), re-run presence:set so the header/status line shows the profile:

```bash
peaks skill presence:set peaks-solo --project <repo> --mode <mode-value> --gate startup
```

On the first presence:set in a project, ensure the out-of-band status bar is installed so the user can see at a glance that Peaks is orchestrating — it renders the active skill in Claude Code's terminal status line, independent of model output:

```bash
peaks statusline install --project <repo>   # idempotent; skips if already installed
```

Then display the compact status header: `Peaks-Cli Skill: peaks-solo | Peaks-Cli Gate: startup | Next: <one short action>`. Display this header on EVERY turn while the skill is active.

Update with `peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate <gate>` when gates change. The presence file persists across the full workflow lifecycle — do NOT clear it at workflow end.

### Peaks-Cli Step 2.3: Load project memory (durable, LLM-authored memories)

Before planning any work, read the project's persistent memory — durable memories that survive across sessions:

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory`, grouped by kind:
- **module** — code areas touched, with risk and rationale captured by past sessions
- **decision** — architectural choices, why they were made, what they affect
- **convention** — discovered project patterns (code style, naming, tooling)
- **rule** / **reference** / **project** — standing constraints, external pointers, and project context

Filter with `--kind <decision|convention|module|rule|reference|project|lesson>` when you only need one slice. Use this to understand what exists, what was decided, and what to avoid re-litigating. Memories are LLM-authored at approved checkpoints via `peaks memory extract`. The `lesson` kind is for LLM-discovered runtime lessons (e.g. "this project's antv6 Drawer uses `size` not `width`"); write them as `<!-- peaks-memory:start kind=lesson -->` blocks in the RD handoff or TXT handoff.

`.peaks/PROJECT.md` is a human-readable session timeline only — do NOT use it for LLM context.

### Peaks-Cli Step 2.5: Set session title

Extract a short (8-20 Chinese characters, or 4-10 English words) descriptive title from the user's first request. The title should capture the core task — e.g. "修复登录页OAuth回调异常", "添加暗色模式开关", "搭建项目基础架构". Then run:

```bash
peaks session title $(peaks session info --active --project "$(git rev-parse --show-toplevel)" --json | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sessionId'])") "<title>"
```

If the session directory already has a title (check via `peaks session list --json`), skip this step — the title is already set.

## Sub-agent session sharing (MANDATORY — one conversation = one sid)

When peaks-solo dispatches a sub-agent (peaks-rd, peaks-qa, peaks-ui, peaks-txt, peaks-sc), the sub-agent prompt MUST include the parent's session id. The sub-agent then passes `--session-id <parent-sid>` for any session-creating CLI call (e.g. `peaks request init --session-id <parent-sid>`). The sub-agent MUST NOT call `peaks workspace init` — that would create a new session dir and orphan the parent's binding. The sub-agent reads `.peaks/_runtime/session.json` to discover the parent's sid (or the orchestrator passes it explicitly). Sub-agents also accept the parent's sid via the new `peaks session info --active` primitive when they need a one-shot read.

Note: `peaks request init` is **dry-run by default** — the JSON response has `applied: false` and no file is written unless `--apply` is passed. This is the same safe-by-default pattern as `peaks workspace migrate --apply`. Sub-agents that need to actually create a slice must add `--apply`.

## Boundaries

Peaks-Cli Solo may:

- identify scenarios such as refactor, bugfix, QA hardening, release validation, and incident response;
- recommend Solo, Assisted, Swarm, or Strict profiles;
- coordinate Peaks-Cli role skills through artifacts;
- coordinate project memory extraction from stable skill artifact sections;
- request user confirmation at risk and commit boundaries;
- read CLI doctor/profile/artifact reports.

Peaks-Cli Solo must not silently:

- install hooks;
- create agents;
- enable MCP servers;
- modify Claude settings;
- create GitHub repositories;
- bypass role-skill artifacts.

Use the Peaks-Cli CLI for runtime side effects.

## Peaks-Cli GStack integration

Map gstack stages to Peaks-Cli role artifacts; preserve Peaks-Cli confirmation gates. Do not delegate orchestration to gstack commands.

For frontend workflows, RD and QA must use Playwright MCP for real browser E2E. The consuming LLM detects the MCP from its own tool list: any Playwright MCP entry in the LLM tool list means the MCP is installed; absent means the user needs to install (`claude mcp add playwright -- npx @playwright/mcp@latest` in Claude Code; other IDEs have their own MCP install path). The LLM invokes the tool directly (browser_navigate / browser_click / browser_snapshot / browser_take_screenshot / browser_console_messages / browser_network_requests / browser_close) by name — there is no peaks-cli indirection. Chrome DevTools MCP is a secondary CDP surface only. Sanitize browser artifacts before retention (no login URLs, cookies, tokens, PII). See `references/browser-workflow.md`.

## Peaks-Cli Local intermediate artifact workspace (MANDATORY)

### Workspace initialization gate

The workspace is created in Step 0 (Startup sequence) as a mandatory first action — before any analysis, role handoff, or artifact write, and regardless of how lightweight the request is. Session IDs are now **auto-generated** with the format `YYYY-MM-DD-session-<6位hex>` (e.g. `2026-05-26-session-a3f8b1`). The user does not provide a session ID — the system creates and persists it in `.peaks/_runtime/session.json` (the canonical home as of slice `2026-06-05-peaks-runtime-layer`; the legacy `.peaks/.session.json` is read-only back-compat for one minor release).

When `peaks workspace init` is run without `--session-id`, it automatically generates a new session ID using today's date and a random hex suffix. If a valid session binding exists at `.peaks/_runtime/session.json` (the canonical home, slice 2026-06-05-peaks-runtime-layer; the legacy `.peaks/.session.json` is read-only back-compat for one minor release), the existing session is reused. To read the active session id from a skill or sub-agent, use the `peaks session info --active --json` primitive — never `cat` the on-disk file directly (the path is internal).

**Existing old-session cleanup**: If `.peaks/` contains numeric-only or generic session directories from prior runs (e.g. `2026-05-25-auth-system`), create the new correctly-named session, migrate any reusable artifacts into it, and note the migration in the TXT handoff. Delete empty old-session directories.

```bash
peaks workspace init --project <repo> --json
```

The workspace initialization creates this structure under `.peaks/`:

```
# Canonical home for all per-project ephemeral state (active-skill
# marker, session binding, sop-state). All writes go here; reads also
# tolerate the legacy paths (`.peaks/.active-skill.json`,
# `.peaks/.session.json` — read-only back-compat for one minor release,
# `.peaks/sop-state/`) for one minor release so a fresh upgrade does
# not break in-flight workflows. Older trees are auto-migrated by
# `peaks workspace reconcile --apply`. Skills and sub-agents MUST
# NOT `cat` any of these files directly — use `peaks session info
# --active --json` (and the matching read-only primitives for the
# other two) to discover session-id / active-skill / sop-state.
.peaks/_runtime/
├── active-skill.json   # orchestrator presence marker (peaks-solo / -rd / -qa / -ui / -sc / -sop / -txt)
├── session.json        # project → session binding (the only single-session source of truth)
└── sop-state/          # current phase + history; definitions live globally in ~/.peaks

# Per-slice artifact dirs (auto-generated, one per session). Files
# inside ARE tracked by the 提交中间产物 convention.
.peaks/_runtime/<sessionId>/
prd/source/      # PRD source documents (Feishu exports, pasted content)
prd/requests/    # PRD request artifacts (goals, non-goals, acceptance, frontend delta)
ui/requests/     # UI request artifacts (visual direction, taste reports)
rd/requests/     # RD request artifacts (slice specs, coverage, CR findings)
rd/project-scan.md  # Project scan (session-scoped singleton, generated once per session)
qa/test-cases/   # QA test cases
qa/test-reports/ # QA test reports (regression matrices, browser evidence)
qa/requests/     # QA request artifacts
sc/              # SC artifacts (change-control, impact, retention, boundary)
txt/             # TXT artifacts (handoff capsules, lessons, memory extraction)
system/          # Existing-system extraction output (visual tokens, conventions)
```

Files written into these directories during the workflow (not pre-created — they appear as their step runs):

- `rd/project-scan.md` (Solo step 0.6)
- `rd/tech-doc.md` (feature/refactor planning; required by `rd → implemented` gate)
- `rd/bug-analysis.md` (bugfix planning; required by `rd → implemented` gate for `--type bugfix`)
- `rd/code-review.md`, `rd/security-review.md` (required by `rd → qa-handoff` gate for feature/bugfix/refactor; security-review only for config)
- `rd/mock-plan.md` (frontend-only mode)
- `ui/design-draft.md` (UI step)
- `system/existing-system.md` (Solo step 0.7; legacy projects only)
- `qa/test-cases/<rid>.md`, `qa/test-reports/<rid>.md`, `qa/security-findings.md`, `qa/performance-findings.md` (gated per `--type`)

### Root pollution prohibition (CRITICAL)

**NEVER write Peaks-Cli intermediate artifacts to the project root directory.** Specifically prohibited at root level:

- PRD snapshots, document extracts, or requirement notes (`feishu-doc-*.md`, `*-snapshot.md`, etc.)
- RD tech docs, scan reports, slice specs, or architecture notes
- QA screenshots, browser evidence, test reports, or validation logs (`.png`, `.jpg`)
- QA test helper files, mock servers, or fixture scripts (`qa-server.js`, etc.)
- UI design drafts, taste reports, or visual direction notes
- TXT handoff capsules or lesson files

Legitimate source files (e.g. `jest-setup.ts`, `tailwind.config.js`) belong at root — do not move them.

If you are about to Write/Edit an intermediate artifact in the project root, STOP. Create the `.peaks/_runtime/<sessionId>/` workspace first and write to the correct role subdirectory. If existing root-level artifacts from a prior run are discovered, move them into `.peaks/_runtime/<sessionId>/` and note the migration in the TXT handoff.

### Git and sync policy

Do not default to git-backed storage or automatic commits for intermediate artifacts. Git inclusion or sync requires explicit user confirmation or an active profile that authorizes it.

## Peaks-Cli Pre-RD project scan checklist (MANDATORY)

Before handing off to `peaks-rd`, scan the project and record findings to `.peaks/_runtime/<sessionId>/rd/project-scan.md`. RD and UI roles read this before starting work. **project-scan.md is a session-scoped singleton** — check if it already exists before regenerating (e.g. via `ls .peaks/_runtime/<sessionId>/rd/project-scan.md`). If it exists and is complete (has `## Archetype` and `## Project mode` sections), reuse it. Only regenerate if missing or incomplete.

**Full checklist lives in [`references/project-scan-checklist.md`](references/project-scan-checklist.md)**: project archetype detection (Peaks-Cli Gate from `peaks scan archetype`), build-tool / component-library / CSS-framework / state-routing-data tables, legacy signals, and the project-scan artifact template. Read that file before doing the scan.

## Peaks-Cli Frontend-only development mode

When the project has no live backend (no swagger.json, no API server), Solo must activate frontend-only mode.

**Full frontend-only contract lives in [`references/frontend-only-mode.md`](references/frontend-only-mode.md)**: mode determination (CLI is authoritative), mock-data strategy table by project data-fetching pattern, mock data rules, API contract placeholder pattern (`src/services/types/` + `src/services/` + `mock/`), mock-to-real migration path, and the Feishu document access fallback chain. Read that file before producing any mock files.

## Peaks-Cli Request type classification + Workflow order + Transition verification gates

The full contract for the 6-type classification table, the 11-step workflow order, and the 7 transition verification gates (A through G with their `ls` / `grep` shell snippets) lives in `references/workflow-gates-and-types.md`. The peaks-solo narrative in this SKILL.md references those gate numbers (Gate A through Gate G) — keep both files in lockstep when adding or renaming a gate. The reference file is the canonical contract; SKILL.md keeps the prose.


## Peaks-Cli Swarm parallel phase (sub-agent fan-out, conditional)

The Swarm phase is **conditional**, not unconditional. It only runs when there is a real, user-confirmed requirement. Solo derives the fan-out set from the PRD type and the request content — never from a default of "always launch three".

### Swarm gate (decide BEFORE fan-out)

Before launching any sub-agent, Solo must compute the **swarm plan** from three signals:

1. **PRD state** — `prd/requests/<rid>.md` must be in state `confirmed-by-user` or `handed-off`. If not, STOP. The Swarm is downstream of PRD, not a substitute for it.
2. **Request type** (`--type` from `peaks request init`):
   - `feature` / `refactor` / `bugfix` → RD(planning) and QA(test-cases) are always in the swarm
   - `config` / `docs` / `chore` → no swarm. RD/QA artefacts are not required by Gates B/C/D for these types. Skip the Swarm phase entirely and proceed to step 4 (RD implementation) with only the PRD in hand.
3. **Frontend touch** — does the request affect user-visible behavior? This is decided by:
   - Reading `.peaks/_runtime/<sessionId>/rd/project-scan.md` `## Project mode` for `frontendOnly` (project-shape signal)
   - **AND** scanning the PRD body for frontend keywords: 页面 / 组件 / 表单 / 弹窗 / 表格 / 样式 / 布局 / 交互 / UI / UX / page / component / form / modal / table / styling / layout / interaction
   - UI joins the swarm when (a) is `true` OR (b) matches. Both signals required `false` to skip UI.

Solo records the swarm plan in `.peaks/_runtime/<sessionId>/sc/swarm-plan.json` so SC and TXT can audit what was launched:

```json
{
  "rid": "<rid>",
  "type": "feature",
  "frontendOnly": true,
  "frontendKeywordHit": true,
  "subAgents": ["ui", "rd-planning", "qa-test-cases"]
}
```

Sub-agent presence in this list = Solo launched a Task for it. Absence = the role was skipped with documented reason.

### Mode-driven fan-out shape

| Mode | How the swarm plan is decided | What Solo does |
|---|---|---|
| `full-auto` | Compute plan from signals above, no question to user | Auto-launch all sub-agents in the plan in parallel |
| `swarm` | Same as `full-auto` | Same as `full-auto` (this profile name is historical — behavior is identical) |
| `assisted` | `AskUserQuestion` with three options: (a) Full — UI + RD(planning) + QA(test-cases); (b) Backend-only — RD(planning) + QA(test-cases); (c) Sequential — run RD first, then QA, skip UI | Use the user's choice as the plan |
| `strict` | Same as `assisted` (the question is informational; strict still enforces confirmation gates later) | Same as `assisted` |

In all modes, **the plan must be written to `sc/swarm-plan.json` before any Task call.** Solo updates `.peaks/.active-skill.json` to `gate=swarm-fan-out` at this point.

### Sub-agent mechanism (IDE-agnostic dispatch, NOT Skill tool)

**Solo is itself a skill running in the current session. To invoke a role in the Swarm, Solo MUST call the IDE-agnostic dispatch primitive `peaks sub-agent dispatch <role>` — NOT the `Skill` tool, NOT any IDE-private sub-agent literal.** The `Skill` tool is single-stack and blocking; using it for "parallel" work was the v1.x illusion of concurrency. The dispatch CLI is the only mechanism that keeps SKILL.md free of IDE-private tool names and lets the same prompt work on every registered IDE.

Each sub-agent dispatch call looks like:

```
peaks sub-agent dispatch <role> \
  --prompt "<paste peaks-<role>/SKILL.md body, minus the self-presence / Step 0 blocks,
            plus the runtime arguments: project=<repo>, session-id=<session-id>, request-id=<rid>, mode=<mode>,
            plus the explicit output contract: 'Write your artefacts to the paths listed below and
            return only the list of paths. Do not call Skill(...). Do not set presence. Do not
            hand back prose.', plus the heartbeat instruction: 'While running, call
            peaks sub-agent heartbeat --record <dispatchRecordPath> --status <state> --progress <pct> --note \"<text>\"
            at least every 30 seconds.'>" \
  --request-id <rid> --session-id <session-id> --project <repo> --json
```

Then the LLM takes `data.toolCall` from the envelope (a `{name, args}` descriptor), looks up the tool by `name` in its environment, and invokes it with `args` — IDE-private, no SKILL.md hardcoding.

The role's required artefact paths (also see peaks-ui/rd/qa SKILL.md and `references/swarm-dispatch-contract.md`):

| Role | Writes | Reads (PRD-side) |
|---|---|---|
| `ui` | `.peaks/_runtime/<sessionId>/ui/design-draft.md`, `.peaks/_runtime/<sessionId>/ui/requests/<rid>.md` | PRD body, project-scan, archetype |
| `rd-planning` | `.peaks/_runtime/<sessionId>/rd/tech-doc.md` (feature/refactor) or `.peaks/_runtime/<sessionId>/rd/bug-analysis.md` (bugfix) | PRD body, project-scan, existing-system, codegraph |
| `qa-test-cases` | `.peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md` | PRD body, RD planning artefact, project-scan, codegraph |

**Solo launches all sub-agents in the swarm plan in a single message (multiple `peaks sub-agent dispatch` calls in parallel, each followed by execution of the returned toolCall)** — this is what gives real concurrency. Do not sequentialize them. The CLI returns N toolCall descriptors; the LLM fires all N in the same message; the IDE dispatches them concurrently; Solo then waits for all to return, runs `ls` checks against the paths above (Peaks-Cli Gate B), and only then advances to RD implementation.

**Hard prohibitions on sub-agents** (also passed in each dispatch prompt):

- Do NOT call `Skill(skill="...")` — sub-agents must not recursively activate skills, that defeats the fan-out.
- Do NOT call `peaks skill presence:set` — only the main Solo loop owns `.peaks/.active-skill.json`. Sub-agents write to a per-agent marker file `.peaks/_runtime/<sessionId>/system/sub-agent-<role>.json` if they need to record state, but never the main presence file.
- Do NOT open interactive user prompts. If a sub-agent needs clarification, it must return a `blocked` verdict in its return string and let Solo handle the user message.
- Do NOT commit, push, install hooks, or apply settings.json mutations. Only Solo holds those permissions.
- **Do write heartbeats** — call `peaks sub-agent heartbeat --record <dispatchRecordPath> --status running --progress <pct> --note "<text>"` at least every 30s (see `references/sub-agent-dispatch.md` §G6 for the full contract). The parent Dispatcher uses these to render the live status line during the wait.

After every sub-agent dispatch returns, Solo **restores presence** once (not per-agent), then continues to Gate B verification:

```bash
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate swarm-converged
```

### Degradation when swarm roles fail or are absent

| Condition | Solo action | TXT handoff note |
|---|---|---|
| UI sub-agent returns blocked/error | RD continues with PRD visual descriptions | `ui-design-missing` |
| RD planning sub-agent returns blocked/error | RD continues with PRD-derived planning | `tech-doc-missing` |
| QA test-cases sub-agent returns blocked/error | RD continues; QA backfills test cases before verdict | `qa-test-cases-missing` |
| Two or more of the above | Fall back to sequential: `peaks request transition rd → spec-locked` then inline RD run, then QA | `swarm-degraded-to-sequential` |
| All three fail | Pause workflow; surface to user; request confirmation to continue | `swarm-aborted` |

Skipping the entire swarm (when `--type` is `config|docs|chore`) is not a degradation — record `swarm-skipped: type=<type>` and proceed.

### Frontend-only trigger pre-flight

Before computing the swarm plan, Solo runs the keyword scan deterministically:

1. Read `.peaks/_runtime/<sessionId>/prd/requests/<rid>.md` body.
2. Lowercase + strip markdown; check regex `\b(页面|组件|表单|弹窗|表格|样式|布局|交互|UI|UX|page|component|form|modal|table|styling|layout|interaction|frontend|前端)\b`.
3. If match count ≥ 1 → `frontendKeywordHit=true`.
4. If `frontendOnly` (from project-scan) is `true` and no keyword hit → UI joins anyway (frontend-only project, even non-visual changes may need visual sanity for regressions).
5. If `frontendOnly` is `false` and no keyword hit → UI skipped.

Solo records the pre-flight result in `sc/swarm-plan.json` so the audit trail shows why UI was or was not included.

## Peaks-Cli Mandatory RD QA repair loop (AUTO-PROCEED)

> **CLI gate enforcement**: `peaks request transition` now refuses to move RD/QA to gated states when required artifacts are missing. The required files depend on `--type` chosen at `peaks request init` (default `feature`):
>
> - `feature` / `refactor`: full gates (tech-doc, code-review, security-review, test-cases, test-report, security-findings, performance-findings)
> - `bugfix`: lighter planning (`bug-analysis.md` instead of `tech-doc.md`); still requires code-review + security-review + regression test-cases + security-findings; performance-findings optional unless the bug is performance-related
> - `config`: only security-review (RD) and security-findings (QA)
> - `docs` / `chore`: no gates
>
> When PRD lands, classify the request type before running `peaks request init` for every role — pass `--type <type>` so the artifact records it and downstream transitions enforce the right gates. Misclassifying a feature as `docs` to skip gates is a workflow violation. If a transition fails with `code: PREREQUISITES_MISSING`, the response lists every missing path — produce them, then re-transition. For one-off exceptions, the escape hatch `--allow-incomplete --reason "<text>"` records the bypass in the artifact transition note.

After `peaks-rd` finishes any implementation, repair, or code-output slice, Peaks-Cli Solo MUST automatically route the result to `peaks-qa` without waiting for user confirmation. This is not optional in full-auto mode. Solo must not declare the workflow complete, emit a TXT handoff, or stop at RD completion.

**How Solo invokes another role (mechanism, not metaphor):**

Solo is itself a skill running in the current session. There are **two distinct mechanisms** in this skill, and they MUST NOT be confused:

1. **Swarm fan-out (planning side, after PRD confirmed)** — uses `peaks sub-agent dispatch <role>` to launch real concurrent sub-agents. The CLI returns a per-IDE tool-call descriptor that the LLM executes in its environment. See "Peaks-Cli Swarm parallel phase" above for the full contract. Sub-agents do NOT call Skill(...) back into the role; they execute the role's instructions inline from the prompt.
2. **Sequential handoff (execution side, RD↔QA repair loop)** — Solo is the only loop, and after RD or QA finishes (whether as a sub-agent or directly), Solo drives the next step from the orchestrator seat. Do NOT use the `Skill` tool to "reactivate" peaks-rd or peaks-qa in the main loop; doing so is the v1.x anti-pattern that masqueraded as "calling the role" but actually just re-prompted the same session. From v1.3 onward, the main loop drives roles via the CLI gate (`peaks request transition`) and reads back artefacts (`peaks request show ... --json`); the actual RD/QA work is either done inline by Solo (when Solo has just been re-invoked by the user) or by a Task sub-agent (in swarm mode).

After RD completes (whether inline or sub-agent), Solo does not stop — it must advance to QA. There is no "RD done, ask the user" state in full-auto mode. The only valid stops are: (a) QA verdict=pass, (b) repair cap hit, (c) explicit user cancel.

**RD's internal reviews are already parallelized.** When RD finishes implementation, it issues a 3-way sub-agent fan-out (code-review + security-review + perf-baseline, see `skills/peaks-rd/SKILL.md` "Parallel review fan-out") and waits for all to return before transitioning to `qa-handoff`. Solo does NOT need to track three separate RD-side sub-runs; the RD role owns the fan-out lifecycle end-to-end. Solo's presence restoration after the swarm converges is the only coordination point.

**Presence restoration after RD/QA work returns (MANDATORY):** In v1.x, role skills called `peaks skill presence:set <role>` internally and stomped on `.peaks/.active-skill.json`. From v1.3 onward, sub-agents in the Swarm path are forbidden from calling `peaks skill presence:set` (see "Sub-agent dispatch" in each role's SKILL.md), so the main loop's presence file is preserved across the fan-out window by construction. The one place Solo still has to actively restore presence is **once after the fan-out returns** (gate=swarm-converged) and again **after each RD↔QA repair iteration** (gate=repair-cycle-<N>). Use the same command from Step 2 with the current mode and the gate that has just advanced:

```bash
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate <current-gate>
```

This keeps the CLAUDE.md status header accurate (`Peaks-Cli Skill: peaks-solo`) instead of showing a stale role name. Use the current mode and gate values; the gate may have advanced since startup. Skipping this step causes the header to display the last-known gate permanently.

**Full-auto auto-proceed rule**: In the `full-auto` profile, when RD transitions to `qa-handoff`, Solo immediately drives QA — by launching a `peaks sub-agent dispatch qa` sub-agent carrying the `peaks-qa` body (swarm path), then executing the returned toolCall, or by running QA inline in the main loop (assisted/strict path). Do not pause, do not ask the user, do not summarize RD results as if they were final. The only valid reason to skip QA is when `--type` is `docs` or `chore` (no acceptance surface).

A QA report with any failing, blocked, missing, or unverified acceptance item is not a pass.

**How Solo routes QA findings back to RD (mechanism, not metaphor):**

When `peaks-qa` returns `verdict=return-to-rd`, Solo does NOT manually rewrite RD artifacts. Instead it follows this exact sequence:

1. Read the QA verdict and findings via `peaks request show <rid> --role qa --project <repo> --json`. The findings live in the QA artifact body (failing acceptance items, evidence paths, severity).
2. Transition the RD artifact back from `qa-handoff` to a working state and record the QA verdict in the transition note:
   ```bash
   peaks request transition <rid> --role rd --state spec-locked \
     --reason "QA return-to-rd cycle <N>: <one-line summary of failing items; full findings in qa/test-reports/<rid>.md>" \
     --project <repo> --json
   ```
   `spec-locked` is the canonical "needs more RD work" state. The reason is mandatory in repair cycles so the artifact history shows the loop.
3. Re-launch `peaks-rd` work. Two paths, mode-driven:
   - **Swarm / full-auto**: launch a fresh `peaks sub-agent dispatch rd` sub-agent (then execute the returned toolCall) with the same `peaks-rd` body used in the Swarm phase, plus the QA findings path so it can read the failure list. Solo restores presence after the sub-agent returns.
   - **Assisted / strict / inline-fallback**: Solo executes the RD repair steps directly in the main loop, since there is no concurrent fan-out to coordinate.
   In both paths, pass the QA findings path so the repair sees what failed.
4. peaks-rd fixes the reported issues only (red-line scope: do not modify unrelated surfaces), regenerates code-review and security-review evidence if changes touched reviewed surfaces, then transitions `rd → implemented → qa-handoff` again.
5. Solo re-runs QA (sub-agent Task in swarm/full-auto, inline in assisted/strict) with the same `<request-id>`. QA re-runs gates against the new diff.
6. Repeat steps 1-5 until QA returns `verdict=pass`, or the cap below fires.
   **After each repair iteration** (after peaks-rd and peaks-qa both return), Solo MUST restore presence:
   ```bash
   peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate repair-cycle-<N>
   ```

**Repair cycle cap**: After 3 repair cycles without a passing QA verdict, emit a blocked TXT handoff regardless of remaining issues. Do not loop indefinitely. If a specific issue cannot be resolved within 3 cycles, mark it as a known blocker in the TXT handoff and proceed to the SC phase.

In full-auto mode, treat the RD↔QA repair loop as a built-in controller objective: loop through RD→QA until all acceptance items pass (max 3 cycles). Do not exit the loop on a non-passing QA verdict unless the TXT handoff marks the workflow as blocked.

## Default runbook

The end-to-end CLI sequence for the `full-auto` profile lives in `references/runbook.md` (extracted from this file to keep SKILL.md under the 800-line cap from `common/coding-style.md`). `assisted` and `strict` profiles pause at `[CONFIRM]` markers in the runbook; `full-auto` and `swarm` auto-proceed through all gates. See Transition Gates for artifact verification at each stage. The numbered workflow list (steps 0-11) earlier in this SKILL.md is the canonical phase sequence; the runbook is the executable CLI transcription — keep both in lockstep when updating.

Maintenance: when adding new CLI commands to the runbook, mirror them into both `references/runbook.md` and the test in `tests/unit/skill-default-runbook.test.ts` (the test falls back to `references/runbook.md` when the SKILL.md section is a pointer).

Repair loop details: see `## Mandatory RD QA repair loop` above for the full 5-step procedure and the 3-cycle cap. Append transition notes via `--reason` rather than rewriting artifacts during repair cycles.

## RD micro-cycle (TDD small-step rapid-test loop)

> **Slice 内部**的修复 / refactor / lint 修复走 micro-cycle（5-10s/cycle）。
> Slice 边界走 `peaks slice check`（一次性 4 项自检）。
> 不要把 micro-cycle 跟边界 check 混用——前者 100ms 反馈循环，后者 30s+ 全套。
> 完整手册：`references/micro-cycle.md`。
> 摘要：micro-cycle 内只跑 `vitest run <file> -t "<name>"`；边界跑 `peaks slice check`（tsc + vitest + 3-way + verify-pipeline）。
> 硬约束：违反任一"micro-cycle 内禁止触发"列表 = workflow violation；边界不全绿 = 禁止 ship。

## Peaks-Cli Project standards preflight

Before orchestrating an end-to-end code repository workflow, gather the project standards preflight status from RD and QA by calling the Peaks-Cli CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

Use `standards init` for first-time creation and `standards update` for existing `CLAUDE.md` append/review behavior. In `full-auto` and `swarm` profiles, `--apply` runs automatically after `--dry-run` succeeds — these files live inside the target project, are required for downstream skill preflight, and producing them is part of finishing the workflow (Peaks-Cli Gate G enforces this). `assisted` and `strict` profiles pause for explicit user confirmation between dry-run and apply.

**CRITICAL — Standards must reflect the project scan.** When generating or updating `CLAUDE.md`, the content must reference concrete findings from `.peaks/_runtime/<changeId>/rd/project-scan.md`: the detected component library (e.g. "This project uses antd 5.x"), CSS solution (e.g. "Uses Less via Umi"), build tool, state management, and routing. Never emit a generic template that says "read .claude/rules/..." without naming the actual project stack. If the project-scan has not been run yet, run it before standards init/update.

**Legacy projects additionally** — when archetype ∈ {legacy-frontend, legacy-fullstack, frontend-monorepo}, the `CLAUDE.md` Conventions section MUST extract concrete naming, directory, service-layer, and hooks conventions from `.peaks/_runtime/<changeId>/system/existing-system.md` and record them as hard constraints for new code. It must also list the `## Legacy constraints` from `project-scan.md` (class components, moment, enzyme, etc.) and instruct that new code in the same module preserves those patterns unless PRD explicitly authorizes modernization. A `CLAUDE.md` for a legacy project that contains only generic rule pointers without naming the actual conventions is a blocking violation — regenerate it.

Do not hand-write standards file mutations inside the skill.

For project-analysis requests such as "分析项目" / "分析下这个项目", Step 0 still applies: the workspace is initialized and `peaks-solo` presence is set before any analysis output. These requests run the lightweight analysis branch (project scan + standards dry-run) rather than the full RD/QA pipeline, but they never skip workspace anchoring or exit the workflow. The handoff must include an explicit **Standards increment** section. Report the current `CLAUDE.md` and `.claude/rules/**` status from the dry-run output as incremental deltas, not just a generic preflight note:

- whether `CLAUDE.md` is missing, existing, planned, skipped, appended, or review-only;
- which `.claude/rules/**` files are planned, existing, skipped, appended, or review-only;
- whether writes were applied or intentionally left as dry-run because authorization or scope was absent;
- the exact next action if standards should be applied later.

If the dry-run output lacks enough detail to explain those deltas, say that the standards increment is unknown and keep standards application blocked until another `peaks standards init/update --dry-run` provides evidence.

## Peaks-Cli Refactor mode

Read `references/refactor-mode.md` before handling refactor requests.

Default MVP path: `peaks-solo refactor`.

It must enforce the shared refactor red lines:

1. understand the project before changes;
2. require UT coverage >= 95%;
3. treat unknown coverage as failing;
4. split broad refactors into minimal functional slices;
5. require strict verifiable specs before each slice;
6. require 100% acceptance for each slice;
7. require code changes and sanitized intermediate artifacts to be traceable in local `.peaks/_runtime/<sessionId>/` storage before the next slice; commit or sync sanitized artifacts only when explicitly authorized.

## Peaks-Cli Quality-gate commands (CLI cheat sheet)

These commands harden the workflow against silent skips. Use them in the runbook at the points indicated; they all support `--json` and `--session-id`.

| Command | Purpose | When to run | Non-zero exit when |
|---|---|---|---|
| `peaks request lint <rid> --role <role> --project <path>` | Scan artifact body for unfilled `<placeholder>`, bare `- ...` bullets, TBD/TODO markers | Before every transition out of `draft` / before role handoff | Any `error`-severity finding (unfilled placeholder, bare-dot bullet) |
| `peaks request repair-status <rid> --project <path>` | Count RD↔QA repair cycles from `--reason` transition notes ("QA cycle N: ...") | Before every RD repair iteration in step 7 | Cycle count reached the 3-cycle cap |
| `peaks scan request-type-sanity --project <path> --type <type>` | Cross-verify declared `--type` against the actual `git diff` file mix (catches "feature mis-declared as docs" workflow violations) | After PRD type lock-in AND after each RD repair iteration | Declared type disagrees with the file mix |
| `peaks scan libraries --project <path>` | Enumerate every dependency + devDependency + peerDependency + optionalDependency with parsed major version; output goes to `## Library versions` in `rd/project-scan.md`. Read-only. | At Solo step 0.6 (alongside `peaks scan archetype`) | Always exits 0 (warnings in JSON envelope; never blocks) |
| `peaks slice check [--rid <rid>] [--project <path>]` | 4-stage slice 边界 check (typecheck + unit-tests + review-fanout + gate-verify-pipeline). Aggregate pass/fail; non-zero exit if any stage fails. See "Slice 边界 check" below for usage rules (boundary only, never inside a micro-cycle). | At slice 边界（post-micro-cycle, pre-peaks-qa）| Any stage fails |

Together with `peaks request transition` (which already CLI-enforces per-type artifact prerequisites), these five commands form the runtime quality net. SKILL.md prose is descriptive; the CLI is what physically blocks bad workflows.

## Peaks-Cli Completion handoff

After final validation, refresh project-local standards via `peaks standards init/update` (never hand-write). Merge scan-backed changes incrementally; preserve hand-maintained content unless user confirms deletion.

Use Peaks-Cli TXT for the compact handoff capsule: mode, validated decisions, artifact paths, standards deltas (`CLAUDE.md` and `.claude/rules/**` statuses), open questions, next action. Do not restate the full workflow log.

### Workflow completion (no auto-exit)

Do NOT call `peaks skill presence:clear --project <repo>` at workflow end. The presence file and header remain active so the user stays inside the workflow context. The user can continue with follow-up requirements naturally — no need to re-invoke `/peaks-solo`. The header continues to display the active skill and current gate.

Before ending, extract durable memories from this session:
```bash
peaks project memories:extract --session-id <session-id> --project <repo> --json
```

## Peaks-Cli External references and lifecycle

**Codegraph**: Optional project-analysis before RD handoff. Use `peaks codegraph affected --project <path> <changed-files...> --json` for regression-surface hints. Output as untrusted supporting evidence only; never commit `.codegraph/` artifacts.

## Codegraph orchestration context

Solo treats `peaks codegraph affected --project <path> <changed-files...> --json` as an optional project-analysis enhancement that informs the role handoff between PRD, RD, and QA. The output is untrusted supporting evidence — Solo must not treat codegraph output as approval for scope, design, or QA verdict.

Do not run upstream installer flows, mutate agent settings, or commit `.codegraph/` artifacts into git. Peaks-Cli gates remain authoritative; codegraph context is a hint, never a substitute for role-skill output.

**External skills**: All external skill references (`mattpocock/skills`, `awesome-design-md`, `taste-skill`, `shadcn/ui`, `Chrome DevTools MCP`, `Figma Context MCP`, `Context7`, etc.) follow the three-stage pattern: capability discovery via `peaks capabilities` before naming, references only (no execute/install/persist), Peaks-Cli CLI for all side effects. Do not execute upstream installers, do not install upstream resources, do not persist sensitive examples — Peaks-Cli gates remain authoritative. External skills inform, they do not approve.

**OpenSpec lifecycle**: `render → validate → show → to-rd → validate → archive`. Solo's default runbook handles the exit gate (validate → archive after QA pass). Entry-gate validation (to-rd before slicing) is available when `openspec/` exists pre-workflow; Solo delegates it to `peaks-rd` during implementation.

**MCP lifecycle**: `list → plan → apply --yes → call → rollback`. `apply` backs up settings and refuses non-peaks entries unless `--claim` is passed.

Detailed rules: `references/external-skill-invocation.md`, `references/openspec-mcp-workflow.md`, `references/workflow.md`, `references/existing-system-extraction.md`. For an informational mapping of peaks artefact paths to the A2A (Agent2Agent) protocol's Task / Artifact / Part / Message / AgentCard vocabulary (no A2A implementation, just a shared naming layer), see `references/a2a-artifact-mapping.md`.

## Sub-agent context governance (G7 + G7.7 + G8 + G9 — slice #010)

> Slice #010 adds the **layer 3.5** context-governance push to the slice #009 sub-agent dispatch primitives. This section is the MANDATORY reference for the main LLM reducer. Detailed protocol: `references/context-governance.md` + `references/headroom-integration.md`.

### G7 — sub-agent context minimal-occupation (metadata-only + 按需 Read)

Sub-agent artifacts (rd/tech-doc.md, qa/test-cases/&lt;rid&gt;.md, ui/design-draft.md) MUST NOT be inlined into dispatch records and fed back to the main LLM during reduce.

- Sub-agent writes artifact to disk at a known path (path convention: `.peaks/_sub_agents/<sessionId>/artifacts/<rid>-<role>-<idx>.<ext>`).
- Sub-agent calls `peaks sub-agent dispatch --write-artifact <path>` (or via dispatch CLI flag). The CLI computes sha256 + size + writes `ArtifactMeta` to record.
- Main LLM reduces the batch and sees ONLY the metadata view (~200 chars per sub-agent, vs ~1MB if content were inlined) — a 3000-5000× reduction.
- Main LLM decides whether to `Read <path>` for full content (LLM tool call, NOT via peaks CLI).

Main LLM view format (G7.4.e):
```
[peaks-solo] batch 3/3 done in 47.3s
- rd → .peaks/_sub_agents/2026-06-06-session-5b1095/artifacts/003-rd-001.md (12KB, sha256:abc123) summary: "wrote RD tech-doc with 4 sub-roles"
- qa-business → .../artifacts/003-qa-business-001.md (8KB, sha256:def456) summary: "wrote 12 API test cases"
- qa-perf → .../artifacts/003-qa-perf-001.md (5KB, sha256:ghi789) summary: "p95 latency target ≤ 200ms"
```

### G7.7 — headroom-ai integration (opt-in compression)

If a sub-agent prompt is too large even after G7 metadata-only (e.g. 1MB artifact description, 5MB mid-prompt analysis), use `--use-headroom`:
- Default `false` (G7 remains default).
- Modes: `balanced` (default) | `aggressive` | `conservative`.
- Failure: `HEADROOM_UNAVAILABLE` warning + G7 metadata-only fallback (NOT blocking).

### G8 — cross sub-agent shared channel (dispatcher-mediated indirect signal)

Sub-agent A's completion **immediately** writes a shared entry; sub-agent B (still in flight) can read shared entries from sibling sub-agents. **This is NOT peer-to-peer messaging.** The dispatcher stores, the sub-agents read/write; A and B never directly talk.

- Path: `.peaks/_sub_agents/<sessionId>/shared/<batchId>.json`.
- Two new CLI atoms (NO new top-level CLI): `peaks sub-agent share` + `peaks sub-agent shared-read`.
- RL-23 strong constraint: when sub-agent calls `peaks sub-agent heartbeat --status done`, it MUST also call `peaks sub-agent share --key "<role>.completed" --value <artifact-meta>`.

### G9 — forced compression gate (CLI 兜底 + hook double-guard)

Threshold table (256K default context capacity):

| Threshold | Prompt size | Behavior |
|---|---|---|
| 50% (early warn) | ≥ 128KB | Soft warning, suggest `--use-headroom` |
| **75% (user red line)** | ≥ 192KB | Soft warn + `warnings: ["CONTEXT_NEAR_LIMIT"]` |
| **80% (hard reject)** | ≥ 204KB | Hard reject `code: "PROMPT_TOO_LARGE"`; `--force` allowed at CLI |
| 90% (emergency) | ≥ 230KB | Hard reject + `contextWarning: 'high'` |

Two layers:
- **CLI 兜底** — `peaks sub-agent dispatch` validates prompt size; `--force` allowed.
- **PreToolUse hook** — `peaks sub-agent-dispatch-guard` re-validates; **NO `--force`** at hook layer (RL-30 strict).

The sub-agent prompt template (G8.6 + G9 self-check) is in `references/context-governance.md`.

