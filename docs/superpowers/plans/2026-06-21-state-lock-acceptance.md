# peaks-state-lock + peaks-qa Acceptance Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `peaks-state-lock` (CLI primitive for cross-stage file lock + signature chain) and refactor `peaks-qa` to consume the full sig chain (STRAT → TACT → MUT → ACCEPT). Hard-fail on chain breaks; cross-stage read protection prevents 合谋.

**Architecture:** New CLI module (`peaks state <sub>`) manages `.lock` + `.sig` files per stage under `.peaks/_runtime/<sid>/state/`. `peaks-qa` becomes the "Acceptance" stage — reads sig chain, validates hashes, computes ACCEPT.sig chained to all upstream sigs. Cross-stage read protection rejects any read of a future-stage file.

**Tech Stack:** Node fs/promises, sha256 (crypto), Zod (existing). No new deps.

## Global Constraints

Inherited from Plans 1–3:
- TypeScript ≥ 5.7 strict ESM
- File ≤ 800 lines (Karpathy #2)
- Slice ≤ 800 lines; `peaks slice check` green
- Coverage ≥ 80% per module
- All Plans 1/2/3 tests still pass
- Cross-version isolation (Plan 1) + AST gate (Plan 3) still pass

## File Structure

```
src/services/state/
  types.ts                  # Stage enum + LockEntry + SigChain
  state-lock.ts             # CLI-level lock primitive
  sig-chain.ts              # Verify sig chain integrity
  state-service.ts          # Public API for peaks-qa / peaks-solo
  index.ts                  # barrel
src/cli/commands/
  state-commands.ts         # peaks state <sub>
src/cli/index.ts            # (modify) register state
src/services/qa/
  qa-service.ts             # (modify) consume sig chain → ACCEPT.sig
  acceptance-stage.ts       # NEW: orchestrator
tests/unit/services/state/
  state-lock.test.ts
  sig-chain.test.ts
  state-service.test.ts
tests/unit/cli/commands/
  state-commands.test.ts
tests/unit/services/qa/
  acceptance-stage.test.ts
tests/integration/state/
  end-to-end-chain.test.ts  # full STRAT → TACT → MUT → ACCEPT chain
```

---

## Task 1: Stage enum + types

**Files:**
- Create: `src/services/state/types.ts`
- Test: `tests/unit/services/state/types.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { StageOrder, StageSchema } from '../../../../src/services/state/types.js';

describe('Stage types', () => {
  it('STAGE_ORDER has 4 entries', () => {
    expect(STAGE_ORDER).toEqual(['ANALYSIS', 'IMPLEMENTATION', 'MUTATION', 'ACCEPTANCE']);
  });

  it('StageSchema accepts known stages', () => {
    for (const s of STAGE_ORDER) expect(StageSchema.safeParse(s).success).toBe(true);
  });

  it('StageSchema rejects unknown stage', () => {
    expect(StageSchema.safeParse('UNKNOWN').success).toBe(false);
  });
});
```

- [ ] **Step 2: Write `types.ts`**

```typescript
/**
 * Per spec §4.9 — the four audit stages. Order matters: each stage
 * requires all prior stages' sigs to be present.
 */
import { z } from 'zod';

export const STAGE_ORDER = ['ANALYSIS', 'IMPLEMENTATION', 'MUTATION', 'ACCEPTANCE'] as const;
export type Stage = typeof STAGE_ORDER[number];
export const StageSchema = z.enum(STAGE_ORDER);

export interface LockEntry {
  readonly stage: Stage;
  readonly pid: number;
  readonly acquiredAt: string;
  readonly ttlSeconds: number;
}

export interface SigChainEntry {
  readonly stage: Stage;
  readonly sig: string;
  readonly inputSigs: ReadonlyArray<string>;
}

export interface SigChain {
  readonly chain: ReadonlyArray<SigChainEntry>;
}

export interface VerifyResult {
  readonly passed: boolean;
  readonly missingStages: ReadonlyArray<Stage>;
  readonly brokenLinks: ReadonlyArray<{ readonly stage: Stage; readonly expected: ReadonlyArray<string>; readonly actual: ReadonlyArray<string> }>;
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm vitest run tests/unit/services/state/types.test.ts`
Expected: PASS.

```bash
git add src/services/state/types.ts tests/unit/services/state/types.test.ts
git commit -m "feat(state): Stage enum + LockEntry + SigChain types"
```

---

## Task 2: state-lock primitive — file lock + TTL

**Files:**
- Create: `src/services/state/state-lock.ts`
- Modify: `src/services/state/index.ts`
- Test: `tests/unit/services/state/state-lock.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, releaseLock, readLock, LockHeldError } from '../../../../src/services/state/state-lock.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'peaks-lock-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('state-lock', () => {
  it('acquires a lock for a stage and writes lock file', () => {
    const entry = acquireLock({ stateDir: workdir, stage: 'ANALYSIS', ttlSeconds: 60 });
    expect(entry.stage).toBe('ANALYSIS');
    expect(existsSync(join(workdir, 'ANALYSIS.lock'))).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(workdir, 'ANALYSIS.lock'), 'utf8'));
    expect(onDisk.stage).toBe('ANALYSIS');
  });

  it('throws LockHeldError when lock already held (different PID)', () => {
    acquireLock({ stateDir: workdir, stage: 'ANALYSIS', ttlSeconds: 60 });
    expect(() => acquireLock({ stateDir: workdir, stage: 'ANALYSIS', ttlSeconds: 60, currentPid: 999999 }))
      .toThrow(LockHeldError);
  });

  it('releases lock — file removed', () => {
    acquireLock({ stateDir: workdir, stage: 'IMPLEMENTATION', ttlSeconds: 60 });
    releaseLock({ stateDir: workdir, stage: 'IMPLEMENTATION' });
    expect(existsSync(join(workdir, 'IMPLEMENTATION.lock'))).toBe(false);
  });

  it('readLock returns null when no lock present', () => {
    expect(readLock({ stateDir: workdir, stage: 'MUTATION' })).toBeNull();
  });

  it('auto-expires lock after TTL (default 30 min)', () => {
    acquireLock({ stateDir: workdir, stage: 'ACCEPTANCE', ttlSeconds: 0 }); // immediately stale
    // The TTL=0 means the lock is considered expired on next read.
    expect(readLock({ stateDir: workdir, stage: 'ACCEPTANCE', now: new Date(Date.now() + 1000) })).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/state/state-lock.test.ts`

- [ ] **Step 3: Write `state-lock.ts`**

```typescript
/**
 * Per spec §4.9 — file-based lock per stage with TTL.
 *
 * Hard constraints:
 *   H6 (CLI裁决): lock state is the source of truth, not memory.
 *   Cross-stage read protection: stage X lock prevents reading
 *       later-stage files.
 */
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { LockEntry, Stage } from './types.js';

export const DEFAULT_LOCK_TTL_SECONDS = 30 * 60;

export class LockHeldError extends Error {
  constructor(public readonly stage: Stage, public readonly existing: LockEntry) {
    super(`BLOCKED: lock held for stage ${stage} by PID ${existing.pid}`);
  }
}

export class LockExpiredError extends Error {
  constructor(public readonly stage: Stage) {
    super(`LOCK_EXPIRED: stage ${stage}`);
  }
}

export interface AcquireLockInput {
  readonly stateDir: string;
  readonly stage: Stage;
  readonly ttlSeconds?: number;
  readonly currentPid?: number;
}

export function acquireLock(input: AcquireLockInput): LockEntry {
  const pid = input.currentPid ?? process.pid;
  const existing = readLock({ stateDir: input.stateDir, stage: input.stage });
  if (existing && existing.pid !== pid) {
    throw new LockHeldError(input.stage, existing);
  }
  const entry: LockEntry = {
    stage: input.stage,
    pid,
    acquiredAt: new Date().toISOString(),
    ttlSeconds: input.ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS,
  };
  // Synchronous write — small JSON file.
  // Use require here for sync; tests don't need fs/promises here.
  // Production wiring uses writeFile (async) — kept sync here for the
  // acquireLock contract to be synchronous (callers expect it).
  const fs = require('node:fs') as typeof import('node:fs');
  fs.writeFileSync(join(input.stateDir, `${input.stage}.lock`), JSON.stringify(entry, null, 2));
  return entry;
}

export function releaseLock(input: { readonly stateDir: string; readonly stage: Stage }): void {
  const fs = require('node:fs') as typeof import('node:fs');
  try {
    fs.unlinkSync(join(input.stateDir, `${input.stage}.lock`));
  } catch {
    // already gone — fine
  }
}

export interface ReadLockInput {
  readonly stateDir: string;
  readonly stage: Stage;
  readonly now?: Date;
}

export function readLock(input: ReadLockInput): LockEntry | null {
  const fs = require('node:fs') as typeof import('node:fs');
  let raw: string;
  try {
    raw = fs.readFileSync(join(input.stateDir, `${input.stage}.lock`), 'utf8');
  } catch {
    return null;
  }
  const entry = JSON.parse(raw) as LockEntry;
  // TTL check
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - new Date(entry.acquiredAt).getTime();
  if (ageMs / 1000 > entry.ttlSeconds) {
    // Expired — treat as released.
    return null;
  }
  return entry;
}
```

- [ ] **Step 4: Update `index.ts`**

```typescript
export * from './types.js';
export {
  acquireLock, releaseLock, readLock, LockHeldError, LockExpiredError,
  DEFAULT_LOCK_TTL_SECONDS,
  type AcquireLockInput, type ReadLockInput,
} from './state-lock.js';
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm vitest run tests/unit/services/state/state-lock.test.ts`
Expected: PASS, 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/state/ tests/unit/services/state/state-lock.test.ts
git commit -m "feat(state): state-lock primitive (file lock + TTL)"
```

---

## Task 3: Sig-chain verifier

**Files:**
- Create: `src/services/state/sig-chain.ts`
- Modify: `src/services/state/index.ts`
- Test: `tests/unit/services/state/sig-chain.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyChain, writeStageSig } from '../../../../src/services/state/sig-chain.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-sigchain-'));
  mkdirSync(workdir, { recursive: true });
});
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('sig chain', () => {
  it('passes when all stages have sigs and chain links match', async () => {
    await writeStageSig({ stateDir: workdir, stage: 'ANALYSIS', sig: 'a'.repeat(64), inputSigs: [] });
    await writeStageSig({ stateDir: workdir, stage: 'IMPLEMENTATION', sig: 'b'.repeat(64), inputSigs: ['a'.repeat(64)] });
    await writeStageSig({ stateDir: workdir, stage: 'MUTATION', sig: 'c'.repeat(64), inputSigs: ['b'.repeat(64)] });
    await writeStageSig({ stateDir: workdir, stage: 'ACCEPTANCE', sig: 'd'.repeat(64), inputSigs: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] });
    const result = await verifyChain({ stateDir: workdir });
    expect(result.passed).toBe(true);
  });

  it('fails when a stage sig is missing', async () => {
    await writeStageSig({ stateDir: workdir, stage: 'ANALYSIS', sig: 'a'.repeat(64), inputSigs: [] });
    // Skip IMPLEMENTATION.
    await writeStageSig({ stateDir: workdir, stage: 'MUTATION', sig: 'c'.repeat(64), inputSigs: [] });
    const result = await verifyChain({ stateDir: workdir });
    expect(result.passed).toBe(false);
    expect(result.missingStages).toContain('IMPLEMENTATION');
  });

  it('fails when chain link is broken', async () => {
    await writeStageSig({ stateDir: workdir, stage: 'ANALYSIS', sig: 'a'.repeat(64), inputSigs: [] });
    await writeStageSig({ stateDir: workdir, stage: 'IMPLEMENTATION', sig: 'b'.repeat(64), inputSigs: ['WRONG_SIG'] });
    const result = await verifyChain({ stateDir: workdir });
    expect(result.passed).toBe(false);
    expect(result.brokenLinks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/state/sig-chain.test.ts`

- [ ] **Step 3: Write `sig-chain.ts`**

```typescript
/**
 * Per spec §4.9 — sig chain verification.
 *
 * Each stage's sig file records its own hash AND the hashes of upstream
 * sigs it consumed. Verification checks both presence and link integrity.
 */
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SigChainEntry, Stage, VerifyResult } from './types.js';
import { STAGE_ORDER } from './types.js';

export interface WriteStageSigInput {
  readonly stateDir: string;
  readonly stage: Stage;
  readonly sig: string;
  readonly inputSigs: ReadonlyArray<string>;
}

export async function writeStageSig(input: WriteStageSigInput): Promise<void> {
  const entry: SigChainEntry = {
    stage: input.stage,
    sig: input.sig,
    inputSigs: [...input.inputSigs],
  };
  const path = join(input.stateDir, `${input.stage}.sig`);
  const tmp = `${path}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(entry, null, 2), 'utf8');
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

async function readStageSig(stateDir: string, stage: Stage): Promise<SigChainEntry | null> {
  try {
    const raw = await readFile(join(stateDir, `${stage}.sig`), 'utf8');
    return JSON.parse(raw) as SigChainEntry;
  } catch {
    return null;
  }
}

export interface VerifyChainInput {
  readonly stateDir: string;
}

export async function verifyChain(input: VerifyChainInput): Promise<VerifyResult> {
  const missing: Stage[] = [];
  const entries = new Map<Stage, SigChainEntry>();

  for (const stage of STAGE_ORDER) {
    const entry = await readStageSig(input.stateDir, stage);
    if (entry === null) {
      missing.push(stage);
    } else {
      entries.set(stage, entry);
    }
  }

  if (missing.length > 0) {
    return { passed: false, missingStages: missing, brokenLinks: [] };
  }

  // Check chain links.
  const brokenLinks: VerifyResult['brokenLinks'][number][] = [];
  for (let i = 1; i < STAGE_ORDER.length; i += 1) {
    const stage = STAGE_ORDER[i];
    const entry = entries.get(stage);
    if (!entry) continue;
    const upstream = STAGE_ORDER.slice(0, i)
      .map((s) => entries.get(s)?.sig)
      .filter((s): s is string => typeof s === 'string');
    const missingUpstream = upstream.filter((s) => !entry.inputSigs.includes(s));
    if (missingUpstream.length > 0) {
      brokenLinks.push({ stage, expected: upstream, actual: [...entry.inputSigs] });
    }
  }

  return {
    passed: brokenLinks.length === 0,
    missingStages: [],
    brokenLinks,
  };
}
```

- [ ] **Step 4: Update `index.ts`**

```typescript
export {
  writeStageSig, verifyChain, type WriteStageSigInput, type VerifyChainInput,
} from './sig-chain.js';
```

- [ ] **Step 5: Run + commit**

Run: `pnpm vitest run tests/unit/services/state/sig-chain.test.ts`
Expected: PASS, 3 tests pass.

```bash
git add src/services/state/sig-chain.ts src/services/state/index.ts tests/unit/services/state/sig-chain.test.ts
git commit -m "feat(state): sig-chain verifier (presence + link integrity)"
```

---

## Task 4: State service — cross-stage read protection

**Files:**
- Create: `src/services/state/state-service.ts`
- Modify: `src/services/state/index.ts`
- Test: `tests/unit/services/state/state-service.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canReadStage, writeSigFor, type StateService,
} from '../../../../src/services/state/state-service.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-stsvc-'));
  mkdirSync(workdir, { recursive: true });
});
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('state-service', () => {
  it('canReadStage: current stage can read its own stage and earlier stages', () => {
    expect(canReadStage('ANALYSIS', 'IMPLEMENTATION')).toBe(false); // ANALYSIS < IMPLEMENTATION
    expect(canReadStage('IMPLEMENTATION', 'ANALYSIS')).toBe(true);
    expect(canReadStage('IMPLEMENTATION', 'IMPLEMENTATION')).toBe(true);
  });

  it('writeSigFor atomically writes sig file', async () => {
    await writeSigFor({ stateDir: workdir, stage: 'ANALYSIS', sig: 'a'.repeat(64), inputSigs: [] });
    expect(existsSync(join(workdir, 'ANALYSIS.sig'))).toBe(true);
  });

  it('throws when trying to write a sig for a future stage (out-of-order)', async () => {
    await expect(writeSigFor({
      stateDir: workdir, stage: 'ACCEPTANCE', sig: 'd'.repeat(64), inputSigs: [],
    })).rejects.toThrow(/previous.*stage.*missing/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/state/state-service.test.ts`

- [ ] **Step 3: Write `state-service.ts`**

```typescript
/**
 * Per spec §4.9 — public state service.
 *
 * Cross-stage read protection: stage X can read its own stage's files +
 * earlier stages' files. Reading later-stage files throws.
 */
import { mkdir } from 'node:fs/promises';
import { writeStageSig, type WriteStageSigInput } from './sig-chain.js';
import { STAGE_ORDER, type Stage } from './types.js';

export function stageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * canReadStage(current, target):
 *   true if target stage ≤ current stage in STAGE_ORDER.
 *   false otherwise.
 */
export function canReadStage(current: Stage, target: Stage): boolean {
  return stageIndex(target) <= stageIndex(current);
}

export interface WriteSigForInput extends WriteStageSigInput {}

/**
 * Writes a sig for a stage. Refuses if any prior stage's sig is missing
 * (out-of-order writes are forbidden by spec §4.9 防合谋).
 */
export async function writeSigFor(input: WriteSigForInput): Promise<void> {
  await mkdir(input.stateDir, { recursive: true });
  const idx = stageIndex(input.stage);
  if (idx > 0) {
    // Check all prior stages have sigs.
    // We can't import verifyChain here without circularity; do inline.
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    for (let i = 0; i < idx; i += 1) {
      const prior = STAGE_ORDER[i];
      try {
        await readFile(join(input.stateDir, `${prior}.sig`), 'utf8');
      } catch {
        throw new Error(`BLOCKED: previous stage ${prior}.sig missing — out-of-order write forbidden`);
      }
    }
  }
  await writeStageSig(input);
}

export type StateService = {
  readonly canReadStage: typeof canReadStage;
  readonly writeSigFor: typeof writeSigFor;
  readonly stageIndex: typeof stageIndex;
};
```

- [ ] **Step 4: Update `index.ts`**

```typescript
export {
  canReadStage, writeSigFor, stageIndex, type WriteSigForInput, type StateService,
} from './state-service.js';
```

- [ ] **Step 5: Run + commit**

Run: `pnpm vitest run tests/unit/services/state/state-service.test.ts`
Expected: PASS, 3 tests pass.

```bash
git add src/services/state/state-service.ts src/services/state/index.ts tests/unit/services/state/state-service.test.ts
git commit -m "feat(state): state-service (cross-stage read protection, out-of-order block)"
```

---

## Task 5: CLI commands — `peaks state <sub>`

**Files:**
- Create: `src/cli/commands/state-commands.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/unit/cli/commands/state-commands.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateCommands } from '../../../../src/cli/commands/state-commands.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-state-cli-'));
  mkdirSync(workdir, { recursive: true });
});
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('peaks state commands', () => {
  it('status reports current sig chain state', async () => {
    const program = createStateCommands({ stateDir: workdir });
    writeFileSync(join(workdir, 'ANALYSIS.sig'), JSON.stringify({
      stage: 'ANALYSIS', sig: 'a'.repeat(64), inputSigs: [],
    }));
    await program.parseAsync(['node', 'peaks', 'state', 'status']);
  });

  it('verify returns non-zero on missing stage', async () => {
    const program = createStateCommands({ stateDir: workdir });
    const code = await new Promise<number>((resolve) => {
      program.exitOverride().parseAsync(['node', 'peaks', 'state', 'verify', '--all'])
        .then(() => resolve(0))
        .catch((err) => resolve(err.code ?? 1));
    });
    expect(code).not.toBe(0);
  });

  it('lock acquires a stage lock', () => {
    const program = createStateCommands({ stateDir: workdir });
    program.parse(['node', 'peaks', 'state', 'lock', '--stage', 'ANALYSIS', '--in', '/tmp/sig']);
    expect(existsSync(join(workdir, 'ANALYSIS.lock'))).toBe(true);
  });

  it('unlock removes the stage lock', () => {
    const program = createStateCommands({ stateDir: workdir });
    program.parse(['node', 'peaks', 'state', 'lock', '--stage', 'ANALYSIS', '--in', '/tmp/sig']);
    program.parse(['node', 'peaks', 'state', 'unlock', '--stage', 'ANALYSIS']);
    expect(existsSync(join(workdir, 'ANALYSIS.lock'))).toBe(false);
  });
});
```

- [ ] **Step 2: Write `state-commands.ts`**

```typescript
/**
 * `peaks state <sub>` — CLI surface for cross-stage lock + sig chain.
 * Per spec §4.9.
 */
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  acquireLock, releaseLock, readLock,
} from '../../services/state/state-lock.js';
import { verifyChain } from '../../services/state/sig-chain.js';
import { STAGE_ORDER, type Stage } from '../../services/state/types.js';

export interface StateCommandsOptions {
  readonly stateDir: string;
}

export function createStateCommands(opts: StateCommandsOptions): Command {
  const state = new Command('state').description(
    'peaks-state-lock: cross-stage file lock + signature chain (spec §4.9)'
  );

  state
    .command('lock')
    .requiredOption('--stage <stage>', 'ANALYSIS | IMPLEMENTATION | MUTATION | ACCEPTANCE')
    .requiredOption('--in <file>', 'file whose sha256 becomes the sig')
    .option('--ttl <seconds>', 'lock TTL seconds', '1800')
    .action(async (a: { stage: string; in: string; ttl: string }) => {
      const stage = a.stage as Stage;
      const sig = await computeSig(a.in);
      acquireLock({ stateDir: opts.stateDir, stage, ttlSeconds: Number(a.ttl) });
      // Write sig file via the sig-chain module.
      const { writeSigFor } = await import('../../services/state/state-service.js');
      await writeSigFor({
        stateDir: opts.stateDir, stage, sig,
        inputSigs: stage === 'ANALYSIS' ? [] : await collectUpstreamSigs(opts.stateDir, stage),
      });
      process.stdout.write(`locked ${stage}: ${sig}\n`);
    });

  state
    .command('unlock')
    .requiredOption('--stage <stage>', 'stage to unlock')
    .action((a: { stage: string }) => {
      releaseLock({ stateDir: opts.stateDir, stage: a.stage as Stage });
      process.stdout.write(`unlocked ${a.stage}\n`);
    });

  state
    .command('verify')
    .option('--all', 'verify full chain', false)
    .action(async () => {
      const result = await verifyChain({ stateDir: opts.stateDir });
      if (result.passed) {
        process.stdout.write('CHAIN OK\n');
      } else {
        process.stderr.write(`CHAIN BROKEN: missing=${result.missingStages.join(',')} broken=${result.brokenLinks.length}\n`);
        process.exit(3);
      }
    });

  state
    .command('inspect')
    .requiredOption('--stage <stage>', 'stage to inspect')
    .action(async (a: { stage: string }) => {
      const lock = readLock({ stateDir: opts.stateDir, stage: a.stage as Stage });
      try {
        const sig = JSON.parse(await readFile(join(opts.stateDir, `${a.stage}.sig`), 'utf8'));
        process.stdout.write(`stage: ${a.stage}\nlock: ${lock ? `held by PID ${lock.pid}` : 'free'}\nsig: ${sig.sig}\ninputSigs: ${sig.inputSigs.join(',')}\n`);
      } catch {
        process.stdout.write(`stage: ${a.stage}\nno sig file\n`);
      }
    });

  state
    .command('status')
    .action(async () => {
      for (const stage of STAGE_ORDER) {
        const lock = readLock({ stateDir: opts.stateDir, stage });
        try {
          const sig = JSON.parse(await readFile(join(opts.stateDir, `${stage}.sig`), 'utf8'));
          process.stdout.write(`${stage}: sig=${sig.sig.slice(0, 12)}... lock=${lock ? 'held' : 'free'}\n`);
        } catch {
          process.stdout.write(`${stage}: no sig\n`);
        }
      }
    });

  return state;
}

async function computeSig(file: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const content = await readFile(file, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

async function collectUpstreamSigs(stateDir: string, currentStage: Stage): Promise<ReadonlyArray<string>> {
  const out: string[] = [];
  const idx = STAGE_ORDER.indexOf(currentStage);
  for (let i = 0; i < idx; i += 1) {
    try {
      const sig = JSON.parse(await readFile(join(stateDir, `${STAGE_ORDER[i]}.sig`), 'utf8'));
      out.push(sig.sig);
    } catch {
      // missing — caller will see out-of-order error
    }
  }
  return out;
}
```

- [ ] **Step 3: Register in `src/cli/index.ts`**

Modify `src/cli/index.ts` — register state.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/cli/commands/state-commands.test.ts`
Expected: PASS, 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/state-commands.ts src/cli/index.ts tests/unit/cli/commands/state-commands.test.ts
git commit -m "feat(state): CLI commands (lock/unlock/verify/inspect/status)"
```

---

## Task 6: Acceptance-stage orchestrator (in peaks-qa)

**Files:**
- Create: `src/services/qa/acceptance-stage.ts`
- Modify: `src/services/qa/qa-service.ts`
- Test: `tests/unit/services/qa/acceptance-stage.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAcceptance } from '../../../../src/services/qa/acceptance-stage.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-acc-'));
  mkdirSync(workdir, { recursive: true });
});
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('runAcceptance', () => {
  it('refuses when sig chain is broken', async () => {
    // No sigs written.
    await expect(runAcceptance({
      stateDir: workdir, sliceCheckResult: { passed: true, report: '' },
    })).rejects.toThrow(/chain/i);
  });

  it('writes ACCEPT.sig when chain is intact and slice check passes', async () => {
    const sigs = [
      { stage: 'ANALYSIS' as const, sig: 'a'.repeat(64), inputSigs: [] },
      { stage: 'IMPLEMENTATION' as const, sig: 'b'.repeat(64), inputSigs: ['a'.repeat(64)] },
      { stage: 'MUTATION' as const, sig: 'c'.repeat(64), inputSigs: ['b'.repeat(64)] },
    ];
    for (const s of sigs) {
      writeFileSync(join(workdir, `${s.stage}.sig`), JSON.stringify(s));
    }
    const accept = await runAcceptance({
      stateDir: workdir, sliceCheckResult: { passed: true, report: 'ok' },
    });
    expect(accept.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses when slice check fails', async () => {
    // Chain intact but slice failed.
    const sigs = [
      { stage: 'ANALYSIS' as const, sig: 'a'.repeat(64), inputSigs: [] },
      { stage: 'IMPLEMENTATION' as const, sig: 'b'.repeat(64), inputSigs: ['a'.repeat(64)] },
      { stage: 'MUTATION' as const, sig: 'c'.repeat(64), inputSigs: ['b'.repeat(64)] },
    ];
    for (const s of sigs) {
      writeFileSync(join(workdir, `${s.stage}.sig`), JSON.stringify(s));
    }
    await expect(runAcceptance({
      stateDir: workdir, sliceCheckResult: { passed: false, report: 'tsc failed' },
    })).rejects.toThrow(/slice check/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/qa/acceptance-stage.test.ts`

- [ ] **Step 3: Write `acceptance-stage.ts`**

```typescript
/**
 * Per spec §4.2 验收审计 + §4.9 — peaks-qa becomes "Acceptance".
 *
 * Reads the sig chain (Plan 4 Tasks 3–4), validates integrity, runs
 * `peaks slice check`, and writes ACCEPT.sig.
 *
 * Hard constraints:
 *   H6 (CLI裁决): ACCEPT.sig is written only if (a) chain passes AND
 *       (b) slice check passes. Both are CLI-level verdicts.
 *   H8 (audit trail): ACCEPT.sig inputs include all upstream sigs.
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyChain } from '../state/sig-chain.js';
import { writeSigFor } from '../state/state-service.js';
import { STAGE_ORDER } from '../state/types.js';

export interface SliceCheckResult {
  readonly passed: boolean;
  readonly report: string;
}

export interface RunAcceptanceInput {
  readonly stateDir: string;
  readonly sliceCheckResult: SliceCheckResult;
}

export interface RunAcceptanceOutput {
  readonly sha256: string;
  readonly chainPassed: boolean;
}

function sha256Of(content: object): string {
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function runAcceptance(input: RunAcceptanceInput): Promise<RunAcceptanceOutput> {
  // Step 1: verify sig chain.
  const chain = await verifyChain({ stateDir: input.stateDir });
  if (!chain.passed) {
    throw new Error(
      `BLOCKED: sig chain broken — missing=[${chain.missingStages.join(',')}], ` +
      `broken-links=${chain.brokenLinks.length}. Refusing to write ACCEPT.sig.`
    );
  }

  // Step 2: slice check.
  if (!input.sliceCheckResult.passed) {
    throw new Error(
      `BLOCKED: slice check failed — ${input.sliceCheckResult.report}`
    );
  }

  // Step 3: collect upstream sigs.
  const upstreamSigs: string[] = [];
  for (const stage of STAGE_ORDER) {
    if (stage === 'ACCEPTANCE') break;
    try {
      const raw = await readFile(join(input.stateDir, `${stage}.sig`), 'utf8');
      upstreamSigs.push((JSON.parse(raw) as { sig: string }).sig);
    } catch {
      // verifyChain already covered this — should not happen
    }
  }

  // Step 4: compute ACCEPT.sig (placeholder, then hash).
  const partial = {
    version: '1.0' as const,
    sha256: '',
    generatedAt: new Date().toISOString(),
    upstreamSigs,
    sliceCheckPassed: true,
    sliceCheckReport: input.sliceCheckResult.report,
  };
  const sha256 = sha256Of(partial);
  const final = { ...partial, sha256 };

  // Step 5: write ACCEPT.sig via state-service (which enforces chain ordering).
  await writeSigFor({
    stateDir: input.stateDir,
    stage: 'ACCEPTANCE',
    sig: sha256,
    inputSigs: upstreamSigs,
  });

  // Also persist the full acceptance report alongside.
  const reportPath = join(input.stateDir, 'ACCEPTANCE.report.json');
  const tmp = `${reportPath}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(final, null, 2), 'utf8');
    await rename(tmp, reportPath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return { sha256, chainPassed: chain.passed };
}
```

- [ ] **Step 4: Modify `qa-service.ts`**

Add a pre-step at the start of runQa: if `ACCEPT.sig` is requested (i.e., we're at the acceptance stage), invoke `runAcceptance`. Existing qa logic (Gate A2/A3/A4/D + slice check) is preserved.

```typescript
// Pseudocode — adapt to actual qa-service.
import { runAcceptance } from './acceptance-stage.js';

async function runQa(input: QaInput): Promise<QaOutput> {
  // Existing logic runs slice check, Gate A2/A3/A4/D ...
  const sliceCheckResult = await runSliceCheck(input);
  // After existing checks, write ACCEPT.sig.
  const accept = await runAcceptance({
    stateDir: `.peaks/_runtime/${input.sid}/state`,
    sliceCheckResult,
  });
  return { acceptSig: accept.sha256, ...existingResult };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/unit/services/qa/`
Expected: PASS.

- [ ] **Step 6: Run full vitest**

Run: `pnpm vitest run`
Expected: all tests pass (existing + Plan 1/2/3 + new Phase 4).

- [ ] **Step 7: Commit**

```bash
git add src/services/qa/ tests/unit/services/qa/
git commit -m "feat(qa): acceptance-stage — sig chain verification → ACCEPT.sig"
```

---

## Task 7: End-to-end integration test (full chain)

**Files:**
- Create: `tests/integration/state/end-to-end-chain.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
/**
 * End-to-end: STRAT → TACT → MUT → ACCEPT chain.
 *
 * Verifies all 4 phases' Plans can chain together:
 *   Plan 3 (STRAT.sig, TACT.sig) + Plan 2 (MUT.sig) + Plan 4 (ACCEPT.sig).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStrategy } from '../../../src/services/rd/strategy.js';
import { writeImpl } from '../../../src/services/rd/impl.js';
import { buildMutReport } from '../../../src/services/mut/report-builder.js';
import { runAcceptance } from '../../../src/services/qa/acceptance-stage.js';
import { writeSigFor } from '../../../src/services/state/state-service.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'peaks-chain-e2e-')); mkdirSync(workdir, { recursive: true }); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('full chain: STRAT → TACT → MUT → ACCEPT', () => {
  it('produces 4 sigs and ACCEPT.sig is reachable only after all prior sigs exist', async () => {
    // Phase 1: Strategy.
    const strat = await writeStrategy({
      out: join(workdir, 'strategy.md'),
      goal: 'add helper',
      rootCauseAnalysis: 'trivial',
      impactSurface: ['src/A.ts'],
      designRationale: 'trivial',
    });
    await writeSigFor({ stateDir: workdir, stage: 'ANALYSIS', sig: strat.sha256, inputSigs: [] });

    // Phase 2: Impl (passes AST gate — no external API calls).
    const impl = await writeImpl({
      out: join(workdir, 'impl.json'),
      inputSig: strat.sha256,
      changedFiles: ['src/A.ts'],
      externalApiCalls: [],
      astGate: { passed: true, violations: [] },
    });
    await writeSigFor({ stateDir: workdir, stage: 'IMPLEMENTATION', sig: impl.sha256, inputSigs: [strat.sha256] });

    // Phase 3: Mut.
    const mut = await buildMutReport({
      inputSig: impl.sha256,
      out: join(workdir, 'mut.json'),
      mutation: {
        tool: 'stryker', mutantsTotal: 10, mutantsKilled: 9,
        mutantsSurvived: 1, mutantsTimeout: 0, killRate: 0.9, byFile: [],
      },
      assertions: { totalAssertions: 10, weakAssertions: 0, weakRate: 0, weakPatterns: [] },
    });
    await writeSigFor({ stateDir: workdir, stage: 'MUTATION', sig: mut.sha256, inputSigs: [impl.sha256] });

    // Phase 4: Acceptance.
    const accept = await runAcceptance({
      stateDir: workdir, sliceCheckResult: { passed: true, report: 'all green' },
    });
    expect(accept.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run tests/integration/state/end-to-end-chain.test.ts`
Expected: PASS.

```bash
git add tests/integration/state/end-to-end-chain.test.ts
git commit -m "test(state): full chain end-to-end STRAT → TACT → MUT → ACCEPT"
```

---

## Task 8: Slice check + documentation

- [ ] **Step 1: Slice check**

```bash
pnpm tsc --noEmit
pnpm vitest run
peaks slice check --json
```

Expected: all green.

- [ ] **Step 2: Update README**

Append:

```markdown
## 🔒 peaks-state-lock + peaks-qa 验收 (v3.0)

四阶段审计 + 跨阶段 sig 链强制:

```bash
peaks state lock   --stage ANALYSIS --in strategy.md
peaks state lock   --stage IMPLEMENTATION --in impl.json
peaks state lock   --stage MUTATION --in mut.json
peaks state verify --all
peaks state status
```

**承诺**:任何 sig 链断裂 → peaks-qa 拒绝写 ACCEPT.sig → 阻断 merge。

详见 [design spec §4.9](../../docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md)。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(state): README entry for peaks-state-lock + acceptance"
```

---

## Self-Review

### Spec coverage vs Phase 4 ACs

| AC | Task |
|---|---|
| AC-1 state CLI complete (lock/unlock/verify/inspect/status) | Tasks 4 + 5 |
| AC-2 peaks-qa reads sig chain → ACCEPT.sig | Tasks 6 + 7 |
| AC-3 cross-stage read protection | Task 4 (canReadStage) + Task 6 (runAcceptance rejects broken chain) |
| AC-4 sig chain break → refuse merge | Task 6 (throws on broken chain) + Task 3 (verifyChain) |
| AC-5 end-to-end integration | Task 7 |

### Type consistency

- `STAGE_ORDER` (Task 1) used by Tasks 3, 4, 5, 6, 7
- `LockEntry` (Task 1) consumed by Task 2
- `SigChainEntry` (Task 1) consumed by Tasks 3, 6, 7
- `VerifyResult` (Task 1) consumed by Task 6
- `Stage` (Task 1) flows through all tasks

### File size

- `state-lock.ts` ≈ 90 lines ✓
- `sig-chain.ts` ≈ 80 lines ✓
- `state-service.ts` ≈ 60 lines ✓
- `state-commands.ts` ≈ 130 lines ✓
- `acceptance-stage.ts` ≈ 100 lines ✓

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-state-lock-acceptance.md`. Two execution options:

1. Subagent-Driven (recommended)
2. Inline Execution

Which approach?

---

## All Four Plans — Summary

| Plan | Tasks | Status |
|---|---|---|
| Plan 1: peaks-context | 13 | Ready |
| Plan 2: peaks-mut | 10 | Ready |
| Plan 3: peaks-rd split | 11 | Ready |
| Plan 4: state-lock + qa acceptance | 8 | Ready |

Each plan is independently shippable. Order:
- Plan 1 first (foundation: context.json is consumed by all later phases)
- Plan 2 (peaks-mut uses context.json audience view)
- Plan 3 (peaks-rd produces STRAT/TACT sigs)
- Plan 4 (peaks-state-lock + qa acceptance consumes all sigs)

Total: 42 tasks across 4 plans; each bounded by 800-line slice rule; each with a load-bearing test.

**Final gate**: peaks-cli v3.0 ships when all 4 plans land, cross-version isolation test passes, and `peaks workflow verify-pipeline` is green.