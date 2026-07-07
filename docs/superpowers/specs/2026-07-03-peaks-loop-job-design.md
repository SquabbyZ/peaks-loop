# Peaks-Loop Job: Long-Task Loop Engineering for 24h AI Programmer

**Status:** Draft (post-brainstorming, pre-writing-plans)
**Date:** 2026-07-03
**Author:** SquabbyZ (via peaks-code brainstorm session 2026-07-03-session-67f631)
**Affects:** peaks-code, peaks CLI (new `peaks job *` subcommand family), `.peaks/_runtime/<sessionId>/job/<jobId>/` artifact tree

---

## 1. Problem statement

### 1.1 Symptom

When users ask peaks-loop to drive a long, multi-slice job — e.g. "for an existing Next.js project, write unit tests for every subdirectory under `app/`, one slice per subdirectory, self-validate + commit, then move to the next slice, until all done; cost is not a concern" — the LLM-runner correctly splits the work into a slice DAG, but stops after committing slice #1 and refuses to continue with one of two rationalizations:

1. "This task cannot be completed in a single session" (false — auto-compact protocol keeps the runner alive)
2. "Continuing would consume too many tokens / cost too much" (irrelevant — user has explicitly opted out of cost concerns)

This contradicts peaks-loop's positioning as a **24h AI programmer orchestrator** that keeps the runner alive across multi-hour jobs without human intervention (see `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`, constraints C3 + C5).

### 1.2 Root cause (architectural, not behavioral)

The current peaks-code runbook models **one rid = one workflow** end-to-end (PRD → RD → QA → commit → TXT handoff). There is no outer loop construct. After the first rid's TXT handoff fires, the runbook signals "this skill's job is done" — the LLM obeys, regardless of how many slices remain.

The auto-compact protocol (v2.13.0) keeps a single rid's runner alive across context-overflow events, but does **not** chain rids together. The economic audit (`peaks budget audit`) reports cost but does not stop the runner. Neither mechanism matches the user's mental model of "a job with N independent slices that must all complete before the runner stops."

### 1.3 Why not just "patch the prompt"

Patching the peaks-code SKILL.md prose to say "continue until job done" leaves:

- **No on-disk job state** → runner forgets progress after auto-compact, cross-day restart, or IDE reopen
- **LLM's natural "summarize = stop" instinct** unaddressed at the architectural level
- **No guard rail** preventing the LLM from drifting back into "single rid = complete" behavior under context pressure
- **No testable state machine** — verification depends on subjective LLM behavior rather than deterministic CLI

We need a first-class `Job` construct.

---

## 2. Goals & non-goals

### 2.1 Goals

- A user can express "do these N independent slices, one after another, only stop when all done (or one fails terminally)" as a single command to peaks-code
- The runner keeps working across slices **without asking the user about cost, length, or context**
- Progress is **continuously visible to the user** — at any moment the user can see which slice is running, what ETA remains, and the latest checkpoint. Visibility modes: (a) the LLM-runner conversation turn itself is the primary progress surface; (b) `peaks job status --watch` for terminal-side polling; (c) statusline integration for ambient awareness
- Progress survives auto-compact, cross-day session restart, IDE reopen, and accidental process kill
- Slice failures strictly halt the whole job; user decides next action
- Existing single-slice workflow (peaks-code runbook Step 2-7) is unchanged — Job is purely an outer loop wrapper
- Existing mechanisms (auto-compact, session checkpoint, sub-agent fan-out, standards preflight) integrate without modification
- **The main LLM session must not accumulate context past a controlled cap** — either by an outer rotating-session strategy, or by active per-slice context reset. Auto-compact alone is insufficient (it is a passive rescue, not a controlled lifecycle)
- **Sub-agent resource isolation is enforced at dispatch time** — every dispatch MUST declare `--budget-mb`, and cleanup MUST fire on exit. No silent resource leaks across the job's lifetime

### 2.2 Non-goals

- **Multi-job per session is out of M2 scope** — design supports it (per-job directory), M2 ships 1 job / session
- **Cost transparency is non-blocking** — `--show-cost` is a read-only affordance, not a halt condition
- **Cross-machine resume is out of scope** — state lives under sessionId which is per-machine (consistent with existing checkpoints)
- **Job-level cancellation is user-initiated only** — LLM cannot abort a job autonomously
- **Refactoring existing single-slice runbook** — Job is an outer wrapper, not a replacement
- **Background / detached / daemon-mode sub-agents** — explicitly forbidden. Every dispatch runs in the foreground of the user's current IDE session. The user must always have a real-time view of which slice is running. No `nohup`, no `disown`, no detached workers

---

## 3. Architecture overview

### 3.0 Foreground-only, real-time visible (hard invariant)

> **The Job is a foreground loop running in the user's current LLM session. Sub-agent dispatches are foreground too — they block until done. The user can read the LLM-runner's transcript at any moment to see which slice is running, what its ETA is, and the latest artifact. No detached workers, no background daemons, no `nohup`.**

Visibility surfaces (all three, layered):

1. **LLM-runner transcript** — primary. Each turn shows the active step, current slice, and so on.
2. **`peaks job status --watch`** — terminal-side poll, ANSI-colored progress bar, refreshes every 3-5 s. User can open a second terminal pane and run it.
3. **Statusline integration** — the IDE statusline shows `job: ut-app [4/8] ui/dashboard ETA 12m`.

### 3.1 Two main-loop strategies (`--main-loop-strategy`)

Both keep the loop in the foreground of the same user-visible session; they differ in how the **main LLM session** handles its own context growth across many slices:

- **`single`** — one main LLM session drives the entire job. Memory grows monotonically. Acceptable for ≤5 slices (≤1-2 hours). Auto-compact fires passively inside the main session if it overflows.
- **`rotating`** — every K slices (default K=3), the main LLM session **rotates**: writes a checkpoint + cycle-summary, exits, restarts, reads `auto-decisions.md` + `job.state.json`, and resumes. The main context resets; only the on-disk job state and auto-decisions persist. Required for ≥8 slices or ≥4 hours.

The LLM chooses at `peaks job init` time (with a default of `single` for ≤5 slices and a soft warning for ≥8). Both strategies share every other mechanism (sub-agent dispatch, checkpoints, the loop body).

### 3.2 Architecture diagram

```
                 ┌────────────────────────────────────────────────┐
                 │  peaks-code  (orchestrator, full-auto profile) │
                 │  (User reads this transcript in real time)     │
                 └────────────────────────────────────────────────┘
                                   │
                                   │  Step 0.8  (NEW: Job 启动)
                                   ▼
                  ┌──────────────────────────────────────┐
                  │  peaks job init --slice-list <…>     │
                  │  → .peaks/_runtime/<sid>/job/<jid>/  │
                  │      state.json   (on-disk)           │
                  │  → .peaks/_runtime/<sid>/job/<jid>/  │
                  │      slice-dag.json (LLM 自主生成)   │
                  └──────────────────────────────────────┘
                                   │
                                   ▼
            ┌───────────  loop until all slices done ────────────┐
            │   (single = same session until done)               │
            │   (rotating = exit+restart every K slices)         │
            │                                                     │
            │   Step 1 — Pick next slice (per slice-dag order)    │
            │      ↓                                              │
            │   Existing peaks-code runbook (Step 2-7)            │
            │   = 单 rid 单 slice 全套 (PRD→RD→QA→commit)         │
            │      ↓                                              │
            │   Step 0.81 (per-slice checkpoint)                  │
            │      ↓                                              │
            │   Step 0.86 (NEW: rotating-mode K-slice reset)      │
            │          → peaks session cycle-summary --job-id     │
            │          → peaks session rotate                     │
            │          → peaks session resume                     │
            │      ↓                                              │
            │   Step 0.81 (per-slice checkpoint, sub-agent        │
            │              cleanup gate)                          │
            │      ↓                                              │
            │   Loop control:                                     │
            │     remaining > 0  → 回到 Step 1                    │
            │     remaining == 0 → 跳出 loop, 走 Step 11 TXT     │
            │     any slice block → peaks job block → STOP+汇报   │
            │                                                     │
            └─────────────────────────────────────────────────────┘
                                   │
                                   ▼
                  Step 11 (unchanged) — TXT handoff
                  写 1 份全 job summary (N 个 slice 全列出来)
```

### 3.3 Boundary discipline

- **Job sits at the runbook layer**, not inside any single rid. The Step 0.8 / 0.81 / 0.85 / 0.86 / 0.87 steps are NEW additions; existing Step 0 through Step 11 are unchanged in semantics (only runbook.md gets a "Job path" fork that uses them in a loop)
- **CLI surface is a new subcommand family** (`peaks job *`), sitting at the same architectural layer as `peaks session` and `peaks sub-agent`
- **On-disk state uses the 2.7.1 single-scope-axis convention**: `.peaks/_runtime/<sessionId>/job/<jobId>/` — gitignored, parallel to the existing `.peaks/_runtime/<sessionId>/prd/`, `rd/`, `qa/`, `txt/` directories
- **Sub-agent dispatch policy**: every dispatch in a Job MUST declare `--budget-mb <n>` AND fire `peaks sub-agent cleanup --batch-id <id> --force` in the orchestrator's epilogue. The dispatch CLI refuses Job-context dispatches without these. (Implemented as a Job-aware wrapper, not as a change to vanilla `peaks sub-agent dispatch`.)

### 3.2 New / modified files (preliminary)

| File | Status | ~Lines | Purpose |
|---|---|---|---|
| `src/cli/commands/job-commands.ts` | new | 200 | 7 subcommands + JSON envelopes |
| `src/services/job/job-orchestrator.ts` | new | 250 | State machine core + side-effect isolation |
| `src/services/job/job-types.ts` | new | 80 | Types + zod schema |
| `src/services/job/job-state-store.ts` | new | 80 | atlas-style fs ops + locking |
| `skills/peaks-code/SKILL.md` | modified | +120 | Step 0.8 / 0.81 / 0.85 + Step 1 red-line reinforcement |
| `skills/peaks-code/references/runbook.md` | modified | +50 | Job path CLI sequence |
| `skills/peaks-code/references/job-loop.md` | new | 150 | Job state machine deep-dive |
| `tests/unit/job/*.test.ts` | new | 600 | 5 test files (state machine / CLI / schema / integration) |
| `tests/integration/job-e2e.test.ts` | new | 200 | Real LLM drives mini-job E2E |
| `.peaks/memory/peaks-loop-job-introduction.md` | new | TBD | Runbook sediment for future sessions |

**Total: ~1700 LoC + 1 spec + 1 memory.**

---

## 4. Components

### 4.1 CLI subcommand family

```
peaks job init
  --job-id <jid>                          (required, user-named, e.g. "ut-app-2026-07-03")
  --slice-list <a,b,c,...>                (required, initial slice order)
  --parallelism-hint <serial|llm-decides> (optional, default llm-decides)
  --exit-policy <strict|best-effort>      (optional, default strict)
  --main-loop-strategy <single|rotating>  (optional, default auto:
                                            ≤5 slices → single, ≥8 → soft-warn single,
                                            default rotating if user doesn't override)
  --rotate-every <n>                      (optional, default 3; rotating mode only)
  --project <repo>
  --json

peaks job status
  --job-id <jid>
  --watch                                  (optional; ANSI progress bar refreshing every 3s)
  --show-cost                              (optional; overlay last-known cost from peaks budget)
  --project <repo> --json
  # output: { total, done, failed, blocked, skipped,
  #          currentSlice, lastCheckpoint, etaSec, mainLoopStrategy,
  #          mainSessionCycle, resourcesNow { cpu, memMb, diskMb } }

peaks job checkpoint
  --job-id <jid>
  --slice-id <rid>
  --state <done|failed|skipped>
  --commit-sha <sha>     (required when state=done)
  --reason <text>        (required when state=failed or blocked)
  --project <repo> --json

peaks job continue
  --job-id <jid> --project <repo> --json
  # Mostly auto-fired by orchestrator; explicit form is user recovery path

peaks job resume
  --job-id <jid> --project <repo> --json
  # Read state.json + continue from next-slice

peaks job block
  --job-id <jid>
  --slice-id <rid>
  --reason <text>        (required)
  --project <repo> --json
  # Job-wide STOP, waits for user

peaks job handoff
  --job-id <jid> --project <repo> --json
  # Step 11 trigger: produce job-summary for the TXT capsule

peaks job rotate-now
  --job-id <jid> --project <repo> --json
  # Force a main-session rotation NOW (rotating mode only).
  # Used when LLM sees context pressure rising faster than the K-slice cadence.

peaks job subagent-cleanup
  --job-id <jid>
  --batch-id <bid>      (required)
  --force                (required flag)
  --project <repo> --json
  # Explicit epilogue; LLM must call it after every dispatch returns.
```

**Compatibility wrapper**: when running inside a Job, `peaks sub-agent dispatch` auto-injects `--budget-mb` (default 512 MB unless caller overrides) and refuses to return success unless `peaks job subagent-cleanup` is invoked later in the same session. This is a Job-aware wrapper, not a change to vanilla `peaks sub-agent dispatch`.

### 4.2 On-disk state schema

**Location:** `.peaks/_runtime/<sessionId>/job/<jobId>/state.json` (gitignored)

```typescript
import { z } from 'zod';

export const SliceStateSchema = z.object({
  sliceId: z.string(),                         // = rid, reuses peaks request mechanism
  label: z.string(),                           // user-friendly ("app/api/users")
  status: z.enum(['pending', 'in-progress', 'done', 'failed', 'blocked', 'skipped']),
  commitSha: z.string().optional(),            // required when status=done
  finishedAt: z.string().datetime().optional(),
  failureReason: z.string().optional(),        // required when status=failed
  repairCycles: z.number().int().nonnegative().default(0),  // mirrors peaks request repair-status
  blockedReason: z.string().optional(),        // required when status=blocked
});

export const JobStateSchema = z.object({
  jobId: z.string(),
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  lastCheckpointAt: z.string().datetime(),
  parallelismHint: z.enum(['serial', 'llm-decides']).default('llm-decides'),
  exitPolicy: z.enum(['strict', 'best-effort']).default('strict'),
  mainLoopStrategy: z.enum(['single', 'rotating']).default('rotating'),
  rotateEvery: z.number().int().positive().default(3),   // rotating mode only
  mainSessionCycle: z.number().int().nonnegative().default(0),  // bumps on every rotate
  mainLoopOverride: z.object({                            // populated only if LLM overrode rotating→single
    from: z.literal('rotating'),
    to: z.literal('single'),
    reason: z.string().min(10),
    at: z.string().datetime(),
  }).optional(),
  slices: z.array(SliceStateSchema),
});

export const ResourceSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  cpuPercent: z.number().min(0).max(100),
  memMb: z.number().nonnegative(),
  diskMb: z.number().nonnegative(),        // job/<jid>/ dir size
  contextRatio: z.number().min(0).max(1),  // 0..1, last known from peaks code context-now
});

export const JobStatusSummarySchema = z.object({
  total: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  blocked: z.number().int(),
  skipped: z.number().int(),
  currentSlice: z.string().optional(),
  lastCheckpoint: z.string().datetime(),
  mainLoopStrategy: z.enum(['single', 'rotating']),
  mainSessionCycle: z.number().int(),
  etaSec: z.number().int().optional(),     // rough estimate: avgSliceSec * remaining
  resourcesNow: ResourceSnapshotSchema.optional(),
});

export type SliceState = z.infer<typeof SliceStateSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type JobStatusSummary = z.infer<typeof JobStatusSummarySchema>;
```

### 4.3 New peaks-code steps

#### Step 0.8 — Job 启动 (NEW)

Trigger condition: user request semantics suggest multi-slice work. Heuristic:
- Mentions a list of parallel targets (subdirectories, submodules, files to process)
- Says "全部完成", "until all done", "全部", "all of them"
- Mentions a cost/duration disavowal ("不用 care 费用", "don't worry about cost", "一直跑")

If triggered, Code calls `peaks job init` with the parsed slice list (LLM parses the user's list at this point — see 4.4) and proceeds to the loop.

If the request is single-target (e.g. "fix bug in app/api/users"), Step 0.8 is a no-op and the standard single-rid runbook applies.

Job-init also picks `--main-loop-strategy`:
- `len(slices) ≤ 2` → default `single`. Two slices rarely justify the kernel-reset overhead.
- `len(slices) ≥ 3` → default `rotating` with `--rotate-every 3`. This is a hard default — the runner must never silently coast on `single` past 2 slices, because main-session decision-drift already manifests by then in practice.
- LLM may override `rotating` → `single` only if it writes an explicit justification (recorded in the job-init LLM trace) AND the total predicted wall-time is ≤30 min. Override is logged as `mainLoopOverride: { from: 'rotating', to: 'single', reason }` in state.json.

#### Step 0.81 — per-slice 收尾 (NEW)

After each slice's commit succeeds:

```
peaks job checkpoint --slice-id <rid> --state done --commit-sha $(git rev-parse HEAD)
peaks job status --job-id <jid>
```

Loop control:
- `remaining > 0` → return to Step 1 (next-slice selection)
- `remaining == 0` → proceed to Step 8 / 9 / 10 / 11 (single-rid tail)
- `any blocked slice under strict` → invoke Step 0.85
- (rotating mode) at every `rotateEvery` slices → invoke Step 0.86 BEFORE picking next slice

#### Step 0.85 — slice 阻塞处理 (NEW)

Triggered when `peaks request repair-status` returns `atCap: true` for the current slice, OR when `peaks code context-now` returns red-line sustained ≥5 minutes:

```
peaks job block --slice-id <rid> --reason "<QA 3-cycle cap: ...>" 
# OR
peaks job block --slice-id <rid> --reason "<context overflow: ...>"
```

Code emits a TXT-style handoff describing the block reason + the job state, then **STOPS** and waits for the user.

#### Step 0.86 — main session rotation (NEW, rotating mode only)

Active only when `--main-loop-strategy rotating`. Fires every `rotateEvery` slices. The sequence:

```
# 1. Capture cycle summary (so the next main session has a fresh start)
peaks session cycle-summary --job-id <jid> \
  --summary "Completed slices 1-N, current slice, decisions, TODOs" \
  --json > .peaks/_runtime/<sid>/session/cycle-<n>.md

# 2. Bump main session cycle in job state
peaks job checkpoint --slice-id <none> --state rotate  # internal marker

# 3. Trigger IDE-side main-session rotation
peaks session rotate --project <repo> --json    # signals "main session ends here"

# 4. Next user turn starts a fresh main LLM session; peaks-code re-anchors,
#    reads auto-decisions.md + cycle-<n>.md + job.state.json, and resumes the loop.
peaks session resume --job-id <jid> --project <repo> --json
```

**Why this exists**: auto-compact alone cannot reset the main session to a known-clean baseline. After 5-10 compactions the LLM's decision drift becomes noticeable, and after 15+ the runner commonly returns HTTP-400 / "valid params" style errors because the residual context is incoherent. Periodic rotation resets the kernel-level state.

#### Step 0.87 — sub-agent cleanup gate (NEW, every slice)

After every `peaks sub-agent dispatch --batch-id <id>` in a Job scope, BEFORE moving on:

```
peaks job subagent-cleanup --job-id <jid> --batch-id <id> --force
```

If cleanup fails (process still alive, temp files un-cleaned, budget-mb exceeded), the orchestrator refuses to mark the slice done and instead calls `peaks job block --reason "sub-agent cleanup failed: batch <id>"`. This blocks resource leaks from accumulating across slices.

The Step 0.87 wrapper **fires before the normal Step 0.81 checkpoint** — i.e. the order on every slice is:
1. Slice commit landed (from Step 7)
2. `peaks job subagent-cleanup --force` (Step 0.87)
3. `peaks job checkpoint --state done --commit-sha <sha>` (Step 0.81)
4. Loop control (Step 0.81 / 0.85 / 0.86)

### 4.4 LLM-driven slice list parsing + DAG ordering

When `--parallelism-hint llm-decides`:

1. LLM reads the user's request and the project scan output
2. LLM proposes an initial slice list (one entry per independent unit)
3. LLM writes `.peaks/_runtime/<sid>/job/<jid>/slice-dag.json` with edges (which slices must precede others) and a topological order
4. `peaks job init` accepts the DAG as input; subsequent `peaks job status` reports current vs total

When `--parallelism-hint serial`, LLM still proposes the list (Step 0.8 prompt demands it) but the DAG is a linear chain. Serial is meant for debugging and explicit user request; default is `llm-decides`.

**Slice-list source resolution.** If the user names the slices verbatim in their request (e.g. "app/api/users, app/api/orders, app/ui/dashboard"), use that list directly. Otherwise invoke `peaks scan project-tree --slice-on <boundary> --project <repo>` to auto-derive (e.g. slice-on directory under app/). The LLM may also amend the auto-derived list to add or remove entries based on the user's natural-language request, but every derived slice appears in state.json with provenance (auto / user-named / llm-amended).

### 4.5 Integration with existing mechanisms

| Existing mechanism | Job integration |
|---|---|
| `peaks request init/transition/repair-status` | Each slice reuses the full single-rid lifecycle. No changes. |
| `peaks sub-agent dispatch` | Each slice's RD/QA swarm runs unchanged at the protocol layer. The **Job-aware wrapper** auto-injects `--budget-mb` (default 512 MB) and demands `peaks job subagent-cleanup` afterward. Vanilla `peaks sub-agent dispatch` is untouched. |
| `peaks session checkpoint/resume` | Cross-session: read both `session/checkpoints/` AND `job/<jid>/state.json`. If job state says more slices remain, prompt user: resume / restart / skip. In rotating mode, `peaks session resume` reads `session/cycle-<n>.md` + job.state.json. |
| `peaks session rotate` (NEW for rotating mode) | Active only when `--main-loop-strategy rotating`. Forces a controlled main-session reset every `rotateEvery` slices. Distinct from auto-compact, which is in-band compression; `rotate` is a fresh main-session kernel. |
| `peaks code auto-compact` (v2.13.0) | Per-slice (may fire many times across one job). Auto-compact touches only session-side artifacts (e.g. `session/auto-decisions.md`); it never reads or writes `job/<jobId>/state.json`. Each invocation is independent — job state always reflects "has this slice committed yet", independent of context pressure. **Note:** auto-compact is a *passive rescue inside one session*. The Job uses it for transient spikes but does **not** rely on it for long-term main-context health — that's what `rotate` is for. |
| `peaks skill presence` | Unchanged. Code remains the active skill. |
| `peaks standards / project scan` | Run once at job init, not per-slice. |
| `peaks budget audit` | `--show-cost` becomes a new flag on `peaks job status` (read-only, never halts). |
| `peaks statusline` | New event hook: when a Job is in flight, the statusline renders `job: <jid> [done/total] currentSlice ETA m:s context main%. <rotating cycle>`. Lets the user see progress passively. |
| `peaks resource snapshot` (NEW, optional) | `peaks resource snapshot --job-id <jid>` returns the ResourceSnapshot for the Job. Polled opportunistically, not on a clock. Snapshot stored at `job/<jid>/resources/<timestamp>.json` for retrospective analysis. |
| `peaks code context-now` | Polled every slice in rotating mode (cheap). If ratio ≥ 0.85, Code's Step 0.81 may trigger an out-of-cadence `peaks job rotate-now`. |

---

## 5. Data flows

### 5.1 Happy path — user adds UT for every `app/` subdirectory

```
T+0:  user request
      "peaks-code 给 app/ 下所有子目录补 UT,以子目录为 slice 维度,自验证后 commit,不用 care 费用"

T+30s: Code Step 0 — anchor workspace, scan archetype
T+45s: Code Step 0.8 — multi-slice heuristic triggers
        ls app/*/ → parses [api/users, api/orders, ui/dashboard, ui/auth, lib/db, ...]
        peaks job init --job-id ut-app-2026-07-03
                       --slice-list "api/users,api/orders,ui/dashboard,ui/auth,lib/db,..."
                       --parallelism-hint llm-decides
                       --exit-policy strict
        writes state.json + slice-dag.json

T+1m:   Loop iter 1: slice api/users
        Single-rid runbook runs: PRD → RD → QA → commit
        commit: feat(test): add UT for app/api/users (sha: abc123)
        Step 0.81: peaks job checkpoint --state done --commit-sha abc123
        peaks job status: { done: 1, remaining: 7, ... }

T+8m:   Loop iter 2: slice api/orders
        ... (similar to iter 1, but auto-compact triggered at 0.85; state.json untouched)

T+15m:  ... (more iters) ...

T+45m:  Loop iter 8: slice ui/dashboard
        QA returns verdict=return-to-rd 3 times consecutively
        peaks request repair-status returns atCap: true
        Step 0.85: peaks job block --reason "QA 3-cycle cap, dashboard props unstable"
        STOP. Output: "job ut-app-2026-07-03 BLOCKED at slice ui/dashboard, awaiting user"

T+50m:  user intervention — fixes props manually
        user: "peaks-code 续 ut-app-2026-07-03"
        Code detects "续" + has unfinished-work probe → peaks job resume
        User: "已修,继续" → peaks job continue
        Re-runs slice ui/dashboard to completion

T+60m:  ... (remaining slices) ...

T+90m:  Loop terminates: { done: 8, remaining: 0 }
        Step 8 / 9 / 10 / 11: SC / OpenSpec (if exists) / TXT handoff
        TXT capsule body contains the full job summary

```

### 5.2 Cross-session recovery (24h off-line scenario)

```
T+0..N: Code runs job over hours
T+N:    User closes IDE for the night

T+M (next morning):
        User opens IDE, runs /peaks-code
        Code Step 0.7 (unfinished-work probe) reads job state.json
        { done: 3, remaining: 5, currentSlice: lib/db }
        AskUserQuestion: "检测到未完成的 job ut-app-2026-07-03 (3/8 done)。
                         (a) resume, (b) restart, (c) 跳过已完成"
        User picks (a)
        peaks job resume → continues from lib/db
```

### 5.3 Auto-compact interaction

```
Loop iter 4 mid-execution
peaks code context-now returns ratio=0.87 (pre-compact zone)
auto-compact protocol runs:
  - writes .peaks/_runtime/<sid>/session/auto-decisions.md
  - triggers IDE-side compact
LLM reads auto-decisions.md on post-compact turn
Continues current slice; completes; calls checkpoint
state.json unchanged; only session/auto-decisions.md is updated
```

**Invariant:** auto-compact touches only session state, never job state. Job state always reflects "has this slice committed yet", independent of context pressure.

### 5.4 Multiple jobs in one session (deferred — M2 supports 1 job / session)

The `.peaks/_runtime/<sid>/job/<jobId>/` layout allows N job dirs to coexist. In M2, peaks-code Step 0.8 will refuse to start a second job while one is in flight (errors out with a list of active jobs and tells user to run `peaks job continue` explicitly). Multi-job concurrent control is M7+ scope.

---

## 6. Error handling

### 6.1 Error categories & strategies

| Category | Trigger | Strategy | User pauses? |
|---|---|---|---|
| **Slice-level RD failure** | RD exit ≠ 0 | Existing peaks RD micro-cycle, cap 3, over cap → slice block | Only at cap |
| **Slice-level QA failure** | QA verdict = return-to-rd | Existing repair loop, cap 3, over cap → slice block | Only at cap |
| **Slice-level uncertainty** (LLM notices AC unclear) | LLM fires `uncertain` signal | **Banned from asking user** (full-auto); LLM self-resolves: refine AC / scope-down / skip-with-reason | No |
| **Job-level block** | Any slice blocked (strict) OR N blocked (best-effort, N=1 default) | peaks job block → STOP, wait for user | **Yes** |
| **Context overflow (transient)** | ratio ≥ 0.85, single mode | Auto-compact fires inside the running session; Job pauses for ≤2 min, then resumes | No (auto) |
| **Context overflow (terminal)** | ratio ≥ 0.95 sustained ≥5 min, OR ratio hits 0.99 once | peaks job block (with reason "context overflow"). In rotating mode, the rotation was supposed to prevent this; if it still happens, treat as a Job-level bug. | **Yes** |
| **Main-session decision-drift** (rotating mode) | Mid-loop LLM notices its own outputs losing coherence / producing garbage outputs | LLM may invoke `peaks job rotate-now` out of cadence. Audit log records the trigger. | No |
| **Sub-agent resource breach** | sub-agent process exceeds its declared `--budget-mb`, OR cleanup epilogue fails | Job block; retry attempts capped at 1 per slice | **Yes** (on cap) |
| **Sub-agent zombie** | `peaks job subagent-cleanup --force` reports live process(es) | Job block with reason "sub-agent zombie: <batch-id>" | **Yes** |
| **CLI / hook fault** | `peaks job *` exit ≠ 0 | LLM reads stderr → report + STOP (no silent retry) | **Yes** |
| **Disk fault** | state.json write fails (EACCES / ENOSPC) | Immediate STOP + report | **Yes** |
| **Semantic mis-detection** | Step 0.8 thinks request is multi-slice, user disagrees | Fallback to single-rid path; log info row only | No |

### 6.2 Strict vs Best-effort

- **strict** (default): 1 slice block → whole job blocks, STOP, wait for user
- **best-effort** (opt-in): blocked slice → status=skipped, continue, summary lists skips with reasons. **Never silent**: skips must surface in final summary.

### 6.3 Red lines (LLM hard constraints)

The LLM-runner MUST NOT:

1. **Enter Step 11 / write final handoff while job has remaining slices.** Hard-gated by `peaks job status` reporting `remaining > 0`.
2. **Re-ask the user about cost / length / context when user has explicitly disavowed.** Written into Step 1 prose as a prompt-level guard.
3. **Coalesce multiple slices into one rid** (e.g. "let me just merge slice 4-5 to save context"). State machine rejects.
4. **Modify a committed slice** (`git commit --amend` on a slice already `done`). New changes get a new slice.
5. **Fake completion** — calling `peaks job checkpoint --state done` for a slice whose QA/test/commit did not actually run. The CLI verifies the commit-sha exists in git log before accepting.
6. **Use detached / background / daemon-mode sub-agents inside a Job.** No `nohup`, no `disown`, no `setsid`. Every dispatch is foreground. Enforced at the Job-aware wrapper layer.
7. **Skip `peaks job subagent-cleanup`** between dispatch and slice checkpoint. Enforced: the wrapper refuses `checkpoint --state done` until the matching cleanup call lands.
8. **Skip or postpone a scheduled `peaks session rotate`** in rotating mode to "save time". The wrapper logs a `rotate-skipped` audit row if the LLM tries; the red line is honored by the gate.
9. **Suppress visibility** — must not silence statusline events or `--watch` output. Even if user steps away, the progress is ambient.

### 6.4 Test strategy

- **Unit:** state machine transition table (init / checkpoint done / failed / blocked / resume / continue / rotate-now / subagent-cleanup)
- **Integration:** mini-job N=3 happy path + 1 slice fail → block → user continue → 续完
- **E2E:** real repo + real commits, 7-slice job completes, git log clean
- **Fault injection:** forced slice fail, simulated IDE kill, simulated context overflow, simulated sub-agent budget breach → verify recovery + job-block
- **Behavior:** red-line #1-#9 lint guards via prompt-fuzzer + assertion suite
- **Resource leak detection:** run a 5-slice job, then assert `job/<jid>/` dir is bounded (<2× single-slice footprint), assert no zombie sub-agent processes via `ps`
- **Context-explosion simulation:** run a 3-slice `single` mode job while injecting noise tokens into the main session transcript; verify job invokes `peaks job rotate-now` before ratio ≥ 0.95, and that the post-rotate main session regains < 0.50 ratio

---

## 7. Acceptance criteria

| AC | Description | Verification |
|---|---|---|
| AC-1 | All 9 `peaks job *` subcommands (init / status / checkpoint / continue / resume / block / handoff / rotate-now / subagent-cleanup) callable, `--help` matches existing CLI style | Unit + help snapshot |
| AC-2 | state.json schema validates via zod (incl. `mainLoopStrategy`, `mainSessionCycle`, `ResourceSnapshot`); missing/wrong fields fail `peaks job status` with field names | Unit (happy + 3 schema error cases) |
| AC-3 | Multi-slice user request → end-to-end completion with 0 user interruptions | E2E + LLM fuzzer |
| AC-4 | Any slice failure → whole job blocks + STOP, user not woken prematurely; block reason readable | Unit + integration |
| AC-5 | Cross-session / cross-day: read state.json, resume from next-slice; done slices not re-run | Integration (sim restart) |
| AC-6 | auto-compact 5+ times during job doesn't corrupt job state | Integration |
| AC-7 | 9 red lines (incl. no-detach, statusline, hard-budget, no-skip-rotate) not violated under prompt fuzzer | Fuzzer + assertion |
| AC-8 | Strict: 1 block → whole job blocks, no auto-skip of subsequent slices | Unit |
| AC-9 | Best-effort: 1 block → skipped + reason + continue | Unit |
| AC-10 | Coexists with existing `peaks request / session / sub-agent fan-out` (no rid double-opening) | Regression (run existing peaks-code runbook) |
| AC-11 | `--main-loop-strategy rotating` (default for ≥3 slices) resets main session every `rotateEvery` slices, post-rotate ratio < 0.50, no data loss in job state | E2E (8-slice job, ratio injection) |
| AC-12 | `--main-loop-strategy single` (default for ≤2 slices) end-to-end without any rotation; LLM-initiated override from rotating→single requires justification and is rejected if total predicted wall-time >30 min | Unit + integration + override-journal audit |
| AC-13 | Job-aware sub-agent wrapper: every dispatch in Job scope mandates `--budget-mb`; cleanup must fire before slice checkpoint; failure → job block | Unit + integration |
| AC-14 | `peaks job status --watch` shows progressing counters every 3s; statusline event renders `job: ... ETA ...` | Manual + snapshot |

---

## 8. Delivery & milestones

### 8.1 Deliverable list

| # | File | Lines (est) | Purpose |
|---|---|---|---|
| 1 | `src/cli/commands/job-commands.ts` | 280 | 9 subcommands incl. `--watch` + JSON envelopes |
| 2 | `src/services/job/job-orchestrator.ts` | 300 | State machine core + rotate-now + cleanup-gate |
| 3 | `src/services/job/job-types.ts` | 100 | Types + zod schema (incl. ResourceSnapshot) |
| 4 | `src/services/job/job-state-store.ts` | 100 | atlas-style fs ops + locking |
| 5 | `src/services/job/subagent-job-wrapper.ts` | 120 | Forces `--budget-mb` + cleanup in Job scope |
| 6 | `src/services/job/job-rotation.ts` | 100 | Cycle-summary + `peaks session rotate` orchestration |
| 7 | `src/services/job/job-resource-snapshot.ts` | 80 | cpu/mem/disk/context snapshot collector |
| 8 | `skills/peaks-code/SKILL.md` | +150 | Step 0.8/0.81/0.85/0.86/0.87 + Step 1 reinforcement + visibility prose |
| 9 | `skills/peaks-code/references/runbook.md` | +60 | Job path CLI sequence |
| 10 | `skills/peaks-code/references/job-loop.md` | 200 | Job state machine + rotating-mode deep-dive |
| 11 | `tests/unit/job/*.test.ts` | 800 | state machine / schema / wrapper / rotation / CLI |
| 12 | `tests/integration/job-e2e.test.ts` | 250 | 8-slice E2E with context-explosion injection |
| 13 | `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` | (this file) | RFC + design |
| 14 | `.peaks/memory/peaks-loop-job-introduction.md` | TBD | Runbook sediment for future sessions |

**Total ~2540 LoC + 1 spec + 1 memory** (revised up from 1700 to cover rotating-mode, subagent wrapper, resource snapshot, statusline hook). Note: per Q4 (2026-07-03 round 3), `mainLoopStrategy` default was tightened from "≤5 single, 6-8 single+warn, ≥9 rotating" to "≤2 single, ≥3 rotating (hard)" — this puts rotating on the hot path for the vast majority of real jobs, so M4 + M6 testing must cover rotation heavily.

### 8.2 Milestones (revised)

| Phase | Content | Est | Verifies |
|---|---|---|---|
| **M1 — Spec + types** | Schema + zod + CLI help snapshot + ResourceSnapshot shape | 0.5d | AC-2 |
| **M2 — State machine core** | Orchestrator + state-store + transition tests (single mode only) | 1d | AC-2 / AC-8 / AC-9 / AC-12 |
| **M3 — CLI family** | 9 subcommands wired incl. `--watch` | 1d | AC-1 / AC-14 |
| **M4 — Code integration + rotating mode** | Step 0.8/0.81/0.85/0.86/0.87 + job-rotation.ts + SKILL.md + runbook | 2d | AC-3 / AC-4 / AC-7 / AC-11 |
| **M5 — Sub-agent wrapper + resource safety** | subagent-job-wrapper.ts + job-resource-snapshot.ts + statusline event hook + AC-13 enforcement | 1d | AC-13 / AC-14 |
| **M6 — Integration / E2E + fault injection** | 8-slice E2E + context-explosion inject + sub-agent budget breach | 1.5d | AC-5 / AC-6 / AC-11 |
| **M7 — Regression + docs + release** | Run existing code runbook + spec commit + memory sediment | 0.5d | AC-10 + release |

**Total: ~7.5 working days, single dev, full-auto** (revised up from 5 to cover rotating-mode + cleanup + resource safety).

### 8.3 Risks & open questions

1. **LLM fuzzer strength** — Can fuzzer reliably detect red-line #1-#9 violations? Needs a PoC at M2.
2. **Job state vs session state boundary** — Both exist; explicit boundary: session covers **context state**, job covers **workflow state**. Cross-references defined in 4.5; refine as M4 lands.
3. **Multi-job concurrency** — M2 ships 1 job / session. M8+ adds N-job, requires per-job resource isolation (per-job cgroup / per-job temp dir).
4. **Cost transparency** — `--show-cost` shipped in v1 (read-only, non-blocking).
5. **LLM self-decide algorithm** for parallelism — Minimal heuristic in 4.4. Iteration after M7.
6. **Rotating mode cross-session resume correctness** — `peaks session resume` after `peaks session rotate` must load both `cycle-<n>.md` and `job.state.json`. Test it under M6 fault injection.
7. **Memory / disk leak across a long job** — even with the cleanup gate, residual artifacts from sub-agent scratch dirs may accumulate. The `peaks resource snapshot` collector + AC-13 resource-leak detection are mandatory; if leaks exceed budget after M6, add a per-N-slice deep-cleanup pass in M8.
8. **Statusline integration is per-IDE** — Claude Code MVP, others (cursor / trae / etc) follow existing patterns in `peaks statusline install`. Already tracked elsewhere; mention here for visibility.

---

## 9. Appendix: Why this design (vs alternatives)

### Alt B — Pure prompt-level patch

Patch peaks-code SKILL.md to say "loop until done". Pros: minimal change. Cons: no on-disk state, no cross-day recovery, LLM "summarize = stop" instinct unaddressed.

### Alt C — Hook-level "continue job" interceptor

Add a PreToolUse hook that rejects completion responses when job has remaining slices. Pros: zero SKILL.md / CLI change. Cons: overlaps with existing [Fact-Forcing Gate] in unclear ways; no on-disk state; hard to test.

**Why A wins:** on-disk state enables cross-day recovery (the user's C3 scenario); CLI surface makes it testable + auditable; the outer-loop wrapper preserves existing single-rid runbook untouched.

---

## 10. References

- `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md` — core positioning (24h AI programmer)
- `.peaks/memory/peaks-cli-user-role-and-tech-decision.md` — user role + reverse-fake-choice
- `.peaks/memory/2026-06-28-full-auto-boundary.md` — full-auto = commit-end
- `.peaks/memory/2026-06-27-auto-compact-design.md` — context overflow protocol
- `skills/peaks-code/SKILL.md` — current 11-step runbook
- `skills/peaks-code/references/runbook.md` — current single-rid CLI sequence
