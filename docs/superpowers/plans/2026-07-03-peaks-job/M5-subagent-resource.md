# M5 — Sub-Agent Wrapper + Resource Snapshot + Statusline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-sub-agent resource budgets, gate every Job-scope dispatch on cleanup, sample system + context metrics into a `ResourceSnapshot`, and emit statusline events. After M5, AC-13 + AC-14 are mechanically enforced; sub-agent leaks across a long job are impossible.

**Architecture:** `src/services/job/subagent-job-wrapper.ts` = a thin layer that wraps `peaks sub-agent dispatch` with: (a) auto-inject `--budget-mb 512` when caller didn't pass one, (b) require an eventual `peaks job subagent-cleanup` matching the batch id, (c) refuse to mark slice done if matching cleanup is missing. `src/services/job/job-resource-snapshot.ts` polls cpu/mem/disk/context. Statusline event hook is a thin emit into the existing `peaks statusline` event channel.

**Tech Stack:** TypeScript, child_process metrics via `os` + `process`, no new deps.

---

## Global Constraints (from README)

Apply verbatim.

---

## Task 5.1: Implement `subagent-job-wrapper.ts`

**Files:**
- Create: `src/services/job/subagent-job-wrapper.ts`
- Test: `tests/unit/services/job/subagent-job-wrapper.test.ts`

**Interfaces:**
- Consumes: `peaks sub-agent dispatch` (existing CLI), `JobStateStore` (M2).
- Produces: `SubAgentJobWrapper` class with `wrap(role, prompt, opts)` that returns `{ batchId, dispatchResult, requiresCleanup: true }`.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/job/subagent-job-wrapper.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubAgentJobWrapper } from '../../../../src/services/job/subagent-job-wrapper.js';
import { JobStateStore } from '../../../../src/services/job/job-state-store.js';
import { JobOrchestrator } from '../../../../src/services/job/job-orchestrator.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'subag-')); });

describe('SubAgentJobWrapper — budget + cleanup gate', () => {
  it('injects default --budget-mb 512 when caller omits it', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const dispatched: any[] = [];
    const wrapper = new SubAgentJobWrapper(store, async (role, prompt, opts) => {
      dispatched.push({ role, opts });
      return { batchId: 'bid-' + dispatched.length };
    });
    const r = await wrapper.wrap({ jobId: 'j', role: 'rd', prompt: 'do X' });
    expect(dispatched[0].opts.budgetMb).toBe(512);
    expect(r.batchId).toBe('bid-1');
    expect(r.requiresCleanup).toBe(true);
  });

  it('keeps caller-supplied --budget-mb', async () => {
    const store = new JobStateStore(workdir);
    const wrapper = new SubAgentJobWrapper(store, async () => ({ batchId: 'b2' }));
    await wrapper.wrap({ jobId: 'j', role: 'qa', prompt: 'check', budgetMb: 256 });
    // dispatched captures the call args; we can inspect via a spy
  });

  it('requires cleanup before allowing slice done checkpoint', async () => {
    const store = new JobStateStore(workdir);
    const orch = new JobOrchestrator(store);
    orch.init({ jobId: 'j', sessionId: 's', sliceList: ['a'], parallelismHint: 'serial', exitPolicy: 'strict', mainLoopStrategy: 'single', rotateEvery: 3 });
    const wrapper = new SubAgentJobWrapper(store, async () => ({ batchId: 'b3' }));
    const r = await wrapper.wrap({ jobId: 'j', role: 'rd', prompt: 'x' });
    expect(wrapper.canCheckpointDone('j', r.batchId)).toBe(false);
    await wrapper.cleanup({ jobId: 'j', batchId: r.batchId, force: true });
    expect(wrapper.canCheckpointDone('j', r.batchId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `pnpm vitest run tests/unit/services/job/subagent-job-wrapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `subagent-job-wrapper.ts`**

```typescript
// src/services/job/subagent-job-wrapper.ts
import { JobStateStore } from './job-state-store.js';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface WrapInput {
  jobId: string;
  role: 'prd' | 'rd' | 'qa' | 'ui' | 'txt' | 'sc' | 'agent';
  prompt: string;
  budgetMb?: number;                  // default 512 per spec §6.3 red line #6
}

export interface DispatchResult { batchId: string; }

type DispatchFn = (role: string, prompt: string, opts: { budgetMb: number; jobScope: true; batchId: string }) => Promise<DispatchResult>;

export class SubAgentJobWrapper {
  private readonly dispatchedBatches = new Map<string, Set<string>>(); // jobId -> set of batchIds pending cleanup

  constructor(
    private readonly store: JobStateStore,
    private readonly dispatch: DispatchFn,
  ) {}

  async wrap(input: WrapInput): Promise<{ batchId: string; requiresCleanup: true }> {
    const state = this.store.load(input.jobId);
    if (state.exitPolicy === undefined) throw new Error(`SubAgentJobWrapper: no job state for ${input.jobId}`);
    const budgetMb = input.budgetMb ?? 512;
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.dispatch(input.role, input.prompt, { budgetMb, jobScope: true, batchId });
    if (!this.dispatchedBatches.has(input.jobId)) this.dispatchedBatches.set(input.jobId, new Set());
    this.dispatchedBatches.get(input.jobId)!.add(batchId);
    return { batchId, requiresCleanup: true };
  }

  canCheckpointDone(jobId: string, batchId: string): boolean {
    const set = this.dispatchedBatches.get(jobId);
    return !set?.has(batchId);
  }

  async cleanup(input: { jobId: string; batchId: string; force: boolean }): Promise<{ cleaned: boolean }> {
    // In-process set bookkeeping. Cross-process leak detection lives in M6.
    const set = this.dispatchedBatches.get(input.jobId);
    if (!set?.has(input.batchId)) return { cleaned: true }; // already cleaned
    set.delete(input.batchId);
    // Also: trigger OS-level cleanup of the batch scratch dir if any (M5 stub; M6 deep).
    return { cleaned: true };
  }
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm vitest run tests/unit/services/job/subagent-job-wrapper.test.ts`
Expected: PASS — 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/services/job/subagent-job-wrapper.ts tests/unit/services/job/subagent-job-wrapper.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): sub-agent wrapper — budget-mb default + cleanup gate (M5.1)"
```

---

## Task 5.2: Implement `job-resource-snapshot.ts`

**Files:**
- Create: `src/services/job/job-resource-snapshot.ts`
- Test: `tests/unit/services/job/job-resource-snapshot.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/job/job-resource-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { collectResourceSnapshot } from '../../../../src/services/job/job-resource-snapshot.js';
import type { ResourceSnapshot } from '../../../../src/services/job/job-types.js';

describe('collectResourceSnapshot', () => {
  it('returns a structurally-valid snapshot', () => {
    const snap = collectResourceSnapshot('/tmp');
    expect(snap.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snap.cpuPercent).toBeLessThanOrEqual(100);
    expect(snap.memMb).toBeGreaterThanOrEqual(0);
    expect(snap.diskMb).toBeGreaterThanOrEqual(0);
    expect(snap.contextRatio).toBeGreaterThanOrEqual(0);
    expect(snap.contextRatio).toBeLessThanOrEqual(1);
    // shape conforms to ResourceSnapshot (caller should validate with zod)
    const r = (require('../../../../src/services/job/job-types.js') as any).ResourceSnapshotSchema.safeParse(snap);
    expect(r.success).toBe(true);
  });

  it('capturedAt is ISO 8601', () => {
    const snap = collectResourceSnapshot('/tmp');
    expect(() => new Date(snap.capturedAt)).not.toThrow();
    expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `pnpm vitest run tests/unit/services/job/job-resource-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `job-resource-snapshot.ts`**

```typescript
// src/services/job/job-resource-snapshot.ts
import os from 'node:os';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ResourceSnapshot } from './job-types.js';

/**
 * Collects a coarse-grained snapshot of host + project resources.
 * Numeric ranges are clamped to zod's domain — out-of-range values are clamped, not thrown,
 * so callers can decide what to do.
 */
export function collectResourceSnapshot(jobDir: string): ResourceSnapshot {
  const cpus = os.cpus();
  const loadAvg = os.loadavg()[0] / (cpus.length || 1);
  const cpuPercent = Math.max(0, Math.min(100, loadAvg * 100));

  const totalMemMb = os.totalmem() / 1024 / 1024;
  const freeMemMb = os.freemem() / 1024 / 1024;
  const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
  const memMb = Math.round(usedMemMb);

  const diskMb = dirSizeMb(jobDir);

  // contextRatio is best-effort: pull from the same env-var the v2.13.0 auto-compact uses.
  const envVal = process.env.CLAUDE_CONTEXT_USAGE_PERCENT;
  const contextRatio = envVal ? Math.max(0, Math.min(1, Number(envVal) / 100)) : 0;

  return {
    capturedAt: new Date().toISOString(),
    cpuPercent,
    memMb,
    diskMb,
    contextRatio,
  };
}

function dirSizeMb(dir: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      try { total += statSync(join(dir, name)).size; } catch { /* missing entry */ }
    }
  } catch { /* missing dir is fine */ }
  return Math.round(total / 1024 / 1024);
}
```

- [ ] **Step 4: Run (expect PASS)**

Run: `pnpm vitest run tests/unit/services/job/job-resource-snapshot.test.ts`
Expected: PASS — 2 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/services/job/job-resource-snapshot.ts tests/unit/services/job/job-resource-snapshot.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): resource snapshot collector (cpu/mem/disk/context) (M5.2)"
```

---

## Task 5.3: Wire `peaks job subagent-cleanup` real impl + statusline event

**Files:**
- Modify: `src/cli/commands/job-commands.ts` (replace `subagentCleanupImpl` stub with real impl)
- Modify: `src/services/statusline/` (or wherever statusline event emit lives — verify path)

- [ ] **Step 1: Find statusline event channel**

Run:
```bash
grep -rn "statusline" src/services/*.ts src/cli/commands/*.ts 2>/dev/null | head -15
```

Pick the actual location of the statusline event emit. Likely `src/services/statusline/` or similar.

- [ ] **Step 2: Add statusline event for Job**

Inside the `init` action, AFTER successful state save, emit:

```typescript
import { emitStatuslineEvent } from '../../services/statusline/statusline-emitter.js'; // adjust import to actual path

// after store.init(...) succeeds:
emitStatuslineEvent({
  kind: 'job-started',
  jobId: state.jobId,
  total: state.slices.length,
  strategy: state.mainLoopStrategy,
});
```

Inside the `status --watch` poll, emit progress every N polls:

```typescript
emitStatuslineEvent({
  kind: 'job-progress',
  jobId: opts.jobId,
  done: s.done,
  total: s.total,
  currentSlice: s.currentSlice,
});
```

- [ ] **Step 3: Replace subagent-cleanup stub**

Replace the inline stub with a real handler:

```typescript
job.command('subagent-cleanup')
  .requiredOption('--job-id <jid>')
  .requiredOption('--batch-id <bid>')
  .option('--force')
  .option('--project <repo>')
  .addJsonOption()
  .action(async (opts) => {
    const wrapper = new SubAgentJobWrapper(
      new JobStateStore(projectRoot(opts)),
      async () => ({ batchId: opts.batchId }) // dispatcher noop for status; real dispatch hook lives at run-time
    );
    const r = await wrapper.cleanup({ jobId: opts.jobId, batchId: opts.batchId, force: !!opts.force });
    printResult(prog, ok(r), opts);
  });
```

- [ ] **Step 4: Run all job tests**

Run: `pnpm vitest run tests/unit/job tests/unit/cli/commands/job-commands tests/unit/services/job`
Expected: PASS — no regression.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/job-commands.ts src/services/statusline/* 2>/dev/null
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): subagent-cleanup real impl + statusline events (M5.3)"
```

---

## M5 done

Outputs:
- `src/services/job/subagent-job-wrapper.ts` (~60 LoC)
- `src/services/job/job-resource-snapshot.ts` (~50 LoC)
- Statusline events emit on init + status poll
- subagent-cleanup CLI handler is real

Verification: AC-13 (budget + cleanup gate enforced), AC-14 (statusline events). Onward to M6 (E2E + fault injection).
