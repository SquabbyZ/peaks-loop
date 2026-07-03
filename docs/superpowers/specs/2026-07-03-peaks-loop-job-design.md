# Peaks-Loop Job: Long-Task Loop Engineering for 24h AI Programmer

**Status:** Draft (post-brainstorming, pre-writing-plans)
**Date:** 2026-07-03
**Author:** SquabbyZ (via peaks-solo brainstorm session 2026-07-03-session-67f631)
**Affects:** peaks-solo, peaks CLI (new `peaks job *` subcommand family), `.peaks/_runtime/<sessionId>/job/<jobId>/` artifact tree

---

## 1. Problem statement

### 1.1 Symptom

When users ask peaks-loop to drive a long, multi-slice job — e.g. "for an existing Next.js project, write unit tests for every subdirectory under `app/`, one slice per subdirectory, self-validate + commit, then move to the next slice, until all done; cost is not a concern" — the LLM-runner correctly splits the work into a slice DAG, but stops after committing slice #1 and refuses to continue with one of two rationalizations:

1. "This task cannot be completed in a single session" (false — auto-compact protocol keeps the runner alive)
2. "Continuing would consume too many tokens / cost too much" (irrelevant — user has explicitly opted out of cost concerns)

This contradicts peaks-loop's positioning as a **24h AI programmer orchestrator** that keeps the runner alive across multi-hour jobs without human intervention (see `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`, constraints C3 + C5).

### 1.2 Root cause (architectural, not behavioral)

The current peaks-solo runbook models **one rid = one workflow** end-to-end (PRD → RD → QA → commit → TXT handoff). There is no outer loop construct. After the first rid's TXT handoff fires, the runbook signals "this skill's job is done" — the LLM obeys, regardless of how many slices remain.

The auto-compact protocol (v2.13.0) keeps a single rid's runner alive across context-overflow events, but does **not** chain rids together. The economic audit (`peaks budget audit`) reports cost but does not stop the runner. Neither mechanism matches the user's mental model of "a job with N independent slices that must all complete before the runner stops."

### 1.3 Why not just "patch the prompt"

Patching the peaks-solo SKILL.md prose to say "continue until job done" leaves:

- **No on-disk job state** → runner forgets progress after auto-compact, cross-day restart, or IDE reopen
- **LLM's natural "summarize = stop" instinct** unaddressed at the architectural level
- **No guard rail** preventing the LLM from drifting back into "single rid = complete" behavior under context pressure
- **No testable state machine** — verification depends on subjective LLM behavior rather than deterministic CLI

We need a first-class `Job` construct.

---

## 2. Goals & non-goals

### 2.1 Goals

- A user can express "do these N independent slices, one after another, only stop when all done (or one fails terminally)" as a single command to peaks-solo
- The runner keeps working across slices **without asking the user about cost, length, or context**
- Progress survives auto-compact, cross-day session restart, IDE reopen, and accidental process kill
- Slice failures strictly halt the whole job; user decides next action
- Existing single-slice workflow (peaks-solo runbook Step 2-7) is unchanged — Job is purely an outer loop wrapper
- Existing mechanisms (auto-compact, session checkpoint, sub-agent fan-out, standards preflight) integrate without modification

### 2.2 Non-goals

- **Multi-job per session is out of M2 scope** — design supports it (per-job directory), M2 ships 1 job / session
- **Cost transparency is non-blocking** — `--show-cost` is a read-only affordance, not a halt condition
- **Cross-machine resume is out of scope** — state lives under sessionId which is per-machine (consistent with existing checkpoints)
- **Job-level cancellation is user-initiated only** — LLM cannot abort a job autonomously
- **Refactoring existing single-slice runbook** — Job is an outer wrapper, not a replacement

---

## 3. Architecture overview

```
                 ┌────────────────────────────────────────────────┐
                 │  peaks-solo  (orchestrator, full-auto profile) │
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
            │                                                     │
            │   Step 1 — Pick next slice (per slice-dag order)    │
            │      ↓                                              │
            │   Existing peaks-solo runbook (Step 2-7)            │
            │   = 单 rid 单 slice 全套 (PRD→RD→QA→commit)         │
            │      ↓                                              │
            │   Step 0.81 (NEW: per-slice checkpoint)             │
            │   = peaks job checkpoint --slice <rid> --state done │
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

### 3.1 Boundary discipline

- **Job sits at the runbook layer**, not inside any single rid. The Step 0.8 / 0.81 / 0.85 steps are NEW additions; existing Step 0 through Step 11 are unchanged in semantics (only runbook.md gets a "Job path" fork that uses them in a loop)
- **CLI surface is a new subcommand family** (`peaks job *`), sitting at the same architectural layer as `peaks session` and `peaks sub-agent`
- **On-disk state uses the 2.7.1 single-scope-axis convention**: `.peaks/_runtime/<sessionId>/job/<jobId>/` — gitignored, parallel to the existing `.peaks/_runtime/<sessionId>/prd/`, `rd/`, `qa/`, `txt/` directories

### 3.2 New / modified files (preliminary)

| File | Status | ~Lines | Purpose |
|---|---|---|---|
| `src/cli/commands/job-commands.ts` | new | 200 | 7 subcommands + JSON envelopes |
| `src/services/job/job-orchestrator.ts` | new | 250 | State machine core + side-effect isolation |
| `src/services/job/job-types.ts` | new | 80 | Types + zod schema |
| `src/services/job/job-state-store.ts` | new | 80 | atlas-style fs ops + locking |
| `skills/peaks-solo/SKILL.md` | modified | +120 | Step 0.8 / 0.81 / 0.85 + Step 1 red-line reinforcement |
| `skills/peaks-solo/references/runbook.md` | modified | +50 | Job path CLI sequence |
| `skills/peaks-solo/references/job-loop.md` | new | 150 | Job state machine deep-dive |
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
  --project <repo>
  --json

peaks job status
  --job-id <jid> --project <repo> --json
  # output: { total, done, failed, blocked, skipped, currentSlice, lastCheckpoint }

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
```

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
  slices: z.array(SliceStateSchema),
});

export const JobStatusSummarySchema = z.object({
  total: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  blocked: z.number().int(),
  skipped: z.number().int(),
  currentSlice: z.string().optional(),
  lastCheckpoint: z.string().datetime(),
});

export type SliceState = z.infer<typeof SliceStateSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type JobStatusSummary = z.infer<typeof JobStatusSummarySchema>;
```

### 4.3 New peaks-solo steps

#### Step 0.8 — Job 启动 (NEW)

Trigger condition: user request semantics suggest multi-slice work. Heuristic:
- Mentions a list of parallel targets (subdirectories, submodules, files to process)
- Says "全部完成", "until all done", "全部", "all of them"
- Mentions a cost/duration disavowal ("不用 care 费用", "don't worry about cost", "一直跑")

If triggered, Solo calls `peaks job init` with the parsed slice list (LLM parses the user's list at this point — see 4.4) and proceeds to the loop.

If the request is single-target (e.g. "fix bug in app/api/users"), Step 0.8 is a no-op and the standard single-rid runbook applies.

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

#### Step 0.85 — slice 阻塞处理 (NEW)

Triggered when `peaks request repair-status` returns `atCap: true` for the current slice, OR when `peaks solo context-now` returns red-line sustained ≥5 minutes:

```
peaks job block --slice-id <rid> --reason "<QA 3-cycle cap: ...>" 
# OR
peaks job block --slice-id <rid> --reason "<context overflow: ...>"
```

Solo emits a TXT-style handoff describing the block reason + the job state, then **STOPS** and waits for the user.

### 4.4 LLM-driven slice list parsing + DAG ordering

When `--parallelism-hint llm-decides`:

1. LLM reads the user's request and the project scan output
2. LLM proposes an initial slice list (one entry per independent unit)
3. LLM writes `.peaks/_runtime/<sid>/job/<jid>/slice-dag.json` with edges (which slices must precede others) and a topological order
4. `peaks job init` accepts the DAG as input; subsequent `peaks job status` reports current vs total

When `--parallelism-hint serial`, LLM still proposes the list (Step 0.8 prompt demands it) but the DAG is a linear chain. Serial is meant for debugging and explicit user request; default is `llm-decides`.

### 4.5 Integration with existing mechanisms

| Existing mechanism | Job integration |
|---|---|
| `peaks request init/transition/repair-status` | Each slice reuses the full single-rid lifecycle. No changes. |
| `peaks sub-agent dispatch` | Each slice's RD/QA swarm runs unchanged. |
| `peaks session checkpoint/resume` | Cross-session: read both `session/checkpoints/` AND `job/<jid>/state.json`. If job state says more slices remain, prompt user: resume / restart / skip. |
| `peaks solo auto-compact` (v2.13.0) | Per-slice. Job state unaffected. |
| `peaks skill presence` | Unchanged. Solo remains the active skill. |
| `peaks standards / project scan` | Run once at job init, not per-slice. |
| `peaks budget audit` | `--show-cost` becomes a new flag on `peaks job status` (read-only, never halts). |

---

## 5. Data flows

### 5.1 Happy path — user adds UT for every `app/` subdirectory

```
T+0:  user request
      "peaks-solo 给 app/ 下所有子目录补 UT,以子目录为 slice 维度,自验证后 commit,不用 care 费用"

T+30s: Solo Step 0 — anchor workspace, scan archetype
T+45s: Solo Step 0.8 — multi-slice heuristic triggers
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
        user: "peaks-solo 续 ut-app-2026-07-03"
        Solo detects "续" + has unfinished-work probe → peaks job resume
        User: "已修,继续" → peaks job continue
        Re-runs slice ui/dashboard to completion

T+60m:  ... (remaining slices) ...

T+90m:  Loop terminates: { done: 8, remaining: 0 }
        Step 8 / 9 / 10 / 11: SC / OpenSpec (if exists) / TXT handoff
        TXT capsule body contains the full job summary

```

### 5.2 Cross-session recovery (24h off-line scenario)

```
T+0..N: Solo runs job over hours
T+N:    User closes IDE for the night

T+M (next morning):
        User opens IDE, runs /peaks-solo
        Solo Step 0.7 (unfinished-work probe) reads job state.json
        { done: 3, remaining: 5, currentSlice: lib/db }
        AskUserQuestion: "检测到未完成的 job ut-app-2026-07-03 (3/8 done)。
                         (a) resume, (b) restart, (c) 跳过已完成"
        User picks (a)
        peaks job resume → continues from lib/db
```

### 5.3 Auto-compact interaction

```
Loop iter 4 mid-execution
peaks solo context-now returns ratio=0.87 (pre-compact zone)
auto-compact protocol runs:
  - writes .peaks/_runtime/<sid>/session/auto-decisions.md
  - triggers IDE-side compact
LLM reads auto-decisions.md on post-compact turn
Continues current slice; completes; calls checkpoint
state.json unchanged; only session/auto-decisions.md is updated
```

**Invariant:** auto-compact touches only session state, never job state. Job state always reflects "has this slice committed yet", independent of context pressure.

### 5.4 Multiple jobs in one session (deferred — M2 supports 1 job / session)

The `.peaks/_runtime/<sid>/job/<jobId>/` layout allows N job dirs to coexist. In M2, peaks-solo Step 0.8 will refuse to start a second job while one is in flight (errors out with a list of active jobs and tells user to run `peaks job continue` explicitly). Multi-job concurrent control is M7+ scope.

---

## 6. Error handling

### 6.1 Error categories & strategies

| Category | Trigger | Strategy | User pauses? |
|---|---|---|---|
| **Slice-level RD failure** | RD exit ≠ 0 | Existing peaks RD micro-cycle, cap 3, over cap → slice block | Only at cap |
| **Slice-level QA failure** | QA verdict = return-to-rd | Existing repair loop, cap 3, over cap → slice block | Only at cap |
| **Slice-level uncertainty** (LLM notices AC unclear) | LLM fires `uncertain` signal | **Banned from asking user** (full-auto); LLM self-resolves: refine AC / scope-down / skip-with-reason | No |
| **Job-level block** | Any slice blocked (strict) OR N blocked (best-effort, N=1 default) | peaks job block → STOP, wait for user | **Yes** |
| **Context overflow** | ratio ≥ 0.95 sustained ≥5 min | peaks job block (with reason "context overflow") | **Yes** |
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

### 6.4 Test strategy

- **Unit:** state machine transition table (init / checkpoint done / failed / blocked / resume / continue)
- **Integration:** mini-job N=3 happy path + 1 slice fail → block → user continue → 续完
- **E2E:** real repo + real commits, 7-slice job completes, git log clean
- **Fault injection:** forced slice fail, simulated IDE kill, simulated context overflow → verify recovery
- **Behavior:** red-line #1-#5 lint guards via prompt-fuzzer + assertion suite

---

## 7. Acceptance criteria

| AC | Description | Verification |
|---|---|---|
| AC-1 | All 7 `peaks job *` subcommands callable, `--help` matches existing CLI style | Unit + help snapshot |
| AC-2 | state.json schema validates via zod; missing/wrong fields fail `peaks job status` with field names | Unit (happy + 3 schema error cases) |
| AC-3 | Multi-slice user request → end-to-end completion with 0 user interruptions | E2E + LLM fuzzer |
| AC-4 | Any slice failure → whole job blocks + STOP, user not woken prematurely; block reason readable | Unit + integration |
| AC-5 | Cross-session / cross-day: read state.json, resume from next-slice; done slices not re-run | Integration (sim restart) |
| AC-6 | auto-compact 5+ times during job doesn't corrupt job state | Integration |
| AC-7 | 5 red lines not violated under prompt fuzzer | Fuzzer + assertion |
| AC-8 | Strict: 1 block → whole job blocks, no auto-skip of subsequent slices | Unit |
| AC-9 | Best-effort: 1 block → skipped + reason + continue | Unit |
| AC-10 | Coexists with existing `peaks request / session / sub-agent fan-out` (no rid double-opening) | Regression (run existing peaks-solo runbook) |

---

## 8. Delivery & milestones

### 8.1 Deliverable list

| # | File | Lines (est) | Purpose |
|---|---|---|---|
| 1 | `src/cli/commands/job-commands.ts` | 200 | 7 subcommands + JSON envelopes |
| 2 | `src/services/job/job-orchestrator.ts` | 250 | State machine core |
| 3 | `src/services/job/job-types.ts` | 80 | Types + zod schema |
| 4 | `src/services/job/job-state-store.ts` | 80 | fs ops + lock |
| 5 | `skills/peaks-solo/SKILL.md` | +120 | Step 0.8 / 0.81 / 0.85 + Step 1 reinforcement |
| 6 | `skills/peaks-solo/references/runbook.md` | +50 | Job path CLI sequence |
| 7 | `skills/peaks-solo/references/job-loop.md` | 150 | State machine deep-dive |
| 8 | `tests/unit/job/*.test.ts` | 600 | 5 test files |
| 9 | `tests/integration/job-e2e.test.ts` | 200 | Real LLM mini-job E2E |
| 10 | `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` | (this file) | RFC + design |
| 11 | `.peaks/memory/peaks-loop-job-introduction.md` | TBD | Runbook sediment |

**Total ~1700 LoC + 1 spec + 1 memory**

### 8.2 Milestones

| Phase | Content | Est | Verifies |
|---|---|---|---|
| **M1 — Spec + types** | Schema + zod + CLI help snapshot | 0.5d | AC-2 |
| **M2 — State machine** | Orchestrator + state-store + transition tests | 1d | AC-2 / AC-8 / AC-9 |
| **M3 — CLI family** | 7 subcommands wired to orchestrator | 1d | AC-1 |
| **M4 — Solo integration** | Step 0.8 / 0.81 / 0.85 + SKILL.md + runbook | 1d | AC-3 / AC-7 |
| **M5 — Integration / E2E** | Cross-day simulation + auto-compact interaction | 1d | AC-4 / AC-5 / AC-6 |
| **M6 — Regression + docs** | Run existing solo runbook + spec commit + memory sediment | 0.5d | AC-10 + release |

**Total: ~5 working days, single dev, full-auto.**

### 8.3 Risks & open questions

1. **LLM fuzzer strength** — Can fuzzer reliably detect red-line #1-#5 violations? Needs a PoC at M2.
2. **Job state vs session state** — Both exist; need explicit boundary (session checkpoint covers **context state**, job state covers **workflow state**). Cross-references defined in 4.5 but may need refinement.
3. **Multi-job concurrency** — M2 ships 1 job / session. M7+ adds N-job, requires resource isolation.
4. **Cost transparency** — `--show-cost` is read-only and non-blocking. Decision deferred to M2: ship or omit in v1.
5. **LLM self-decide algorithm** — Heuristic in 4.4 is minimal. Iteration after M6 based on real LLM behavior.

---

## 9. Appendix: Why this design (vs alternatives)

### Alt B — Pure prompt-level patch

Patch peaks-solo SKILL.md to say "loop until done". Pros: minimal change. Cons: no on-disk state, no cross-day recovery, LLM "summarize = stop" instinct unaddressed.

### Alt C — Hook-level "continue job" interceptor

Add a PreToolUse hook that rejects completion responses when job has remaining slices. Pros: zero SKILL.md / CLI change. Cons: overlaps with existing [Fact-Forcing Gate] in unclear ways; no on-disk state; hard to test.

**Why A wins:** on-disk state enables cross-day recovery (the user's C3 scenario); CLI surface makes it testable + auditable; the outer-loop wrapper preserves existing single-rid runbook untouched.

---

## 10. References

- `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md` — core positioning (24h AI programmer)
- `.peaks/memory/peaks-cli-user-role-and-tech-decision.md` — user role + reverse-fake-choice
- `.peaks/memory/2026-06-28-full-auto-boundary.md` — full-auto = commit-end
- `.peaks/memory/2026-06-27-auto-compact-design.md` — context overflow protocol
- `skills/peaks-solo/SKILL.md` — current 11-step runbook
- `skills/peaks-solo/references/runbook.md` — current single-rid CLI sequence
