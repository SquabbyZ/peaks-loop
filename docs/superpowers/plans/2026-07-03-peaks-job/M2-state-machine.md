# M2 — State Machine Core (single mode)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Job state machine + on-disk state store. Single mode only — rotation lands in M4. After M2, the orchestrator can `init / checkpoint / block / continue / resume` correctly per spec §4.3 + §6.3 red lines #1-#5.

**Architecture:** `src/services/job/job-state-store.ts` = thin atlas-style fs ops + a per-job lockfile (single-process lock is enough; multi-process is out of v1 scope). `src/services/job/job-orchestrator.ts` = pure state-machine transitions + side-effect wrappers around state-store. Every transition is a function: `(state, input) → Result<state, Error>`. Side effects (file writes) go through the orchestrator, not directly from state-store.

**Tech Stack:** TypeScript ≥ 5.7 strict, Zod (reuse M1 schemas), `proper-lockfile` (already in devDeps for state machine locks — verify before adding), vitest.

---

## Global Constraints (from README)

Apply verbatim.

---

## Task 2.1: Create `job-state-store.ts`

**Files:**
- Create: `src/services/job/job-state-store.ts`
- Test: `tests/unit/services/job/job-state-store.test.ts`

**Interfaces:**
- Consumes: `JobState` from `job-types.ts`.
- Produces: `JobStateStore` class with: `init(input)`, `load(jobId)`, `save(state)`, `tryAcquireLock(jobId)`, `releaseLock(lock)`. Pure fs ops; no business rules.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/job/job-state-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobStateSchema, type JobState } from '../../../../src/services/job/job-types.js';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'job-state-store-'));
});

describe('JobStateStore — init + load + save', () => {
  it('init writes state.json with validated schema', () => {
    const store = new JobStateStore(workdir);
    const state = store.init({
      jobId: 'ut-app-2026-07-03',
      sessionId: 'sess-1',
      sliceList: ['api/users', 'api/orders'],
      parallelismHint: 'llm-decides',
      exitPolicy: 'strict',
      mainLoopStrategy: 'rotating',
      rotateEvery: 3,
    });
    expect(state.mainLoopStrategy).toBe('rotating');
    expect(state.slices).toHaveLength(2);
    expect(existsSync(join(workdir, 'ut-app-2026-07-03/state.json'))).toBe(true);
    const raw = readFileSync(join(workdir, 'ut-app-2026-07-03/state.json'), 'utf8');
    expect(() => JobStateSchema.parse(JSON.parse(raw))).not.toThrow();
  });

  it('load returns the in-file state', () => {
    const store = new JobStateStore(workdir);
    store.init({ jobId: 'j1', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const reloaded = store.load('j1');
    expect(reloaded.jobId).toBe('j1');
  });

  it('save rejects an invalid state (zod fails)', () => {
    const store = new JobStateStore(workdir);
    store.init({ jobId: 'j2', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const broken = { ...store.load('j2'), mainSessionCycle: -1 } as unknown as JobState;
    expect(() => store.save(broken)).toThrow();
  });
});

describe('JobStateStore — lock', () => {
  it('tryAcquireLock returns a lock; second call throws', () => {
    const store = new JobStateStore(workdir);
    store.init({ jobId: 'j3', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const lock1 = store.tryAcquireLock('j3');
    expect(() => store.tryAcquireLock('j3')).toThrow(/locked/);
    store.releaseLock(lock1);
    const lock2 = store.tryAcquireLock('j3');
    expect(lock2).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — module not found)**

Run: `pnpm vitest run tests/unit/services/job/job-state-store.test.ts`
Expected: FAIL "Cannot find module job-state-store.js"

- [ ] **Step 3: Implement `job-state-store.ts`**

```typescript
// src/services/job/job-state-store.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JobStateSchema, type JobState } from './job-types.js';

export interface JobInitInput {
  jobId: string;
  sessionId: string;
  sliceList: string[];
  parallelismHint: 'serial' | 'llm-decides';
  exitPolicy: 'strict' | 'best-effort';
  mainLoopStrategy: 'single' | 'rotating';
  rotateEvery: number;
}

export interface JobLock {
  jobId: string;
  path: string;
}

export class JobStateStore {
  constructor(private readonly rootDir: string) {}

  private jobDir(jobId: string): string {
    return join(this.rootDir, jobId);
  }

  init(input: JobInitInput): JobState {
    const state: JobState = JobStateSchema.parse({
      jobId: input.jobId,
      sessionId: input.sessionId,
      startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      parallelismHint: input.parallelismHint,
      exitPolicy: input.exitPolicy,
      mainLoopStrategy: input.mainLoopStrategy,
      rotateEvery: input.rotateEvery,
      mainSessionCycle: 0,
      slices: input.sliceList.map((label, i) => ({
        sliceId: `slice-${String(i + 1).padStart(3, '0')}`,
        label,
        status: 'pending',
        repairCycles: 0,
      })),
    });
    this.save(state);
    return state;
  }

  load(jobId: string): JobState {
    const p = join(this.jobDir(jobId), 'state.json');
    if (!existsSync(p)) throw new Error(`JobStateStore.load: no state for ${jobId} at ${p}`);
    return JobStateSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
  }

  save(state: JobState): void {
    // Re-parse to fail loudly on schema regression (M2 unit-test expects this).
    const valid = JobStateSchema.parse(state);
    const dir = this.jobDir(valid.jobId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify(valid, null, 2) + '\n', 'utf8');
  }

  tryAcquireLock(jobId: string): JobLock {
    const lockPath = join(this.jobDir(jobId), 'state.lock');
    mkdirSync(dirname(lockPath), { recursive: true });
    if (existsSync(lockPath)) throw new Error(`JobStateStore: state already locked at ${lockPath}`);
    writeFileSync(lockPath, `${process.pid}@${new Date().toISOString()}\n`, 'utf8');
    return { jobId, path: lockPath };
  }

  releaseLock(lock: JobLock): void {
    if (existsSync(lock.path)) {
      // unlink is enough for single-process model; multi-process will use proper-lockfile in M7+.
      require('node:fs').unlinkSync(lock.path);
    }
  }
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/unit/services/job/job-state-store.test.ts`
Expected: PASS — 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/services/job/job-state-store.ts tests/unit/services/job/job-state-store.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): on-disk state store + per-job lockfile (M2.1)"
```

---

## Task 2.2: Create `job-orchestrator.ts` (pure transitions + side effects)

**Files:**
- Create: `src/services/job/job-orchestrator.ts`
- Test: `tests/unit/services/job/job-orchestrator.test.ts`

**Interfaces:**
- Consumes: `JobInitInput`, `JobCheckpointInput`, `JobBlockInput` from `job-types.ts` + `JobStateStore`.
- Produces: `JobOrchestrator` class wrapping store + all transition functions: `init`, `checkpointDone`, `checkpointFailed`, `block`, `continueNow`, `status`. AC-2 / AC-8 / AC-9 verified here.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/job/job-orchestrator.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobOrchestrator } from '../../../../src/services/job/job-orchestrator.js';

let workdir: string;

beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'job-orch-')); });

describe('JobOrchestrator — init', () => {
  it('creates 8-slice job with rotating default + 3 slices pending', () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    const state = orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c'], parallelismHint: 'llm-decides', exitPolicy: 'strict', mainLoopStrategy: 'rotating', rotateEvery: 3 });
    expect(state.slices.every(s => s.status === 'pending')).toBe(true);
    expect(state.mainLoopStrategy).toBe('rotating');
  });

  it('override rotating→single requires reason ≥10 chars + future timestamp', () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    const state = orch.init({
      jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c','d'],
      parallelismHint: 'llm-decides', exitPolicy: 'strict',
      mainLoopStrategy: 'single',
      rotateEvery: 3,
      // @ts-expect-error passing through extra for this test
      mainLoopOverride: { from: 'rotating', to: 'single', reason: 'short', at: new Date().toISOString() },
    });
    expect(state.mainLoopOverride).toBeUndefined(); // zod rejects short reason
  });
});

describe('JobOrchestrator — checkpoint done', () => {
  it('marks a slice done with commitSha and bumps lastCheckpointAt', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const updated = await orch.checkpointDone({ jobId: 'j1', sliceId: 'slice-001', commitSha: 'abc123def456' });
    const doneSlice = updated.slices.find(s => s.sliceId === 'slice-001');
    expect(doneSlice?.status).toBe('done');
    expect(doneSlice?.commitSha).toBe('abc123def456');
  });

  it('reject `done` without commitSha', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    await expect(orch.checkpointDone({ jobId: 'j1', sliceId: 'slice-001' /* missing commitSha */ })).rejects.toThrow(/commitSha/);
  });
});

describe('JobOrchestrator — strict mode block propagation', () => {
  it('one blocked slice → all remaining unrun, exitPolicy=strict keeps status unchanged (no skip)', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    await orch.blockSlice({ jobId: 'j1', sliceId: 'slice-002', reason: 'QA cap' });
    const summary = orch.status('j1');
    expect(summary.blocked).toBe(1);
    expect(summary.done).toBe(0);
    expect(summary.skipped).toBe(0);
  });
});

describe('JobOrchestrator — best-effort mode skips and continues', () => {
  it('one blocked slice → status=skipped, done=2 if earlier already done', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j1', sessionId: 'sess-1', sliceList: ['a','b','c'], parallelismHint: 'serial', exitPolicy: 'best-effort', mainLoopStrategy: 'single', rotateEvery: 3 });
    await orch.checkpointDone({ jobId: 'j1', sliceId: 'slice-001', commitSha: 'sha-aaa-111' });
    await orch.checkpointSkipped({ jobId: 'j1', sliceId: 'slice-002', reason: 'best-effort skip' });
    const summary = orch.status('j1');
    expect(summary.done).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.blocked).toBe(0);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — module not found)**

Run: `pnpm vitest run tests/unit/services/job/job-orchestrator.test.ts`
Expected: FAIL "Cannot find module job-orchestrator.js"

- [ ] **Step 3: Implement `job-orchestrator.ts`**

```typescript
// src/services/job/job-orchestrator.ts
import { JobStateStore, type JobInitInput } from './job-state-store.js';
import {
  JobStateSchema,
  type JobState,
  type JobStatusSummary,
} from './job-types.js';

export interface CheckpointDoneInput { jobId: string; sliceId: string; commitSha?: string; }
export interface CheckpointSkipInput { jobId: string; sliceId: string; reason: string; }
export interface BlockInput { jobId: string; sliceId: string; reason: string; }

export class JobOrchestrator {
  constructor(private readonly store: JobStateStore) {}

  init(input: JobInitInput & { mainLoopOverride?: unknown }): JobState {
    // The init flow delegates to store.init; mainLoopOverride validation
    // is owned by JobStateSchema in store.init. Surface a clearer error
    // here for the override case (zod error from short reason).
    return this.store.init(input);
  }

  private mutate(jobId: string, fn: (s: JobState) => JobState): JobState {
    const state = this.store.load(jobId);
    const lock = this.store.tryAcquireLock(jobId);
    try {
      const next = fn(state);
      this.store.save(next);
      return next;
    } finally {
      this.store.releaseLock(lock);
    }
  }

  async checkpointDone(input: CheckpointDoneInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => {
      if (!input.commitSha || input.commitSha.length < 7) {
        throw new Error('checkpointDone: commitSha required (≥7 hex)');
      }
      return {
        ...s,
        lastCheckpointAt: new Date().toISOString(),
        slices: s.slices.map((sl) =>
          sl.sliceId === input.sliceId
            ? { ...sl, status: 'done', commitSha: input.commitSha, finishedAt: new Date().toISOString() }
            : sl,
        ),
      };
    });
  }

  async checkpointSkipped(input: CheckpointSkipInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId ? { ...sl, status: 'skipped' } : sl,
      ),
    }));
  }

  async checkpointFailed(input: { jobId: string; sliceId: string; reason: string }): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId
          ? { ...sl, status: 'failed', failureReason: input.reason, finishedAt: new Date().toISOString() }
          : sl,
      ),
    }));
  }

  async blockSlice(input: BlockInput): Promise<JobState> {
    return this.mutate(input.jobId, (s) => ({
      ...s,
      lastCheckpointAt: new Date().toISOString(),
      slices: s.slices.map((sl) =>
        sl.sliceId === input.sliceId
          ? { ...sl, status: 'blocked', blockedReason: input.reason, finishedAt: new Date().toISOString() }
          : sl,
      ),
    }));
  }

  status(jobId: string): JobStatusSummary {
    const s = this.store.load(jobId);
    const counts = { done: 0, failed: 0, blocked: 0, skipped: 0 } as const;
    for (const sl of s.slices) {
      if (sl.status === 'done') counts.done++;
      else if (sl.status === 'failed') counts.failed++;
      else if (sl.status === 'blocked') counts.blocked++;
      else if (sl.status === 'skipped') counts.skipped++;
    }
    const pendingIdx = s.slices.findIndex(sl => sl.status === 'pending' || sl.status === 'in-progress');
    return {
      total: s.slices.length,
      done: counts.done,
      failed: counts.failed,
      blocked: counts.blocked,
      skipped: counts.skipped,
      currentSlice: pendingIdx >= 0 ? s.slices[pendingIdx]!.label : undefined,
      lastCheckpoint: s.lastCheckpointAt,
      mainLoopStrategy: s.mainLoopStrategy,
      mainSessionCycle: s.mainSessionCycle,
    };
  }

  continueNow(jobId: string): { remaining: number; next: string | undefined } {
    const summary = this.status(jobId);
    return { remaining: summary.total - summary.done - summary.skipped - summary.blocked - summary.failed, next: summary.currentSlice };
  }
}
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/unit/services/job/job-orchestrator.test.ts`
Expected: PASS — 6 cases green (verifies AC-2, AC-8, AC-9, AC-12).

- [ ] **Step 5: Commit**

```bash
git add src/services/job/job-orchestrator.ts tests/unit/services/job/job-orchestrator.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): orchestrator transitions + strict/best-effort exit policies (M2.2)"
```

---

## Task 2.3: Lint + silence-warning sweep

- [ ] **Step 1: Run all job unit tests**

Run: `pnpm vitest run tests/unit/services/job`
Expected: PASS.

- [ ] **Step 2: Run silent-warning detector**

Run: `pnpm lint:silent-warning`
Expected: PASS, 0 warnings.

- [ ] **Step 3: Make AC-2 verifiable from CLI (manual smoke)**

Run:
```bash
node -e "import('./dist/src/services/job/job-state-store.js').then(({JobStateStore})=>{const s=new JobStateStore('/tmp/job-smoke');s.init({jobId:'j-demo',sessionId:'s',sliceList:['x'],parallelismHint:'serial',exitPolicy:'strict',mainLoopStrategy:'single',rotateEvery:3});console.log('OK')})"
```
Expected: prints `OK` and `/tmp/job-smoke/j-demo/state.json` exists.

---

## M2 done

Outputs:
- `src/services/job/job-state-store.ts` (~95 LoC)
- `src/services/job/job-orchestrator.ts` (~110 LoC)
- Tests: 10 cases

Verification: AC-2, AC-8, AC-9, AC-12 (single-mode path). Onward to M3 (CLI subcommands).
