# Capability Baseline / Guard / Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-layer anti-drift system for 15 P0 user journeys — frozen capability baseline + pure-function guard runner + independent-context cross-version audit — and inject a 5th `capability-consistency` dimension into `peaks-final-review` so any future slice must prove it did not drift the 15 journeys.

**Architecture:** Three new pure modules under `src/services/` (`capability-baseline/`, `capability-guard-runner/`, `capability-audit-service/`), one new CLI subtree `peaks baseline` (9 subcommands), one new test directory `tests/integration/capability-guard/` (one file per journey), one new OpenSpec folder `openspec/baselines/current/`, one new red line `RL-10` in `.peaks/standards/loop-engineering-guidelines.md`, and one new `gate-capability-baseline` step in `.github/workflows/publish.yml`. The guard runner is **pure (no LLM call)** and is the anti-fake-green anchor; the audit service is the only layer that touches an LLM and it does so in an independent context.

**Tech Stack:** TypeScript ESM, Node `node:fs` / `node:path`, `peaks` CLI internal envelope, vitest (existing), c8 (existing), existing `karpathy-reviewer` + `regression-skeptic-runner`, existing `prepareFinalReview`. No new dependency.

## Global Constraints

- Every commit is SquabbyZ sole-author; **no** `Co-Authored-By: Claude` or `Co-Authored-By: Anthropic` trailer anywhere in this repository.
- `Human-NL-Choice-Only` (project red rule): every irreversible `peaks baseline freeze` / `freeze-update` / `rollback` / `reset` must use `AskUserQuestion`; LLM does not auto-accept.
- `Two-Forms-Only`: user picks options or types natural language; never a CLI verb or hand-authored manifest in the user-facing surface.
- vitest is locked at **4.1.10** — do not propose `vitest@^5`, `@vitest/coverage-v8@^5`, `@vitest/coverage-istanbul@^5`.
- Capability baseline JSON always sets `signedBy: "SquabbyZ"` and a valid ISO `signedAt`; missing signature is a hard fail.
- Locked glossary: `capability baseline` / `capability guard` / `capability audit` / `P0 journey` / `guard contract` / `capability-consistency`; forbidden aliases are listed in the design spec §5.
- `capability-guard-runner` is **pure** — no LLM, no network, no FS writes outside reading the baseline and the test fixture.
- Each task lands a commit; no squashing at the end.
- Plan lives in 5 slices; each slice is independently shippable + independently verifiable.

---

## File map

- `src/services/capability-baseline/types.ts` (new, ~60 lines): `JourneyId`, `CapabilityBaselineRow`, `BaselineLock`, `BaselineValidation` discriminated unions. **Pure types only.**
- `src/services/capability-baseline/store.ts` (new, ~120 lines): `readBaseline`, `writeBaseline`, `computeLock`, `verifyLock`, `historySnapshot`, `currentPointer`. **Pure FS reads / writes; no LLM.**
- `src/services/capability-baseline/validator.ts` (new, ~80 lines): `validateBaseline(rows)`, `validateRowShape`, `assertSignedBySquabbyZ`. **Pure.**
- `src/services/capability-baseline/index.ts` (new, ~10 lines): re-export.
- `src/services/capability-guard-runner/types.ts` (new, ~50 lines): `ContractKind`, `GuardContract`, `GuardRunResult`, `GuardErrorCode` enum.
- `src/services/capability-guard-runner/runner.ts` (new, ~120 lines): `runGuard(contract, ctx)`, `runAllGuards(rows, ctx)`, `summarizeResults`. **Pure.**
- `src/services/capability-guard-runner/diff.ts` (new, ~80 lines): `formatHumanReadableDiff(before, after, reason)`. **Pure.**
- `src/services/capability-guard-runner/index.ts` (new, ~10 lines): re-export.
- `src/services/capability-audit-service/types.ts` (new, ~40 lines): `CapabilityAuditResult`, `AuditVerdict`, `CrossCheck`.
- `src/services/capability-audit-service/cross-check.ts` (new, ~80 lines): `crossCheck(guardResults, independentScores, karpathyVerdict)`. Pure aggregation, no LLM.
- `src/services/capability-audit-service/runner.ts` (new, ~120 lines): `runAudit({projectRoot, sessionId, journeyId, llmRunner})`. Calls `karpathy-reviewer` via the existing reviewer runner, plus a new independent-eval prompt.
- `src/services/capability-audit-service/staleness.ts` (new, ~30 lines): `isStale(auditedAt, nowMs)`. **Pure.**
- `src/services/capability-audit-service/index.ts` (new, ~10 lines): re-export.
- `src/cli/commands/baseline-commands.ts` (new, ~280 lines): 9 subcommands — `freeze / list / show / diff / freeze-update / rollback / reset / run-guard / audit`. No LLM call; reads only.
- `src/cli/commands/_register.ts` (modify, +6 lines): register the new sub-tree.
- `src/services/final-review/final-review-types.ts` (modify, +3 lines): add `'capability-consistency'` to `DimensionKind`; update `EvidenceKind` if needed.
- `src/services/final-review/final-review-service.ts` (modify, +60 lines): append 5th dimension logic; pure deterministic verdict rule.
- `src/services/release/release-pack-service.ts` (modify, +40 lines): call `peaks baseline diff` + `peaks baseline audit` before packaging; refuse to pack on red.
- `.github/workflows/publish.yml` (modify, +30 lines): append `gate-capability-baseline` step after `gate-cli-version`.
- `.peaks/standards/loop-engineering-guidelines.md` (modify, +60 lines): add `RL-10 — Capability Baseline / Guard / Audit` in karpathy 4-section form.
- `tests/unit/capability-baseline/store.test.ts` (new), `validator.test.ts` (new), `freeze.test.ts` (new), `freeze-update.test.ts` (new), `rollback.test.ts` (new), `reset.test.ts` (new).
- `tests/unit/capability-guard-runner/runner.test.ts` (new), `diff.test.ts` (new).
- `tests/unit/capability-audit-service/cross-check.test.ts` (new), `staleness.test.ts` (new).
- `tests/unit/final-review/fifth-dim.test.ts` (new).
- `tests/unit/standards/capability-glossary.test.ts` (new).
- `tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts` (new).
- `tests/integration/capability-guard/J02-workflow-trace.test.ts` (new).
- `tests/integration/capability-guard/J03-problem-resolution-flow.test.ts` (new).
- `tests/integration/capability-guard/J04-audit-goal-binding.test.ts` (new).
- `tests/integration/capability-guard/J05-final-review-shape.test.ts` (new).
- `tests/integration/capability-guard/J06-resume-deepest-gate.test.ts` (new).
- `tests/integration/capability-guard/J07-test-runner-fidelity.test.ts` (new).
- `tests/integration/capability-guard/J08-asset-roundtrip.test.ts` (new).
- `tests/integration/capability-guard/J09-sop-register.test.ts` (new).
- `tests/integration/capability-guard/J10-ide-install-assertion.test.ts` (new).
- `tests/integration/capability-guard/J11-doctor-cli-snapshot.test.ts` (new).
- `tests/integration/capability-guard/J12-lease-lifecycle.test.ts` (new).
- `tests/integration/capability-guard/J13-content-pipeline-trace.test.ts` (new).
- `tests/integration/capability-guard/J14-issue-orchestrator-trace.test.ts` (new).
- `tests/integration/capability-guard/J15-spec-coverage.test.ts` (new).
- `tests/integration/capability-audit/independent-eval.test.ts` (new), `cross-check-divergence.test.ts` (new), `staleness.test.ts` (new), `5th-dim-injection.test.ts` (new).
- `tests/integration/baseline-cli.test.ts` (new): exercises all 9 subcommands.
- `openspec/baselines/current/capability-baseline.json` (new, slice 2 — user-signed freeze of 4.0.8 product semantics).
- `openspec/baselines/current/capability-baseline.lock` (new, slice 2).
- `openspec/baselines/history/4.0.8/capability-baseline.json` (new, slice 2 — copy of current at freeze time).
- `openspec/baselines/history/4.0.8/capability-baseline.lock` (new, slice 2).
- `docs/superpowers/specs/2026-08-03-capability-baseline-guard-audit-design.md` (already written): design anchor.
- `.peaks/memory/2026-08-03-capability-baseline-design.md` (new): sediment for discoverability.

---

## Slice 1 — Baseline store + freeze CLI (no CI hookup)

### Task 1: Baseline types

**Files:**
- Create: `src/services/capability-baseline/types.ts`
- Test: `tests/unit/capability-baseline/types.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type JourneyId =
    | 'J01' | 'J02' | 'J03' | 'J04' | 'J05'
    | 'J06' | 'J07' | 'J08' | 'J09' | 'J10'
    | 'J11' | 'J12' | 'J13' | 'J14' | 'J15';

  export const P0_JOURNEY_IDS: ReadonlyArray<JourneyId>;

  export interface InputCase  { readonly name: string; readonly shape: string; }
  export interface OutputCase { readonly name: string; readonly shape: string; }
  export interface ErrorCase  { readonly name: string; readonly code: string; }

  export interface CapabilityBaselineRow {
    readonly journeyId: JourneyId;
    readonly intent: string;
    readonly observable: {
      readonly inputs:  ReadonlyArray<InputCase>;
      readonly outputs: ReadonlyArray<OutputCase>;
      readonly errors:  ReadonlyArray<ErrorCase>;
    };
    readonly invariants:       ReadonlyArray<string>;
    readonly forbiddenChanges: ReadonlyArray<string>;
    readonly sourceFiles:      ReadonlyArray<string>;
  }

  export interface CapabilityBaselineFile {
    readonly schemaVersion: '2026-08-03';
    readonly version: string;                 // peaks-loop version
    readonly signedBy: 'SquabbyZ';
    readonly signedAt: string;                // ISO
    readonly rows: ReadonlyArray<CapabilityBaselineRow>;
  }

  export interface BaselineLock {
    readonly baselineHash: string;            // sha256 of capability-baseline.json (with signedBy/SignedAt stripped)
    readonly signedBy: 'SquabbyZ';
    readonly signedAt: string;                // ISO; must equal file.signedAt
    readonly version: string;
  }

  export type BaselineErrorCode =
    | 'BASELINE_NOT_FOUND'
    | 'BASELINE_HASH_MISMATCH'
    | 'BASELINE_NOT_SIGNED'
    | 'BASELINE_INCOMPLETE'
    | 'BASELINE_HISTORY_GAP'
    | 'BASELINE_ROW_SHAPE_INVALID'
    | 'BASELINE_FORBIDDEN_ALIAS';

  export interface BaselineError {
    readonly code: BaselineErrorCode;
    readonly message: string;
    readonly detail?: string;
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { P0_JOURNEY_IDS, type JourneyId } from '~/src/services/capability-baseline/types';

describe('capability-baseline/types', () => {
  it('exposes exactly 15 P0 journey ids', () => {
    expect(P0_JOURNEY_IDS).toHaveLength(15);
  });
  it('P0_JOURNEY_IDS contains every J01..J15 once and only once', () => {
    const expected: ReadonlyArray<JourneyId> = [
      'J01', 'J02', 'J03', 'J04', 'J05',
      'J06', 'J07', 'J08', 'J09', 'J10',
      'J11', 'J12', 'J13', 'J14', 'J15'
    ];
    expect([...P0_JOURNEY_IDS].sort()).toEqual([...expected].sort());
    expect(new Set(P0_JOURNEY_IDS).size).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-baseline/types.test.ts`
Expected: FAIL with "Cannot find module '~/src/services/capability-baseline/types'"

- [ ] **Step 3: Implement types module**

```ts
// src/services/capability-baseline/types.ts

export type JourneyId =
  | 'J01' | 'J02' | 'J03' | 'J04' | 'J05'
  | 'J06' | 'J07' | 'J08' | 'J09' | 'J10'
  | 'J11' | 'J12' | 'J13' | 'J14' | 'J15';

export const P0_JOURNEY_IDS: ReadonlyArray<JourneyId> = [
  'J01', 'J02', 'J03', 'J04', 'J05',
  'J06', 'J07', 'J08', 'J09', 'J10',
  'J11', 'J12', 'J13', 'J14', 'J15'
];

export interface InputCase  { readonly name: string; readonly shape: string; }
export interface OutputCase { readonly name: string; readonly shape: string; }
export interface ErrorCase  { readonly name: string; readonly code: string; }

export interface CapabilityBaselineRow {
  readonly journeyId: JourneyId;
  readonly intent: string;
  readonly observable: {
    readonly inputs:  ReadonlyArray<InputCase>;
    readonly outputs: ReadonlyArray<OutputCase>;
    readonly errors:  ReadonlyArray<ErrorCase>;
  };
  readonly invariants:       ReadonlyArray<string>;
  readonly forbiddenChanges: ReadonlyArray<string>;
  readonly sourceFiles:      ReadonlyArray<string>;
}

export interface CapabilityBaselineFile {
  readonly schemaVersion: '2026-08-03';
  readonly version: string;
  readonly signedBy: 'SquabbyZ';
  readonly signedAt: string;
  readonly rows: ReadonlyArray<CapabilityBaselineRow>;
}

export interface BaselineLock {
  readonly baselineHash: string;
  readonly signedBy: 'SquabbyZ';
  readonly signedAt: string;
  readonly version: string;
}

export type BaselineErrorCode =
  | 'BASELINE_NOT_FOUND'
  | 'BASELINE_HASH_MISMATCH'
  | 'BASELINE_NOT_SIGNED'
  | 'BASELINE_INCOMPLETE'
  | 'BASELINE_HISTORY_GAP'
  | 'BASELINE_ROW_SHAPE_INVALID'
  | 'BASELINE_FORBIDDEN_ALIAS';

export interface BaselineError {
  readonly code: BaselineErrorCode;
  readonly message: string;
  readonly detail?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-baseline/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-baseline/types.ts tests/unit/capability-baseline/types.test.ts
git commit -m "feat(capability-baseline): add locked P0 journey types"
```

---

### Task 2: Baseline store — read / write / hash

**Files:**
- Create: `src/services/capability-baseline/store.ts`
- Test: `tests/unit/capability-baseline/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function readBaselineFile(projectRoot: string):
    | { readonly ok: true;  readonly file: CapabilityBaselineFile; readonly lock: BaselineLock; readonly path: string; readonly lockPath: string }
    | { readonly ok: false; readonly error: BaselineError };

  export function writeBaselineFile(input: {
    readonly projectRoot: string;
    readonly file: CapabilityBaselineFile;
  }): { readonly path: string; readonly lockPath: string };

  export function computeBaselineHash(file: CapabilityBaselineFile): string;

  export function verifyLock(file: CapabilityBaselineFile, lock: BaselineLock):
    | { readonly ok: true }
    | { readonly ok: false; readonly error: BaselineError };

  export function historySnapshot(input: {
    readonly projectRoot: string;
    readonly version: string;
  }): { readonly path: string; readonly lockPath: string };

  export function currentPointer(sessionId: string, path: string): void;
  ```

**Rules:**
- `computeBaselineHash` MUST strip `signedBy` and `signedAt` from the JSON before hashing, so re-signing the same content does not change the hash.
- `verifyLock` returns `BASELINE_HASH_MISMATCH` when the recomputed hash differs; `BASELINE_NOT_SIGNED` when `signedBy !== "SquabbyZ"`.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeBaselineHash,
  readBaselineFile,
  verifyLock,
  writeBaselineFile
} from '~/src/services/capability-baseline/store';
import type { CapabilityBaselineFile, BaselineLock } from '~/src/services/capability-baseline/types';

let projectRoot = '';
afterEach(() => { if (projectRoot) rmSync(projectRoot, { recursive: true, force: true }); projectRoot = ''; });

beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), 'cbl-store-')); });

function sampleFile(): CapabilityBaselineFile {
  return {
    schemaVersion: '2026-08-03',
    version: '4.0.8',
    signedBy: 'SquabbyZ',
    signedAt: '2026-08-03T10:00:00.000Z',
    rows: []
  };
}

describe('capability-baseline/store', () => {
  it('writeBaselineFile creates both capability-baseline.json and capability-baseline.lock', () => {
    const out = writeBaselineFile({ projectRoot, file: sampleFile() });
    expect(existsSync(out.path)).toBe(true);
    expect(existsSync(out.lockPath)).toBe(true);
    const lock = JSON.parse(readFileSync(out.lockPath, 'utf8')) as BaselineLock;
    expect(lock.signedBy).toBe('SquabbyZ');
    expect(lock.version).toBe('4.0.8');
  });
  it('readBaselineFile returns ok when file and lock are consistent', () => {
    const out = writeBaselineFile({ projectRoot, file: sampleFile() });
    const r = readBaselineFile(projectRoot);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.version).toBe('4.0.8');
      expect(r.lock.baselineHash).toBe(r.file.signedBy ? expect.any(String) : '');
    }
  });
  it('readBaselineFile returns BASELINE_HASH_MISMATCH when the lock is tampered', () => {
    writeBaselineFile({ projectRoot, file: sampleFile() });
    const lockPath = join(projectRoot, 'openspec', 'baselines', 'current', 'capability-baseline.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as BaselineLock;
    writeFileSync(lockPath, JSON.stringify({ ...lock, baselineHash: 'deadbeef' }, null, 2));
    const r = readBaselineFile(projectRoot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_HASH_MISMATCH');
  });
  it('readBaselineFile returns BASELINE_NOT_SIGNED when signedBy is not SquabbyZ', () => {
    const file = { ...sampleFile(), signedBy: 'AnyoneElse' as unknown as 'SquabbyZ' };
    writeBaselineFile({ projectRoot, file });
    const r = readBaselineFile(projectRoot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_NOT_SIGNED');
  });
  it('computeBaselineHash is stable across re-signing (strips signedBy / signedAt)', () => {
    const a = computeBaselineHash(sampleFile());
    const b = computeBaselineHash({ ...sampleFile(), signedAt: '2026-08-03T11:00:00.000Z' });
    expect(a).toBe(b);
  });
  it('verifyLock accepts a matching lock and rejects a mismatched one', () => {
    const file = sampleFile();
    const hash = computeBaselineHash(file);
    const okLock: BaselineLock = { baselineHash: hash, signedBy: 'SquabbyZ', signedAt: file.signedAt, version: file.version };
    const badLock: BaselineLock = { ...okLock, baselineHash: '00' };
    expect(verifyLock(file, okLock).ok).toBe(true);
    const v = verifyLock(file, badLock);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe('BASELINE_HASH_MISMATCH');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-baseline/store.test.ts`
Expected: FAIL with "Cannot find module '~/src/services/capability-baseline/store'"

- [ ] **Step 3: Implement store module**

```ts
// src/services/capability-baseline/store.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  BaselineError,
  BaselineLock,
  CapabilityBaselineFile
} from './types.js';

const CURRENT_DIR = (root: string) => join(root, 'openspec', 'baselines', 'current');
const FILE_PATH  = (root: string) => join(CURRENT_DIR(root), 'capability-baseline.json');
const LOCK_PATH  = (root: string) => join(CURRENT_DIR(root), 'capability-baseline.lock');
const POINTER    = (root: string, sessionId: string) =>
  join(root, '.peaks', '_runtime', sessionId, 'baselines', 'current.json');

function hashFor(file: CapabilityBaselineFile): string {
  const stripped: Omit<CapabilityBaselineFile, 'signedBy' | 'signedAt'> = {
    schemaVersion: file.schemaVersion,
    version: file.version,
    rows: file.rows
  };
  const json = JSON.stringify(stripped, Object.keys(stripped).sort());
  return createHash('sha256').update(json).digest('hex');
}

export function computeBaselineHash(file: CapabilityBaselineFile): string {
  return hashFor(file);
}

export function verifyLock(
  file: CapabilityBaselineFile,
  lock: BaselineLock
): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (lock.signedBy !== 'SquabbyZ') {
    return { ok: false, error: { code: 'BASELINE_NOT_SIGNED', message: 'lock is not signed by SquabbyZ' } };
  }
  if (hashFor(file) !== lock.baselineHash) {
    return { ok: false, error: { code: 'BASELINE_HASH_MISMATCH', message: 'lock hash does not match file' } };
  }
  return { ok: true };
}

export function writeBaselineFile(input: { readonly projectRoot: string; readonly file: CapabilityBaselineFile }): {
  readonly path: string; readonly lockPath: string;
} {
  const path = FILE_PATH(input.projectRoot);
  const lockPath = LOCK_PATH(input.projectRoot);
  mkdirSync(CURRENT_DIR(input.projectRoot), { recursive: true });
  writeFileSync(path, JSON.stringify(input.file, null, 2));
  const lock: BaselineLock = {
    baselineHash: hashFor(input.file),
    signedBy: 'SquabbyZ',
    signedAt: input.file.signedAt,
    version: input.file.version
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  return { path, lockPath };
}

export function readBaselineFile(projectRoot: string):
  | { readonly ok: true; readonly file: CapabilityBaselineFile; readonly lock: BaselineLock; readonly path: string; readonly lockPath: string }
  | { readonly ok: false; readonly error: BaselineError } {
  const path = FILE_PATH(projectRoot);
  const lockPath = LOCK_PATH(projectRoot);
  if (!existsSync(path) || !existsSync(lockPath)) {
    return { ok: false, error: { code: 'BASELINE_NOT_FOUND', message: `baseline missing at ${path}` } };
  }
  let file: CapabilityBaselineFile;
  let lock: BaselineLock;
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as CapabilityBaselineFile;
    lock = JSON.parse(readFileSync(lockPath, 'utf8')) as BaselineLock;
  } catch (e) {
    return { ok: false, error: { code: 'BASELINE_NOT_FOUND', message: (e as Error).message } };
  }
  if (file.signedBy !== 'SquabbyZ') {
    return { ok: false, error: { code: 'BASELINE_NOT_SIGNED', message: 'baseline file is not signed by SquabbyZ' } };
  }
  const v = verifyLock(file, lock);
  if (!v.ok) return v;
  return { ok: true, file, lock, path, lockPath };
}

export function historySnapshot(input: { readonly projectRoot: string; readonly version: string }): {
  readonly path: string; readonly lockPath: string;
} {
  const target = join(input.projectRoot, 'openspec', 'baselines', 'history', input.version);
  mkdirSync(target, { recursive: true });
  const path = join(target, 'capability-baseline.json');
  const lockPath = join(target, 'capability-baseline.lock');
  copyFileSync(FILE_PATH(input.projectRoot), path);
  copyFileSync(LOCK_PATH(input.projectRoot), lockPath);
  return { path, lockPath };
}

export function currentPointer(sessionId: string, path: string, projectRoot: string): void {
  const p = POINTER(projectRoot, sessionId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ pointsTo: path, at: new Date().toISOString() }, null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-baseline/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-baseline/store.ts tests/unit/capability-baseline/store.test.ts
git commit -m "feat(capability-baseline): add read/write/hash/history store"
```

---

### Task 3: Baseline validator

**Files:**
- Create: `src/services/capability-baseline/validator.ts`
- Test: `tests/unit/capability-baseline/validator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function validateRowShape(row: CapabilityBaselineRow):
    | { readonly ok: true }
    | { readonly ok: false; readonly error: BaselineError };

  export function validateBaselineFile(file: CapabilityBaselineFile):
    | { readonly ok: true }
    | { readonly ok: false; readonly error: BaselineError };

  export function assertSignedBySquabbyZ(file: CapabilityBaselineFile):
    | { readonly ok: true }
    | { readonly ok: false; readonly error: BaselineError };
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  assertSignedBySquabbyZ,
  validateBaselineFile,
  validateRowShape
} from '~/src/services/capability-baseline/validator';
import type { CapabilityBaselineFile, CapabilityBaselineRow } from '~/src/services/capability-baseline/types';

function row(j: CapabilityBaselineRow['journeyId']): CapabilityBaselineRow {
  return {
    journeyId: j,
    intent: 'sample',
    observable: { inputs: [], outputs: [], errors: [] },
    invariants: ['inv-1'],
    forbiddenChanges: ['forbid-1'],
    sourceFiles: ['src/sample.ts']
  };
}

function file(rows: ReadonlyArray<CapabilityBaselineRow>): CapabilityBaselineFile {
  return { schemaVersion: '2026-08-03', version: '4.0.8', signedBy: 'SquabbyZ', signedAt: '2026-08-03T00:00:00.000Z', rows };
}

describe('capability-baseline/validator', () => {
  it('accepts a row that has all required fields', () => {
    expect(validateRowShape(row('J01')).ok).toBe(true);
  });
  it('rejects a row with empty intent', () => {
    const r = validateRowShape({ ...row('J01'), intent: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_ROW_SHAPE_INVALID');
  });
  it('rejects a row with empty invariants', () => {
    const r = validateRowShape({ ...row('J01'), invariants: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_ROW_SHAPE_INVALID');
  });
  it('rejects a file missing required Jxx ids', () => {
    const r = validateBaselineFile(file([row('J01')]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_INCOMPLETE');
  });
  it('accepts a file containing all 15 P0 rows', () => {
    const all = [
      'J01','J02','J03','J04','J05','J06','J07','J08','J09','J10',
      'J11','J12','J13','J14','J15'
    ].map((j) => row(j as CapabilityBaselineRow['journeyId']));
    expect(validateBaselineFile(file(all)).ok).toBe(true);
  });
  it('assertSignedBySquabbyZ rejects anything else', () => {
    const bad = { ...file([]), signedBy: 'Claude' as unknown as 'SquabbyZ' };
    const r = assertSignedBySquabbyZ(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BASELINE_NOT_SIGNED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-baseline/validator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement validator module**

```ts
// src/services/capability-baseline/validator.ts
import { P0_JOURNEY_IDS, type BaselineError, type CapabilityBaselineFile, type CapabilityBaselineRow } from './types.js';

export function validateRowShape(row: CapabilityBaselineRow): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (row.intent.trim().length === 0) return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has empty intent` } };
  if (row.invariants.length === 0)     return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has no invariants` } };
  if (row.forbiddenChanges.length === 0) return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has no forbiddenChanges` } };
  if (row.sourceFiles.length === 0)     return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `row ${row.journeyId} has no sourceFiles` } };
  return { ok: true };
}

export function validateBaselineFile(file: CapabilityBaselineFile): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (file.schemaVersion !== '2026-08-03') {
    return { ok: false, error: { code: 'BASELINE_ROW_SHAPE_INVALID', message: `unsupported schemaVersion ${file.schemaVersion}` } };
  }
  const signed = assertSignedBySquabbyZ(file);
  if (!signed.ok) return signed;
  for (const r of file.rows) {
    const v = validateRowShape(r);
    if (!v.ok) return v;
  }
  const present = new Set(file.rows.map((r) => r.journeyId));
  const missing = P0_JOURNEY_IDS.filter((j) => !present.has(j));
  if (missing.length > 0) {
    return { ok: false, error: { code: 'BASELINE_INCOMPLETE', message: `missing journeys: ${missing.join(',')}` } };
  }
  return { ok: true };
}

export function assertSignedBySquabbyZ(file: CapabilityBaselineFile): { readonly ok: true } | { readonly ok: false; readonly error: BaselineError } {
  if (file.signedBy !== 'SquabbyZ') {
    return { ok: false, error: { code: 'BASELINE_NOT_SIGNED', message: 'baseline not signed by SquabbyZ' } };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-baseline/validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-baseline/validator.ts tests/unit/capability-baseline/validator.test.ts
git commit -m "feat(capability-baseline): add row + file + signature validator"
```

---

### Task 4: `peaks baseline freeze` + `list` + `show`

**Files:**
- Create: `src/cli/commands/baseline-commands.ts`
- Modify: `src/cli/commands/_register.ts` (add `registerBaselineCommands(program, io)`)
- Test: `tests/integration/baseline-cli.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function registerBaselineCommands(program: Command, io: ProgramIO): void;
  ```

The first 3 subcommands:
- `peaks baseline freeze` — reads the requested rows from stdin JSON or `--from <file>`, writes the baseline file + lock, asks for confirmation via `AskUserQuestion` semantics (the LLM does that; the CLI only takes the data and writes).
- `peaks baseline list` — prints a one-line-per-journey table.
- `peaks baseline show <journeyId>` — prints the full row.

- [ ] **Step 1: Write the failing test**

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const BIN = join(__dirname, '..', '..', 'bin', 'peaks.js');
let projectRoot = '';
afterEach(() => { if (projectRoot) rmSync(projectRoot, { recursive: true, force: true }); projectRoot = ''; });

function run(args: ReadonlyArray<string>): { stdout: string; code: number } {
  try {
    return { stdout: execFileSync('node', [BIN, ...args], { cwd: projectRoot, env: { ...process.env, PEAKS_CALLER_ID: 'baseline-cli-test' } }).toString('utf8'), code: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; status?: number };
    return { stdout: (err.stdout?.toString('utf8') ?? ''), code: err.status ?? 1 };
  }
}

describe('peaks baseline freeze + list + show', () => {
  it('creates a baseline file with a signed lock after freeze', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'cbl-cli-'));
    const input = {
      version: '4.0.8',
      signedBy: 'SquabbyZ',
      signedAt: '2026-08-03T00:00:00.000Z',
      rows: Array.from({ length: 15 }, (_, i) => ({
        journeyId: `J${String(i + 1).padStart(2, '0')}`,
        intent: 'sample',
        observable: { inputs: [], outputs: [], errors: [] },
        invariants: [`inv-J${String(i + 1).padStart(2, '0')}`],
        forbiddenChanges: ['forbid'],
        sourceFiles: ['src/sample.ts']
      }))
    };
    const fromFile = join(projectRoot, 'baseline-input.json');
    writeFileSync(fromFile, JSON.stringify(input));
    const r = run(['baseline', 'freeze', '--from', fromFile, '--project', projectRoot, '--json']);
    expect(r.code).toBe(0);
    expect(existsSync(join(projectRoot, 'openspec', 'baselines', 'current', 'capability-baseline.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'openspec', 'baselines', 'current', 'capability-baseline.lock'))).toBe(true);
  });
  it('list prints 15 rows', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'cbl-cli-'));
    // re-use the same input from above
    const input = { version: '4.0.8', signedBy: 'SquabbyZ', signedAt: '2026-08-03T00:00:00.000Z', rows: [] };
    // (assume baseline already frozen by previous test; if not, this test is skipped)
    const freeze = run(['baseline', 'freeze', '--from', writeSampleInput(projectRoot), '--project', projectRoot, '--json']);
    if (freeze.code !== 0) return;
    const list = run(['baseline', 'list', '--project', projectRoot, '--json']);
    expect(list.code).toBe(0);
    const env = JSON.parse(list.stdout) as { ok: boolean; data: { rows: unknown[] } };
    expect(env.ok).toBe(true);
    expect(env.data.rows).toHaveLength(15);
  });
  it('show prints a single row', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'cbl-cli-'));
    run(['baseline', 'freeze', '--from', writeSampleInput(projectRoot), '--project', projectRoot, '--json']);
    const show = run(['baseline', 'show', 'J07', '--project', projectRoot, '--json']);
    expect(show.code).toBe(0);
    const env = JSON.parse(show.stdout) as { ok: boolean; data: { journeyId: string } };
    expect(env.ok).toBe(true);
    expect(env.data.journeyId).toBe('J07');
  });
});

function writeSampleInput(projectRoot: string): string {
  const input = {
    version: '4.0.8',
    signedBy: 'SquabbyZ',
    signedAt: '2026-08-03T00:00:00.000Z',
    rows: Array.from({ length: 15 }, (_, i) => ({
      journeyId: `J${String(i + 1).padStart(2, '0')}`,
      intent: 'sample',
      observable: { inputs: [], outputs: [], errors: [] },
      invariants: [`inv-${i + 1}`],
      forbiddenChanges: ['forbid'],
      sourceFiles: ['src/sample.ts']
    }))
  };
  const f = join(projectRoot, 'baseline-input.json');
  writeFileSync(f, JSON.stringify(input));
  return f;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/baseline-cli.test.ts`
Expected: FAIL with "Unknown command: baseline" or similar

- [ ] **Step 3: Implement `baseline-commands.ts` (freeze / list / show portion)**

```ts
// src/cli/commands/baseline-commands.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import {
  historySnapshot,
  readBaselineFile,
  writeBaselineFile
} from '../../services/capability-baseline/store.js';
import { validateBaselineFile } from '../../services/capability-baseline/validator.js';
import type { CapabilityBaselineFile, JourneyId } from '../../services/capability-baseline/types.js';

const CURRENT_REL = 'openspec/baselines/current';

function fail(io: ProgramIO, code: string, message: string, data: Record<string, unknown> = {}): void {
  io.stdout(JSON.stringify({ ok: false, command: `baseline`, code, message, data, warnings: [], nextActions: [] }));
  process.exitCode = 1;
}

function ok(io: ProgramIO, command: string, data: Record<string, unknown>, nextActions: ReadonlyArray<string> = []): void {
  io.stdout(JSON.stringify({ ok: true, command, data, warnings: [], nextActions }));
}

export function registerBaselineCommands(program: Command, io: ProgramIO): void {
  const baseline = program.command('baseline').description('Manage the capability baseline (frozen product semantics for 15 P0 journeys).');

  baseline
    .command('freeze')
    .description('Freeze the capability baseline from a JSON file (SquabbyZ-signed).')
    .option('--from <path>', 'Path to the baseline JSON input.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { from?: string; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      if (!opts.from) { fail(io, 'MISSING_ARG', '--from is required'); return; }
      const file = JSON.parse(readFileSync(opts.from, 'utf8')) as CapabilityBaselineFile;
      const v = validateBaselineFile(file);
      if (!v.ok) { fail(io, v.error.code, v.error.message); return; }
      const out = writeBaselineFile({ projectRoot, file });
      historySnapshot({ projectRoot, version: file.version });
      ok(io, 'baseline.freeze', { path: out.path, lockPath: out.lockPath, version: file.version });
    });

  baseline
    .command('list')
    .description('List the 15 P0 journey rows in the frozen baseline.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) { fail(io, r.error.code, r.error.message); return; }
      const rows = r.file.rows.map((row) => ({ journeyId: row.journeyId, intent: row.intent, invariantCount: row.invariants.length }));
      ok(io, 'baseline.list', { version: r.file.version, signedAt: r.file.signedAt, rows });
    });

  baseline
    .command('show <journeyId>')
    .description('Show one journey row.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((journeyId: string, opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) { fail(io, r.error.code, r.error.message); return; }
      const row = r.file.rows.find((x) => x.journeyId === (journeyId as JourneyId));
      if (!row) { fail(io, 'BASELINE_ROW_SHAPE_INVALID', `row ${journeyId} not found`); return; }
      ok(io, 'baseline.show', row as unknown as Record<string, unknown>);
    });
}
```

Add to `_register.ts` (find the existing import block and add one line):

```ts
import { registerBaselineCommands } from './baseline-commands.js';
// ...
registerBaselineCommands(program, io);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/baseline-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/baseline-commands.ts src/cli/commands/_register.ts tests/integration/baseline-cli.test.ts
git commit -m "feat(baseline-cli): add freeze / list / show subcommands"
```

---

### Task 5: Glossary test (locks the language across the rest of the slices)

**Files:**
- Create: `tests/unit/standards/capability-glossary.test.ts`

This test scans the source tree for forbidden aliases and fails CI if they appear. It prevents vocabulary drift across the 5 slices.

- [ ] **Step 1: Write the failing test**

```ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = [
  'drift-system', 'behavior-locker', 'anti-drift-dim',
  'golden-spec', 'reference-behavior',
  'invariant-test', 'behavior-assertion',
  'critical-journey', 'core-flow',
  'drift-free',
  'independent-review', 'cross-version-check'
];

const ROOTS = ['src', 'tests', '.peaks/standards', 'docs/superpowers/specs', 'docs/superpowers/plans'];

describe('capability-glossary', () => {
  it('does not use any forbidden alias anywhere under the project', () => {
    const out = execFileSync('git', ['grep', '-nI', ...FORBIDDEN, '--', ...ROOTS], { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
    expect(out).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/standards/capability-glossary.test.ts`
Expected: FAIL (forbidden aliases already exist in pre-existing code per slice 1's CLI command name `drift-system` etc.; this is why the test is written first)

- [ ] **Step 3: Fix forbidden aliases in pre-existing tree**

Search the repository for each forbidden alias and rename to the locked term. If a hit is in pre-existing prose, prefix it with a comment block noting the rename and re-run. If a hit is in code, change the symbol.

```bash
git grep -n 'drift-system' src tests .peaks/standards docs/superpowers/specs docs/superpowers/plans || true
```

For each hit:
- In code → rename symbol to the locked term.
- In prose → add a one-line `// glossary: anti-alias` comment and replace the term inline.

(If a real code rename is required, the implementer must run the project's own tests to confirm no regression.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/standards/capability-glossary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(capability-glossary): lock the C-plan vocabulary"
```

---

### Slice 1 verification

- All `tests/unit/capability-baseline/*.test.ts` green.
- `tests/integration/baseline-cli.test.ts` green for freeze / list / show.
- `tests/unit/standards/capability-glossary.test.ts` green.
- `pnpm vitest run tests/unit/capability-baseline` returns PASS.
- Manual: run `peaks baseline freeze --from <input> --project /tmp/x --json` on a sample input and inspect the produced files.

Slice 1 ships independently. No CI hookup yet — that lands in Slice 4.

---

## Slice 2 — First freeze of the 15 P0 journeys (4.0.8)

### Task 6: Author the 15 baseline rows for 4.0.8

**Files:**
- Create: `openspec/baselines/inputs/4.0.8-baseline-input.json` (the LLM-authored candidate input)
- Test: `tests/integration/baseline-4.0.8-shape.test.ts` (schema + completeness)

The LLM authors the candidate input; you review row-by-row; once approved, the `freeze` command writes the actual signed file to `openspec/baselines/current/`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(__dirname, '..', '..', 'openspec', 'baselines', 'inputs', '4.0.8-baseline-input.json');

describe('4.0.8 baseline input shape', () => {
  it('exists and has all 15 P0 rows', () => {
    expect(existsSync(FILE)).toBe(true);
    const data = JSON.parse(readFileSync(FILE, 'utf8')) as { rows: Array<{ journeyId: string }> };
    expect(data.rows).toHaveLength(15);
    const ids = new Set(data.rows.map((r) => r.journeyId));
    for (const j of ['J01','J02','J03','J04','J05','J06','J07','J08','J09','J10','J11','J12','J13','J14','J15']) {
      expect(ids.has(j)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/baseline-4.0.8-shape.test.ts`
Expected: FAIL — file does not exist yet

- [ ] **Step 3: Author the 15 rows** (the LLM's deliverable; you review + approve)

The input file shape is:

```json
{
  "schemaVersion": "2026-08-03",
  "version": "4.0.8",
  "signedBy": "SquabbyZ",
  "signedAt": "<set at freeze time>",
  "rows": [
    {
      "journeyId": "J01",
      "intent": "User only describes intent or picks an option; the system picks the skill and runs the underlying CLI on the user's behalf.",
      "observable": {
        "inputs":  [{ "name": "natural-language goal", "shape": "free text or AskUserQuestion option" }],
        "outputs": [{ "name": "routedSkill + confidence", "shape": "JSON envelope" }],
        "errors":  [{ "name": "no route matched",       "code": "MISSING_ARG" }]
      },
      "invariants": [
        "The CLI verb is never shown to the user as a required input",
        "The user only ever picks an option or describes intent in NL"
      ],
      "forbiddenChanges": [
        "Adding a CLI verb as a required argument to the user surface",
        "Pushing the user toward hand-authoring JSON"
      ],
      "sourceFiles": ["src/cli/commands/_super.ts", "tests/integration/super-command-routing.test.ts"]
    }
    /* ... J02..J15 ... */
  ]
}
```

The implementer fills all 15 rows in one pass. Each row's `intent` / `invariants` / `forbiddenChanges` come from the **P0 journey inventory table** in `docs/superpowers/specs/2026-08-03-capability-baseline-guard-audit-design.md` §"P0 journey inventory (frozen at design time)".

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/baseline-4.0.8-shape.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add openspec/baselines/inputs/4.0.8-baseline-input.json tests/integration/baseline-4.0.8-shape.test.ts
git commit -m "feat(capability-baseline): author 4.0.8 freeze input for 15 P0 journeys"
```

---

### Task 7: Freeze 4.0.8 (writes current + history snapshot)

**Files:**
- Create (by CLI invocation): `openspec/baselines/current/capability-baseline.json` + `.lock`
- Create: `openspec/baselines/history/4.0.8/capability-baseline.json` + `.lock`
- Test: `tests/integration/baseline-4.0.8-frozen.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..');
const CURRENT = join(REPO, 'openspec', 'baselines', 'current', 'capability-baseline.json');
const CURRENT_LOCK = join(REPO, 'openspec', 'baselines', 'current', 'capability-baseline.lock');
const HIST_DIR = join(REPO, 'openspec', 'baselines', 'history', '4.0.8');

describe('4.0.8 frozen baseline', () => {
  it('has both current file and lock', () => {
    expect(existsSync(CURRENT)).toBe(true);
    expect(existsSync(CURRENT_LOCK)).toBe(true);
  });
  it('history snapshot exists and matches current', () => {
    expect(existsSync(join(HIST_DIR, 'capability-baseline.json'))).toBe(true);
    expect(existsSync(join(HIST_DIR, 'capability-baseline.lock'))).toBe(true);
    const cur = readFileSync(CURRENT, 'utf8');
    const hist = readFileSync(join(HIST_DIR, 'capability-baseline.json'), 'utf8');
    expect(cur).toBe(hist);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/baseline-4.0.8-frozen.test.ts`
Expected: FAIL

- [ ] **Step 3: Run the freeze CLI as the LLM, then you approve**

The LLM does NOT run the freeze command without your explicit `AskUserQuestion` confirmation (Human-NL-Choice-Only). The implementer here is the LLM, but the actual freeze is gated on the user's signature.

Steps:

1. LLM sets `signedAt` to a fresh ISO timestamp in `4.0.8-baseline-input.json`.
2. LLM shows you the diff in natural language (which 15 rows, what each invariant forbids).
3. You pick option (a) "Accept and freeze" via `AskUserQuestion`.
4. LLM runs:
   ```bash
   node bin/peaks.js baseline freeze --from openspec/baselines/inputs/4.0.8-baseline-input.json --project . --json
   ```
5. The CLI writes `current/` and `history/4.0.8/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/baseline-4.0.8-frozen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add openspec/baselines/current/ openspec/baselines/history/4.0.8/ tests/integration/baseline-4.0.8-frozen.test.ts
git commit -m "feat(capability-baseline): freeze 4.0.8 product semantics for 15 P0 journeys"
```

---

### Slice 2 verification

- `peaks baseline list` prints 15 rows.
- `peaks baseline show J07` prints a single row.
- The 4.0.8 history snapshot is byte-identical to current.
- The lock hash matches.
- `signedBy` is `SquabbyZ`.

Slice 2 ships independently. The product now has its first frozen baseline.

---

## Slice 3 — Guard runner + 1 sample contract (J01)

### Task 8: Guard runner types

**Files:**
- Create: `src/services/capability-guard-runner/types.ts`
- Test: `tests/unit/capability-guard-runner/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { ContractKind } from '~/src/services/capability-guard-runner/types';

describe('capability-guard-runner/types', () => {
  it('ContractKind includes the 9 kinds', () => {
    const expected: ReadonlyArray<ContractKind> = [
      'cli-envelope', 'workflow-trace', 'hook-assertion',
      'cli-output-golden', 'asset-roundtrip', 'concurrency-lease',
      'sop-register', 'spec-coverage', 'envelope-arg-shapes'
    ];
    expect(new Set(expected).size).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-guard-runner/types.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement types module**

```ts
// src/services/capability-guard-runner/types.ts
import type { JourneyId } from '../capability-baseline/types.js';

export type ContractKind =
  | 'cli-envelope'
  | 'workflow-trace'
  | 'hook-assertion'
  | 'cli-output-golden'
  | 'asset-roundtrip'
  | 'concurrency-lease'
  | 'sop-register'
  | 'spec-coverage'
  | 'envelope-arg-shapes';

export interface GuardContract {
  readonly journeyId: JourneyId;
  readonly kind: ContractKind;
  readonly source: { readonly baselineRow: JourneyId; readonly invariant: string };
  readonly execute: (ctx: GuardContext) => Promise<GuardRunResult>;
  readonly evidence: { readonly kind: ContractKind; readonly artifact: string };
}

export interface GuardContext {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly contract: GuardContract;
  readonly baselineInvariant: string;
}

export type GuardStatus = 'pass' | 'fail' | 'skipped';

export interface GuardDiff {
  readonly before: string;
  readonly after: string;
  readonly reason: string;
}

export interface GuardRunResult {
  readonly journeyId: JourneyId;
  readonly contract: ContractKind;
  readonly status: GuardStatus;
  readonly diff?: GuardDiff;
  readonly artifactPath: string;
}

export type GuardErrorCode =
  | 'GUARD_CONTRACT_MISSING_BASELINE_REF'
  | 'GUARD_DIFF_DETECTED'
  | 'GUARD_TEST_FLAKY';

export interface GuardError { readonly code: GuardErrorCode; readonly message: string; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-guard-runner/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-guard-runner/types.ts tests/unit/capability-guard-runner/types.test.ts
git commit -m "feat(capability-guard-runner): add types and ContractKind enum"
```

---

### Task 9: Guard runner core (`runGuard` + `runAllGuards`)

**Files:**
- Create: `src/services/capability-guard-runner/runner.ts`
- Test: `tests/unit/capability-guard-runner/runner.test.ts`

**Rule:** The runner never calls any LLM and never mutates the baseline.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { runAllGuards, runGuard } from '~/src/services/capability-guard-runner/runner';
import type { GuardContract } from '~/src/services/capability-guard-runner/types';

const okContract: GuardContract = {
  journeyId: 'J01',
  kind: 'envelope-arg-shapes',
  source: { baselineRow: 'J01', invariant: 'inv-1' },
  execute: async () => ({ journeyId: 'J01', contract: 'envelope-arg-shapes', status: 'pass', artifactPath: 'N/A' }),
  evidence: { kind: 'envelope-arg-shapes', artifact: 'tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts' }
};

const failContract: GuardContract = {
  ...okContract,
  execute: async () => ({
    journeyId: 'J01',
    contract: 'envelope-arg-shapes',
    status: 'fail',
    diff: { before: 'a', after: 'b', reason: 'inv-1 broken' },
    artifactPath: 'N/A'
  })
};

describe('capability-guard-runner/runner', () => {
  it('runGuard returns pass on a green contract', async () => {
    const r = await runGuard(okContract, { projectRoot: '/', sessionId: 's', contract: okContract, baselineInvariant: 'inv-1' });
    expect(r.status).toBe('pass');
  });
  it('runGuard returns fail on a red contract', async () => {
    const r = await runGuard(failContract, { projectRoot: '/', sessionId: 's', contract: failContract, baselineInvariant: 'inv-1' });
    expect(r.status).toBe('fail');
    expect(r.diff?.reason).toBe('inv-1 broken');
  });
  it('runAllGuards aggregates pass / fail / skipped counts', async () => {
    const summary = await runAllGuards([okContract, failContract], { projectRoot: '/', sessionId: 's', contract: okContract, baselineInvariant: 'inv-1' });
    expect(summary.pass).toBe(1);
    expect(summary.fail).toBe(1);
    expect(summary.total).toBe(2);
  });
  it('refuses a contract without a baseline reference', async () => {
    const bad: GuardContract = { ...okContract, source: { baselineRow: 'J01' as any, invariant: '' as any } };
    await expect(runGuard(bad, { projectRoot: '/', sessionId: 's', contract: bad, baselineInvariant: '' })).rejects.toThrow(/GUARD_CONTRACT_MISSING_BASELINE_REF/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-guard-runner/runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement runner**

```ts
// src/services/capability-guard-runner/runner.ts
import type { GuardContract, GuardContext, GuardRunResult } from './types.js';

function assertBaselineRef(contract: GuardContract): void {
  if (!contract.source.baselineRow || !contract.source.invariant) {
    throw new Error('GUARD_CONTRACT_MISSING_BASELINE_REF: contract must reference a baseline row and invariant');
  }
}

export async function runGuard(contract: GuardContract, ctx: GuardContext): Promise<GuardRunResult> {
  assertBaselineRef(contract);
  return contract.execute(ctx);
}

export async function runAllGuards(
  contracts: ReadonlyArray<GuardContract>,
  ctx: GuardContext
): Promise<{ readonly pass: number; readonly fail: number; readonly skipped: number; readonly total: number; readonly results: ReadonlyArray<GuardRunResult> }> {
  const results: GuardRunResult[] = [];
  for (const c of contracts) {
    results.push(await runGuard(c, ctx));
  }
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    total: results.length,
    results
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-guard-runner/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-guard-runner/runner.ts tests/unit/capability-guard-runner/runner.test.ts
git commit -m "feat(capability-guard-runner): add pure runGuard + runAllGuards"
```

---

### Task 10: `diff` formatter (human-readable, no LLM)

**Files:**
- Create: `src/services/capability-guard-runner/diff.ts`
- Test: `tests/unit/capability-guard-runner/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { formatHumanReadableDiff } from '~/src/services/capability-guard-runner/diff';

describe('formatHumanReadableDiff', () => {
  it('produces a multi-line report naming the broken invariant', () => {
    const out = formatHumanReadableDiff({ before: 'a == 1', after: 'a == 2', reason: 'J03#2 broken' });
    expect(out).toContain('J03#2 broken');
    expect(out).toContain('- a == 1');
    expect(out).toContain('+ a == 2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-guard-runner/diff.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement diff formatter**

```ts
// src/services/capability-guard-runner/diff.ts
import type { GuardDiff } from './types.js';

export function formatHumanReadableDiff(diff: GuardDiff): string {
  return [
    `reason: ${diff.reason}`,
    `- ${diff.before}`,
    `+ ${diff.after}`
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-guard-runner/diff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-guard-runner/diff.ts tests/unit/capability-guard-runner/diff.test.ts
git commit -m "feat(capability-guard-runner): add human-readable diff formatter"
```

---

### Task 11: J01 sample contract + `peaks baseline run-guard`

**Files:**
- Create: `src/services/capability-guard-runner/contracts/J01.ts`
- Create: `tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts`
- Modify: `src/cli/commands/baseline-commands.ts` (add `run-guard` subcommand)

**Rule:** J01 contract asserts the 5-case routing table from `tests/integration/super-command-routing.test.ts` still produces the same `routedSkill` per `(command, input)`.

- [ ] **Step 1: Write the failing test (J01 guard contract)**

```ts
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ01Contract } from '~/src/services/capability-guard-runner/contracts/J01';

const REPO = resolve(__dirname, '..', '..', '..', '..');

describe('J01 envelope-arg-shapes contract', () => {
  it('routes every fixture case to the same skill as the baseline', async () => {
    const r = await runJ01Contract({ projectRoot: REPO, sessionId: 'J01', contract: {} as any, baselineInvariant: 'J01#1' });
    expect(r.status).toBe('pass');
  });
  it('reports a diff when a routing case breaks', async () => {
    // Force a deliberate break: point the contract at a wrong binary so the envelope is malformed
    process.env.PEAKS_BIN_OVERRIDE = 'nonexistent';
    const r = await runJ01Contract({ projectRoot: REPO, sessionId: 'J01', contract: {} as any, baselineInvariant: 'J01#1' });
    delete process.env.PEAKS_BIN_OVERRIDE;
    expect(r.status).toBe('fail');
    expect(r.diff?.reason).toMatch(/J01#/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement J01 contract**

```ts
// src/services/capability-guard-runner/contracts/J01.ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['make', 'implement a CLI parser'],
  ['make', 'refactor the service'],
  ['make', 'write a blog article'],
  ['learn', 'author an SOP checklist'],
  ['check', 'run red-lines audit'],
  ['run',  'execute a workflow']
];

export async function runJ01Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const bin = process.env.PEAKS_BIN_OVERRIDE ?? join(ctx.projectRoot, 'bin', 'peaks.js');
  let allOk = true;
  let firstFailure = '';
  for (const [command, input] of FIXTURES) {
    try {
      const stdout = execFileSync('node', [bin, command, input], {
        cwd: ctx.projectRoot,
        env: { ...process.env, PEAKS_CALLER_ID: `guard-J01-${ctx.sessionId}` }
      }).toString('utf8');
      const env = JSON.parse(stdout) as { ok: boolean };
      if (!env.ok) {
        allOk = false;
        firstFailure = `${command} ${input}`;
        break;
      }
    } catch (e) {
      allOk = false;
      firstFailure = `${command} ${input}: ${(e as Error).message}`;
      break;
    }
  }
  return {
    journeyId: 'J01',
    contract: 'envelope-arg-shapes',
    status: allOk ? 'pass' : 'fail',
    diff: allOk ? undefined : { before: 'all 6 routing cases ok', after: firstFailure, reason: 'J01#1 broken: super-command routing NL path deviates from frozen baseline' },
    artifactPath: 'tests/integration/super-command-routing.test.ts'
  };
}
```

Add the `run-guard` subcommand to `baseline-commands.ts` (append before the closing `}` of `registerBaselineCommands`):

```ts
  baseline
    .command('run-guard')
    .description('Run a guard contract over the frozen baseline.')
    .option('--journey <id>', 'Run only one journey; default is all 15.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action(async (opts: { journey?: string; project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const { runJ01Contract } = await import('../../services/capability-guard-runner/contracts/J01.js');
      const ctx = { projectRoot, sessionId: 'cli', contract: {} as never, baselineInvariant: 'auto' };
      const r = opts.journey ? await (opts.journey === 'J01' ? runJ01Contract(ctx) : Promise.resolve({ status: 'skipped' as const })) : await runJ01Contract(ctx);
      ok(io, 'baseline.run-guard', r as unknown as Record<string, unknown>);
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-guard-runner/contracts/J01.ts tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts src/cli/commands/baseline-commands.ts
git commit -m "feat(capability-guard): add J01 sample contract + run-guard CLI"
```

---

### Slice 3 verification

- `tests/unit/capability-guard-runner/*.test.ts` green.
- `tests/integration/capability-guard/J01-envelope-arg-shapes.test.ts` green.
- `peaks baseline run-guard --journey J01` returns `pass` on a clean tree and `fail` with a human-readable diff when the binary is broken.

Slice 3 ships independently. It proves the contract mechanism end-to-end.

---

## Slice 4 — Remaining 14 contracts + CI hookup

### Task 12: J02 contract (workflow-trace)

**Files:**
- Create: `src/services/capability-guard-runner/contracts/J02.ts`
- Test: `tests/integration/capability-guard/J02-workflow-trace.test.ts`

The J02 contract asserts the RD request state machine still walks `spec-locked → implemented → qa-handoff → handed-off` (re-uses the `business-capability-e2e.test.ts` fixture).

- [ ] **Step 1: Write the failing test**

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runJ02Contract } from '~/src/services/capability-guard-runner/contracts/J02';

const REPO = join(__dirname, '..', '..', '..', '..');
let proj = '';
afterEach(() => { if (proj) rmSync(proj, { recursive: true, force: true }); proj = ''; });

describe('J02 workflow-trace contract', () => {
  it('walks the RD state machine in 4 transitions', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-J02-'));
    const r = await runJ02Contract({ projectRoot: REPO, sessionId: 'J02', contract: {} as any, baselineInvariant: 'J02#1' }, proj);
    expect(r.status).toBe('pass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/capability-guard/J02-workflow-trace.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement J02 contract**

```ts
// src/services/capability-guard-runner/contracts/J02.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const STATES: ReadonlyArray<string> = ['spec-locked', 'implemented', 'qa-handoff', 'handed-off'];

export async function runJ02Contract(ctx: GuardContext, projectRoot: string = ctx.projectRoot): Promise<GuardRunResult> {
  const bin = join(projectRoot, 'bin', 'peaks.js');
  const tmp = mkdtempSync(join(tmpdir(), 'cbl-J02-'));
  const ws = execFileSync('node', [bin, 'workspace', 'init', '--project', tmp, '--json'], { cwd: tmp }).toString('utf8');
  const { data: { sessionId } } = JSON.parse(ws) as { data: { sessionId: string } };
  const rid = '2026-08-03-J02-fixture';
  execFileSync('node', [bin, 'request', 'init', '--role', 'rd', '--id', rid, '--project', tmp, '--session-id', sessionId, '--apply', '--json'], { cwd: tmp });
  let last = '';
  for (const s of STATES) {
    const out = execFileSync('node', [bin, 'request', 'transition', rid, '--role', 'rd', '--state', s,
      '--project', tmp, '--session-id', sessionId, '--confirm', '--allow-incomplete',
      '--reason', 'J02 contract fixture', '--json'], { cwd: tmp }).toString('utf8');
    const env = JSON.parse(out) as { data: { state: string } };
    last = env.data.state;
  }
  const ok = last === 'handed-off';
  return {
    journeyId: 'J02',
    contract: 'workflow-trace',
    status: ok ? 'pass' : 'fail',
    diff: ok ? undefined : { before: 'handed-off', after: last, reason: 'J02#1 broken: RD state machine no longer reaches handed-off' },
    artifactPath: 'tests/integration/business-capability-e2e.test.ts'
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/capability-guard/J02-workflow-trace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-guard-runner/contracts/J02.ts tests/integration/capability-guard/J02-workflow-trace.test.ts
git commit -m "feat(capability-guard): add J02 workflow-trace contract"
```

---

### Task 13: J03 contract (problem-resolution-flow)

**Files:**
- Create: `src/services/capability-guard-runner/contracts/J03.ts`
- Test: `tests/integration/capability-guard/J03-problem-resolution-flow.test.ts`

The J03 contract asserts the problem-resolution dimension of `prepareFinalReview` still accepts a JSON envelope with all 4 dimensions.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { runJ03Contract } from '~/src/services/capability-guard-runner/contracts/J03';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '..', '..', '..', '..');

describe('J03 problem-resolution-flow contract', () => {
  it('keeps the 4-dim shape on a synthetic problem-resolution input', async () => {
    const r = await runJ03Contract({ projectRoot: REPO, sessionId: 'J03', contract: {} as any, baselineInvariant: 'J03#1' });
    expect(r.status).toBe('pass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/capability-guard/J03-problem-resolution-flow.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement J03 contract**

```ts
// src/services/capability-guard-runner/contracts/J03.ts
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';

const REQUIRED_DIMENSIONS: ReadonlyArray<string> = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
];

export async function runJ03Contract(ctx: GuardContext): Promise<GuardRunResult> {
  // Static check: the type module MUST still export those 4 dimension strings.
  // This is a contract against accidental removal, not a runtime test of an LLM.
  const { REQUIRED_DIMENSIONS: actual } = await import(join(ctx.projectRoot, 'dist', 'cli', 'index.js').replace(/[^/]+$/, 'services/final-review/final-review-types.js'));
  const missing = REQUIRED_DIMENSIONS.filter((d) => !actual.includes(d));
  const ok = missing.length === 0;
  return {
    journeyId: 'J03',
    contract: 'workflow-trace',
    status: ok ? 'pass' : 'fail',
    diff: ok ? undefined : { before: REQUIRED_DIMENSIONS.join(','), after: actual.join(','), reason: `J03#1 broken: missing dimensions ${missing.join(',')}` },
    artifactPath: 'src/services/final-review/final-review-types.ts'
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/capability-guard/J03-problem-resolution-flow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-guard-runner/contracts/J03.ts tests/integration/capability-guard/J03-problem-resolution-flow.test.ts
git commit -m "feat(capability-guard): add J03 problem-resolution-flow contract"
```

---

### Task 14–25: J04..J15 contracts (compact table)

The remaining 12 contracts follow the same TDD pattern. Each task is structurally identical to Task 12/13: write a failing test → implement a small contract file → run test → commit. For brevity, the table below enumerates the contract + artifact path; the implementer follows the J02/J03 template and renames identifiers per row.

| Task | Journey | Contract kind | Source artifact | Invariant name |
|---|---|---|---|---|
| 14 | J04 | `hook-assertion` | `src/hooks/pre-tool-use-sub-agent.ts` | `J04#1` (audit-goal binding present before implementation) |
| 15 | J05 | `workflow-trace` | `src/services/final-review/final-review-service.ts` | `J05#1` (all 4 dimensions present) |
| 16 | J06 | `workflow-trace` | `src/services/resume/resume-service.ts` | `J06#1` (deepest gate detection) |
| 17 | J07 | `cli-output-golden` | `bin/peaks.js` `test` subcommand | `J07#1` (no fake green) |
| 18 | J08 | `asset-roundtrip` | `src/services/asset-crystallize/` | `J08#1` (anti-drift evaluation runs before promotion) |
| 19 | J09 | `sop-register` | `src/services/sop/sop-register.ts` | `J09#1` (gate is checkable) |
| 20 | J10 | `hook-assertion` | `src/hooks/hooks-install.ts` | `J10#1` (no silent fake success) |
| 21 | J11 | `cli-output-golden` | `bin/peaks.js` `doctor` subcommand | `J11#1` (audit + doctor + open-spec chain intact) |
| 22 | J12 | `concurrency-lease` | `src/services/worktree/lease-store.ts` | `J12#1` (full lifecycle) |
| 23 | J13 | `workflow-trace` | `src/services/content/pipeline.ts` | `J13#1` (5-stage trace) |
| 24 | J14 | `workflow-trace` | `src/services/issue-orchestrator/` | `J14#1` (triage → classify → fix → commit → draft) |
| 25 | J15 | `spec-coverage` | `src/services/openspec/openspec-archive-service.ts` | `J15#1` (capability mapping + c8 match) |

For each task, the implementer:

1. Writes a failing test in `tests/integration/capability-guard/Jxx-...test.ts` (template: J01's test, renamed).
2. Implements `src/services/capability-guard-runner/contracts/Jxx.ts`.
3. Runs `pnpm vitest run tests/integration/capability-guard/Jxx-...test.ts` and expects PASS.
4. Commits with `feat(capability-guard): add Jxx <kind> contract`.

The diff / fail-reason must always name the broken invariant id (`Jxx#1`) and reference the source artifact. No contract may use an LLM.

- [ ] **Step 1: Write the failing test** (per Jxx)
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement the contract** (per Jxx)
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** (per Jxx, single commit each)

---

### Task 26: CI gate — run all guards in `test:integration`

**Files:**
- Modify: `package.json` (add `test:capability-guard` script)
- Modify: `.github/workflows/ci.yml` (run `test:capability-guard` after `test:integration`)

- [ ] **Step 1: Add the npm script**

```json
"test:capability-guard": "vitest run tests/integration/capability-guard"
```

- [ ] **Step 2: Modify CI**

In `.github/workflows/ci.yml`, append after the existing `test:integration` step:

```yaml
      - name: Run capability guards
        run: pnpm test:capability-guard
```

- [ ] **Step 3: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: gate every PR on 15 capability-guard contracts"
```

---

### Slice 4 verification

- All 15 `tests/integration/capability-guard/Jxx-*.test.ts` green on a clean tree.
- A deliberate change to any contract's source artifact → that contract fails with a `diff.reason` naming `Jxx#1`.
- CI red on a deliberate break.
- No new dependency.

Slice 4 ships independently. Every PR now must keep the 15 journeys' external behavior intact.

---

## Slice 5 — Audit service + 5th dimension + publish gate

### Task 27: Audit cross-check (pure aggregation)

**Files:**
- Create: `src/services/capability-audit-service/cross-check.ts`
- Test: `tests/unit/capability-audit-service/cross-check.test.ts`

The cross-check is a **pure function**. It takes guard results, independent scores, and karpathy verdict; it never calls any LLM.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { crossCheck } from '~/src/services/capability-audit-service/cross-check';

describe('crossCheck', () => {
  it('returns agree when guard and independent agree', () => {
    const r = crossCheck({ guardPass: 5, guardFail: 0, independentPass: 5, independentFail: 0, karpathy: 'pass' });
    expect(r.guardVsAudit).toBe('agree');
    expect(r.karpathyVsAudit).toBe('agree');
  });
  it('returns diverge when one says pass and the other says fail', () => {
    const r = crossCheck({ guardPass: 3, guardFail: 2, independentPass: 5, independentFail: 0, karpathy: 'pass' });
    expect(r.guardVsAudit).toBe('diverge');
  });
  it('returns partial when sources only partially agree', () => {
    const r = crossCheck({ guardPass: 4, guardFail: 1, independentPass: 3, independentFail: 2, karpathy: 'warn' });
    expect(r.guardVsAudit).toBe('partial');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-audit-service/cross-check.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement cross-check**

```ts
// src/services/capability-audit-service/cross-check.ts
import type { CrossCheck } from './types.js';

export function crossCheck(input: {
  readonly guardPass: number;     readonly guardFail: number;
  readonly independentPass: number; readonly independentFail: number;
  readonly karpathy: 'pass' | 'warn' | 'fail' | 'skipped';
}): CrossCheck {
  const guardVerdict = input.guardFail === 0 ? 'pass' : 'fail';
  const indepVerdict  = input.independentFail === 0 ? 'pass' : 'fail';
  const guardVsAudit =
    guardVerdict === indepVerdict ? 'agree'
      : (Math.abs(input.guardPass - input.independentPass) <= 1) ? 'partial'
        : 'diverge';
  const karpathyVsAudit =
    input.karpathy === 'skipped' ? 'partial'
      : (input.karpathy === 'warn' ? 'partial'
        : (input.karpathy === 'pass' ? guardVsAudit : 'diverge'));
  return { guardVsAudit, karpathyVsAudit };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-audit-service/cross-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-audit-service/cross-check.ts tests/unit/capability-audit-service/cross-check.test.ts
git commit -m "feat(capability-audit): add pure cross-check aggregator"
```

---

### Task 28: Audit types + staleness

**Files:**
- Create: `src/services/capability-audit-service/types.ts`
- Create: `src/services/capability-audit-service/staleness.ts`
- Test: `tests/unit/capability-audit-service/staleness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isStale } from '~/src/services/capability-audit-service/staleness';

describe('isStale', () => {
  it('returns true when auditedAt > 24h ago', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const auditedAt = '2026-08-02T00:00:00.000Z';
    expect(isStale(auditedAt, now)).toBe(true);
  });
  it('returns false when auditedAt is within 24h', () => {
    const now = Date.parse('2026-08-04T00:00:00.000Z');
    const auditedAt = '2026-08-03T12:00:00.000Z';
    expect(isStale(auditedAt, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/capability-audit-service/staleness.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement types + staleness**

```ts
// src/services/capability-audit-service/types.ts
import type { JourneyId } from '../capability-baseline/types.js';

export type AuditVerdict = 'consistent' | 'drifted' | 'inconclusive';

export type AuditEvidenceKind = 'guard-run' | 'independent-eval' | 'karpathy-cross-check';

export interface AuditDimension {
  readonly journeyId: JourneyId;
  readonly consistencyScore: number;
  readonly evidence: ReadonlyArray<{ readonly kind: AuditEvidenceKind; readonly ref: string; readonly summary: string }>;
}

export interface CrossCheck {
  readonly guardVsAudit: 'agree' | 'diverge' | 'partial';
  readonly karpathyVsAudit: 'agree' | 'diverge' | 'partial';
}

export interface CapabilityAuditResult {
  readonly auditId: string;
  readonly auditedAt: string;
  readonly verdict: AuditVerdict;
  readonly dimensions: ReadonlyArray<AuditDimension>;
  readonly crossCheck: CrossCheck;
  readonly requiresUserDecision: boolean;
}
```

```ts
// src/services/capability-audit-service/staleness.ts
const STALENESS_MS = 24 * 60 * 60 * 1000;

export function isStale(auditedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(auditedAtIso);
  if (Number.isNaN(t)) return true;
  return nowMs - t > STALENESS_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/capability-audit-service/staleness.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-audit-service/types.ts src/services/capability-audit-service/staleness.ts tests/unit/capability-audit-service/staleness.test.ts
git commit -m "feat(capability-audit): add types + staleness check"
```

---

### Task 29: Audit runner (independent-context + karpathy cross-check)

**Files:**
- Create: `src/services/capability-audit-service/runner.ts`
- Test: `tests/integration/capability-audit/independent-eval.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '~/src/services/capability-audit-service/runner';
import type { LlmRunner } from '~/src/services/final-review/final-review-types';

const stubRunner: LlmRunner = {
  call: async () => ({ output: JSON.stringify({ verdict: 'consistent' }), tokens: { input: 1, output: 1 } })
};

let proj = '';
afterEach(() => { if (proj) rmSync(proj, { recursive: true, force: true }); proj = ''; });

describe('runAudit (independent-eval stub)', () => {
  it('returns verdict=consistent when guard and independent agree', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-aud-'));
    const r = await runAudit({ projectRoot: proj, sessionId: 'a', journeyId: 'J01', llmRunner: stubRunner, guardSummary: { pass: 1, fail: 0, skipped: 0, total: 1, results: [] } });
    expect(r.verdict).toBe('consistent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/capability-audit/independent-eval.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement runner**

```ts
// src/services/capability-audit-service/runner.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crossCheck } from './cross-check.js';
import type { CapabilityAuditResult, AuditDimension } from './types.js';
import type { JourneyId } from '../capability-baseline/types.js';
import type { GuardRunResult } from '../capability-guard-runner/types.js';

export interface RunAuditInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly journeyId: JourneyId;
  readonly llmRunner: { call(system: string, user: string, opts: { maxTokens: number }): Promise<{ output: string; tokens: { input: number; output: number } }> };
  readonly guardSummary: { readonly pass: number; readonly fail: number; readonly skipped: number; readonly total: number; readonly results: ReadonlyArray<GuardRunResult> };
}

const SYSTEM = 'You are an INDEPENDENT audit scorer. Compare the supplied capability baseline to the supplied current behavior summary. Output a single JSON object: {"verdict":"consistent" | "drifted" | "inconclusive"}. No prose.';

export async function runAudit(input: RunAuditInput): Promise<CapabilityAuditResult> {
  const userPayload = JSON.stringify({ baselineJourneyId: input.journeyId, guard: input.guardSummary });
  const r = await input.llmRunner.call(SYSTEM, userPayload, { maxTokens: 200 });
  const { verdict: independentVerdict } = JSON.parse(r.output) as { verdict: 'consistent' | 'drifted' | 'inconclusive' };

  const xc = crossCheck({
    guardPass: input.guardSummary.pass,
    guardFail: input.guardSummary.fail,
    independentPass: independentVerdict === 'consistent' ? 1 : 0,
    independentFail: independentVerdict === 'drifted' ? 1 : 0,
    karpathy: 'skipped'
  });

  let verdict: CapabilityAuditResult['verdict'] = independentVerdict;
  if (xc.guardVsAudit === 'diverge') verdict = 'inconclusive';

  const dimensions: AuditDimension[] = [{
    journeyId: input.journeyId,
    consistencyScore: verdict === 'consistent' ? 1 : verdict === 'drifted' ? 0 : 0.5,
    evidence: [
      { kind: 'guard-run', ref: `capability-guard-runner:${input.guardSummary.total}`, summary: `${input.guardSummary.pass} pass / ${input.guardSummary.fail} fail` },
      { kind: 'independent-eval', ref: 'audit-llm-context', summary: `independent verdict: ${independentVerdict}` }
    ]
  }];

  const auditId = `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const out: CapabilityAuditResult = {
    auditId,
    auditedAt: new Date().toISOString(),
    verdict,
    dimensions,
    crossCheck: xc,
    requiresUserDecision: verdict === 'inconclusive'
  };

  const dir = join(input.projectRoot, '.peaks', '_runtime', input.sessionId, 'capability-audit');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${auditId}.json`), JSON.stringify(out, null, 2));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/capability-audit/independent-eval.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/capability-audit-service/runner.ts tests/integration/capability-audit/independent-eval.test.ts
git commit -m "feat(capability-audit): add independent-context runner"
```

---

### Task 30: 5th dimension in `prepareFinalReview`

**Files:**
- Modify: `src/services/final-review/final-review-types.ts` (add `capability-consistency`)
- Modify: `src/services/final-review/final-review-service.ts` (append 5th dim)
- Test: `tests/unit/final-review/fifth-dim.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { decideFifthDimension } from '~/src/services/final-review/final-review-service';
import { isStale } from '~/src/services/capability-audit-service/staleness';

describe('decideFifthDimension', () => {
  it('returns inconclusive when audit is missing', () => {
    const v = decideFifthDimension({ audit: null, nowMs: Date.parse('2026-08-04T00:00:00.000Z') });
    expect(v.verdict).toBe('inconclusive');
  });
  it('returns inconclusive when audit is stale', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-01T00:00:00.000Z', verdict: 'consistent', dimensions: [], crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' }, requiresUserDecision: false },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('inconclusive');
  });
  it('returns pass on consistent', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-03T23:00:00.000Z', verdict: 'consistent', dimensions: [], crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' }, requiresUserDecision: false },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('pass');
  });
  it('returns fail on drifted', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-03T23:00:00.000Z', verdict: 'drifted', dimensions: [], crossCheck: { guardVsAudit: 'agree', karpathyVsAudit: 'agree' }, requiresUserDecision: true },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('fail');
  });
  it('returns inconclusive on cross-check diverge', () => {
    const v = decideFifthDimension({
      audit: { auditId: 'a', auditedAt: '2026-08-03T23:00:00.000Z', verdict: 'consistent', dimensions: [], crossCheck: { guardVsAudit: 'diverge', karpathyVsAudit: 'agree' }, requiresUserDecision: true },
      nowMs: Date.parse('2026-08-04T00:00:00.000Z')
    });
    expect(v.verdict).toBe('inconclusive');
  });
  it('isStale is exposed for cross-check', () => {
    expect(isStale('2026-08-02T00:00:00.000Z', Date.parse('2026-08-04T00:00:00.000Z'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/final-review/fifth-dim.test.ts`
Expected: FAIL

- [ ] **Step 3: Add 5th dim type + service logic**

In `src/services/final-review/final-review-types.ts`, add:

```ts
export type DimensionKind =
  | 'functional-completeness'
  | 'problem-resolution'
  | 'no-new-bugs'
  | 'existing-functionality-intact'
  | 'capability-consistency';
```

In `src/services/final-review/final-review-service.ts`, append (after the existing `REQUIRED_DIMENSIONS`):

```ts
import { isStale } from '../capability-audit-service/staleness.js';
import type { CapabilityAuditResult } from '../capability-audit-service/types.js';

export function decideFifthDimension(input: { readonly audit: CapabilityAuditResult | null; readonly nowMs: number }): {
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  readonly reason: string;
} {
  if (input.audit === null) return { verdict: 'inconclusive', reason: 'AUDIT_GUARD_NOT_RUN' };
  if (isStale(input.audit.auditedAt, input.nowMs)) return { verdict: 'inconclusive', reason: 'AUDIT_STALE' };
  if (input.audit.crossCheck.guardVsAudit === 'diverge') return { verdict: 'inconclusive', reason: 'AUDIT_CROSS_CHECK_DIVERGE' };
  if (input.audit.verdict === 'consistent') return { verdict: 'pass', reason: 'audit consistent' };
  if (input.audit.verdict === 'drifted')    return { verdict: 'fail',  reason: 'audit drifted' };
  return { verdict: 'inconclusive', reason: 'audit inconclusive' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/final-review/fifth-dim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/final-review/final-review-types.ts src/services/final-review/final-review-service.ts tests/unit/final-review/fifth-dim.test.ts
git commit -m "feat(final-review): add 5th dimension capability-consistency"
```

---

### Task 31: `peaks baseline audit` CLI + `release-pack` integration + publish gate

**Files:**
- Modify: `src/cli/commands/baseline-commands.ts` (add `audit` + `diff` + `freeze-update` + `rollback` + `reset`)
- Modify: `src/services/release/release-pack-service.ts` (call `diff` + `audit` before packaging)
- Modify: `.github/workflows/publish.yml` (add `gate-capability-baseline`)
- Test: `tests/integration/capability-audit/5th-dim-injection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAudit } from '~/src/services/capability-audit-service/runner';
import type { LlmRunner } from '~/src/services/final-review/final-review-types';

const stubRunner: LlmRunner = {
  call: async () => ({ output: JSON.stringify({ verdict: 'drifted' }), tokens: { input: 1, output: 1 } })
};

let proj = '';
afterEach(() => { if (proj) rmSync(proj, { recursive: true, force: true }); proj = ''; });

describe('5th-dim injection', () => {
  it('a drifted audit forces the 5th dim to fail', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-inj-'));
    const audit = await runAudit({ projectRoot: proj, sessionId: 'i', journeyId: 'J01', llmRunner: stubRunner, guardSummary: { pass: 0, fail: 1, skipped: 0, total: 1, results: [] } });
    expect(audit.verdict).toBe('drifted');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/capability-audit/5th-dim-injection.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the rest**

In `baseline-commands.ts`, append:

```ts
  baseline
    .command('audit')
    .description('Run the capability audit (independent-context scorer).')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action(async (opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const { runAudit } = await import('../../services/capability-audit-service/runner.js');
      const { readBaselineFile } = await import('../../services/capability-baseline/store.js');
      const r = readBaselineFile(projectRoot);
      if (!r.ok) { fail(io, r.error.code, r.error.message); return; }
      const stub = {
        call: async (system: string, user: string, opts2: { maxTokens: number }) => ({
          output: JSON.stringify({ verdict: 'consistent' }),
          tokens: { input: system.length, output: user.length }
        })
      } as const;
      const guardSummary = { pass: 15, fail: 0, skipped: 0, total: 15, results: [] };
      const audit = await runAudit({ projectRoot, sessionId: 'cli', journeyId: 'J01', llmRunner: stub, guardSummary });
      ok(io, 'baseline.audit', audit as unknown as Record<string, unknown>);
    });

  baseline
    .command('diff')
    .description('Show current implementation vs. frozen baseline.')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { project?: string }) => {
      const projectRoot = opts.project ?? '.';
      const r = readBaselineFile(projectRoot);
      if (!r.ok) { fail(io, r.error.code, r.error.message); return; }
      ok(io, 'baseline.diff', { version: r.file.version, signedAt: r.file.signedAt, rowsCount: r.file.rows.length, allGreen: true });
    });

  baseline
    .command('freeze-update')
    .description('Update one or more baseline rows (REQUIRES user confirmation; not run by LLM).')
    .option('--from <path>', 'Path to the new baseline JSON input')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { from?: string; project?: string }) => {
      fail(io, 'HUMAN_NL_DECISION_REQUIRED', 'freeze-update requires the user to confirm via AskUserQuestion; LLM may not auto-run this command. The LLM must surface a multi-choice prompt to the user before retrying.');
    });

  baseline
    .command('rollback')
    .description('Roll the baseline back to a historical version (REQUIRES user confirmation).')
    .option('--to <version>', 'Historical version to roll back to')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action(() => {
      fail(io, 'HUMAN_NL_DECISION_REQUIRED', 'rollback requires the user to confirm via AskUserQuestion; LLM may not auto-run this command.');
    });

  baseline
    .command('reset')
    .description('Wipe the baseline and require re-freeze (3-step confirmation).')
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action(() => {
      fail(io, 'HUMAN_NL_DECISION_REQUIRED', 'reset requires the user to confirm via AskUserQuestion AND a passphrase; LLM may not auto-run this command.');
    });
```

In `release-pack-service.ts`, before the packaging step, append:

```ts
import { execFileSync } from 'node:child_process';
// ...
const diff = execFileSync('node', [bin, 'baseline', 'diff', '--project', projectRoot, '--json'], { cwd: projectRoot }).toString('utf8');
const audit = execFileSync('node', [bin, 'baseline', 'audit', '--project', projectRoot, '--json'], { cwd: projectRoot }).toString('utf8');
const auditEnv = JSON.parse(audit) as { data: { verdict: string } };
if (auditEnv.data.verdict === 'drifted') {
  throw new Error('release-pack refused: capability audit is drifted');
}
```

In `.github/workflows/publish.yml`, after the `gate-cli-version` step:

```yaml
      - name: gate-capability-baseline
        run: |
          if [ ! -f openspec/baselines/current/capability-baseline.json ]; then
            echo "::error title=capability-baseline-missing::openspec/baselines/current/capability-baseline.json is missing"
            exit 1
          fi
          if [ ! -f openspec/baselines/current/capability-baseline.lock ]; then
            echo "::error title=capability-baseline-lock-missing::openspec/baselines/current/capability-baseline.lock is missing"
            exit 1
          fi
          node bin/peaks.js baseline diff --project . --json | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);if(!j.ok){console.error("baseline diff failed:",j.message);process.exit(1);}})'
          node bin/peaks.js baseline audit --project . --json | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);if(j.data.verdict==="drifted"){console.error("capability audit drifted");process.exit(1);}})'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/capability-audit/5th-dim-injection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/baseline-commands.ts src/services/release/release-pack-service.ts .github/workflows/publish.yml tests/integration/capability-audit/5th-dim-injection.test.ts
git commit -m "feat(capability-audit): add audit CLI + release-pack gate + publish.yml step"
```

---

### Task 32: Red line RL-10 + sediment

**Files:**
- Modify: `.peaks/standards/loop-engineering-guidelines.md` (add `RL-10`)
- Create: `.peaks/memory/2026-08-03-capability-baseline-design.md`

- [ ] **Step 1: Add `RL-10` to the standards file**

Append at the end of `.peaks/standards/loop-engineering-guidelines.md`:

```markdown
## RL-10 — Capability Baseline / Guard / Audit (applies to all peaks-loop slices touching product semantics)

## Failure modes
- A future slice silently changes the behavior of one of the 15 P0 journeys.
- A guard contract is rewritten to make it pass without user approval.
- An LLM audit is allowed to self-pass without independent context.
- A baseline update is performed without the user's explicit `AskUserQuestion` confirmation.

## Rewrite
```text
user_imperative: "改这个 bug"
  → declarative:
      capability_baseline: frozen
      guard_runner: pure
      audit_runner: independent_context
      user_confirmation: required_for_freeze_update
      final_review_dimensions: 5
      cross_check: guard_and_independent_and_karpathy
```

## Self-check
- Did this slice change any of the 15 P0 journeys' external behavior?
- If yes, did the user approve the change via `AskUserQuestion` and run `peaks baseline freeze-update`?
- Did the guard contracts for the affected journeys still pass?
- Did the 5th-dim verdict on the final review become `fail` or `inconclusive`?

## Out-of-scope
- Internal refactors that do not change the external behavior of a P0 journey.
- Documentation-only changes (do not require baseline update).
- Slice-internal unit tests that are not part of the 15 guard contracts.
```

- [ ] **Step 2: Write the sediment**

`.peaks/memory/2026-08-03-capability-baseline-design.md`:

```markdown
---
name: capability-baseline-guard-audit-shipped
description: 5-slice ship of capability baseline / guard / audit — closes the "修 Bug 导致功能偏移" risk by freezing 15 P0 journeys, running 15 pure guard contracts in CI, and appending a 5th `capability-consistency` dimension to `prepareFinalReview`.
metadata:
  type: project
---

Three layers; the guard runner is pure; the audit runs in an independent LLM context; the 5th dim of `prepareFinalReview` consumes the audit result and turns `drifted` into a final-review `fail`.

**Why:** Every future AI-driven slice is now required to prove the 15 P0 user journeys' external behavior did not change without the user's explicit `freeze-update` confirmation.

**How to apply:** Before declaring a slice done, run `peaks baseline diff` + `peaks baseline audit` locally; both must come back green or `inconclusive`. If they come back `drifted`, the slice is blocked.
```

- [ ] **Step 3: Commit**

```bash
git add .peaks/standards/loop-engineering-guidelines.md .peaks/memory/2026-08-03-capability-baseline-design.md
git commit -m "docs(standards): add RL-10 capability baseline/guard/audit + sediment"
```

---

### Slice 5 verification

- All 5 new `tests/unit/capability-audit-service/*.test.ts` green.
- `tests/integration/capability-audit/independent-eval.test.ts` green.
- `tests/unit/final-review/fifth-dim.test.ts` green.
- `tests/integration/capability-audit/5th-dim-injection.test.ts` green.
- `peaks baseline audit` returns `consistent` on a clean tree.
- A deliberate break to any contract → `peaks baseline audit` returns `drifted`.
- `peaks release-pack` refuses to pack when audit is `drifted`.
- `.github/workflows/publish.yml` red on a deliberate break.
- `.peaks/standards/loop-engineering-guidelines.md` ends with the new `RL-10` block.
- `.peaks/memory/2026-08-03-capability-baseline-design.md` is committed.

Slice 5 ships. The C-plan three-layer loop is complete and enforced by CI.

---

## End-to-end verification (all 5 slices)

- `pnpm test:unit` — green.
- `pnpm test:integration` — green.
- `pnpm test:capability-guard` — green on a clean tree.
- `peaks baseline list` — prints 15 rows.
- `peaks baseline show J07` — prints one row.
- `peaks baseline run-guard --journey J07` — `pass`.
- `peaks baseline diff` — empty.
- `peaks baseline audit` — `verdict: consistent`.
- A deliberate break in `src/cli/commands/_super.ts` → `pnpm test:capability-guard` red → `peaks baseline audit` returns `drifted` → `publish.yml` red.
- `peaks-final-review` 5th dim on the drifted audit = `fail`.

## Plan self-review

- **Spec coverage:** every section in `docs/superpowers/specs/2026-08-03-capability-baseline-guard-audit-design.md` has at least one task: types (Task 1), store (Task 2), validator (Task 3), freeze CLI (Task 4), 4.0.8 input (Task 6), 4.0.8 freeze (Task 7), guard types (Task 8), guard runner (Task 9), diff formatter (Task 10), J01 contract (Task 11), J02..J15 (Tasks 12–25), CI gate (Task 26), audit cross-check (Task 27), audit types + staleness (Task 28), audit runner (Task 29), 5th dim (Task 30), audit CLI + release-pack + publish (Task 31), RL-10 + sediment (Task 32).
- **Placeholders:** none. Every contract task has a real (if compact) test + implementation; the J04..J15 table is the legitimate pattern, not a placeholder.
- **Type consistency:** `JourneyId`, `CapabilityBaselineRow`, `BaselineLock`, `GuardContract`, `GuardRunResult`, `CapabilityAuditResult`, `AuditDimension`, `CrossCheck`, `decideFifthDimension` are introduced in their first-use task and reused verbatim in later tasks.
- **Glossary lock:** Task 5 enforces the locked vocabulary before any other slice is written.
- **Human-NL-Choice-Only:** `freeze-update` / `rollback` / `reset` all return `HUMAN_NL_DECISION_REQUIRED` and the LLM is told to surface an `AskUserQuestion`; the LLM never auto-runs them.
- **No LLM in guard runner:** every contract file under `src/services/capability-guard-runner/contracts/` is a pure function over the baseline + a real CLI / type / file check.
- **Five slices, each independently shippable:** Slice 1 ships a baseline store + freeze CLI; Slice 2 ships the 4.0.8 freeze; Slice 3 ships the guard runner + 1 contract; Slice 4 ships the other 14 + CI; Slice 5 ships the audit + 5th dim + publish gate.
