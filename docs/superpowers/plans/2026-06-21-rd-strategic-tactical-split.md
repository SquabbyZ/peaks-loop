# peaks-rd Strategic+Tactical Split Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split peaks-rd into two sub-stages — Strategic (root-cause analysis, design intent) and Tactical (minimal code + AST hard gate). Each sub-stage emits its own sig (STRAT.sig / TACT.sig). Tactical is gated by an AST check that compares LLM-written external API calls against peaks-context's locked-version doc summaries (no more "6.x API in 5.x project" silently passing).

**Architecture:** Add a `runStrategic` and `runTactical` entry point in rd-service. Both consume `context.json` (different audience views). Strategic produces `strategy.md` + STRAT.sig; Tactical produces `impl.json` + TACT.sig. Tactical runs the AST hard gate **before** writing TACT.sig — gate failure blocks, LLM auto-fixes, retries up to 3 cycles (peaks-qa's existing repair cap).

**Tech Stack:** TypeScript Compiler API (`typescript` package, already in devDeps), Zod, vitest. No new deps.

## Global Constraints

Inherited from Plan 1 + Plan 2:
- TypeScript ≥ 5.7 strict ESM
- File ≤ 800 lines (Karpathy #2)
- Slice ≤ 800 lines; `peaks slice check` green at each phase boundary
- Coverage ≥ 80% per module
- peaks-context cross-version isolation promise (Plan 1) MUST still pass
- peaks-mut MUT.sig chain (Plan 2) MUST still pass
- peaks-rd对外接口不变(solo 仍按 peaks-rd <args> 调)

## File Structure

```
src/services/rd/
  rd-service.ts                # (modify) split run() into runStrategic + runTactical
  strategic-stage.ts           # NEW: strategic sub-stage
  tactical-stage.ts            # NEW: tactical sub-stage
  ast-gate.ts                  # NEW: AST scanner that compares API calls to context.json docs
  strategy.ts                  # NEW: strategy.md writer + STRAT.sig computation
  impl.ts                      # NEW: impl.json writer + TACT.sig computation
  types.ts                     # NEW: StrategyOutput + ImplOutput + Zod schemas
src/skills/peaks-rd/
  SKILL.md                     # (modify) document 2 sub-stages
tests/unit/services/rd/
  strategic-stage.test.ts
  tactical-stage.test.ts
  ast-gate.test.ts             # ★ load-bearing: catches 6.x API in 5.x project
  rd-service.test.ts           # (modify) test new entry points
tests/integration/rd/
  end-to-end-split.test.ts     # full sub-stage flow
```

---

## Task 1: Define StrategyOutput + ImplOutput types + Zod

**Files:**
- Create: `src/services/rd/types.ts`
- Test: `tests/unit/services/rd/types.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/services/rd/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StrategyOutputSchema, ImplOutputSchema } from '../../../../src/services/rd/types.js';

describe('StrategyOutputSchema', () => {
  it('accepts valid strategy.md output', () => {
    const r = StrategyOutputSchema.safeParse({
      version: '1.0', sha256: 'a'.repeat(64),
      generatedAt: '2026-06-21T12:00:00Z',
      goal: 'add OAuth', rootCauseAnalysis: 'callback URL unknown',
      impactSurface: ['LoginForm.tsx'], designRationale: 'option B',
      askUserQuestion: { question: 'callback URL?', options: ['query', 'redirect'] },
    });
    expect(r.success).toBe(true);
  });
});

describe('ImplOutputSchema', () => {
  it('accepts valid impl.json', () => {
    const r = ImplOutputSchema.safeParse({
      version: '1.0', sha256: 'a'.repeat(64),
      generatedAt: '2026-06-21T12:00:00Z',
      inputSig: 'b'.repeat(64),
      changedFiles: ['src/oauth.ts'],
      externalApiCalls: [{ file: 'src/oauth.ts', line: 10, api: 'oauthClient.handle', version: '2.4.0' }],
      astGateResult: { passed: true, violations: [] },
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/rd/types.test.ts`

- [ ] **Step 3: Write `types.ts`**

```typescript
/**
 * Per spec §4.2 战略审计 + 战术审计 — sub-stage outputs.
 *
 * Hard constraint H8 (audit trail hashable): every output has sha256.
 * TACT.sig inputSig chain must reference STRAT.sig.
 */
import { z } from 'zod';

export const StrategyOutputSchema = z.object({
  version: z.literal('1.0'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  goal: z.string(),
  rootCauseAnalysis: z.string(),
  impactSurface: z.array(z.string()),
  designRationale: z.string(),
  askUserQuestion: z.object({
    question: z.string(),
    options: z.array(z.string()),
  }).optional(),
});
export type StrategyOutput = z.infer<typeof StrategyOutputSchema>;

export const AstViolationSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  api: z.string(),
  expectedVersion: z.string(),
  actualVersion: z.string(),
  severity: z.enum(['error', 'warning']),
});

export const AstGateResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(AstViolationSchema),
});

export const ExternalApiCallSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  api: z.string(),
  version: z.string(),
});

export const ImplOutputSchema = z.object({
  version: z.literal('1.0'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  inputSig: z.string().regex(/^[a-f0-9]{64}$/),  // STRAT.sig
  changedFiles: z.array(z.string()),
  externalApiCalls: z.array(ExternalApiCallSchema),
  astGateResult: AstGateResultSchema,
});
export type ImplOutput = z.infer<typeof ImplOutputSchema>;
export type AstViolation = z.infer<typeof AstViolationSchema>;
export type AstGateResult = z.infer<typeof AstGateResultSchema>;
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run tests/unit/services/rd/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/rd/types.ts tests/unit/services/rd/types.test.ts
git commit -m "feat(rd): StrategyOutput + ImplOutput types + Zod schemas"
```

---

## Task 2: AST hard gate — detect version-mismatched API calls (★ load-bearing)

**Files:**
- Create: `src/services/rd/ast-gate.ts`
- Test: `tests/unit/services/rd/ast-gate.test.ts`

**Interfaces:**
- Consumes: list of changed source files + context.json doc summaries (locked version per dep)
- Produces: `AstGateResult` (passed boolean + violations array)

- [ ] **Step 1: Write failing test**

Create `tests/unit/services/rd/ast-gate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAstGate } from '../../../../src/services/rd/ast-gate.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'peaks-astgate-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('runAstGate (★ load-bearing)', () => {
  it('passes when external API call uses the locked version', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'oauth.ts'), `
      import { handleCallback } from 'oauth-client';
      handleCallback({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/oauth.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback', 'init'] },
        ],
      },
    });
    expect(result.passed).toBe(true);
  });

  it('FAILS when external API call uses a non-locked version (★ core gate)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'oauth.ts'), `
      import { handleCallbackV3 } from 'oauth-client';
      handleCallbackV3({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/oauth.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback', 'init'] },
        ],
      },
    });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toMatchObject({
      api: 'handleCallbackV3',
      expectedVersion: '2.4.0',
    });
  });

  it('passes when no external API calls (pure local code)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'util.ts'), `
      export const add = (a: number, b: number) => a + b;
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/util.ts'],
      context: { deps: {}, docSummaries: [] },
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm vitest run tests/unit/services/rd/ast-gate.test.ts`

- [ ] **Step 3: Write `ast-gate.ts`**

```typescript
/**
 * Per spec §4.2 战术审计 — AST hard gate.
 *
 * Hard constraints:
 *   H6 (CLI裁决): gate result is computed by AST analysis, not LLM.
 *   H2 (locked version): any external API call whose name is NOT in the
 *       locked-version doc summary fails the gate.
 *
 * Implementation: TypeScript Compiler API for import + call expression
 * extraction. v1 uses regex for speed; production wiring migrates to
 * the Compiler API for accuracy.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AstGateResult, AstViolation, ExternalApiCall } from './types.js';

export interface AstGateContext {
  readonly deps: Readonly<Record<string, { readonly version: string; readonly source: string; readonly resolved: string }>>;
  readonly docSummaries: ReadonlyArray<{ readonly dep: string; readonly version: string; readonly apis: ReadonlyArray<string> }>;
}

export interface RunAstGateInput {
  readonly project: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly context: AstGateContext;
}

const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
const CALL_RE = /\b([a-zA-Z_$][\w$]*)\s*\(/g;

export async function runAstGate(input: RunAstGateInput): Promise<AstGateResult> {
  const violations: AstViolation[] = [];
  const externalCalls: ExternalApiCall[] = [];

  for (const file of input.changedFiles) {
    const fullPath = join(input.project, file);
    let content: string;
    try {
      content = await readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    // Find imports from external deps.
    const imports = [...content.matchAll(IMPORT_RE)];
    const importMap = new Map<string, string>(); // localName -> depName
    for (const imp of imports) {
      const depName = imp[2];
      if (input.context.deps[depName] === undefined) continue; // not an external dep
      const names = imp[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
      for (const n of names) {
        if (n) importMap.set(n, depName);
      }
    }

    // Find call expressions that match imported names.
    const calls = [...content.matchAll(CALL_RE)];
    for (const c of calls) {
      const name = c[1];
      const dep = importMap.get(name);
      if (!dep) continue;
      const idx = c.index ?? 0;
      const line = content.slice(0, idx).split('\n').length;

      const depVersion = input.context.deps[dep]?.version ?? '';
      const docSummary = input.context.docSummaries.find(
        (d) => d.dep === dep && d.version === depVersion,
      );
      const apis = docSummary?.apis ?? [];

      externalCalls.push({ file, line, api: name, version: depVersion });

      if (apis.length > 0 && !apis.includes(name)) {
        violations.push({
          file,
          line,
          api: name,
          expectedVersion: depVersion,
          actualVersion: 'unknown', // could resolve via npm view if needed
          severity: 'error',
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm vitest run tests/unit/services/rd/ast-gate.test.ts`
Expected: PASS, 3 tests pass (including ★ load-bearing test).

- [ ] **Step 5: Commit**

```bash
git add src/services/rd/ast-gate.ts tests/unit/services/rd/ast-gate.test.ts
git commit -m "feat(rd): AST hard gate — version-mismatched API detection (★ load-bearing)"
```

---

## Task 3: Strategy stage — write strategy.md + STRAT.sig

**Files:**
- Create: `src/services/rd/strategy.ts`
- Test: `tests/unit/services/rd/strategy.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStrategy } from '../../../../src/services/rd/strategy.js';

describe('writeStrategy', () => {
  it('writes strategy.md + computes STRAT.sig from content (excluding sig field)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-strategy-'));
    try {
      const out = await writeStrategy({
        out: join(workdir, 'strategy.md'),
        goal: 'add OAuth',
        rootCauseAnalysis: 'callback URL unknown',
        impactSurface: ['LoginForm.tsx'],
        designRationale: 'option B',
      });
      expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
      const onDisk = readFileSync(join(workdir, 'strategy.md'), 'utf8');
      expect(onDisk).toContain('add OAuth');
      expect(onDisk).toContain('STRAT.sig:');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Write `strategy.ts`**

```typescript
/**
 * Per spec §4.2 战略审计 — strategy.md writer + STRAT.sig computation.
 *
 * Hard constraints:
 *   H8 (audit trail hashable): sig field embedded in strategy.md is the
 *       sha256 of all OTHER content (chicken-and-egg avoided).
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { StrategyOutputSchema, type StrategyOutput } from './types.js';

export interface WriteStrategyInput {
  readonly out: string;
  readonly goal: string;
  readonly rootCauseAnalysis: string;
  readonly impactSurface: ReadonlyArray<string>;
  readonly designRationale: string;
  readonly askUserQuestion?: { readonly question: string; readonly options: ReadonlyArray<string> };
}

function sha256Of(content: object): string {
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function writeStrategy(input: WriteStrategyInput): Promise<StrategyOutput> {
  const partial = {
    version: '1.0' as const,
    sha256: '',
    generatedAt: new Date().toISOString(),
    goal: input.goal,
    rootCauseAnalysis: input.rootCauseAnalysis,
    impactSurface: input.impactSurface,
    designRationale: input.designRationale,
    ...(input.askUserQuestion ? { askUserQuestion: input.askUserQuestion } : {}),
  };
  const sha256 = sha256Of(partial);
  const final: StrategyOutput = { ...partial, sha256 };
  StrategyOutputSchema.parse(final);

  const body = [
    `# Strategy`,
    ``,
    `## Goal`,
    input.goal,
    ``,
    `## Root Cause Analysis`,
    input.rootCauseAnalysis,
    ``,
    `## Impact Surface`,
    input.impactSurface.map((s) => `- ${s}`).join('\n'),
    ``,
    `## Design Rationale`,
    input.designRationale,
    ...(input.askUserQuestion ? [``, `## Decision Needed`, `**${input.askUserQuestion.question}**`, ...input.askUserQuestion.options.map((o) => `- ${o}`)] : []),
    ``,
    `---`,
    `STRAT.sig: ${sha256}`,
  ].join('\n');

  const tmp = `${input.out}.tmp`;
  try {
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, input.out);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return final;
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm vitest run tests/unit/services/rd/strategy.test.ts`
Expected: PASS.

```bash
git add src/services/rd/strategy.ts tests/unit/services/rd/strategy.test.ts
git commit -m "feat(rd): Strategy stage — strategy.md + STRAT.sig"
```

---

## Task 4: Tactical stage — run AST gate + write impl.json + TACT.sig

**Files:**
- Create: `src/services/rd/impl.ts`
- Test: `tests/unit/services/rd/impl.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeImpl } from '../../../../src/services/rd/impl.js';
import type { AstGateResult } from '../../../../src/services/rd/types.js';

describe('writeImpl', () => {
  it('writes impl.json + computes TACT.sig chained to inputSig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const x = 1;\n');
      const astGate: AstGateResult = { passed: true, violations: [] };
      const out = await writeImpl({
        out: join(workdir, 'impl.json'),
        inputSig: 'a'.repeat(64),
        changedFiles: ['src/A.ts'],
        externalApiCalls: [],
        astGate,
      });
      expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(out.inputSig).toBe('a'.repeat(64));
      const onDisk = JSON.parse(readFileSync(join(workdir, 'impl.json'), 'utf8'));
      expect(onDisk.sha256).toBe(out.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('throws when AST gate failed — refuses to write TACT.sig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-impl-fail-'));
    try {
      const astGate: AstGateResult = {
        passed: false,
        violations: [{ file: 'src/X.ts', line: 1, api: 'fooV3', expectedVersion: '2.4.0', actualVersion: 'unknown', severity: 'error' }],
      };
      await expect(writeImpl({
        out: join(workdir, 'impl.json'),
        inputSig: 'a'.repeat(64),
        changedFiles: ['src/X.ts'],
        externalApiCalls: [],
        astGate,
      })).rejects.toThrow(/AST gate failed/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Write `impl.ts`**

```typescript
/**
 * Per spec §4.2 战术审计 — impl.json writer + TACT.sig computation.
 *
 * Hard constraints:
 *   H8 (audit trail hashable): TACT.sig chains from STRAT.sig via inputSig.
 *   H6 (CLI裁决): refuses to write when AST gate has violations —
 *       LLM MUST auto-fix and re-run.
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { ImplOutputSchema, type AstGateResult, type ExternalApiCall, type ImplOutput } from './types.js';

export interface WriteImplInput {
  readonly out: string;
  readonly inputSig: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly externalApiCalls: ReadonlyArray<ExternalApiCall>;
  readonly astGate: AstGateResult;
}

function sha256Of(content: object): string {
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function writeImpl(input: WriteImplInput): Promise<ImplOutput> {
  if (!input.astGate.passed) {
    throw new Error(
      `BLOCKED: AST gate failed — ${input.astGate.violations.length} violations. ` +
      'LLM MUST auto-fix and re-run before TACT.sig can be written. ' +
      '(spec §4.2 战术审计)'
    );
  }

  const partial = {
    version: '1.0' as const,
    sha256: '',
    generatedAt: new Date().toISOString(),
    inputSig: input.inputSig,
    changedFiles: [...input.changedFiles],
    externalApiCalls: [...input.externalApiCalls],
    astGateResult: input.astGate,
  };
  const sha256 = sha256Of(partial);
  const final: ImplOutput = { ...partial, sha256 };
  ImplOutputSchema.parse(final);

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

- [ ] **Step 3: Run + commit**

Run: `pnpm vitest run tests/unit/services/rd/impl.test.ts`
Expected: PASS.

```bash
git add src/services/rd/impl.ts tests/unit/services/rd/impl.test.ts
git commit -m "feat(rd): Tactical stage — AST gate + impl.json + TACT.sig"
```

---

## Task 5: Strategic-stage orchestrator

**Files:**
- Create: `src/services/rd/strategic-stage.ts`
- Test: `tests/unit/services/rd/strategic-stage.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStrategicStage } from '../../../../src/services/rd/strategic-stage.js';

describe('runStrategicStage', () => {
  it('produces strategy.md + STRAT.sig atomically', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-stratstage-'));
    try {
      const out = join(workdir, 'strategy.md');
      const result = await runStrategicStage({
        goal: 'add OAuth',
        rootCauseAnalysis: 'callback URL unknown',
        impactSurface: ['LoginForm.tsx'],
        designRationale: 'option B',
        out,
      });
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, 'utf8')).toContain('STRAT.sig');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Write `strategic-stage.ts`**

```typescript
/**
 * Per spec §4.2 战略审计 — orchestrator.
 * Pure pass-through to writeStrategy; this exists so the public rd-service
 * entry point is a single function (consistent with tactical-stage).
 */
import { writeStrategy, type WriteStrategyInput } from './strategy.js';
import type { StrategyOutput } from './types.js';

export type RunStrategicInput = WriteStrategyInput;

export async function runStrategicStage(input: RunStrategicInput): Promise<StrategyOutput> {
  return writeStrategy(input);
}
```

- [ ] **Step 3: Run + commit**

```bash
git add src/services/rd/strategic-stage.ts tests/unit/services/rd/strategic-stage.test.ts
git commit -m "feat(rd): Strategic-stage orchestrator (pass-through to strategy)"
```

---

## Task 6: Tactical-stage orchestrator (run AST gate, then write TACT.sig)

**Files:**
- Create: `src/services/rd/tactical-stage.ts`
- Test: `tests/unit/services/rd/tactical-stage.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTacticalStage } from '../../../../src/services/rd/tactical-stage.js';

describe('runTacticalStage', () => {
  it('runs AST gate then writes TACT.sig when gate passes', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { add } from './local';
        export const x = add(1, 2);
      `);
      const out = join(workdir, 'impl.json');
      const result = await runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: 'a'.repeat(64),
        context: { deps: {}, docSummaries: [] },
        out,
      });
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('throws when AST gate fails — does NOT write TACT.sig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-tactstage-fail-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), `
        import { unknownApi } from 'oauth-client';
        unknownApi();
      `);
      await expect(runTacticalStage({
        project: workdir,
        changedFiles: ['src/A.ts'],
        inputSig: 'a'.repeat(64),
        context: {
          deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
          docSummaries: [{ dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback'] }],
        },
        out: join(workdir, 'impl.json'),
      })).rejects.toThrow(/AST gate/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Write `tactical-stage.ts`**

```typescript
/**
 * Per spec §4.2 战术审计 — orchestrator.
 * Runs AST gate first; only writes TACT.sig if gate passes.
 */
import { runAstGate, type AstGateContext } from './ast-gate.js';
import { writeImpl } from './impl.js';
import type { ImplOutput } from './types.js';

export interface RunTacticalInput {
  readonly project: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly inputSig: string;
  readonly context: AstGateContext;
  readonly out: string;
}

export async function runTacticalStage(input: RunTacticalInput): Promise<ImplOutput> {
  const astGate = await runAstGate({
    project: input.project,
    changedFiles: input.changedFiles,
    context: input.context,
  });
  return writeImpl({
    out: input.out,
    inputSig: input.inputSig,
    changedFiles: input.changedFiles,
    externalApiCalls: [], // v1: AST gate emits violations; future slice maps to calls
    astGate,
  });
}
```

- [ ] **Step 3: Run + commit**

Run: `pnpm vitest run tests/unit/services/rd/tactical-stage.test.ts`
Expected: PASS, 2 tests pass.

```bash
git add src/services/rd/tactical-stage.ts tests/unit/services/rd/tactical-stage.test.ts
git commit -m "feat(rd): Tactical-stage orchestrator (AST gate → TACT.sig)"
```

---

## Task 7: Modify rd-service to dispatch sub-stages

**Files:**
- Modify: `src/services/rd/rd-service.ts`
- Modify: `tests/unit/services/rd/rd-service.test.ts`

- [ ] **Step 1: Read existing rd-service entry point**

Identify the public function (likely `runRd` or similar).

- [ ] **Step 2: Modify entry point**

The existing public function remains the same signature. Internally split:

```typescript
// Pseudocode — adapt to actual rd-service.
import { runStrategicStage } from './strategic-stage.js';
import { runTacticalStage } from './tactical-stage.js';
import { buildContext } from '../context/context-builder.js';

export async function runRd(input: RdInput): Promise<RdOutput> {
  const sid = input.sid;
  // Ensure context.json exists (Phase 1 wires this; v1 inline here).
  await buildContext({
    goal: input.goal, project: input.project,
    audience: 'peaks-rd', depsMode: 'locked',
    docBudgetTokens: 8000,
    out: `.peaks/_runtime/${sid}/context.json`,
    fetcher: headroomFetcher,
  });

  // Stage 1: Strategic.
  const stratOut = await runStrategicStage({
    out: `.peaks/_runtime/${sid}/strategy.md`,
    goal: input.goal,
    rootCauseAnalysis: await runStrategicLlm(input),  // LLM call here
    impactSurface: input.impactSurface,
    designRationale: input.designRationale,
  });

  // Stage 2: Tactical.
  const tactOut = await runTacticalStage({
    project: input.project,
    changedFiles: input.changedFiles,
    inputSig: stratOut.sha256,
    context: { deps: input.deps, docSummaries: input.docSummaries },
    out: `.peaks/_runtime/${sid}/impl.json`,
  });

  return { strategy: stratOut, impl: tactOut };
}
```

**Critical:** the existing public signature must remain backward-compatible. Tests that call `runRd(...)` with old args should still pass.

- [ ] **Step 3: Update existing rd-service tests**

Add a new test that asserts both STRAT.sig and TACT.sig are emitted.

- [ ] **Step 4: Run full vitest suite**

Run: `pnpm vitest run`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/services/rd/ tests/unit/services/rd/
git commit -m "refactor(rd): split into strategic + tactical sub-stages (sig chain)"
```

---

## Task 8: Update peaks-rd SKILL.md

**Files:**
- Modify: `src/skills/peaks-rd/SKILL.md`

- [ ] **Step 1: Add sub-stage documentation**

Append to the existing SKILL.md:

```markdown
## Sub-stages (Phase 3)

peaks-rd now runs in two sub-stages:

1. **Strategic** — root-cause analysis, design intent. Outputs `strategy.md` + `STRAT.sig`.
2. **Tactical** — minimal implementation. AST hard gate compares external API calls against peaks-context's locked-version docs. Outputs `impl.json` + `TACT.sig`.

Hard constraint: TACT.sig cannot be written when the AST gate has violations.
The LLM auto-fixes and retries (peaks-qa's 3-cycle repair cap).

Karpathy guidelines remain injected in both sub-stages.
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/peaks-rd/SKILL.md
git commit -m "docs(rd): SKILL.md notes for 2 sub-stages"
```

---

## Task 9: End-to-end integration test

**Files:**
- Create: `tests/integration/rd/end-to-end-split.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStrategicStage } from '../../../src/services/rd/strategic-stage.js';
import { runTacticalStage } from '../../../src/services/rd/tactical-stage.js';

describe('rd sub-stages end-to-end', () => {
  it('strategic → tactical → sig chain', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-rd-e2e-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const add = (a: number, b: number) => a + b;\n');
      const strat = await runStrategicStage({
        out: join(workdir, 'strategy.md'),
        goal: 'add add helper',
        rootCauseAnalysis: 'no local add helper',
        impactSurface: ['src/A.ts'],
        designRationale: 'trivial',
      });
      const tact = await runTacticalStage({
        project: workdir, changedFiles: ['src/A.ts'],
        inputSig: strat.sha256, context: { deps: {}, docSummaries: [] },
        out: join(workdir, 'impl.json'),
      });
      expect(tact.inputSig).toBe(strat.sha256);
      expect(existsSync(join(workdir, 'strategy.md'))).toBe(true);
      expect(existsSync(join(workdir, 'impl.json'))).toBe(true);
      expect(readFileSync(join(workdir, 'strategy.md'), 'utf8')).toContain(strat.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run tests/integration/rd/end-to-end-split.test.ts`
Expected: PASS.

```bash
git add tests/integration/rd/end-to-end-split.test.ts
git commit -m "test(rd): end-to-end strategic + tactical sub-stage chain"
```

---

## Task 10: Slice check + cross-version integration

**Files:**
- Create: `tests/integration/rd/ast-gate-cross-version.test.ts` (combines Plan 1 + Plan 3)

- [ ] **Step 1: Write integration test that exercises BOTH Plan 1 peaks-context and Plan 3 AST gate**

```typescript
/**
 * ★ Cross-version isolation: end-to-end — Plan 1 (context) + Plan 3 (gate).
 *
 * If peaks-context produces a context.json with 6.x API summaries despite
 * locked 5.x deps, AND the AST gate accepts that 6.x API, the two layers
 * are not aligned. This test pins that alignment.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectContext } from '../../../src/services/context/collector.js';
import { retrieveDocs } from '../../../src/services/context/doc-retriever.js';
import { runTacticalStage } from '../../../src/services/rd/tactical-stage.js';

describe('context + ast-gate alignment', () => {
  it('AST gate fails when LLM uses 6.x API in 5.x project (BOTH layers aligned)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-rd-xver-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'Login.tsx'), `
        import { Form } from 'antd';
        Form.item({ children: [] });
      `);
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo', dependencies: { antd: '5.21.0' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const collected = await collectContext({
        goal: 'add login form', project: workdir, depsMode: 'locked',
      });
      // DocRetriever returns 5.x summary (Form.Item, NOT Form.item).
      const docs = await retrieveDocs(collected.collector.deps, {
        fetcher: async (dep, version) => {
          if (dep === 'antd' && version === '5.21.0') {
            return { version: '5.21.0', excerpt: 'Form, Form.Item, Button' };
          }
          return null;
        },
      });
      const docSummaries = docs.fetchedDocs.map((d) => ({
        dep: d.dep, version: d.version,
        apis: [...new Set(d.sections.flatMap((s) => s.excerpt.split(/[\s,]+/)).filter(Boolean))],
      }));

      await expect(runTacticalStage({
        project: workdir,
        changedFiles: ['src/Login.tsx'],
        inputSig: 'a'.repeat(64),
        context: {
          deps: Object.fromEntries(
            Object.entries(collected.collector.deps).map(([k, v]) => [k, v]),
          ),
          docSummaries,
        },
        out: join(workdir, 'impl.json'),
      })).rejects.toThrow(/AST gate/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `pnpm vitest run tests/integration/rd/ast-gate-cross-version.test.ts`
Expected: PASS.

```bash
git add tests/integration/rd/ast-gate-cross-version.test.ts
git commit -m "test(rd): cross-version isolation end-to-end (context + AST gate aligned)"
```

---

## Task 11: Slice check + documentation

- [ ] **Step 1: Slice check**

```bash
pnpm tsc --noEmit
pnpm vitest run
peaks slice check --json
```

Expected: all green.

- [ ] **Step 2: Update README**

Append after peaks-mut section:

```markdown
## 🎯 peaks-rd 双阶段 (v3.0)

peaks-rd 现在拆成两阶段:

1. **战略审计**:写 `strategy.md` + `STRAT.sig`(根因分析 + 影响面)
2. **战术审计**:写 `impl.json` + `TACT.sig`,**AST 硬门禁拦截版本错配的 API 调用**

详见 [design spec §4.2](../../docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md)。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(rd): README entry for 2-sub-stage split"
```

---

## Self-Review

### Spec coverage vs Phase 3 ACs

| AC | Task |
|---|---|
| AC-1 Strategic produces STRAT.sig | Tasks 1 + 3 + 5 |
| AC-2 Tactical runs AST hard gate + produces TACT.sig | Tasks 1 + 2 + 4 + 6 |
| AC-3 Strategic failure blocks Tactical | Task 7 (rd-service sequencing) + Task 4 (impl.ts gate check) |
| AC-4 Karpathy 4 in both sub-stages | Inherited (rd-service change preserves injection) |

### Type consistency

- `StrategyOutput` / `ImplOutput` defined Task 1; consumed by Tasks 3–7
- `AstGateResult` (Task 1) → AST gate (Task 2) → tactical stage (Task 6)
- `inputSig` chain: STRAT.sig → TACT.sig inputSig (Tasks 4, 6, 7)

### File size

- Each new service file < 200 lines ✓
- Tests < 100 lines each ✓

## Execution Handoff

Plan complete. Two options:
1. Subagent-Driven (recommended)
2. Inline Execution

Which approach?