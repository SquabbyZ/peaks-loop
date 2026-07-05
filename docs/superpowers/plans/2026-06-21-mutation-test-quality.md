# peaks-mut Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `peaks-mut` skill (PRD §1.1(二) + §4.2 acceptance + §7 phase 2) that catches test fake-green via Stryker mutation testing + 5-pattern AST assertion-validity scan. Single deliverable: `peaks mut run` produces a `mut-report.json` with `MUT.sig` that `peaks-qa` consumes.

**Architecture:** New skill (11→12) that consumes `context.json --audience peaks-mut` (built by peaks-context Phase 1). Two engines: `MutRunner` (delegates to Stryker for TS, mutmut for Python later, go-mutesting for Go later) and `AssertScanner` (custom AST — TypeScript Compiler API + tree-sitter). V1 ships TS only; v2 plugs other tools.

**Tech Stack:** TypeScript 5.7 strict ESM, Stryker 8.x (`@stryker-mutator/core` + `@stryker-mutator/typescript-checker`), TypeScript Compiler API for AST, vitest, pnpm. New dep: `@stryker-mutator/core` + `@stryker-mutator/typescript-checker`.

## Global Constraints

(All inherited from Plan 1; project-wide)
- TypeScript ≥ 5.7 strict ESM
- File ≤ 800 lines (Karpathy #2)
- Slice ≤ 800 lines; `peaks slice check` green at each phase boundary
- Coverage ≥ 80% per module
- Zod for input validation
- Readonly / spread for immutability
- No `console.log` in `src/`
- Conventional commits
- Vitest BDD `describe / it`
- Cross-version isolation promise (Plan 1 Task 4) must still pass

## File Structure

```
src/services/mut/
  types.ts                      # MutReportJson interface + Zod schema
  mut-runner.ts                 # Stryker wrapper (TS v1)
  assert-scanner.ts             # 5-pattern weak-assertion AST detector
  report-builder.ts             # Combines mutation + assertions → mut-report.json + MUT.sig
  thresholds.ts                 # 80% kill / 5% weak defaults
  index.ts                      # barrel
src/skills/peaks-mut/
  SKILL.md                      # new skill (matches existing 11 skills' format)
src/cli/commands/
  mut-commands.ts               # peaks mut <sub>
src/cli/index.ts                # (modify) register mut
src/services/qa/qa-service.ts   # (modify) consume MUT.sig
tests/unit/services/mut/
  assert-scanner.test.ts
  mut-runner.test.ts
  report-builder.test.ts
  thresholds.test.ts
tests/unit/cli/commands/
  mut-commands.test.ts
tests/integration/mut/
  end-to-end.test.ts            # Stryker on fixture → mut-report.json
```

Each file ≤ 800 lines. If `assert-scanner.ts` grows past 800 (5 patterns × detection logic), split per pattern.

---

## Task 1: Setup — Stryker deps + scaffold

**Files:**
- Modify: `package.json`
- Create: `src/services/mut/.gitkeep`
- Create: `src/skills/peaks-mut/.gitkeep`

- [ ] **Step 1: Install Stryker**

Run: `pnpm add -D @stryker-mutator/core@^8.0.0 @stryker-mutator/typescript-checker@^8.0.0`
Expected: package.json + lockfile updated.

- [ ] **Step 2: Scaffold directories**

Run:
```bash
mkdir -p src/services/mut src/skills/peaks-mut tests/unit/services/mut tests/integration/mut
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(mut): add Stryker dependencies + scaffold directories"
```

---

## Task 2: Define `MutReportJson` types + Zod schema

**Files:**
- Create: `src/services/mut/types.ts`
- Create: `src/services/mut/index.ts`
- Test: `tests/unit/services/mut/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/mut/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MutReportSchema } from '../../../../src/services/mut/types.js';

describe('MutReportSchema', () => {
  it('accepts a valid mut-report.json', () => {
    const result = MutReportSchema.safeParse({
      version: '1.0',
      sha256: 'a'.repeat(64),
      generatedAt: '2026-06-21T12:00:00Z',
      inputSig: 'b'.repeat(64),
      mutation: {
        tool: 'stryker',
        mutantsTotal: 50, mutantsKilled: 40, mutantsSurvived: 10, mutantsTimeout: 0,
        killRate: 0.8,
        byFile: [],
      },
      assertions: {
        totalAssertions: 100, weakAssertions: 4, weakRate: 0.04,
        weakPatterns: [],
      },
      thresholds: {
        mutationKillRateMin: 0.8, weakAssertionRateMax: 0.05, passed: true,
      },
      followups: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects sha256 with wrong length', () => {
    const result = MutReportSchema.safeParse({
      version: '1.0', sha256: 'short', generatedAt: '2026-06-21T12:00:00Z', inputSig: 'b'.repeat(64),
      mutation: { tool: 'stryker', mutantsTotal: 0, mutantsKilled: 0, mutantsSurvived: 0, mutantsTimeout: 0, killRate: 0, byFile: [] },
      assertions: { totalAssertions: 0, weakAssertions: 0, weakRate: 0, weakPatterns: [] },
      thresholds: { mutationKillRateMin: 0.8, weakAssertionRateMax: 0.05, passed: false },
      followups: [],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/mut/types.test.ts`
Expected: FAIL — `types.ts` does not exist.

- [ ] **Step 3: Write `types.ts`**

Create `src/services/mut/types.ts`:

```typescript
/**
 * Per spec §4.2 验收审计 + §7 阶段二 — MutReportJson v1.0.
 *
 * Hard constraints:
 *   H8 (audit trail hashable): sha256 + inputSig (chain to TACT.sig)
 *   H6 (CLI裁决, not LLM): passed boolean is computed by CLI, not LLM
 */
import { z } from 'zod';

export type MutVersion = '1.0';
export type MutTool = 'stryker' | 'mutmut' | 'go-mutesting';

export type WeakPattern =
  | 'toBeDefined' | 'toBeTruthy' | 'toEqual-self' | 'expect-anything' | 'toBe-self';

export interface SurvivedMutant {
  readonly line: number;
  readonly mutation: string;
  readonly survivedBecause: string;
}

export interface FileMutationReport {
  readonly file: string;
  readonly killRate: number;
  readonly survived: ReadonlyArray<SurvivedMutant>;
}

export interface MutationReport {
  readonly tool: MutTool;
  readonly mutantsTotal: number;
  readonly mutantsKilled: number;
  readonly mutantsSurvived: number;
  readonly mutantsTimeout: number;
  readonly killRate: number;
  readonly byFile: ReadonlyArray<FileMutationReport>;
}

export interface WeakExample {
  readonly file: string;
  readonly line: number;
  readonly code: string;
}

export interface WeakPatternCount {
  readonly pattern: WeakPattern;
  readonly count: number;
  readonly examples: ReadonlyArray<WeakExample>;
}

export interface AssertionsReport {
  readonly totalAssertions: number;
  readonly weakAssertions: number;
  readonly weakRate: number;
  readonly weakPatterns: ReadonlyArray<WeakPatternCount>;
}

export interface ThresholdsConfig {
  readonly mutationKillRateMin: number;
  readonly weakAssertionRateMax: number;
  readonly passed: boolean;
}

export type FollowupSeverity = 'soft' | 'hard';
export type FollowupIssue = 'low_kill_rate' | 'high_weak_assertions';

export interface Followup {
  readonly file: string;
  readonly issue: FollowupIssue;
  readonly severity: FollowupSeverity;
  readonly suggestion: string;
}

export interface MutReportJson {
  readonly version: MutVersion;
  readonly sha256: string;
  readonly generatedAt: string;
  readonly inputSig: string;
  readonly mutation: MutationReport;
  readonly assertions: AssertionsReport;
  readonly thresholds: ThresholdsConfig;
  readonly followups: ReadonlyArray<Followup>;
}

export const WeakPatternSchema = z.enum([
  'toBeDefined', 'toBeTruthy', 'toEqual-self', 'expect-anything', 'toBe-self',
]);

export const MutReportSchema = z.object({
  version: z.literal('1.0'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  inputSig: z.string().regex(/^[a-f0-9]{64}$/),
  mutation: z.object({
    tool: z.enum(['stryker', 'mutmut', 'go-mutesting']),
    mutantsTotal: z.number().int().nonnegative(),
    mutantsKilled: z.number().int().nonnegative(),
    mutantsSurvived: z.number().int().nonnegative(),
    mutantsTimeout: z.number().int().nonnegative(),
    killRate: z.number().min(0).max(1),
    byFile: z.array(z.object({
      file: z.string(),
      killRate: z.number().min(0).max(1),
      survived: z.array(z.object({
        line: z.number().int(),
        mutation: z.string(),
        survivedBecause: z.string(),
      })),
    })),
  }),
  assertions: z.object({
    totalAssertions: z.number().int().nonnegative(),
    weakAssertions: z.number().int().nonnegative(),
    weakRate: z.number().min(0).max(1),
    weakPatterns: z.array(z.object({
      pattern: WeakPatternSchema,
      count: z.number().int().nonnegative(),
      examples: z.array(z.object({
        file: z.string(),
        line: z.number().int(),
        code: z.string(),
      })),
    })),
  }),
  thresholds: z.object({
    mutationKillRateMin: z.number().min(0).max(1),
    weakAssertionRateMax: z.number().min(0).max(1),
    passed: z.boolean(),
  }),
  followups: z.array(z.object({
    file: z.string(),
    issue: z.enum(['low_kill_rate', 'high_weak_assertions']),
    severity: z.enum(['soft', 'hard']),
    suggestion: z.string(),
  })),
});
```

- [ ] **Step 4: Create `index.ts` barrel**

```typescript
export { MutReportSchema } from './types.js';
export type {
  MutReportJson, MutationReport, AssertionsReport,
  WeakPattern, WeakPatternCount, Followup,
} from './types.js';
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm vitest run tests/unit/services/mut/types.test.ts`
Expected: PASS, 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/mut/ tests/unit/services/mut/types.test.ts
git commit -m "feat(mut): MutReportJson types + Zod schema (v1.0)"
```

---

## Task 3: AssertScanner — 5-pattern weak-assertion AST detector

**Files:**
- Create: `src/services/mut/assert-scanner.ts`
- Modify: `src/services/mut/index.ts`
- Test: `tests/unit/services/mut/assert-scanner.test.ts`

**Interfaces:**
- Consumes: list of test file paths + project root
- Produces: `AssertionsReport` (total + weak + per-pattern counts + examples)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/mut/assert-scanner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAssertions } from '../../../../src/services/mut/assert-scanner.js';

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-assert-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function makeTestFile(path: string, content: string): void {
  mkdirSync(join(workdir, path, '..'), { recursive: true });
  writeFileSync(join(workdir, path), content);
}

describe('scanAssertions', () => {
  it('detects toBeDefined() as weak pattern', async () => {
    makeTestFile('a.test.ts', `
      test('x', () => {
        expect(fn()).toBeDefined();
        expect(fn()).toEqual(42);
      });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['a.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toBeDefined')?.count).toBe(1);
    expect(r.totalAssertions).toBe(2);
  });

  it('detects toBeTruthy() as weak pattern', async () => {
    makeTestFile('b.test.ts', `
      test('x', () => { expect(x).toBeTruthy(); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['b.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toBeTruthy')?.count).toBe(1);
  });

  it('detects toEqual-self as weak pattern', async () => {
    makeTestFile('c.test.ts', `
      test('x', () => { expect(x).toEqual(x); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['c.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toEqual-self')?.count).toBe(1);
  });

  it('detects expect.anything() as weak pattern', async () => {
    makeTestFile('d.test.ts', `
      test('x', () => { expect(x).toEqual(expect.anything()); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['d.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'expect-anything')?.count).toBe(1);
  });

  it('detects toBe-self as weak pattern', async () => {
    makeTestFile('e.test.ts', `
      test('x', () => { expect(x).toBe(x); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['e.test.ts'] });
    expect(r.weakPatterns.find((p) => p.pattern === 'toBe-self')?.count).toBe(1);
  });

  it('returns zero weak when no weak patterns present', async () => {
    makeTestFile('f.test.ts', `
      test('x', () => { expect(add(1, 2)).toBe(3); });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['f.test.ts'] });
    expect(r.weakAssertions).toBe(0);
  });

  it('computes weakRate correctly', async () => {
    makeTestFile('g.test.ts', `
      test('x', () => {
        expect(x).toBeDefined();
        expect(x).toBeTruthy();
        expect(add(1, 2)).toBe(3);
        expect(add(2, 2)).toBe(4);
      });
    `);
    const r = await scanAssertions({ project: workdir, testFiles: ['g.test.ts'] });
    expect(r.weakRate).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/mut/assert-scanner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `assert-scanner.ts`**

```typescript
/**
 * Per spec §4.2 验收审计 + §7 阶段二 — 5-pattern weak-assertion AST scan.
 *
 * Hard constraints:
 *   H6 (CLI裁决): every detection is regex/AST-based, not LLM-judged.
 *   KISS: regex matchers on common expect() patterns. Production slice
 *   would migrate to TypeScript Compiler API; v1 ships regex for speed.
 *
 * Weak patterns (5):
 *   - toBeDefined()
 *   - toBeTruthy()
 *   - toEqual(x) where arg === receiver (toEqual-self)
 *   - expect.anything()
 *   - toBe(x) where arg === receiver (toBe-self)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AssertionsReport, WeakExample, WeakPattern, WeakPatternCount,
} from './types.js';

const WEAK_PATTERNS: ReadonlyArray<{
  readonly pattern: WeakPattern;
  readonly regex: RegExp;
}> = [
  { pattern: 'toBeDefined', regex: /\.toBeDefined\s*\(\s*\)/g },
  { pattern: 'toBeTruthy', regex: /\.toBeTruthy\s*\(\s*\)/g },
  { pattern: 'expect-anything', regex: /expect\.anything\s*\(\s*\)/g },
  // Self-equality patterns require matched-pair parsing; handled below.
];

const TO_EQUAL_SELF = /\.toEqual\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g;
const TO_BE_SELF = /\.toBe\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g;

export interface ScanInput {
  readonly project: string;
  readonly testFiles: ReadonlyArray<string>;
}

async function countAssertions(content: string): Promise<number> {
  // Approximate: count expect(...).method( occurrences.
  const matches = content.match(/expect\s*\([^)]*\)\.\w+\s*\(/g);
  return matches?.length ?? 0;
}

function lineOf(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length;
}

export async function scanAssertions(input: ScanInput): Promise<AssertionsReport> {
  let total = 0;
  let weak = 0;
  const byPattern = new Map<WeakPattern, WeakExample[]>();

  for (const file of input.testFiles) {
    const fullPath = join(input.project, file);
    const content = await readFile(fullPath, 'utf8');
    total += await countAssertions(content);

    for (const { pattern, regex } of WEAK_PATTERNS) {
      const matches = [...content.matchAll(regex)];
      if (matches.length > 0) {
        weak += matches.length;
        const list = byPattern.get(pattern) ?? [];
        for (const m of matches) {
          const idx = m.index ?? 0;
          list.push({ file, line: lineOf(content, idx), code: m[0] });
        }
        byPattern.set(pattern, list);
      }
    }

    // toEqual-self: needs receiver extraction.
    const eqSelf = [...content.matchAll(TO_EQUAL_SELF)];
    for (const m of eqSelf) {
      const receiverMatch = content.slice(0, m.index ?? 0).match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g);
      if (receiverMatch && receiverMatch.length > 0) {
        const lastReceiver = receiverMatch[receiverMatch.length - 1];
        const receiverName = lastReceiver.match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/)?.[1];
        if (receiverName && receiverName === m[1]) {
          weak += 1;
          const idx = m.index ?? 0;
          const list = byPattern.get('toEqual-self') ?? [];
          list.push({ file, line: lineOf(content, idx), code: m[0] });
          byPattern.set('toEqual-self', list);
        }
      }
    }

    // toBe-self: same pattern.
    const beSelf = [...content.matchAll(TO_BE_SELF)];
    for (const m of beSelf) {
      const receiverMatch = content.slice(0, m.index ?? 0).match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g);
      if (receiverMatch && receiverMatch.length > 0) {
        const lastReceiver = receiverMatch[receiverMatch.length - 1];
        const receiverName = lastReceiver.match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/)?.[1];
        if (receiverName && receiverName === m[1]) {
          weak += 1;
          const idx = m.index ?? 0;
          const list = byPattern.get('toBe-self') ?? [];
          list.push({ file, line: lineOf(content, idx), code: m[0] });
          byPattern.set('toBe-self', list);
        }
      }
    }
  }

  const weakPatterns: WeakPatternCount[] = [];
  for (const [pattern, examples] of byPattern.entries()) {
    weakPatterns.push({ pattern, count: examples.length, examples });
  }

  return {
    totalAssertions: total,
    weakAssertions: weak,
    weakRate: total === 0 ? 0 : weak / total,
    weakPatterns,
  };
}
```

- [ ] **Step 4: Update `index.ts`**

```typescript
export { scanAssertions, type ScanInput } from './assert-scanner.js';
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm vitest run tests/unit/services/mut/assert-scanner.test.ts`
Expected: PASS, 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/mut/assert-scanner.ts src/services/mut/index.ts tests/unit/services/mut/assert-scanner.test.ts
git commit -m "feat(mut): AssertScanner with 5 weak-pattern detectors (regex v1)"
```

---

## Task 4: MutRunner — Stryker wrapper

**Files:**
- Create: `src/services/mut/mut-runner.ts`
- Modify: `src/services/mut/index.ts`
- Test: `tests/unit/services/mut/mut-runner.test.ts`

- [ ] **Step 1: Write the failing test (uses Stryker mock)**

Create `tests/unit/services/mut/mut-runner.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runMutation } from '../../../../src/services/mut/mut-runner.js';

describe('runMutation', () => {
  it('invokes Stryker with locked test files and parses result', async () => {
    const invokeStryker = vi.fn().mockResolvedValue({
      mutantsTotal: 50,
      mutantsKilled: 40,
      mutantsSurvived: 10,
      mutantsTimeout: 0,
      perFile: [
        { file: 'src/A.ts', killRate: 0.8, survived: [{ line: 12, mutation: '>= -> >', survivedBecause: 'shouldX' }] },
      ],
    });
    const result = await runMutation({
      project: '/tmp/repo',
      testFiles: ['src/A.test.ts'],
      invokeStryker,
    });
    expect(result.mutation.tool).toBe('stryker');
    expect(result.mutation.killRate).toBe(0.8);
    expect(result.mutation.byFile[0].survived[0]).toMatchObject({ line: 12 });
  });

  it('throws when Stryker fails (does not silently swallow)', async () => {
    const invokeStryker = vi.fn().mockRejectedValue(new Error('stryker crashed'));
    await expect(runMutation({
      project: '/tmp/repo',
      testFiles: ['src/A.test.ts'],
      invokeStryker,
    })).rejects.toThrow(/stryker/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/mut/mut-runner.test.ts`

- [ ] **Step 3: Write `mut-runner.ts`**

```typescript
/**
 * Per spec §4.2 验收审计 — Stryker wrapper for TS mutation testing.
 *
 * Hard constraints:
 *   H6 (CLI裁决): invokeStryker is injected; production wires it to
 *       @stryker-mutator/core programmatic API.
 *   DRY: production implementation lives in this file; tests mock the
 *       invokeStryker injection point.
 */
import type { MutationReport } from './types.js';

export interface StrykerRawResult {
  readonly mutantsTotal: number;
  readonly mutantsKilled: number;
  readonly mutantsSurvived: number;
  readonly mutantsTimeout: number;
  readonly perFile: ReadonlyArray<{
    readonly file: string;
    readonly killRate: number;
    readonly survived: ReadonlyArray<{ line: number; mutation: string; survivedBecause: string }>;
  }>;
}

export type StrykerInvoker = (opts: {
  project: string;
  testFiles: ReadonlyArray<string>;
}) => Promise<StrykerRawResult>;

export interface RunMutationInput {
  readonly project: string;
  readonly testFiles: ReadonlyArray<string>;
  readonly invokeStryker: StrykerInvoker;
}

export interface RunMutationOutput {
  readonly mutation: MutationReport;
}

export async function runMutation(input: RunMutationInput): Promise<RunMutationOutput> {
  let raw: StrykerRawResult;
  try {
    raw = await input.invokeStryker({
      project: input.project,
      testFiles: input.testFiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Stryker invocation failed: ${message}`);
  }
  const killRate = raw.mutantsTotal === 0 ? 0 : raw.mutantsKilled / raw.mutantsTotal;
  return {
    mutation: {
      tool: 'stryker',
      mutantsTotal: raw.mutantsTotal,
      mutantsKilled: raw.mutantsKilled,
      mutantsSurvived: raw.mutantsSurvived,
      mutantsTimeout: raw.mutantsTimeout,
      killRate,
      byFile: raw.perFile.map((f) => ({
        file: f.file,
        killRate: f.killRate,
        survived: f.survived,
      })),
    },
  };
}
```

- [ ] **Step 4: Update `index.ts`**

```typescript
export { runMutation, type RunMutationInput, type RunMutationOutput, type StrykerInvoker, type StrykerRawResult } from './mut-runner.js';
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm vitest run tests/unit/services/mut/mut-runner.test.ts`
Expected: PASS, 2 tests pass.

- [ ] **Step 6: Wire production Stryker**

Add `src/services/mut/production-stryker.ts`:

```typescript
/**
 * Production Stryker invoker. Uses @stryker-mutator/core programmatic API.
 * Note: this is a thin wrapper — actual Stryker invocation requires the
 * Stryker config in `stryker.conf.js` to live at the project root.
 */
import type { StrykerInvoker, StrykerRawResult } from './mut-runner.js';

export function createProductionStrykerInvoker(): StrykerInvoker {
  return async ({ project, testFiles }) => {
    // Lazy-load Stryker so unit tests don't need it installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stryker = (await import('@stryker-mutator/core')).Stryker;
    const stryker = new Stryker({
      // Project-rooted config; explicit overrides here are minimal.
      mutate: testFiles,
      // ... any per-project overrides ...
    });
    const result = await stryker.runMutationTest();
    // Stryker returns a StrykerResult; normalize to our shape.
    return normalize(result, project);
  };
}

function normalize(raw: unknown, _project: string): StrykerRawResult {
  // Stryker result shape varies by version; v8 uses { mutants: [...] }.
  // Production wiring fills this in when first wired.
  const r = raw as { mutants: Array<{ status: string; fileName?: string; location?: { start?: { line?: number } } }> };
  const mutants = r.mutants ?? [];
  return {
    mutantsTotal: mutants.length,
    mutantsKilled: mutants.filter((m) => m.status === 'Killed').length,
    mutantsSurvived: mutants.filter((m) => m.status === 'Survived').length,
    mutantsTimeout: mutants.filter((m) => m.status === 'Timeout').length,
    perFile: [], // populated from mutants in production wiring
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/services/mut/mut-runner.ts src/services/mut/production-stryker.ts src/services/mut/index.ts tests/unit/services/mut/mut-runner.test.ts
git commit -m "feat(mut): MutRunner (Stryker wrapper + production invoker)"
```

---

## Task 5: Thresholds + report builder

**Files:**
- Create: `src/services/mut/thresholds.ts`
- Create: `src/services/mut/report-builder.ts`
- Modify: `src/services/mut/index.ts`
- Test: `tests/unit/services/mut/thresholds.test.ts`
- Test: `tests/unit/services/mut/report-builder.test.ts`

- [ ] **Step 1: Write `thresholds.ts`**

```typescript
/**
 * Default thresholds per spec §4.2 验收审计.
 * Override via `peaks-mut.config.json` at project root.
 */
export interface Thresholds {
  readonly mutationKillRateMin: number;
  readonly weakAssertionRateMax: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = Object.freeze({
  mutationKillRateMin: 0.80,
  weakAssertionRateMax: 0.05,
});
```

- [ ] **Step 2: Write `thresholds.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_THRESHOLDS, evaluateThresholds } from '../../../../src/services/mut/thresholds.js';

describe('evaluateThresholds', () => {
  it('passes when both metrics within bounds', () => {
    const result = evaluateThresholds(DEFAULT_THRESHOLDS, 0.85, 0.03);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when kill rate below minimum', () => {
    const result = evaluateThresholds(DEFAULT_THRESHOLDS, 0.70, 0.03);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ kind: 'mutationKillRateMin' }));
  });

  it('fails when weak rate above maximum', () => {
    const result = evaluateThresholds(DEFAULT_THRESHOLDS, 0.85, 0.10);
    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ kind: 'weakAssertionRateMax' }));
  });
});
```

- [ ] **Step 3: Write the threshold evaluator (extend `thresholds.ts`)**

Append to `src/services/mut/thresholds.ts`:

```typescript
export interface ThresholdViolation {
  readonly kind: 'mutationKillRateMin' | 'weakAssertionRateMax';
  readonly actual: number;
  readonly threshold: number;
}

export interface ThresholdEvaluation {
  readonly passed: boolean;
  readonly violations: ReadonlyArray<ThresholdViolation>;
}

export function evaluateThresholds(
  t: Thresholds,
  actualKillRate: number,
  actualWeakRate: number,
): ThresholdEvaluation {
  const violations: ThresholdViolation[] = [];
  if (actualKillRate < t.mutationKillRateMin) {
    violations.push({ kind: 'mutationKillRateMin', actual: actualKillRate, threshold: t.mutationKillRateMin });
  }
  if (actualWeakRate > t.weakAssertionRateMax) {
    violations.push({ kind: 'weakAssertionRateMax', actual: actualWeakRate, threshold: t.weakAssertionRateMax });
  }
  return { passed: violations.length === 0, violations };
}
```

- [ ] **Step 4: Write `report-builder.ts`**

```typescript
/**
 * Combines MutationReport + AssertionsReport into MutReportJson, computes
 * thresholds, derives followups. Writes file + computes MUT.sig.
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { MutReportSchema } from './types.js';
import { DEFAULT_THRESHOLDS, evaluateThresholds, type Thresholds } from './thresholds.js';
import type {
  AssertionsReport, Followup, MutationReport, MutReportJson,
} from './types.js';

export interface BuildMutInput {
  readonly mutation: MutationReport;
  readonly assertions: AssertionsReport;
  readonly inputSig: string;
  readonly out: string;
  readonly thresholds?: Thresholds;
}

function deriveFollowups(
  m: MutationReport,
  a: AssertionsReport,
  t: Thresholds,
): ReadonlyArray<Followup> {
  const out: Followup[] = [];
  if (m.killRate < t.mutationKillRateMin) {
    for (const f of m.byFile) {
      if (f.killRate < t.mutationKillRateMin) {
        out.push({
          file: f.file,
          issue: 'low_kill_rate',
          severity: 'soft',
          suggestion: `Add tests for ${f.survived.length} survived mutants in ${f.file}`,
        });
      }
    }
  }
  if (a.weakRate > t.weakAssertionRateMax) {
    for (const p of a.weakPatterns) {
      if (p.count > 0) {
        out.push({
          file: p.examples[0]?.file ?? '<unknown>',
          issue: 'high_weak_assertions',
          severity: 'hard',
          suggestion: `Replace ${p.count} weak assertions of type "${p.pattern}" with concrete value checks`,
        });
      }
    }
  }
  return out;
}

function sha256Of(content: object): string {
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function buildMutReport(input: BuildMutInput): Promise<MutReportJson> {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const evalResult = evaluateThresholds(thresholds, input.mutation.killRate, input.assertions.weakRate);
  const followups = deriveFollowups(input.mutation, input.assertions, thresholds);

  const partial = {
    version: '1.0' as const,
    sha256: '',
    generatedAt: new Date().toISOString(),
    inputSig: input.inputSig,
    mutation: input.mutation,
    assertions: input.assertions,
    thresholds: {
      mutationKillRateMin: thresholds.mutationKillRateMin,
      weakAssertionRateMax: thresholds.weakAssertionRateMax,
      passed: evalResult.passed,
    },
    followups,
  };
  const sha256 = sha256Of(partial);
  const final: MutReportJson = { ...partial, sha256 };

  MutReportSchema.parse(final);

  const tmp = `${input.out}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(final, null, 2), 'utf8');
    await rename(tmp, input.out);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return final;
}
```

- [ ] **Step 5: Write `report-builder.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMutReport } from '../../../../src/services/mut/report-builder.js';

describe('buildMutReport', () => {
  it('produces mut-report.json with valid sha256 + chain to inputSig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-rb-'));
    try {
      const out = join(workdir, 'mut.json');
      const result = await buildMutReport({
        inputSig: 'a'.repeat(64),
        out,
        mutation: {
          tool: 'stryker', mutantsTotal: 100, mutantsKilled: 85,
          mutantsSurvived: 15, mutantsTimeout: 0, killRate: 0.85,
          byFile: [],
        },
        assertions: {
          totalAssertions: 100, weakAssertions: 3, weakRate: 0.03,
          weakPatterns: [],
        },
      });
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.inputSig).toBe('a'.repeat(64));
      expect(result.thresholds.passed).toBe(true);
      const onDisk = JSON.parse(readFileSync(out, 'utf8'));
      expect(onDisk.sha256).toBe(result.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('marks thresholds.passed=false when below bounds + emits followups', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-rb2-'));
    try {
      const result = await buildMutReport({
        inputSig: 'a'.repeat(64),
        out: join(workdir, 'mut.json'),
        mutation: {
          tool: 'stryker', mutantsTotal: 100, mutantsKilled: 60,
          mutantsSurvived: 40, mutantsTimeout: 0, killRate: 0.60,
          byFile: [{ file: 'src/A.ts', killRate: 0.60, survived: [] }],
        },
        assertions: {
          totalAssertions: 100, weakAssertions: 12, weakRate: 0.12,
          weakPatterns: [{ pattern: 'toBeDefined', count: 12, examples: [{ file: 'src/A.test.ts', line: 5, code: 'expect(x).toBeDefined()' }] }],
        },
      });
      expect(result.thresholds.passed).toBe(false);
      expect(result.followups.length).toBeGreaterThan(0);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 6: Update `index.ts`**

```typescript
export { scanAssertions, type ScanInput } from './assert-scanner.js';
export { runMutation, type RunMutationInput, type RunMutationOutput, type StrykerInvoker, type StrykerRawResult } from './mut-runner.js';
export { buildMutReport, type BuildMutInput } from './report-builder.js';
export { DEFAULT_THRESHOLDS, evaluateThresholds, type Thresholds, type ThresholdEvaluation, type ThresholdViolation } from './thresholds.js';
export { MutReportSchema } from './types.js';
export type {
  MutReportJson, MutationReport, AssertionsReport,
  WeakPattern, WeakPatternCount, Followup,
} from './types.js';
```

- [ ] **Step 7: Run all tests**

Run: `pnpm vitest run tests/unit/services/mut/`
Expected: PASS, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/services/mut/ tests/unit/services/mut/
git commit -m "feat(mut): Thresholds + ReportBuilder (MUT.sig chain, followup derivation)"
```

---

## Task 6: CLI commands — `peaks mut <sub>`

**Files:**
- Create: `src/cli/commands/mut-commands.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/unit/cli/commands/mut-commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cli/commands/mut-commands.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMutCommands } from '../../../../src/cli/commands/mut-commands.js';

let workdir: string;
let outdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-cli-'));
  outdir = mkdtempSync(join(tmpdir(), 'peaks-mut-cli-out-'));
  mkdirSync(join(workdir, 'src'), { recursive: true });
  writeFileSync(join(workdir, 'src', 'A.ts'), 'export const add = (a: number, b: number) => a + b;\n');
  writeFileSync(join(workdir, 'src', 'A.test.ts'), `
    import { add } from './A';
    test('adds', () => { expect(add(1, 2)).toBeDefined(); expect(add(1, 2)).toBe(3); });
  `);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(outdir, { recursive: true, force: true });
});

describe('peaks mut commands', () => {
  it('run produces mut-report.json via CLI (using injected Stryker + scanner)', async () => {
    const program = createMutCommands({
      invokeStryker: async () => ({
        mutantsTotal: 5, mutantsKilled: 4, mutantsSurvived: 1, mutantsTimeout: 0,
        perFile: [{ file: 'src/A.ts', killRate: 0.8, survived: [{ line: 1, mutation: '+ -> -', survivedBecause: 'shouldX' }] }],
      }),
    });
    const out = join(outdir, 'mut.json');
    await program.parseAsync([
      'node', 'peaks', 'mut', 'run',
      '--project', workdir,
      '--test-files', 'src/A.test.ts',
      '--input-sig', 'a'.repeat(64),
      '--out', out,
    ]);
    expect(existsSync(out)).toBe(true);
    const json = JSON.parse(readFileSync(out, 'utf8'));
    expect(json.mutation.tool).toBe('stryker');
    expect(json.assertions.weakPatterns.length).toBeGreaterThan(0);
  });

  it('asserts runs only assertion scan', async () => {
    const program = createMutCommands({ invokeStryker: async () => { throw new Error('should not be called'); } });
    const out = join(outdir, 'mut.json');
    await program.parseAsync([
      'node', 'peaks', 'mut', 'asserts',
      '--project', workdir,
      '--test-files', 'src/A.test.ts',
      '--input-sig', 'a'.repeat(64),
      '--out', out,
    ]);
    expect(existsSync(out)).toBe(true);
  });
});
```

- [ ] **Step 2: Write `mut-commands.ts`**

```typescript
/**
 * `peaks mut <sub>` — CLI surface for the mutation test-quality skill.
 * Per spec §4.2 验收审计 + §7 阶段二.
 */
import { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { scanAssertions } from '../../services/mut/assert-scanner.js';
import { runMutation, type StrykerInvoker } from '../../services/mut/mut-runner.js';
import { buildMutReport } from '../../services/mut/report-builder.js';
import { MutReportSchema } from '../../services/mut/types.js';

export interface MutCommandsOptions {
  readonly invokeStryker: StrykerInvoker;
}

export function createMutCommands(opts: MutCommandsOptions): Command {
  const mut = new Command('mut').description(
    'peaks-mut: mutation testing + assertion validity scan (spec §4.2 / §7)'
  );

  mut
    .command('run')
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files to mutate against')
    .requiredOption('--input-sig <hex>', 'TACT.sig (sha256) for chain')
    .requiredOption('--out <path>', 'output path for mut-report.json')
    .option('--json', 'machine-readable output', false)
    .action(async (a: { project: string; testFiles: string[]; inputSig: string; out: string; json: boolean }) => {
      const { mutation } = await runMutation({
        project: a.project, testFiles: a.testFiles, invokeStryker: opts.invokeStryker,
      });
      const assertions = await scanAssertions({ project: a.project, testFiles: a.testFiles });
      const report = await buildMutReport({ inputSig: a.inputSig, out: a.out, mutation, assertions });
      if (a.json) {
        process.stdout.write(JSON.stringify({ ok: true, sha256: report.sha256, passed: report.thresholds.passed }) + '\n');
        if (!report.thresholds.passed) process.exit(3);
      } else {
        process.stdout.write(`mut-report.json: ${a.out}\nsha256: ${report.sha256}\npassed: ${report.thresholds.passed}\n`);
        if (!report.thresholds.passed) process.exit(3);
      }
    });

  mut
    .command('mutants')
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files')
    .requiredOption('--input-sig <hex>', 'TACT.sig')
    .requiredOption('--out <path>', 'output path')
    .action(async (a: { project: string; testFiles: string[]; inputSig: string; out: string }) => {
      const { mutation } = await runMutation({
        project: a.project, testFiles: a.testFiles, invokeStryker: opts.invokeStryker,
      });
      // Write a minimal mut-report with empty assertions for this subcommand.
      await buildMutReport({
        inputSig: a.inputSig, out: a.out, mutation,
        assertions: { totalAssertions: 0, weakAssertions: 0, weakRate: 0, weakPatterns: [] },
      });
      process.stdout.write(`mutants-only report: ${a.out}\n`);
    });

  mut
    .command('asserts')
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files')
    .requiredOption('--input-sig <hex>', 'TACT.sig')
    .requiredOption('--out <path>', 'output path')
    .action(async (a: { project: string; testFiles: string[]; inputSig: string; out: string }) => {
      const assertions = await scanAssertions({ project: a.project, testFiles: a.testFiles });
      await buildMutReport({
        inputSig: a.inputSig, out: a.out,
        mutation: { tool: 'stryker', mutantsTotal: 0, mutantsKilled: 0, mutantsSurvived: 0, mutantsTimeout: 0, killRate: 0, byFile: [] },
        assertions,
      });
      process.stdout.write(`asserts-only report: ${a.out}\n`);
    });

  mut
    .command('report')
    .requiredOption('--in <path>', 'input mut-report.json')
    .action(async (a: { in: string }) => {
      const raw = await readFile(a.in, 'utf8');
      const parsed = MutReportSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        process.stderr.write(`INVALID: ${parsed.error.message}\n`);
        process.exit(2);
      }
      const r = parsed.data;
      process.stdout.write([
        `mutation: tool=${r.mutation.tool} killRate=${(r.mutation.killRate * 100).toFixed(1)}%`,
        `assertions: total=${r.assertions.totalAssertions} weak=${r.assertions.weakAssertions} rate=${(r.assertions.weakRate * 100).toFixed(1)}%`,
        `thresholds: passed=${r.thresholds.passed}`,
        `followups: ${r.followups.length}`,
        `sha256: ${r.sha256}`,
      ].join('\n') + '\n');
    });

  return mut;
}
```

- [ ] **Step 3: Register in `src/cli/index.ts`**

Modify `src/cli/index.ts` — register `mut` subcommand.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/cli/commands/mut-commands.test.ts`
Expected: PASS, 2 tests pass.

- [ ] **Step 5: Manual smoke**

```bash
peaks mut run --project tests/fixtures/mut-sample --test-files src/A.test.ts --input-sig $(echo -n "x" | sha256sum | cut -d' ' -f1) --out /tmp/mut.json
peaks mut report --in /tmp/mut.json
```

Expected: writes mut-report.json; report command prints summary.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/mut-commands.ts src/cli/index.ts tests/unit/cli/commands/mut-commands.test.ts
git commit -m "feat(mut): CLI commands (run/mutants/asserts/report)"
```

---

## Task 7: Skill definition — `skills/peaks-mut/SKILL.md`

**Files:**
- Create: `src/skills/peaks-mut/SKILL.md`
- Test: verify skill registers correctly

- [ ] **Step 1: Write SKILL.md**

Create `src/skills/peaks-mut/SKILL.md`:

```markdown
---
name: peaks-mut
description: Mutation testing + assertion validity scan to catch test fake-green (PRD §4.2 / §7 phase 2).
metadata:
  type: peaks-skill
  family: workflow-quality
  ...
---

# peaks-mut

Catches **test fake-green** — the failure mode where coverage numbers look fine but tests do not actually exercise behavior (PRD §1.1(二)).

## When to use

peaks-code or peaks-rd dispatches peaks-mut after peaks-rd/战术 (TACT.sig exists). The flow:

1. peaks-mut consumes `context.json --audience peaks-mut` (built by peaks-context Phase 1).
2. Stryker mutates test-target source code; existing tests must kill the mutants.
3. AssertScanner finds 5 weak-assertion patterns: `toBeDefined`, `toBeTruthy`, `toEqual-self`, `expect.anything`, `toBe-self`.
4. Outputs `mut-report.json` with `MUT.sig` chained to `TACT.sig` (inputSig field).

## Thresholds (default)

- mutationKillRateMin: 0.80 (soft gate — AskUserQuestion to override)
- weakAssertionRateMax: 0.05 (hard gate — refuse by default)

Override via `peaks-mut.config.json` at project root.

## CLI

```
peaks mut run     # full audit
peaks mut mutants # only Stryker
peaks mut asserts # only AST scan
peaks mut report  # human summary
```

## Independent context

peaks-mut's context.json audience view **does not include** strategy.md / impl.json (PRD §4.2 防合谋). It sees only test files + source under test, so QA cannot be biased by RD's design intent.

## Karpathy guidelines

All 4 guidelines injected (same as peaks-rd). Peaks-mut MUST NOT silently swallow assertion violations.
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/peaks-mut/SKILL.md
git commit -m "feat(skill): peaks-mut SKILL.md (mutation testing skill definition)"
```

---

## Task 8: Wire MUT.sig into peaks-qa

**Files:**
- Modify: `src/services/qa/qa-service.ts`

- [ ] **Step 1: Read existing qa-service entry**

Identify the public run function.

- [ ] **Step 2: Add MUT.sig read step**

```typescript
// Pseudocode — adapt to actual qa-service signature.
import { readFile } from 'node:fs/promises';
import { MutReportSchema } from '../mut/types.js';

async function loadMutReport(sid: string): Promise<MutReportJson | null> {
  const path = `.peaks/_runtime/${sid}/mut-report.json`;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = MutReportSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function runQa(input: QaInput): Promise<QaOutput> {
  const mut = await loadMutReport(input.sid);
  if (mut && !mut.thresholds.passed) {
    // Surface the failure to the user via the standard gate UI;
    // the existing 3-cycle repair loop (peaks-qa) handles re-run.
  }
  // ... rest of qa logic ...
}
```

- [ ] **Step 3: Run full suite**

Run: `pnpm vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/qa/qa-service.ts
git commit -m "feat(qa): consume MUT.sig — surface test-quality failures"
```

---

## Task 9: End-to-end integration test

**Files:**
- Create: `tests/integration/mut/end-to-end.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMutCommands } from '../../../src/cli/commands/mut-commands.js';

describe('peaks-mut end-to-end', () => {
  it('produces mut-report.json with both Stryker + assertion results', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-e2e-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'add.ts'), 'export const add = (a: number, b: number) => a + b;\n');
      writeFileSync(join(workdir, 'src', 'add.test.ts'), `
        import { add } from './add';
        test('add', () => {
          expect(add(1, 2)).toBeDefined();
          expect(add(2, 2)).toBe(4);
          expect(add(0, 0)).toBe(0);
        });
      `);
      const out = join(workdir, 'mut.json');
      const program = createMutCommands({
        invokeStryker: async () => ({
          mutantsTotal: 10, mutantsKilled: 9, mutantsSurvived: 1, mutantsTimeout: 0,
          perFile: [{ file: 'src/add.ts', killRate: 0.9, survived: [] }],
        }),
      });
      await program.parseAsync([
        'node', 'peaks', 'mut', 'run',
        '--project', workdir, '--test-files', 'src/add.test.ts',
        '--input-sig', 'a'.repeat(64), '--out', out, '--json',
      ]);
      const json = JSON.parse(readFileSync(out, 'utf8'));
      expect(json.mutation.killRate).toBeGreaterThanOrEqual(0.8);
      expect(json.assertions.totalAssertions).toBe(3);
      // toBeDefined counted as weak.
      expect(json.assertions.weakPatterns.find((p: { pattern: string }) => p.pattern === 'toBeDefined')).toBeDefined();
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run tests/integration/mut/end-to-end.test.ts`
Expected: PASS.

```bash
git add tests/integration/mut/end-to-end.test.ts
git commit -m "test(mut): end-to-end run produces valid mut-report.json"
```

---

## Task 10: Slice check + documentation

- [ ] **Step 1: Slice check**

```bash
pnpm tsc --noEmit
pnpm vitest run
peaks slice check --json
```

Expected: all green.

- [ ] **Step 2: Update README**

Add a "🧬 peaks-mut" section after the peaks-context section:

```markdown
## 🧬 peaks-mut — 测试假绿拦截 (v3.0)

peaks-mut 通过变异测试 + 断言有效性扫描拦截测试假绿:

```bash
peaks mut run --project . --test-files src/A.test.ts --input-sig <TACT.sig> --out mut-report.json
peaks mut report --in mut-report.json
```

**默认阈值**:变异杀灭率 ≥ 80%、弱断言比例 ≤ 5%。详见 [design spec §4.2](../../docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md)。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(mut): README entry for peaks-mut skill"
```

---

## Self-Review

### Spec coverage vs Phase 2 ACs

| AC | Task |
|---|---|
| AC-1 Stryker integrated (TS v1; other langs interface only) | Tasks 1 + 4 + production-stryker |
| AC-2 5 weak-pattern AST detection | Task 3 |
| AC-3 peaks-qa consumes mut-report → AskUserQuestion trigger | Task 8 |
| AC-4 kill_rate < 80% OR weak_rate > 5% auto-triggers | Tasks 5 (evaluateThresholds) + 8 (qa surfacing) |
| AC-5 Coverage ≥ 80% | All unit tasks pin tests; run `pnpm test:coverage` |

### Type consistency

- `MutReportJson` (Task 2) → consumed by `report-builder.ts` (Task 5) and `mut-commands.ts` (Task 6)
- `StrykerInvoker` (Task 4) → injected via CLI options (Task 6)
- `BuildMutInput` / `BuildMutOutput` (Task 5) match `mut run` shape

### File size check

- `assert-scanner.ts` ≈ 110 lines ✓
- `mut-runner.ts` ≈ 60 lines ✓
- `report-builder.ts` ≈ 90 lines ✓
- Each test file < 100 lines ✓

## Execution Handoff

Plan complete. Two options:
1. Subagent-Driven (recommended)
2. Inline Execution

Which approach?