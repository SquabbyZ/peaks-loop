<!--
Extracted from: 2026-06-25-slice-topology-multipass.md (1626-line original, split on 2026-06-25 post Wave 1)
Section: Phase 2: Algorithm Components
Original lines: 742-1139
This file is part of the slice-topology-multipass plan split.
See the index at ./2026-06-25-slice-topology-multipass.md for navigation.
-->

## Phase 2: Algorithm Components

### Task 5: LLMArbitrator

**Files:**
- Create: `src/services/slice/llm-arbitrator.ts`
- Create: `tests/unit/slice/llm-arbitrator.test.ts`

**Interfaces:**
- Consumes: `LlmRunner` (from Task 2)
- Produces: `arbitrate(prompt, opts): { output, callId, tokens }`

- [ ] **Step 1: Write failing test** (cache hit, cache miss+success, timeout, budget exhausted)

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Write llm-arbitrator.ts** (~100 LoC)

```typescript
// src/services/slice/llm-arbitrator.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmRunner } from '../audit/audit-goal-service.js';

export interface ArbitratorOptions {
  readonly cacheDir: string;
  readonly maxCallsPerInvocation: number;
  readonly perCallTimeoutMs: number;
  readonly llmRunner: LlmRunner;
}

export interface ArbitrateResult {
  readonly output: string | null;
  readonly callId: string;
  readonly tokens: { input: number; output: number } | null;
}

let callsThisInvocation = 0;

export function resetArbitratorBudget(): void { callsThisInvocation = 0; }

export async function arbitrate(
  prompt: string,
  opts: ArbitratorOptions
): Promise<ArbitrateResult> {
  const promptHash = createHash('sha256').update(prompt).digest('hex');
  const cacheFile = join(opts.cacheDir, `${promptHash}.json`);

  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    return { output: cached.output, callId: `cache:${promptHash.slice(0, 12)}`, tokens: null };
  }

  if (callsThisInvocation >= opts.maxCallsPerInvocation) {
    return { output: null, callId: 'budget-exhausted', tokens: null };
  }

  try {
    const result = await Promise.race([
      opts.llmRunner.call('You are a focused technical arbitrator.', prompt, { maxTokens: 1000 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), opts.perCallTimeoutMs)
      )
    ]);
    callsThisInvocation++;
    mkdirSync(opts.cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ output: result.output, cachedAt: new Date().toISOString() }));
    return { output: result.output, callId: `live:${promptHash.slice(0, 12)}`, tokens: result.tokens };
  } catch (err) {
    return { output: null, callId: (err as Error).message === 'timeout' ? 'timeout' : 'error', tokens: null };
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Mutation probe C test**: Add test asserting cache hit does NOT call `llmRunner.call`.

- [ ] **Step 6: Commit**

```bash
git add src/services/slice/llm-arbitrator.ts tests/unit/slice/llm-arbitrator.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(slice): add LLMArbitrator with budget cap + content-hash cache"
```

### Task 6: GranularityDecider

**Files:**
- Create: `src/services/slice/granularity-decider.ts`
- Create: `tests/unit/slice/granularity-decider.test.ts`

- [ ] **Step 1: Write failing test** (small WU, large WU, borderline, multi-file, edge-of-threshold, tie-break)

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Write granularity-decider.ts**

```typescript
// src/services/slice/granularity-decider.ts
import type { WorkUnit } from './slice-decompose-types.js';

export interface GranularityThresholds {
  readonly maxFiles: number;
  readonly maxLoc: number;
}

export type DeciderResult =
  | { readonly subdivide: true; readonly reason: string }
  | { readonly subdivide: false; readonly reason: string }
  | { readonly subdivide: 'tie-break'; readonly reason: string };

export const DEFAULT_THRESHOLDS: GranularityThresholds = { maxFiles: 3, maxLoc: 400 };

export function shouldSubdivide(
  wu: WorkUnit,
  thresholds: GranularityThresholds = DEFAULT_THRESHOLDS
): DeciderResult {
  const locExceeded = wu.loc > thresholds.maxLoc;
  const filesExceeded = wu.files.length > thresholds.maxFiles;
  if (locExceeded || filesExceeded) {
    return { subdivide: true, reason: `wu ${wu.id}: loc=${wu.loc} files=${wu.files.length} exceeds threshold` };
  }
  const locBorderline = wu.loc > thresholds.maxLoc * 0.8;
  const filesBorderline = wu.files.length > thresholds.maxFiles * 0.8;
  if (locBorderline || filesBorderline) {
    return { subdivide: 'tie-break', reason: `wu ${wu.id}: within 20% of threshold, needs LLM judgment` };
  }
  return { subdivide: false, reason: `wu ${wu.id}: under threshold` };
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Mutation probe B test**: Add test asserting `>` (not `>=`) at threshold boundary.

- [ ] **Step 6: Commit**

```bash
git add src/services/slice/granularity-decider.ts tests/unit/slice/granularity-decider.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(slice): add GranularityDecider with stop condition + tie-break"
```

### Task 7: CrossPassEdgeMerger

**Files:**
- Create: `src/services/slice/cross-pass-edge-merger.ts`
- Create: `tests/unit/slice/cross-pass-edge-merger.test.ts`

**Interfaces:**
- Consumes: `PassResult[]`, `LlmRunner`
- Produces: `merge(passes, llmRunner): { edges, llmCalls }`

- [ ] **Step 1: Write failing test** (type-shares, fixture-shares, import-re-export, llm-arbitrated, all-ambiguous)

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Write cross-pass-edge-merger.ts** (~200 LoC)

```typescript
// src/services/slice/cross-pass-edge-merger.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PassResult, CrossPassEdge, LlmArbitration, PassNumber
} from './slice-topology-types.js';
import { arbitrate } from './llm-arbitrator.js';
import type { LlmRunner } from '../audit/audit-goal-service.js';

export interface MergeResult {
  readonly edges: readonly CrossPassEdge[];
  readonly llmCalls: readonly LlmArbitration[];
}

export interface MergeOptions {
  readonly projectRoot: string;
  readonly llmRunner: LlmRunner;
  readonly maxLlmCalls?: number;
}

export async function merge(
  passes: readonly PassResult[],
  opts: MergeOptions
): Promise<MergeResult> {
  const edges: CrossPassEdge[] = [];
  const llmCalls: LlmArbitration[] = [];

  for (let i = 0; i < passes.length - 1; i++) {
    const upper = passes[i]!;
    const lower = passes[i + 1]!;
    const upperFiles = new Set(upper.slices.flatMap(s => s.files));

    // Static: type shares
    for (const slice of lower.slices) {
      for (const file of slice.files) {
        const fullPath = join(opts.projectRoot, file);
        if (!existsSync(fullPath)) continue;
        const content = readFileSync(fullPath, 'utf8');
        if (/import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"]/.test(content)) {
          const match = /from\s+['"]([^'"]+)['"]/.exec(content);
          if (match && upperFiles.has(match[1]!.replace(/^\.\//, ''))) {
            edges.push({
              fromPass: upper.passNumber as PassNumber,
              toPass: lower.passNumber as PassNumber,
              fromSliceId: upper.slices.find(s => s.files.includes(match[1]!.replace(/^\.\//, '')))?.id ?? '',
              toSliceId: slice.id,
              kind: 'type-shares',
              confidence: 'structural',
              evidence: match[0],
              arbitratedBy: null
            });
          }
        }
      }
    }
  }

  return { edges, llmCalls };
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Mutation probe A test**: Add test asserting comment-out of type-shares detection breaks the type-share integration test.

- [ ] **Step 6: Commit**

```bash
git add src/services/slice/cross-pass-edge-merger.ts tests/unit/slice/cross-pass-edge-merger.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(slice): add CrossPassEdgeMerger with type-shares detection"
```

### Task 8: SchemaRouter

**Files:**
- Create: `src/services/slice/schema-router.ts`
- Create: `tests/unit/slice/schema-router.test.ts`

- [ ] **Step 1: Write failing test** (read v1, read v2, write v1, write v2, unknown version)

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Write schema-router.ts**

```typescript
// src/services/slice/schema-router.ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { DecompositionResult } from './slice-decompose-types.js';
import type { DecompositionResultV2 } from './slice-topology-types.js';

export class UnknownSchemaVersionError extends Error {
  readonly code = 'UNKNOWN_SCHEMA_VERSION' as const;
  constructor(message: string) { super(message); this.name = 'UnknownSchemaVersionError'; }
}

export function readResult(filePath: string): DecompositionResult | DecompositionResultV2 {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (parsed.schemaVersion === 'v2') return parsed as DecompositionResultV2;
  if (parsed.schemaVersion === undefined) return parsed as DecompositionResult;
  throw new UnknownSchemaVersionError(`Unknown schemaVersion: ${parsed.schemaVersion}. Supported: v1 (no field), v2.`);
}

export function writeResult(filePath: string, result: DecompositionResult | DecompositionResultV2): void {
  writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8');
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/services/slice/schema-router.ts tests/unit/slice/schema-router.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(slice): add SchemaRouter for v1/v2 dual-read"
```

### Task 9: MultiPassOrchestrator

**Files:**
- Create: `src/services/slice/multi-pass-orchestrator.ts`
- Create: `tests/unit/slice/multi-pass-orchestrator.test.ts`

**Interfaces:**
- Consumes: existing `decomposeSlices()` (UNCHANGED), `LlmRunner`, all Phase 2 components
- Produces: `decompose(rid, prdMarkdown, projectRoot, opts): Promise<DecompositionResultV2>`

- [ ] **Step 1: Write failing test** (single-Pass, 2-Pass, ambiguous, mocked `decomposeSlices`)

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Write multi-pass-orchestrator.ts** (~150 LoC)

```typescript
// src/services/slice/multi-pass-orchestrator.ts
import { decomposeSlices } from './slice-decompose-service.js';
import type { OrchestratorOptions } from './slice-decompose-types.js';
import type {
  DecompositionResultV2, PassResult, SliceV2
} from './slice-topology-types.js';
import { shouldSubdivide } from './granularity-decider.js';
import { merge } from './cross-pass-edge-merger.js';
import { resetArbitratorBudget } from './llm-arbitrator.js';
import type { LlmRunner } from '../audit/audit-goal-service.js';

export async function decompose(
  rid: string,
  prdMarkdown: string,
  projectRoot: string,
  opts: OrchestratorOptions & { llmRunner?: LlmRunner }
): Promise<DecompositionResultV2> {
  resetArbitratorBudget();
  const passes: PassResult[] = [];

  // Pass 1: service-level
  if (opts.granularity === 'service' || opts.granularity === 'both' || opts.granularity === 'auto') {
    const pass1Result = await decomposeSlices(rid, prdMarkdown, projectRoot, { granularity: 'service' });
    const pass1Slices: SliceV2[] = pass1Result.workUnits.map(wu => ({
      id: wu.id,
      label: wu.label,
      granularity: 'service',
      files: [...wu.files],
      loc: wu.loc,
      parentSliceId: null,
      semanticAnchor: wu.semanticAnchor ?? `file:${wu.filePath}`
    }));
    passes.push({
      passNumber: 1,
      granularity: 'service',
      slices: pass1Slices,
      internalEdges: pass1Result.dependencyDAG.edges.map(e => ({
        from: e.from, to: e.to, kind: e.kind, weight: e.weight,
        evidence: e.evidence, confidence: e.confidence
      }))
    });
  }

  // Pass 2: file-level (per Pass 1 slice, in parallel)
  if (opts.granularity === 'file' || opts.granularity === 'both' || opts.granularity === 'auto') {
    const parentSlices = passes[0]?.slices ?? [];
    const pass2Promises = parentSlices
      .filter(s => {
        const decider = shouldSubdivide({ id: s.id, label: s.label, files: s.files, loc: s.loc, testsAdded: 0, filePath: s.files[0] ?? '', candidates: [] });
        return decider.subdivide === true || decider.subdivide === 'tie-break';
      })
      .map(async (parent): Promise<PassResult> => {
        const result = await decomposeSlices(rid, '', projectRoot, { granularity: 'file', scopeFilter: parent.files });
        return {
          passNumber: 2,
          granularity: 'file',
          slices: result.workUnits.map(wu => ({
            id: `${parent.id}.${wu.id}`,
            label: wu.label,
            granularity: 'file',
            files: [...wu.files],
            loc: wu.loc,
            parentSliceId: parent.id,
            semanticAnchor: wu.semanticAnchor ?? `file:${wu.filePath}`
          })),
          internalEdges: result.dependencyDAG.edges.map(e => ({
            from: `${parent.id}.${e.from}`, to: `${parent.id}.${e.to}`,
            kind: e.kind, weight: e.weight, evidence: e.evidence, confidence: e.confidence
          }))
        };
      });
    const pass2Results = await Promise.all(pass2Promises);
    passes.push(...pass2Results);
  }

  // Cross-pass edges
  const mergeResult = opts.llmRunner
    ? await merge(passes, { projectRoot, llmRunner: opts.llmRunner })
    : { edges: [], llmCalls: [] };

  return {
    schemaVersion: 'v2',
    rid,
    generatedAt: new Date().toISOString(),
    passes,
    crossPassEdges: mergeResult.edges,
    llmArbitrations: mergeResult.llmCalls,
    codegraph: passes[0] ? { nodes: 0, edges: 0, dbMB: 0, freshness: 'indexed', affectedCrossFile: false, note: '' } : { nodes: 0, edges: 0, dbMB: 0, freshness: 'unindexed', affectedCrossFile: false, note: 'no Pass 1 result' },
    understandAnything: { kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: '' },
    partial: false
  };
}
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/services/slice/multi-pass-orchestrator.ts tests/unit/slice/multi-pass-orchestrator.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(slice): add MultiPassOrchestrator reusing existing 6-stage algorithm"
```

---

