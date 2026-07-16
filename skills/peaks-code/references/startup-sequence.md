---
name: peaks-code-startup-sequence
description: peaks-code startup sequence Steps 0 / 0.5-0.87 / 1 / 2 / 2.3 / 2.5 / N / N+1 / N+2 — extracted from SKILL.md 2026-07-16 to keep SKILL.md under 25,000-byte cap
---

# Peaks-Loop Startup sequence (MANDATORY — execute in order)

> **Extracted from SKILL.md on 2026-07-16.** This file is the
> authoritative reference; SKILL.md points here with a 1-line pointer.
> Do not edit `SKILL.md` for content changes — edit this file instead.

### Peaks-Loop Slice 011 — workspace consolidate + session checkpoint/resume

`peaks workspace consolidate` is the slice-011 umbrella primitive. `peaks session checkpoint` (context-overflow defense) and `peaks session resume` surface as Step 0.75 + Step N. See `references/cross-date-session-check.md`.

### Peaks-Loop Step 0.75: Resume from checkpoint (BLOCKING on same-day re-invocation)

When a NEW conversation opens on a session whose `lastActivity` is from today AND `.peaks/_runtime/<sessionId>/checkpoints/` has `*.json`, surface via `peaks session info --active --json` + `peaks session resume --from <path> --project <repo>`. Prompt via `AskUserQuestion` (resume / fresh); if "resume", prepend the block. Step 0.75 is no-op on precondition fail. See `references/checkpoint-resume.md`.

### Peaks-Loop Step N: Periodic checkpoint (auto-fire, no user action)

Proactive context-overflow defense. CLI: `peaks session checkpoint [--reason <r>] [...flags]`. Fire `--reason periodic` every 20 tool calls (G1 hard-coded), `--reason artifact-written` per PRD/RD/QA/TXT write. See `references/periodic-checkpoint.md` (otherwise `tests/unit/code/checkpoint-periodic-frequency.test.ts` fails).

### Peaks-Loop Step 0.6: Audit + Goal (NEW)

Invoke peaks-audit after need expressed; store approved goal at `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json`. **All autonomous work requires approved goal.** → `references/audit-goal-gate.md`.

### Peaks-Loop Step N+1: Final Review (NEW)

After autonomous work (RD, QA, security, perf), invoke peaks-final-review for 4-dim evidence. All 4 pass → final delivery; else loop back. See `references/final-review-gate.md`.

### Peaks-Loop Step N+2: Main-session context monitor (D6 + slice 2026-07-02)

After every 4th tool call, probe via `peaks code context-now --project <repo> --json`. Thresholds: 50% / **0.85 pre-compact / 0.95 red-line** (v2.13.0). **In Job mode ≥ 0.85 is MANDATORY auto-compact** (`peaks session auto-compact --execute`). Pass `--enforce-job-mode` for single-rid. **≥ 0.95** red line: next Bash/Task fires `peaks session auto-compact-hook`. **Karpathy §4 exception**: compact red line keeps runner alive — zero-intervention wins; LLM MUST NOT ask user to run `/compact`. Honor `--in-flight-batch` (D6.e).

### Peaks-Loop Step 0: Anchor the workflow (MANDATORY FIRST ACTIONS — no bail-out)

Run `peaks workspace init` + `peaks skill presence:set peaks-code` BEFORE any analysis, role handoff, or mode-selection question. Even "分析下这个项目" / "看一下代码" / one-line questions anchor first.

→ see `references/anchoring-and-session-info.md` for the full Step 0 contract + session-conflict resolution.

#### Step 0 bypass — Claude Code [Fact-Forcing Gate] (slice 2.0.1-bug3)

`peaks workspace init` materializes `.claude/settings.local.json` (a PreToolUse hook allow-list for `.peaks/**` paths and `peaks <subcommand>` Bash) so the [Fact-Forcing Gate] does not block Step 0. Pass `--no-claude-hooks` to opt out.

→ see `references/anchoring-and-session-info.md` for the full bypass contract, recovery flow, and anti-bail-out rule.

### Peaks-Loop Step 0.7: Detect unfinished work and offer resume (BLOCKING on first invocation per session)

After Step 0, run the resume-detection probe; surface via `AskUserQuestion` if a slice is in flight. **v3.1.2 resume rule:** if `.peaks/_runtime/<sessionId>/job/<jid>/progress.json` exists, read FIRST and surface `Next: slice #N of M`. **v2.11.0 D7 override:** if user just `/compact`ed, run `peaks code post-compact-detect --project <repo> --json` FIRST; `shouldAutoResume: true` skips AskUserQuestion. → `references/resume-detection.md`.

### Peaks-Loop Step 0.55: 1.x → 2.0 detection (BLOCKING on first invocation per session, when the project is not on a 2.0 layout)

After Step 0.7 returns "fresh", run `peaks upgrade --detect-1x --project <root> --json`. If `isOneX: true`, surface `AskUserQuestion`. → `references/step-0-55-1x-detection.md`.

### Peaks-Loop Step 0.8 — Job 启动 (BLOCKING on LLM judgement — v3.1.1 patch + v3.1.2 mechanical gates)

> **CLI reality check (D-001 sediment, 2026-07-09):** The CLI surface has changed since this section was last verified. The actual command is **`peaks job init --job-id <jid> --slice-list <list> --main-loop-strategy <single|rotating> [--parallelism-hint <serial|llm-decides>] [--exit-policy <strict|best-effort>] [--project <repo>]`**. The legacy `peaks code detect-job --is-job/--suggested-job-id/--confidence` form described below is **no longer present** in 4.0.0-beta.6. If you find `--is-job` rejected, fall back to `peaks job init`.

The CLI is a **recorder + gate** for job-shape (the LLM judges). LLM calls `peaks job init --job-id <jid> --slice-list <list> --main-loop-strategy <single|rotating>` (with `--caller-id <id>` and `--project <repo>` in non-Claude-Code environments), which writes `.peaks/_runtime/<sessionId>/job/<jid>/state.json` and emits a `[job-event] {kind: job-started, jobId, total, strategy}` line. Downstream steps call `peaks job status --job-id <jid>` to read state.

**Hard rule (v3.1.1 red-line #10):** LLM MUST NOT skip the job-init call. If `peaks job status` reports `done: 0` and the slice work has begun, the LLM forgot to initialize — re-call `peaks job init` immediately.

> **D-003 sediment (2026-07-09):** The historical `JOB_SHAPE_NOT_DECIDED` exception thrown by `read-job-shape` is no longer wired in 4.0.0-beta.6. The current CLI uses `peaks job status` which reports a passive `done: 0` instead of throwing. Both behaviors enforce the same intent (no work may begin before init) but the failure mode is a soft warning rather than a hard exception. LLM should treat `done: 0` after Step 0.8 as a recoverable miss, not an unrecoverable error.

**v3.1.2 mechanical gates** (recorder-only was bypassed twice):

PreToolUse hook on `peaks code gate-step-08`; size-fear ban on `peaks code emit-handoff`; forced auto-compact at ≥ 0.85 in Job mode; on-disk slice progress via `peaks job checkpoint` (canonical reader `peaks job progress --job-id <jid>`). Full mechanics (judgement criteria, hook table, backup-regex rationale, hook wiring) at `references/step-0-8-gate.md`.

### Peaks-Loop Step 0.81 — per-slice 收尾

After commit: `peaks job checkpoint --slice-id <rid> --state done --commit-sha $(git rev-parse HEAD)` → `peaks job status` → loop (remaining>0 → Step 1; ==0 → Step 8/9/10/11; blocked → Step 0.85).

### Peaks-Loop Step 0.85 — slice 阻塞处理

Trigger: `repair-status` atCap=true, context-now red-line ≥5min, or `subagent-cleanup` fails twice. Action: `peaks job block --slice-id <rid> --reason "<reason>"` then STOP.

### Peaks-Loop Step 0.86 — main session rotation

Active in rotating mode; fires every `rotateEvery` slices or via `peaks job rotate-now`. Sequence: cycle-summary → checkpoint rotate-marker → `peaks session rotate` → resume via `peaks session resume --job-id <jid>`.

### Peaks-Loop Step 0.87 — sub-agent cleanup gate

After every `peaks sub-agent dispatch --batch-id <id>` inside a Job, BEFORE next slice checkpoint: `peaks job subagent-cleanup --job-id <jid> --batch-id <id> --force`. Non-zero → block.

→ see `references/job-loop.md` for state machine, visibility, rotation cadence, cross-day recovery, 9 red lines.

### Peaks-Loop Step 1: Mode selection

Use `AskUserQuestion` with `Full auto (Recommended)` first when user did not name a profile OR skill presence is stale (run `peaks skill presence:check-stale --project <path> --json` first; `stale: true` ⇒ re-ask). → `references/mode-selection.md`, `references/fast-mode.md`, `references/mode-selection-with-stale-presence.md`.

### Peaks-Loop Step 2: Re-set skill presence with the chosen mode

Re-run `peaks skill presence:set peaks-code --mode <mode-value> --gate startup`. Install statusline on first run (`peaks statusline install`). → `references/skill-presence-and-title.md`.

### Peaks-Loop Step 2.3: Load project memory (durable, LLM-authored memories)

Run `peaks project memories --project <repo> --json` to read decisions / conventions / modules / rules / lessons from `.peaks/memory`. → `references/project-memory-loading.md`.

### Peaks-Loop Step 2.5: Set session title

Extract a short title from the user's first request (8-20 Chinese chars or 4-10 English words). Run `peaks session title <sessionId> "<title>" --json`. Skip if a title is already set. → `references/skill-presence-and-title.md` (same file as Step 2). D-002: sid is positional, NOT `--session-id` flag (rejected with `error: unknown option`).

## Sub-agent session sharing (MANDATORY — one conversation = one sid)

When peaks-code dispatches a sub-agent (peaks-rd, peaks-qa, peaks-ui, peaks-txt, peaks-sc), the prompt MUST include the parent's sid. The sub-agent MUST NOT call `peaks workspace init` (would orphan the parent's binding).

## Boundaries

Peaks-Loop Code may identify scenarios, recommend profiles, coordinate role skills via artifacts, coordinate project memory extraction, request user confirmation at risk/commit boundaries. MUST NOT silently install hooks / create agents / enable MCP / modify Claude settings / create GitHub repos / bypass role-skill artifacts. → `references/boundaries.md`.