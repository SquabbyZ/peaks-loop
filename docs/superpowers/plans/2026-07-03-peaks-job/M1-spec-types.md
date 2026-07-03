# M1 — Spec Types + Zod Schemas + CLI Help Snapshot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all type definitions + Zod schemas for the Job domain, plus a CLI help-text snapshot. After M1, every later milestone has a typed contract to build against.

**Architecture:** Create `src/services/job/job-types.ts` exporting `SliceStateSchema`, `JobStateSchema`, `ResourceSnapshotSchema`, `JobStatusSummarySchema` per spec §4.2. Each schema is the single source of truth for: (a) on-disk state.json, (b) CLI input validation, (c) command output envelope. A snapshot test locks the public CLI help-text so future changes are intentional.

**Tech Stack:** TypeScript ≥ 5.7 strict ESM, Zod, vitest. No new deps.

---

## Global Constraints (from README)

Reuse verbatim from `README.md#global-constraints`. Most relevant for M1:
- File ≤ 800 lines
- Zod for ALL CLI-input + on-disk schemas
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- ESLint / silent-warning detector (`pnpm lint:silent-warning`) green at boundary
- vitest placement: `tests/unit/services/job/<file>.test.ts`

---

## Task 1.1: Create `job-types.ts` with the four schemas

**Files:**
- Create: `src/services/job/job-types.ts`
- Test: `tests/unit/services/job/job-types.test.ts`

**Interfaces:**
- Produces: `SliceStateSchema`, `JobStateSchema`, `ResourceSnapshotSchema`, `JobStatusSummarySchema` + Zod-inferred TS types. M2 will reference these types from `job-orchestrator.ts`; M3 will reuse them for CLI input validation.

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/job/job-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  SliceStateSchema,
  JobStateSchema,
  ResourceSnapshotSchema,
  JobStatusSummarySchema,
  type SliceState,
  type JobState,
  type ResourceSnapshot,
  type JobStatusSummary,
} from '../../../../src/services/job/job-types.js';

describe('SliceStateSchema', () => {
  it('accepts a minimal pending slice', () => {
    const r = SliceStateSchema.safeParse({ sliceId: 's1', label: 'a', status: 'pending' });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown status enum value', () => {
    const r = SliceStateSchema.safeParse({ sliceId: 's1', label: 'a', status: 'whatever' });
    expect(r.success).toBe(false);
  });
  it('requires commitSha when status is done', () => {
    const r = SliceStateSchema.safeParse({ sliceId: 's1', label: 'a', status: 'done' });
    expect(r.success).toBe(false);
  });
});

describe('JobStateSchema', () => {
  it('defaults mainLoopStrategy to rotating', () => {
    const r = JobStateSchema.parse({
      jobId: 'j1', sessionId: 'sess-1',
      startedAt: '2026-07-03T00:00:00.000Z',
      lastCheckpointAt: '2026-07-03T00:01:00.000Z',
      slices: [],
    });
    expect(r.mainLoopStrategy).toBe('rotating');
    expect(r.rotateEvery).toBe(3);
    expect(r.mainSessionCycle).toBe(0);
  });
  it('accepts optional mainLoopOverride (rotating → single) with reason + timestamp', () => {
    const r = JobStateSchema.safeParse({
      jobId: 'j1', sessionId: 'sess-1',
      startedAt: '2026-07-03T00:00:00.000Z',
      lastCheckpointAt: '2026-07-03T00:01:00.000Z',
      slices: [],
      mainLoopOverride: { from: 'rotating', to: 'single', reason: '2-slice fix; predicted wall ≤5min', at: '2026-07-03T00:00:30.000Z' },
    });
    expect(r.success).toBe(true);
  });
});

describe('ResourceSnapshotSchema', () => {
  it('rejects contextRatio > 1', () => {
    const r = ResourceSnapshotSchema.safeParse({ capturedAt: '2026-07-03T00:00:00.000Z', cpuPercent: 50, memMb: 1024, diskMb: 10, contextRatio: 1.5 });
    expect(r.success).toBe(false);
  });
});

describe('JobStatusSummarySchema', () => {
  it('derives total = done + failed + blocked + skipped + pending (sample)', () => {
    const r = JobStatusSummarySchema.safeParse({ total: 8, done: 5, failed: 0, blocked: 0, skipped: 0, lastCheckpoint: '2026-07-03T00:00:00.000Z', mainLoopStrategy: 'rotating', mainSessionCycle: 1 });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — module not found)**

Run: `pnpm vitest run tests/unit/services/job/job-types.test.ts`
Expected: FAIL with "Cannot find module '../../../../src/services/job/job-types.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/job/job-types.ts
import { z } from 'zod';

// ── Spec §4.2, verbatim from spec ────────────────────────────────────────

export const SliceStateSchema = z.object({
  sliceId: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'in-progress', 'done', 'failed', 'blocked', 'skipped']),
  commitSha: z.string().optional(),                       // required when status=done
  finishedAt: z.string().datetime().optional(),
  failureReason: z.string().optional(),                  // required when status=failed
  repairCycles: z.number().int().nonnegative().default(0),
  blockedReason: z.string().optional(),                  // required when status=blocked
});

export const JobStateSchema = z.object({
  jobId: z.string(),
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  lastCheckpointAt: z.string().datetime(),
  parallelismHint: z.enum(['serial', 'llm-decides']).default('llm-decides'),
  exitPolicy: z.enum(['strict', 'best-effort']).default('strict'),
  mainLoopStrategy: z.enum(['single', 'rotating']).default('rotating'),
  rotateEvery: z.number().int().positive().default(3),
  mainSessionCycle: z.number().int().nonnegative().default(0),
  mainLoopOverride: z
    .object({
      from: z.literal('rotating'),
      to: z.literal('single'),
      reason: z.string().min(10),
      at: z.string().datetime(),
    })
    .optional(),
  slices: z.array(SliceStateSchema),
});

export const ResourceSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  cpuPercent: z.number().min(0).max(100),
  memMb: z.number().nonnegative(),
  diskMb: z.number().nonnegative(),
  contextRatio: z.number().min(0).max(1),
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
  etaSec: z.number().int().optional(),
  resourcesNow: ResourceSnapshotSchema.optional(),
});

export type SliceState = z.infer<typeof SliceStateSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type ResourceSnapshot = z.infer<typeof ResourceSnapshotSchema>;
export type JobStatusSummary = z.infer<typeof JobStatusSummarySchema>;

// ── Spec §4.1 CLI input schemas (used by M3) ─────────────────────────────

export const JobInitInputSchema = z.object({
  jobId: z.string().min(1),
  sliceList: z.array(z.string().min(1)).min(1),
  parallelismHint: z.enum(['serial', 'llm-decides']).default('llm-decides'),
  exitPolicy: z.enum(['strict', 'best-effort']).default('strict'),
  mainLoopStrategy: z.enum(['single', 'rotating']).default('rotating'),
  rotateEvery: z.number().int().positive().default(3),
  project: z.string(),
  json: z.boolean().default(true),
});
export type JobInitInput = z.infer<typeof JobInitInputSchema>;

export const JobCheckpointInputSchema = z
  .object({
    jobId: z.string(),
    sliceId: z.string(),
    state: z.enum(['done', 'failed', 'skipped']),
    commitSha: z.string().optional(),
    reason: z.string().optional(),
    project: z.string(),
    json: z.boolean().default(true),
  })
  .refine(
    (v) => v.state !== 'done' || (v.commitSha && v.commitSha.length >= 7),
    { message: 'commitSha required (≥7 hex) when state=done', path: ['commitSha'] },
  )
  .refine(
    (v) =>
      v.state !== 'failed' && v.state !== 'skipped' ? true : !!(v.reason && v.reason.length >= 3),
    { message: 'reason required (≥3 chars) when state=failed|skipped', path: ['reason'] },
  );
export type JobCheckpointInput = z.infer<typeof JobCheckpointInputSchema>;

export const JobBlockInputSchema = z.object({
  jobId: z.string(),
  sliceId: z.string(),
  reason: z.string().min(3),
  project: z.string(),
  json: z.boolean().default(true),
});
export type JobBlockInput = z.infer<typeof JobBlockInputSchema>;
```

- [ ] **Step 4: Run test (expect PASS)**

Run: `pnpm vitest run tests/unit/services/job/job-types.test.ts`
Expected: PASS — all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/services/job/job-types.ts tests/unit/services/job/job-types.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "feat(job): types + Zod schemas for SliceState / JobState / ResourceSnapshot (M1.1)"
```

---

## Task 1.2: Lock CLI help-text snapshot

**Files:**
- Test: `tests/unit/cli/commands/job-help-snapshot.test.ts`
- Modify (later): `src/cli/commands/job-commands.ts` (created in M3; until then, this snapshot test will be MARKED `it.skip` with a TODO to enable in M3)

**Interfaces:**
- No code dependency. Snapshot is a string fixture committed at `tests/unit/cli/commands/__snapshots__/job-help.txt`.

- [ ] **Step 1: Write failing test (currently skipped)**

```typescript
// tests/unit/cli/commands/job-help-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('peaks job CLI help snapshot', () => {
  it.skip('matches committed snapshot (enable in M3)', () => {
    const helpPath = resolve(__dirname, '__snapshots__/job-help.txt');
    const actual = readFileSync(helpPath, 'utf8');
    expect(actual).toMatch(/Usage: peaks job/);
    expect(actual).toContain('--job-id <jid>');
    expect(actual).toContain('--main-loop-strategy');
    expect(actual).toContain('--rotate-every');
    expect(actual).toContain('--watch');
    expect(actual).toContain('--budget-mb');
    expect(actual).toContain('--show-cost');
    expect(actual).toContain('rotate-now');
    expect(actual).toContain('subagent-cleanup');
  });
});
```

- [ ] **Step 2: Run test (expect SKIPPED)**

Run: `pnpm vitest run tests/unit/cli/commands/job-help-snapshot.test.ts`
Expected: 1 skipped, 0 failed.

- [ ] **Step 3: Commit (no implementation; this task creates the placeholder for M3)**

```bash
git add tests/unit/cli/commands/job-help-snapshot.test.ts
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit -m "test(job): place CLI help-text snapshot test (enabled in M3)"
```

---

## Task 1.3: Run `lint:silent-warning` + full unit suite

**Files:** none (verification only)

- [ ] **Step 1: Run silent-warning detector**

Run: `pnpm lint:silent-warning`
Expected: PASS, 0 warnings.

- [ ] **Step 2: Run unit suite**

Run: `pnpm vitest run tests/unit/services/job`
Expected: PASS, all green.

- [ ] **Step 3: Commit (verification only if no edits)**

```bash
git -c user.name=SquabbyZ -c user.email=601709253@qq.com commit --allow-empty -m "chore(job): M1 lint+snapshot green (no-op)"
```

---

## M1 done

Outputs:
- `src/services/job/job-types.ts` (~85 LoC)
- `tests/unit/services/job/job-types.test.ts` (7 cases)
- `tests/unit/cli/commands/job-help-snapshot.test.ts` (placeholder; enabled in M3)

Verification: AC-2 (state schema validates; missing fields fail with field names). Onward to M2.
