# M4 — Solo Integration + Rotating Mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Job loop into `peaks-code` SKILL.md (Step 0.8 / 0.81 / 0.85 / 0.86 / 0.87 per spec §4.3) and land the rotating-mode implementation (`src/services/job/job-rotation.ts` + `peaks job rotate-now` real impl). After M4, an LLM-runner invoking `peaks-code` can drive a multi-slice job end-to-end.

**Architecture:** SKILL.md gets a "Job Path" subsection appended after Step 0.7. Each new step is one paragraph: when to fire, CLI to call, exit criterion. The `job-rotation.ts` module owns the `peaks session cycle-summary` + `peaks session rotate` + `peaks session resume` orchestration per spec §4.3 Step 0.86.

**Tech Stack:** Markdown (skill prose), existing peaks session API (no new deps).

---

## Global Constraints (from README)

Apply verbatim. The 800-line file cap applies to SKILL.md too.

---

## Task 4.1: Implement `job-rotation.ts`

**Files:**
- Create: `src/services/job/job-rotation.ts`
- Test: `tests/unit/services/job/job-rotation.test.ts`

**Interfaces:**
- Consumes: `JobStateStore` (from M2), `peaks session cycle-summary`, `peaks session rotate`, `peaks session resume` — these MUST exist already (verify via grep). If they don't, this task is blocked (re-plan).
- Produces: `JobRotation` class with `cycleIfDue(jobId, slicesJustCompleted)` returning `{ rotated: boolean; reason?: string }`.

- [ ] **Step 1: Verify existing session-API surface**

Run:
```bash
grep -rn "function cycleSummary\|cycle-summary\|session rotate\|session resume" src/cli/commands/*.ts src/services/session/*.ts 2>/dev/null | head -20
```
Expected: file paths matching `peaks session cycle-summary` / `peaks session rotate` / `peaks session resume`. If any are missing, STOP and re-plan.

- [ ] **Step 2: Write failing test**

```typescript
// tests/unit/services/job/job-rotation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobOrchestrator } from '../../../../src/services/job/job-orchestrator.js';
import { JobRotation } from '../../../../src/services/job/job-rotation.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'job-rot-')); });

describe('JobRotation (single mode)', () => {
  it('never rotates when strategy=single', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b','c','d'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const rot = new JobRotation(store, async () => ({ rotated: false }), async () => ({}));
    const r = await rot.cycleIfDue('j', 4); // 4 slices completed
    expect(r.rotated).toBe(false);
  });
});

describe('JobRotation (rotating mode)', () => {
  it('rotates when slicesJustCompleted % rotateEvery === 0', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b','c','d','e','f'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    let rotateCalls = 0;
    const rot = new JobRotation(store, async () => { rotateCalls++; return { rotated: true }; }, async (jobId) => ({ jobId, cycle: 1 }));
    const r = await rot.cycleIfDue('j', 3);
    expect(r.rotated).toBe(true);
    expect(rotateCalls).toBe(1);
    const reloaded = store.load('j');
    expect(reloaded.mainSessionCycle).toBe(1);
  });

  it('does NOT rotate mid-cadence (e.g. 2 slices in)', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b','c','d'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    const rot = new JobRotation(store, async () => ({ rotated: true }), async () => ({}));
    const r = await rot.cycleIfDue('j', 2);
    expect(r.rotated).toBe(false);
  });
});

describe('JobRotation — rotateNow (out-of-cadence)', () => {
  it('forces rotation regardless of cadence', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a','b'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    let rotateCalls = 0;
    const rot = new JobRotation(store, async () => { rotateCalls++; return { rotated: true }; }, async () => ({}));
    const r = await rot.rotateNow('j');
    expect(r.rotated).toBe(true);
    expect(rotateCalls).toBe(1);
  });
});
```

- [ ] **Step 3: Run (expect FAIL — module not found)**

Run: `pnpm vitest run tests/unit/services/job/job-rotation.test.ts`
Expected: FAIL "Cannot find module job-rotation.js"

- [ ] **Step 4: Implement `job-rotation.ts`**

```typescript
// src/services/job/job-rotation.ts
import { JobStateStore } from './job-state-store.js';

export interface CycleOutcome { rotated: boolean; reason?: string; }

export class JobRotation {
  constructor(
    private readonly store: JobStateStore,
    private readonly sessionRotateImpl: (jobId: string) => Promise<CycleOutcome>,
    private readonly sessionCycleSummaryImpl: (jobId: string) => Promise<{ jobId: string; cycle: number }>,
  ) {}

  async cycleIfDue(jobId: string, slicesJustCompleted: number): Promise<CycleOutcome> {
    const state = this.store.load(jobId);
    if (state.mainLoopStrategy !== 'rotating') return { rotated: false, reason: 'single-mode' };
    if (slicesJustCompleted <= 0) return { rotated: false, reason: 'no-progress' };
    if (slicesJustCompleted % state.rotateEvery !== 0) return { rotated: false, reason: 'not-on-cadence' };
    return this.rotateNow(jobId);
  }

  async rotateNow(jobId: string): Promise<CycleOutcome> {
    const state = this.store.load(jobId);
    const summary = await this.sessionCycleSummaryImpl(jobId);
    const outcome = await this.sessionRotateImpl(jobId);
    if (!outcome.rotated) return { rotated: false, reason: 'session-rotate-refused' };
    const nextCycle = state.mainSessionCycle + 1;
    this.store.save({ ...state, mainSessionCycle: nextCycle, lastCheckpointAt: new Date().toISOString() });
    return { rotated: true, reason: `cycle-${nextCycle} (${summary.cycle})` };
  }
}
```

- [ ] **Step 5: Run (expect PASS)**

Run: `pnpm vitest run tests/unit/services/job/job-rotation.test.ts`
Expected: PASS — 4 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/services/job/job-rotation.ts tests/unit/services/job/job-rotation.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): main-session rotation (cycleIfDue + rotateNow) (M4.1)"
```

---

## Task 4.2: Replace `rotate-now` stub in CLI

**Files:**
- Modify: `src/cli/commands/job-commands.ts` (replace the `rotateNowImpl` stub with real impl backed by `JobRotation`)

- [ ] **Step 1: Update rotate-now handler**

Replace the inline `rotateNowImpl` stub in `src/cli/commands/job-commands.ts`:

```typescript
import { JobRotation } from '../../services/job/job-rotation.js';
// (other imports unchanged)

// inside `rotate-now` action:
job.command('rotate-now')
  .requiredOption('--job-id <jid>')
  .option('--project <repo>')
  .addJsonOption()
  .action(async (opts) => {
    const store = new JobStateStore(projectRoot(opts));
    const rotation = new JobRotation(store,
      async (jid) => { /* delegate to peaks session rotate — implementation wired in M6 via CLI spawn */ return { rotated: true }; },
      async (jid) => ({ jobId: jid, cycle: 0 }),
    );
    const r = await rotation.rotateNow(opts.jobId);
    printResult(prog, ok(r), opts);
  });
```

- [ ] **Step 2: Run all job CLI tests**

Run: `pnpm vitest run tests/unit/cli/commands/job-commands`
Expected: PASS — no regression.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/job-commands.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): rotate-now wired to JobRotation (M4.2)"
```

---

## Task 4.3: Patch `peaks-code` SKILL.md + runbook + add references/job-loop.md

**Files:**
- Modify: `~/.claude/skills/peaks-code/SKILL.md` (+ Step 0.8 / 0.81 / 0.85 / 0.86 / 0.87 + visibility prose + 9 red lines summary)
- Modify: `~/.claude/skills/peaks-code/references/runbook.md` (add Job path CLI sequence)
- Create: `~/.claude/skills/peaks-code/references/job-loop.md` (~200 LoC, deep-dive)

NOTE: project-local skills are in `skills/peaks-code/SKILL.md` (per repo root); confirm the actual path before editing.

- [ ] **Step 1: Locate the right SKILL.md**

Run:
```bash
find . -path ./node_modules -prune -o -name "SKILL.md" -print 2>/dev/null | head -10
```

Pick the file matching `peaks-code` (typically `skills/peaks-code/SKILL.md` for a dev install; `~/.claude/skills/peaks-code/SKILL.md` for end-user install). Edit whichever is canonical per the repo's `install-skills.mjs`.

- [ ] **Step 2: Insert the new steps (single block)**

Append after the existing Step 0.7 in the SKILL.md (preserve line width; do not reflow existing prose):

```markdown
### Peaks-Loop Step 0.8 — Job 启动

Trigger: the user request mentions N parallel targets (subdirectories, submodules, files), or words like "全部完成" / "until all done" / "all of them", or disavows cost/length ("不用 care 费用" / "don't worry about cost" / "一直跑").

Action:
1. Parse or auto-derive the slice list. Verbatim if user-named, else `peaks scan project-tree --slice-on <boundary>`.
2. Choose `--main-loop-strategy`: `len(slices) ≤ 2` → `single`; `≥3` → `rotating` (hard default).
3. Call `peaks job init --job-id <jid> --slice-list <...> --main-loop-strategy rotating --rotate-every 3`.
4. Enter Step 1 with the Job's first slice as the active rid.

Single-target requests: Step 0.8 is a no-op. Continue with the standard single-rid runbook.

### Peaks-Loop Step 0.81 — per-slice 收尾

After each slice's commit (Step 7 lands a commit):
1. `peaks job checkpoint --slice-id <rid> --state done --commit-sha $(git rev-parse HEAD)`
2. `peaks job status --job-id <jid>`
3. Loop control: `remaining > 0` → return to Step 1; `remaining == 0` → Step 8/9/10/11; `any blocked (strict)` → Step 0.85.

### Peaks-Loop Step 0.85 — slice 阻塞处理

Trigger: `peaks request repair-status --rid <rid>` returns `atCap: true`, OR `peaks solo context-now` is red-line sustained ≥5 min, OR `peaks job subagent-cleanup --force` fails twice.

Action: `peaks job block --slice-id <rid> --reason "<precise reason>"` then STOP. Output a TXT-style handoff describing the block + job state.

### Peaks-Loop Step 0.86 — main session rotation (rotating mode only)

Active when `--main-loop-strategy rotating`. Fires every `rotateEvery` slices (default 3) AND on demand via `peaks job rotate-now` if context pressure is rising faster than cadence.

Sequence:
1. `peaks session cycle-summary --job-id <jid> --summary "..." --json`
2. (bump state) `peaks job checkpoint --slice-id <rotate-marker> --state done --commit-sha <n/a>`  ← internal marker
3. `peaks session rotate --project <repo> --json`
4. Next user turn starts fresh main LLM session; Solo re-anchors via `peaks session resume --job-id <jid>`.

### Peaks-Loop Step 0.87 — sub-agent cleanup gate

After every `peaks sub-agent dispatch --batch-id <id>` inside a Job, BEFORE the next slice checkpoint:
1. `peaks job subagent-cleanup --job-id <jid> --batch-id <id> --force`
2. If cleanup exits non-zero → `peaks job block --reason "sub-agent cleanup failed: <batch-id>"`. Do NOT mark slice done until cleanup is clean.

### Peaks-Loop Job — Visibility prose

The Job loop is foreground. Three visibility layers, all on by default:
1. **LLM-runner transcript** — primary surface; user reads the chat to see active step.
2. **`peaks job status --watch`** — terminal poll, ANSI bar, refresh every 3 s.
3. **Statusline** — ambient `job: <jid> [done/total] currentSlice ETA m:s context main%. cycle`.

No detached workers, no `nohup`, no `disown`. Any attempt to spawn a background job → red line violation → block.

### Peaks-Loop Job — Red lines (9 hard rules)

The LLM-runner MUST NOT:
1. Enter Step 11 / write final handoff while job has remaining slices.
2. Re-ask the user about cost / length / context.
3. Coalesce multiple slices into one rid.
4. Modify a committed slice (`git commit --amend` on `done`).
5. Fake completion (CLI verifies commit-sha exists in git log).
6. Use detached / background / daemon-mode sub-agents inside a Job.
7. Skip `peaks job subagent-cleanup` between dispatch and slice checkpoint.
8. Skip or postpone a scheduled `peaks session rotate`.
9. Suppress visibility — no silencing statusline / `--watch`.

Violations trigger a `peaks job block` event with the specific red-line number.
```

- [ ] **Step 3: Add runbook snippet in runbook.md**

Append at the end of `~/.claude/skills/peaks-code/references/runbook.md`:

```bash
# Peaks-Loop Default runbook — Job path (excerpt; full flow in references/job-loop.md)

# After Step 7 (RD+QA commit) lands AND the user request was Job-shaped (Step 0.8 triggered):
peaks job checkpoint --slice-id <rid> --state done --commit-sha $(git rev-parse HEAD)
peaks job status --job-id <jid> --json
peaks job subagent-cleanup --job-id <jid> --batch-id <bid> --force   # Step 0.87 gate
# Loop control:
#   remaining > 0  → return to Step 1 (next slice)
#   remaining == 0 → Step 8/9/10/11 (original tail)
#   blocked (strict) → peaks job block + STOP
# Rotating-mode: every rotateEvery slices → Step 0.86 (peaks session rotate + resume)
```

- [ ] **Step 4: Create `references/job-loop.md`**

```markdown
# Peaks-Loop Solo — Job Loop Deep-Dive

> Read alongside `SKILL.md` Steps 0.8 / 0.81 / 0.85 / 0.86 / 0.87.

## State machine

```
       init ─────────► pending ─► in-progress ─┐
                          │                     │
                          ▼                     ▼
                       blocked (one slice)    done ──► (next slice)
                          │                     ▲
                          ▼                     │
                       (strict: STOP,           │
                        best-effort: skipped)   │
```

## Visibility

| Layer | Tool | Cost | User reads |
|---|---|---|---|
| LLM-runner transcript | (the chat) | free | always |
| `--watch` poll | peaks job status --watch | 1% CPU | when in a 2nd terminal pane |
| Statusline | peaks statusline install | ambient | in IDE bottom bar |

## Rotation cadence

- `len(slices) ≤ 2` → single-mode (auto-compact passively).
- `len(slices) ≥ 3` → rotating-mode, K=3 default.
- LLM-initiated override (rotating→single) is **strongly discouraged**; if used, must record `mainLoopOverride` in state.json with `reason ≥ 10 chars` and predicted wall-time ≤ 30 min.

## Cleanup gate

Every `peaks sub-agent dispatch` inside a Job scope MUST be matched by a `peaks job subagent-cleanup --force` BEFORE the next slice checkpoint. The wrapper (M5) refuses dispatch return-success without matching cleanup.

## Cross-day recovery

`peaks session resume --job-id <jid>` reads:
1. `job/<jid>/state.json` — current job state
2. `session/cycle-<n>.md` — main-session cycle summary (rotating mode)
3. `session/auto-decisions.md` — auto-compact history
4. `session/checkpoints/*.json` — generic session checkpoints

The resume endpoint cross-checks all four before offering continuation; if any layer is stale, the user gets an AskUserQuestion (resume / restart / skip).
```

- [ ] **Step 5: Run skill-default-runbook test (regression)**

Run: `pnpm vitest run tests/unit/skill-default-runbook.test.ts`
Expected: PASS — references/job-loop.md counts as a valid location.

- [ ] **Step 6: Commit**

```bash
git add skills/peaks-code/SKILL.md skills/peaks-code/references/runbook.md skills/peaks-code/references/job-loop.md
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): peaks-code SKILL.md Steps 0.8/0.81/0.85/0.86/0.87 + visibility prose + 9 red lines (M4.3)"
```

---

## M4 done

Outputs:
- `src/services/job/job-rotation.ts` (~50 LoC)
- SKILL.md gains 5 new steps + visibility prose + 9 red lines
- runbook.md gains Job-path snippet
- references/job-loop.md (new, deep-dive)

Verification: AC-3, AC-4, AC-7, AC-11. Onward to M5 (sub-agent wrapper + resource safety).
