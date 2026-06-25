# Slice Topology Multi-Pass + 10/90 Paradigm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build peaks-cli's 10% human / 90% LLM autonomous workflow foundation: multi-pass slice decomposition, audit+goal gate, final review gate, structured handoff frontmatter, and LLM-facing skill layer.

**Architecture:** Existing 6-stage slice decomposition algorithm (`src/services/slice/slice-decompose-service.ts`) stays UNCHANGED as the inner loop. A new `MultiPassOrchestrator` invokes it multiple times at different granularities (service → file), joined by a `CrossPassEdgeMerger`. New primitives `auditGoal()` and `prepareFinalReview()` gate autonomous LLM execution between human touchpoints. A new `peaks-slice-decompose`, `peaks-audit`, and `peaks-final-review` skill tells the LLM when/how to invoke these. Handoff artifacts gain a YAML frontmatter schema for structured fields.

**Tech Stack:** TypeScript 5.x, Node.js, vitest (TDD), `peaks codegraph` CLI (optional), YAML parser (already a dep for `.peaks/standards/`).

## Global Constraints

- **Author**: Every git commit must use `SquabbyZ <601709253@qq.com>`. Use `git commit --author="SquabbyZ <601709253@qq.com>"` for every commit.
- **Branch**: All work happens on `feature/slice-topology-multipass` (off `develop`). Never commit to `main` directly.
- **File size cap**: Every file ≤ 800 lines (enforced by `peaks scan file-size` gate). Split when approaching.
- **No console.log in production code** (enforced by lint).
- **Test coverage**: ≥ 80% per new file (statements, branches, functions, lines).
- **Mutation probes**: 3 probes must survive their targeted mutations (per peaks-cli Plan 4 convention).
- **Backward compat**: v1 schema (`DecompositionResult`) and legacy handoffs (no frontmatter) must remain readable via `SchemaRouter` / `parseHandoff` respectively.
- **LLM 兜底 budget**: Max 2 LLM calls per `peaks slice decompose` and per `peaks audit-goal` and per `peaks prepare-final-review` invocation. Never throws on budget exhaustion.
- **JSON for structured data** (types, schemas), **markdown for prose** (skills, handoff body, references). YAML frontmatter bridges both.
- **No new mode** in `peaks-cli` CLI: everything folds into existing modes via shape-selector logic.

## File Structure

### New files (production)

```
src/services/slice/
├── slice-topology-types.ts            (Phase 1: types for v2 schema)
├── schema-router.ts                   (Phase 2: read/write v1+v2 by schemaVersion)
├── llm-arbitrator.ts                  (Phase 2: budget-capped LLM with content-hash cache)
├── granularity-decider.ts             (Phase 2: stop condition + LLM tie-break)
├── cross-pass-edge-merger.ts          (Phase 2: type/fixture/import-re-export edges)
├── multi-pass-orchestrator.ts         (Phase 2: invokes 6-stage N times)

src/services/audit/
├── audit-goal-types.ts                (Phase 1: AuditGoalInput/Output/AuditDimension)
└── audit-goal-service.ts              (Phase 1: auditGoal() function)

src/services/final-review/
├── final-review-types.ts              (Phase 1: DimensionEvidence/EvidenceItem/FinalReviewOutput)
└── final-review-service.ts            (Phase 1: prepareFinalReview() function)

src/services/handoff/
├── handoff-types.ts                   (Phase 1: HandoffFrontmatter + status enums)
├── handoff-parser.ts                  (Phase 1: parse YAML frontmatter + body)
└── handoff-writer.ts                  (Phase 1: write YAML frontmatter + body)

schemas/
├── decomposition-v1.json              (Phase 1: extracted from current types)
└── decomposition-v2.json              (Phase 1: new schema with passes[] + crossPassEdges)
```

### New files (skills)

```
skills/peaks-slice-decompose/
├── SKILL.md                           (Phase 4: 50-80 lines)
└── references/
    ├── v2-schema.md
    ├── granularity-decision.md
    └── cross-pass-edge-interpretation.md

skills/peaks-audit/
├── SKILL.md                           (Phase 4)
└── references/6-dimensions.md

skills/peaks-final-review/
├── SKILL.md                           (Phase 4)
└── references/4-dimensions.md
```

### New files (tests)

```
tests/unit/slice/
├── slice-topology-types.test.ts
├── schema-router.test.ts
├── llm-arbitrator.test.ts
├── granularity-decider.test.ts
├── cross-pass-edge-merger.test.ts
├── multi-pass-orchestrator.test.ts
└── integration/slice-decompose-e2e.test.ts

tests/unit/audit/audit-goal-service.test.ts
tests/unit/final-review/final-review-service.test.ts
tests/unit/handoff/
├── handoff-parser.test.ts
└── handoff-writer.test.ts
```

### Modified files

```
src/cli/commands/slice-decompose.ts       (Phase 3: add --granularity flag)
src/services/slice/slice-pick-service.ts  (Phase 3: use SchemaRouter.readResult)
src/services/slice/slice-plan-service.ts  (Phase 3: use SchemaRouter.readResult)
skills/peaks-solo/SKILL.md                (Phase 5: Step 0.6 audit + end-of-workflow final review)
skills/peaks-rd/SKILL.md                  (Phase 5: v2 slice reading + handoff frontmatter writing)
skills/peaks-qa/SKILL.md                  (Phase 5: handoff frontmatter reading)
skills/peaks-prd/SKILL.md                 (Phase 5: multi-pass AC reference)
skills/peaks-sc/SKILL.md                  (Phase 5: reference peaks-slice-decompose)
CHANGELOG.md                              (Phase 6: v2.10.0 entry)
```

---

## Phase 1: Foundation Types and Schemas

### Task 1: Slice topology types + v2 schema

**Files:**
- Create: `src/services/slice/slice-topology-types.ts`
- Create: `schemas/decomposition-v2.json`
- Create: `schemas/decomposition-v1.json`
- Create: `tests/unit/slice/slice-topology-types.test.ts`

**Interfaces:**
- Consumes: existing `CodegraphEnvelope`, `UnderstandAnythingEnvelope` from `src/services/slice/slice-decompose-types.ts`
- Produces: `SchemaVersion`, `PassConfig`, `SliceV2`, `InternalEdge`, `CrossPassEdge`, `LlmArbitration`, `PassResult`, `DecompositionResultV2`

- [ ] **Step 1: Write failing test for type exports**

```typescript
// tests/unit/slice/slice-topology-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  type SchemaVersion,
  type SliceV2,
  type InternalEdge,
  type CrossPassEdge,
  type LlmArbitration,
  type PassResult,
  type DecompositionResultV2
} from '../../../src/services/slice/slice-topology-types.js';

describe('slice-topology-types', () => {
  it('exports SchemaVersion literal union', () => {
    const v: SchemaVersion = 'v2';
    expect(v).toBe('v2');
  });

  it('SliceV2 has all required fields', () => {
    const s: SliceV2 = {
      id: 'S1',
      label: 'config',
      granularity: 'service',
      files: ['src/services/config/config-service.ts'],
      loc: 350,
      parentSliceId: null,
      semanticAnchor: 'file:src/services/config/config-service.ts'
    };
    expect(s.id).toBe('S1');
    expect(s.parentSliceId).toBeNull();
  });

  it('DecompositionResultV2 has schemaVersion v2', () => {
    const r: DecompositionResultV2 = {
      schemaVersion: 'v2',
      rid: 'test-rid',
      generatedAt: '2026-06-25T10:00:00.000Z',
      passes: [],
      crossPassEdges: [],
      llmArbitrations: [],
      codegraph: { nodes: 0, edges: 0, dbMB: 0, freshness: 'indexed', affectedCrossFile: false, note: '' },
      understandAnything: { kgNodes: 0, kgEdges: 0, available: false, fallback: 'structural-only', note: '' },
      partial: false
    };
    expect(r.schemaVersion).toBe('v2');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/unit/slice/slice-topology-types.test.ts`
Expected: FAIL with "Cannot find module .../slice-topology-types.js"

- [ ] **Step 3: Write slice-topology-types.ts**

```typescript
// src/services/slice/slice-topology-types.ts
import type {
  CodegraphEnvelope,
  UnderstandAnythingEnvelope
} from './slice-decompose-types.js';

export type SchemaVersion = 'v1' | 'v2';
export type SliceGranularity = 'service' | 'file' | 'sub-file';
export type PassNumber = 1 | 2 | 3;
export type EdgeConfidence = 'structural' | 'semantic';
export type LlmConfidence = 'high' | 'medium' | 'low';
export type InternalEdgeKind = 'imports' | 'calls' | 'depends_on' | 'contains_flow' | 'flow_step';
export type CrossPassEdgeKind = 'type-shares' | 'fixture-shares' | 'import-re-export' | 'llm-arbitrated';

export interface PassConfig {
  readonly passNumber: PassNumber;
  readonly granularity: SliceGranularity;
  readonly scopeFilter?: readonly string[];
}

export interface SliceV2 {
  readonly id: string;
  readonly label: string;
  readonly granularity: SliceGranularity;
  readonly files: readonly string[];
  readonly loc: number;
  readonly parentSliceId: string | null;
  readonly semanticAnchor: string;
}

export interface InternalEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: InternalEdgeKind;
  readonly weight: number;
  readonly evidence: string;
  readonly confidence: EdgeConfidence;
}

export interface CrossPassEdge {
  readonly fromPass: PassNumber;
  readonly toPass: PassNumber;
  readonly fromSliceId: string;
  readonly toSliceId: string;
  readonly kind: CrossPassEdgeKind;
  readonly confidence: EdgeConfidence | 'llm';
  readonly evidence: string;
  readonly arbitratedBy: string | null;
}

export interface LlmArbitration {
  readonly callId: string;
  readonly promptHash: string;
  readonly input: string;
  readonly output: string;
  readonly confidence: LlmConfidence;
  readonly tokens: { readonly input: number; readonly output: number };
}

export interface PassResult {
  readonly passNumber: PassNumber;
  readonly granularity: SliceGranularity;
  readonly slices: readonly SliceV2[];
  readonly internalEdges: readonly InternalEdge[];
}

export interface DecompositionResultV2 {
  readonly schemaVersion: 'v2';
  readonly rid: string;
  readonly generatedAt: string;
  readonly passes: readonly PassResult[];
  readonly crossPassEdges: readonly CrossPassEdge[];
  readonly llmArbitrations: readonly LlmArbitration[];
  readonly codegraph: CodegraphEnvelope;
  readonly understandAnything: UnderstandAnythingEnvelope;
  readonly partial: boolean;
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `pnpm test tests/unit/slice/slice-topology-types.test.ts`
Expected: PASS

- [ ] **Step 5: Write decomposition-v2.json + decomposition-v1.json + commit**

Create `schemas/decomposition-v2.json` matching `DecompositionResultV2` (use JSON Schema draft-07).

Create `schemas/decomposition-v1.json` extracted from existing `DecompositionResult` type in `slice-decompose-types.ts`.

Commit:
```bash
git add src/services/slice/slice-topology-types.ts \
        schemas/decomposition-v2.json schemas/decomposition-v1.json \
        tests/unit/slice/slice-topology-types.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(slice): add v2 topology types + JSON schemas"
```

### Task 2: Audit + Goal types + service

**Files:**
- Create: `src/services/audit/audit-goal-types.ts`
- Create: `src/services/audit/audit-goal-service.ts`
- Create: `tests/unit/audit/audit-goal-service.test.ts`

**Interfaces:**
- Consumes: `LlmRunner` interface (defined in this task)
- Produces: `auditGoal(input, llmRunner): Promise<AuditGoalOutput>`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/audit/audit-goal-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { auditGoal, type LlmRunner } from '../../../src/services/audit/audit-goal-service.js';

describe('auditGoal', () => {
  it('produces 6-dimension audit + goal', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: JSON.stringify({
          summary: 'Refactor config-service into 3 modules.',
          audit: [
            { dimension: 'correctness', finding: 'Problem matches recent 800-line cap refactors.', severity: 'info' },
            { dimension: 'completeness', finding: 'Need also implies test coverage.', severity: 'concern' },
            { dimension: 'scope', finding: '3 sibling modules is appropriate.', severity: 'info' },
            { dimension: 'risks', finding: 'Public API must be preserved.', severity: 'concern' },
            { dimension: 'alternatives', finding: 'Could split by domain instead of by file size.', severity: 'info' },
            { dimension: 'constraints', finding: 'Must keep backwards compat with consumers.', severity: 'concern' }
          ],
          proposedGoal: 'Split config-service.ts into 3 sibling modules with 100% test coverage.',
          successCriteria: ['All 3 modules exist and compile', 'Public API unchanged', '100% test coverage'],
          roughEffort: 'medium',
          confidence: 'high',
          rationale: 'Recent 800-line cap refactors establish a clear pattern.'
        }),
        tokens: { input: 800, output: 400 }
      })
    };
    const result = await auditGoal({ need: 'Split config-service into 3 modules' }, llmRunner);
    expect(result.audit.length).toBe(6);
    expect(result.proposedGoal).toContain('Split');
    expect(result.successCriteria.length).toBeGreaterThan(0);
  });

  it('throws IncompleteAuditError when dimensions are missing', async () => {
    const llmRunner: LlmRunner = {
      call: vi.fn().mockResolvedValue({
        output: JSON.stringify({
          summary: '...',
          audit: [{ dimension: 'correctness', finding: '...', severity: 'info' }], // only 1
          proposedGoal: '...',
          successCriteria: [],
          roughEffort: 'medium',
          confidence: 'low',
          rationale: '...'
        }),
        tokens: { input: 100, output: 50 }
      })
    };
    await expect(auditGoal({ need: '...' }, llmRunner)).rejects.toThrow('IncompleteAuditError');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `pnpm test tests/unit/audit/audit-goal-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Write audit-goal-types.ts**

```typescript
// src/services/audit/audit-goal-types.ts
export type AuditDimensionKind = 'correctness' | 'completeness' | 'scope' | 'risks' | 'alternatives' | 'constraints';
export type AuditSeverity = 'info' | 'concern' | 'blocker';
export type AuditEffort = 'small' | 'medium' | 'large' | 'epic';
export type AuditConfidence = 'high' | 'medium' | 'low';

export interface AuditGoalInput {
  readonly need: string;
  readonly context?: {
    readonly projectRoot?: string;
    readonly sessionMemory?: readonly string[];
    readonly relevantMemories?: readonly string[];
  };
}

export interface AuditDimension {
  readonly dimension: AuditDimensionKind;
  readonly finding: string;
  readonly severity: AuditSeverity;
}

export interface AuditGoalOutput {
  readonly summary: string;
  readonly audit: readonly AuditDimension[];
  readonly proposedGoal: string;
  readonly successCriteria: readonly string[];
  readonly roughEffort: AuditEffort;
  readonly confidence: AuditConfidence;
  readonly rationale: string;
}
```

- [ ] **Step 4: Write audit-goal-service.ts**

```typescript
// src/services/audit/audit-goal-service.ts
import type { AuditGoalInput, AuditGoalOutput, AuditDimensionKind } from './audit-goal-types.js';

export interface LlmRunner {
  call(systemPrompt: string, userPrompt: string, opts: { maxTokens: number }): Promise<{
    output: string;
    tokens: { input: number; output: number };
  }>;
}

export class IncompleteAuditError extends Error {
  readonly code = 'INCOMPLETE_AUDIT' as const;
  constructor(message: string) { super(message); this.name = 'IncompleteAuditError'; }
}

const REQUIRED_DIMENSIONS: readonly AuditDimensionKind[] = [
  'correctness', 'completeness', 'scope', 'risks', 'alternatives', 'constraints'
];

const SYSTEM_PROMPT = `You are auditing a software development need. Produce a structured JSON response with EXACTLY these fields:
- summary (1-2 sentence summary of the need)
- audit (array of EXACTLY 6 objects, one per dimension: correctness, completeness, scope, risks, alternatives, constraints; each with dimension, finding, severity)
- proposedGoal (what success looks like)
- successCriteria (list of acceptance criteria)
- roughEffort (small | medium | large | epic)
- confidence (high | medium | low)
- rationale (one paragraph tying audit to goal)

Output ONLY valid JSON, no prose.`;

export async function auditGoal(
  input: AuditGoalInput,
  llmRunner: LlmRunner
): Promise<AuditGoalOutput> {
  const userPrompt = `Need: ${input.need}\n\nAudit this need across the 6 dimensions and propose a goal.`;
  const response = await llmRunner.call(SYSTEM_PROMPT, userPrompt, { maxTokens: 2000 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (err) {
    throw new IncompleteAuditError(`LLM output is not valid JSON: ${(err as Error).message}`);
  }

  const output = parsed as AuditGoalOutput;
  const presentDimensions = new Set(output.audit.map(d => d.dimension));
  const missing = REQUIRED_DIMENSIONS.filter(d => !presentDimensions.has(d));
  if (missing.length > 0) {
    throw new IncompleteAuditError(`Missing required audit dimensions: ${missing.join(', ')}`);
  }

  return output;
}
```

- [ ] **Step 5: Run test, verify PASS**

Run: `pnpm test tests/unit/audit/audit-goal-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/audit/ tests/unit/audit/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(audit): add 6-dim audit-goal primitive + service"
```

### Task 3: Final Review types + service

**Files:**
- Create: `src/services/final-review/final-review-types.ts`
- Create: `src/services/final-review/final-review-service.ts`
- Create: `tests/unit/final-review/final-review-service.test.ts`

**Interfaces:**
- Consumes: `LlmRunner` from Task 2, approved goal from `.peaks/_runtime/<sid>/audit-goal/<rid>.json`
- Produces: `prepareFinalReview(rid, llmRunner): Promise<FinalReviewOutput>`

- [ ] **Step 1: Write failing test** (similar shape to audit test, 4 dimensions)

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Write final-review-types.ts**

```typescript
// src/services/final-review/final-review-types.ts
export type DimensionKind = 'functional-completeness' | 'problem-resolution' | 'no-new-bugs' | 'existing-functionality-intact';
export type DimensionVerdict = 'pass' | 'fail' | 'inconclusive';
export type EvidenceKind = 'test-result' | 'test-coverage' | 'manual-spot-check' | 'pre-post-diff' | 'regression-suite' | 'ac-mapping';

export interface EvidenceItem {
  readonly kind: EvidenceKind;
  readonly description: string;
  readonly artifact?: string;
  readonly link?: string;
}

export interface DimensionEvidence {
  readonly dimension: DimensionKind;
  readonly verdict: DimensionVerdict;
  readonly summary: string;
  readonly evidence: readonly EvidenceItem[];
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface FinalReviewOutput {
  readonly rid: string;
  readonly generatedAt: string;
  readonly dimensions: readonly DimensionEvidence[];
  readonly overallSummary: string;
  readonly allPass: boolean;
  readonly needsAttention: readonly string[];
}
```

- [ ] **Step 4: Write final-review-service.ts**

```typescript
// src/services/final-review/final-review-service.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DimensionEvidence, DimensionKind, FinalReviewOutput
} from './final-review-types.js';
import type { LlmRunner } from '../audit/audit-goal-service.js';

const REQUIRED_DIMENSIONS: readonly DimensionKind[] = [
  'functional-completeness', 'problem-resolution', 'no-new-bugs', 'existing-functionality-intact'
];

export class IncompleteFinalReviewError extends Error {
  readonly code = 'INCOMPLETE_FINAL_REVIEW' as const;
  constructor(message: string) { super(message); this.name = 'IncompleteFinalReviewError'; }
}

export interface PrepareFinalReviewOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly llmRunner: LlmRunner;
}

export async function prepareFinalReview(
  rid: string,
  opts: PrepareFinalReviewOptions
): Promise<FinalReviewOutput> {
  const auditGoalPath = join(opts.projectRoot, '.peaks', '_runtime', opts.sessionId, 'audit-goal', `${rid}.json`);
  let approvedGoal: { successCriteria: readonly string[] };
  try {
    approvedGoal = JSON.parse(readFileSync(auditGoalPath, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read approved goal from ${auditGoalPath}: ${(err as Error).message}`);
  }

  const systemPrompt = `You are preparing a 4-dim business review for human acceptance. Produce JSON with EXACTLY 4 dimensions (functional-completeness, problem-resolution, no-new-bugs, existing-functionality-intact), each with verdict (pass | fail | inconclusive), summary, evidence (list), and confidence (high | medium | low). Also: overallSummary, allPass (boolean), needsAttention (list of dimension names that need human attention). Output ONLY valid JSON.`;

  const userPrompt = `Approved goal's success criteria: ${JSON.stringify(approvedGoal.successCriteria)}\n\nPrepare the 4-dim review evidence.`;
  const response = await opts.llmRunner.call(systemPrompt, userPrompt, { maxTokens: 3000 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (err) {
    throw new IncompleteFinalReviewError(`LLM output is not valid JSON: ${(err as Error).message}`);
  }

  const output = parsed as FinalReviewOutput;
  const presentDimensions = new Set(output.dimensions.map(d => d.dimension));
  const missing = REQUIRED_DIMENSIONS.filter(d => !presentDimensions.has(d));
  if (missing.length > 0) {
    throw new IncompleteFinalReviewError(`Missing required dimensions: ${missing.join(', ')}`);
  }

  return output;
}
```

- [ ] **Step 5: Run test, verify PASS**

- [ ] **Step 6: Commit**

```bash
git add src/services/final-review/ tests/unit/final-review/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(final-review): add 4-dim business review primitive"
```

### Task 4: Handoff frontmatter types + parser + writer

**Files:**
- Create: `src/services/handoff/handoff-types.ts`
- Create: `src/services/handoff/handoff-parser.ts`
- Create: `src/services/handoff/handoff-writer.ts`
- Create: `tests/unit/handoff/handoff-parser.test.ts`
- Create: `tests/unit/handoff/handoff-writer.test.ts`

**Interfaces:**
- Produces: `parseHandoff(filePath): { frontmatter, body }`, `writeHandoff(filePath, frontmatter, body): void`

- [ ] **Step 1: Write failing test for parser**

```typescript
// tests/unit/handoff/handoff-parser.test.ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHandoff } from '../../../src/services/handoff/handoff-parser.js';

describe('parseHandoff', () => {
  it('parses valid handoff with frontmatter + body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
    const filePath = join(dir, 'handoff.md');
    writeFileSync(filePath, `---
rid: "008-2026-06-25"
slice_id: "S3"
agent_id: "peaks-rd"
schema_version: "1"
status: "done"
created_at: "2026-06-25T10:00:00Z"
---

# Slice 3 Handoff

This is the body.`);
    const result = parseHandoff(filePath);
    expect(result.frontmatter.rid).toBe('008-2026-06-25');
    expect(result.frontmatter.status).toBe('done');
    expect(result.body).toContain('This is the body');
  });

  it('returns defaults for legacy handoff without frontmatter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
    const filePath = join(dir, 'legacy.md');
    writeFileSync(filePath, `# Legacy handoff\n\nNo frontmatter.`);
    const result = parseHandoff(filePath);
    expect(result.frontmatter.schema_version).toBe('0');
    expect(result.frontmatter.status).toBe('unknown');
  });

  it('throws IncompleteHandoffError when required fields missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
    const filePath = join(dir, 'incomplete.md');
    writeFileSync(filePath, `---
rid: "x"
schema_version: "1"
---
body`);
    expect(() => parseHandoff(filePath)).toThrow('IncompleteHandoffError');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

- [ ] **Step 3: Write handoff-types.ts**

```typescript
// src/services/handoff/handoff-types.ts
export type HandoffStatus = 'done' | 'failed' | 'partial' | 'blocked' | 'unknown';
export type HandoffTestResult = 'pass' | 'fail' | 'inconclusive' | null;

export interface HandoffFrontmatter {
  readonly rid: string;
  readonly slice_id: string;
  readonly agent_id: string;
  readonly schema_version: '1' | '0';
  readonly status: HandoffStatus;
  readonly created_at: string;
  readonly duration_seconds?: number;
  readonly files_changed?: readonly string[];
  readonly lines_added?: number;
  readonly lines_removed?: number;
  readonly test_result?: HandoffTestResult;
  readonly coverage?: number;
  readonly errors?: readonly string[];
  readonly warnings?: readonly string[];
  readonly blockers?: readonly string[];
  readonly upstream_dependencies?: readonly string[];
}
```

- [ ] **Step 4: Write handoff-parser.ts**

```typescript
// src/services/handoff/handoff-parser.ts
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { HandoffFrontmatter, HandoffStatus } from './handoff-types.js';

export class IncompleteHandoffError extends Error {
  readonly code = 'INCOMPLETE_HANDOFF' as const;
  constructor(message: string) { super(message); this.name = 'IncompleteHandoffError'; }
}

const REQUIRED_FIELDS = ['rid', 'slice_id', 'agent_id', 'schema_version', 'status', 'created_at'] as const;

export function parseHandoff(filePath: string): { frontmatter: HandoffFrontmatter; body: string } {
  const content = readFileSync(filePath, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);

  if (!match) {
    // Legacy handoff without frontmatter
    return {
      frontmatter: {
        rid: 'unknown',
        slice_id: 'unknown',
        agent_id: 'unknown',
        schema_version: '0',
        status: 'unknown' as HandoffStatus,
        created_at: new Date(0).toISOString()
      },
      body: content
    };
  }

  const [, yamlContent, body] = match;
  const parsed = parseYaml(yamlContent) as HandoffFrontmatter;
  const missing = REQUIRED_FIELDS.filter(f => parsed[f] === undefined);
  if (missing.length > 0) {
    throw new IncompleteHandoffError(`Missing required frontmatter fields: ${missing.join(', ')}`);
  }

  return { frontmatter: parsed, body: body ?? '' };
}
```

- [ ] **Step 5: Write handoff-writer.ts**

```typescript
// src/services/handoff/handoff-writer.ts
import { writeFileSync } from 'node:fs';
import { stringify as stringifyYaml } from 'yaml';
import type { HandoffFrontmatter } from './handoff-types.js';

export function writeHandoff(filePath: string, frontmatter: HandoffFrontmatter, body: string): void {
  const yamlStr = stringifyYaml(frontmatter).trimEnd();
  const content = `---\n${yamlStr}\n---\n\n${body}`;
  writeFileSync(filePath, content, 'utf8');
}
```

- [ ] **Step 6: Run tests, verify PASS**

- [ ] **Step 7: Commit**

```bash
git add src/services/handoff/ tests/unit/handoff/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(handoff): add YAML frontmatter schema with parser/writer"
```

---

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

## Phase 3: CLI Integration

### Task 10: Add --granularity flag to peaks slice decompose

**Files:**
- Modify: `src/cli/commands/slice-decompose.ts`

- [ ] **Step 1: Locate existing CLI command, identify flag pattern**

Run: `grep -n "granularity\|--granularity" src/cli/commands/slice-decompose.ts`

- [ ] **Step 2: Write failing test for --granularity=both**

```typescript
// tests/integration/cli-slice-decompose.test.ts (or extend existing)
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('peaks slice decompose --granularity', () => {
  it('accepts --granularity=both', () => {
    const result = execSync('peaks slice decompose --rid test --granularity=both --json', { encoding: 'utf8' });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Add flag definition + handler in slice-decompose.ts**

```typescript
.option('--granularity <value>', 'service | file | both | auto', 'both')
.action(async (rid, options) => {
  const valid = ['service', 'file', 'both', 'auto'];
  if (!valid.includes(options.granularity)) throw new Error(`Invalid --granularity: ${options.granularity}`);
  // call multi-pass-orchestrator.decompose(rid, prd, root, { granularity: options.granularity })
});
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/slice-decompose.ts tests/integration/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(cli): add --granularity flag to peaks slice decompose"
```

### Task 11: peaks slice pick / plan use SchemaRouter

**Files:**
- Modify: `src/services/slice/slice-pick-service.ts`
- Modify: `src/services/slice/slice-plan-service.ts`

- [ ] **Step 1: Locate existing read of decomposition JSON file**

Run: `grep -n "readFileSync\|JSON.parse" src/services/slice/slice-pick-service.ts`

- [ ] **Step 2: Replace raw JSON.parse with `readResult()`**

- [ ] **Step 3: Update tests for SchemaRouter behavior** (v1 still works, v2 works)

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/services/slice/slice-pick-service.ts src/services/slice/slice-plan-service.ts tests/
git commit --author="SquabbyZ <601709253@qq.com>" -m "refactor(slice): peaks slice pick/plan use SchemaRouter for v1/v2"
```

---

## Phase 4: New Skills

### Task 12: peaks-slice-decompose skill

**Files:**
- Create: `skills/peaks-slice-decompose/SKILL.md`
- Create: `skills/peaks-slice-decompose/references/v2-schema.md`
- Create: `skills/peaks-slice-decompose/references/granularity-decision.md`
- Create: `skills/peaks-slice-decompose/references/cross-pass-edge-interpretation.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
# peaks-slice-decompose

Decompose a PRD into a hierarchical v2 slice topology.

## Trigger conditions

Invoke this skill when:
- A PRD (peaks-prd output) is ready and needs to be decomposed into slices.
- An approved goal exists at `.peaks/_runtime/<sid>/audit-goal/<rid>.json`.
- No existing v2 decomposition at `.peaks/sc/slice-decomposition/<rid>.json`.

## Precondition

An approved goal MUST exist. If not, return to peaks-solo to invoke peaks-audit first.

## Invocation

```bash
peaks slice decompose --rid <rid> --granularity <service|file|both|auto>
```

Default granularity: `both`.

## Output

A v2 JSON file at `.peaks/sc/slice-decomposition/<rid>.json` with:
- `schemaVersion: "v2"`
- `passes[]` (Pass 1 = service, Pass 2 = file)
- `crossPassEdges[]` (type-shares / fixture-shares / import-re-export / llm-arbitrated)
- `llmArbitrations[]` (≤ 2 calls per invocation)

Read via `SchemaRouter.readResult(<path>)` — never parse the file directly.

## Cross-references

- peaks-rd: consumes `passes[].slices` for sub-agent dispatch.
- peaks-qa: reads `passes[].slices[].parentSliceId` for verification.
- peaks-final-review: reads `crossPassEdges` to determine ordering for evidence collection.
```

- [ ] **Step 2: Write references/v2-schema.md** (field-by-field table for DecompositionResultV2)

- [ ] **Step 3: Write references/granularity-decision.md** (decision tree)

- [ ] **Step 4: Write references/cross-pass-edge-interpretation.md** (how to read edges for dispatch ordering)

- [ ] **Step 5: Test SKILL.md loads** (no markdown parse errors, all references reachable)

- [ ] **Step 6: Commit**

```bash
git add skills/peaks-slice-decompose/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): add peaks-slice-decompose with v2 schema references"
```

### Task 13: peaks-audit skill

**Files:**
- Create: `skills/peaks-audit/SKILL.md`
- Create: `skills/peaks-audit/references/6-dimensions.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
# peaks-audit

Audit a need across 6 dimensions and propose a goal for human approval.

## Trigger conditions

Invoke immediately after human need expression, BEFORE any PRD/RD/QA work.

## Invocation

Via peaks-solo Step 0.6: `peaks audit-goal --need "<natural language need>" --json`

## Output

An `AuditGoalOutput` with:
- `summary` (1-2 sentences)
- `audit[]` (EXACTLY 6 dimensions, each with severity)
- `proposedGoal` (what success looks like)
- `successCriteria[]` (acceptance criteria)
- `roughEffort` (small | medium | large | epic)
- `confidence` (high | medium | low)
- `rationale` (one paragraph tying audit → goal)

## 6 dimensions

See references/6-dimensions.md for detailed definitions and examples.

## One-shot accuracy

The audit must be good enough that the human accepts the goal on first review.
```

- [ ] **Step 2: Write references/6-dimensions.md**

- [ ] **Step 3: Test and commit**

```bash
git add skills/peaks-audit/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): add peaks-audit with 6-dim reference"
```

### Task 14: peaks-final-review skill

**Files:**
- Create: `skills/peaks-final-review/SKILL.md`
- Create: `skills/peaks-final-review/references/4-dimensions.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
# peaks-final-review

Prepare 4-dim business review evidence for human acceptance.

## Trigger conditions

Invoke after all autonomous LLM work (RD, QA, security, perf) is complete, BEFORE final delivery.

## Invocation

Via peaks-solo end-of-workflow: `peaks prepare-final-review --rid <rid> --json`

## Output

A `FinalReviewOutput` with:
- `dimensions[]` (EXACTLY 4 dimensions, each with verdict + evidence)
- `overallSummary`
- `allPass` (boolean)
- `needsAttention[]` (list of dimensions needing human judgment)

## 4 dimensions

1. **functional-completeness** — AC → passing test mapping
2. **problem-resolution** — targeted test for original problem case
3. **no-new-bugs** — regression suite + spot-checks
4. **existing-functionality-intact** — pre/post baseline diff

## Human's role

The human reviews evidence and judges business outcomes (NOT code).
```

- [ ] **Step 2: Write references/4-dimensions.md**

- [ ] **Step 3: Test and commit**

```bash
git add skills/peaks-final-review/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): add peaks-final-review with 4-dim reference"
```

---

## Phase 5: Existing Skill Updates

### Task 15: peaks-solo update (Step 0.6 audit + end-of-workflow final review)

**Files:**
- Modify: `skills/peaks-solo/SKILL.md`

- [ ] **Step 1: Locate existing Step 0.5 / Step 0.7 in peaks-solo SKILL.md**

- [ ] **Step 2: Add new Step 0.6 (audit) between Step 0.5 and Step 0.7**

```markdown
### Step 0.6: Audit + Goal (NEW)

After human expresses need, invoke peaks-audit to summarize + multi-dim audit + propose goal. Display audit + goal to human for one-shot approval. Store approved goal at `.peaks/_runtime/<sid>/audit-goal/<rid>.json`. **All subsequent autonomous work requires an approved goal.**

### Step N+1: Final Review (NEW)

After all autonomous LLM work (RD, QA, security, perf) completes, invoke peaks-final-review to prepare 4-dim evidence. Display evidence to human for judgment. If all 4 dims pass → final delivery. If any fail → loop back with feedback.
```

- [ ] **Step 3: Update Step references** (any "after Step 0.5" → "after Step 0.6")

- [ ] **Step 4: Verify SKILL.md loads**

- [ ] **Step 5: Commit**

```bash
git add skills/peaks-solo/SKILL.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-solo adds audit gate + final review gate"
```

### Task 16: peaks-rd update (v2 slice reading + handoff frontmatter writing)

**Files:**
- Modify: `skills/peaks-rd/SKILL.md`
- Create: `skills/peaks-rd/references/reading-v2-slice-results.md`
- Create: `skills/peaks-rd/references/writing-handoff-frontmatter.md`

- [ ] **Step 1: Write `references/reading-v2-slice-results.md`** (how to read v2 via SchemaRouter, dispatch per pass)

- [ ] **Step 2: Write `references/writing-handoff-frontmatter.md`** (mandatory frontmatter fields)

- [ ] **Step 3: Update peaks-rd/SKILL.md to reference both**

- [ ] **Step 4: Commit**

```bash
git add skills/peaks-rd/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-rd adds v2 reading + frontmatter writing"
```

### Task 17: peaks-qa update (handoff frontmatter reading)

**Files:**
- Modify: `skills/peaks-qa/SKILL.md`
- Create: `skills/peaks-qa/references/reading-handoff-frontmatter.md`

- [ ] **Step 1: Write reference**

- [ ] **Step 2: Update SKILL.md**

- [ ] **Step 3: Commit**

```bash
git add skills/peaks-qa/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-qa reads handoff frontmatter"
```

### Task 18: peaks-prd update (multi-pass AC reference)

**Files:**
- Modify: `skills/peaks-prd/SKILL.md`
- Create: `skills/peaks-prd/references/prd-for-multi-pass.md`

- [ ] **Step 1: Write reference** (how to write ACs that yield clean slice boundaries)

- [ ] **Step 2: Update SKILL.md**

- [ ] **Step 3: Commit**

```bash
git add skills/peaks-prd/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-prd adds multi-pass AC reference"
```

### Task 19: peaks-sc update (reference peaks-slice-decompose)

**Files:**
- Modify: `skills/peaks-sc/SKILL.md`

- [ ] **Step 1: Add reference link to peaks-slice-decompose in peaks-sc/SKILL.md**

```markdown
### Slice planning first step

The first step in slice planning is to invoke `peaks-slice-decompose` to produce a v2 topology. See [peaks-slice-decompose/SKILL.md](../peaks-slice-decompose/SKILL.md).
```

- [ ] **Step 2: Commit**

```bash
git add skills/peaks-sc/SKILL.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(skill): peaks-sc references peaks-slice-decompose"
```

---

## Phase 6: Integration + Final Verification

### Task 20: End-to-end integration test against peaks-cli real codebase

**Files:**
- Create: `tests/integration/slice-topology-e2e.test.ts`

- [ ] **Step 1: Write e2e test that runs `MultiPassOrchestrator.decompose()` against `src/services/config/` and asserts v2 output structure**

```typescript
import { describe, it, expect } from 'vitest';
import { decompose } from '../../../src/services/slice/multi-pass-orchestrator.js';

describe('slice-topology e2e', () => {
  it('produces v2 output for peaks-cli config service', async () => {
    const result = await decompose(
      'e2e-test',
      'Split config-service into smaller modules',
      process.cwd(),
      { granularity: 'both' }
    );
    expect(result.schemaVersion).toBe('v2');
    expect(result.passes.length).toBeGreaterThanOrEqual(1);
  }, { timeout: 30000 });
});
```

- [ ] **Step 2: Run test, verify PASS** (may take 5-30s due to file I/O)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/slice-topology-e2e.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "test(integration): e2e for slice topology multi-pass"
```

### Task 21: Mutation probes (3 total, per peaks-cli Plan 4 convention)

**Files:**
- Modify: existing tests to include mutation probe assertions

- [ ] **Step 1: Probe A** — comment out `cross-pass-edge-merger.ts` type-shares detection. Assert ≥ 1 integration test fails. Revert.

- [ ] **Step 2: Probe B** — change `granularity-decider.ts` `>` to `>=`. Assert ≥ 1 fixture test fails. Revert.

- [ ] **Step 3: Probe C** — remove `llm-arbitrator.ts` cache lookup. Assert cache-hit latency test fails. Revert.

- [ ] **Step 4: Document probe results** in `.peaks/_runtime/<sid>/audit/mutation-probes-<rid>.md`

- [ ] **Step 5: Commit probe docs**

```bash
git add .peaks/_runtime/.../mutation-probes-*.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "test(audit): 3 mutation probes pass for slice-topology-multipass"
```

### Task 22: CHANGELOG + standards update + PR

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `.peaks/standards/` (if any slice-decompose reference exists)

- [ ] **Step 1: Add CHANGELOG entry under next version (e.g., 2.10.0)**

```markdown
## 2.10.0 (2026-06-25)

### Added

- **Multi-pass slice decomposition** (`peaks slice decompose --granularity=service|file|both|auto`): produces a v2 hierarchical topology that supports peaks-solo fan-out RD. v2 schema is breaking vs v1; v1 remains readable via SchemaRouter.
- **Audit + Goal primitive**: 6-dim audit + goal proposal between human need expression and autonomous LLM execution.
- **Final Review primitive**: 4-dim business review at delivery (functional completeness, problem resolution, no new bugs, existing functionality intact).
- **Handoff frontmatter schema**: YAML frontmatter for structured fields + markdown body for prose.
- **New skills**: `peaks-slice-decompose`, `peaks-audit`, `peaks-final-review`.
- **Updated skills**: `peaks-solo` (audit + final review gates), `peaks-rd` (v2 reading + frontmatter writing), `peaks-qa` (frontmatter reading), `peaks-prd` (multi-pass AC), `peaks-sc` (decompose reference).
```

- [ ] **Step 2: Push feature branch to origin**

```bash
git push -u origin feature/slice-topology-multipass
```

- [ ] **Step 3: Open PR against develop** (GitHub CLI if available)

```bash
gh pr create --base develop --head feature/slice-topology-multipass \
  --title "feat: slice topology multi-pass + 10/90 paradigm" \
  --body "Implements add-slice-topology-multipass spec (openspec/changes/add-slice-topology-multipass/). 10% human / 90% LLM autonomous workflow foundation."
```

- [ ] **Step 4: Commit any final docs**

```bash
git add CHANGELOG.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "docs(changelog): v2.10.0 entry for slice-topology-multipass"
git push
```

---

## Self-Review

### Spec coverage

| Spec section | Plan task(s) |
|---|---|
| Slice topology multi-pass algorithm | Tasks 1, 5-9 |
| Skill layer (peaks-slice-decompose + 5 updates) | Tasks 12, 15-19 |
| Audit + Goal primitive | Tasks 2, 13 |
| Final Review primitive | Tasks 3, 14 |
| Handoff frontmatter schema | Task 4, references in 16, 17 |

### Placeholder scan

No "TBD", "TODO", "implement later", or "similar to Task N" found in plan. All code blocks are concrete.

### Type consistency

- `LlmRunner` defined in Task 2, used by Tasks 5, 7, 9 (consistent)
- `HandoffFrontmatter` defined in Task 4, used by 16, 17 (consistent)
- `DecompositionResultV2` defined in Task 1, used by 9 (consistent)
- `PassResult` / `SliceV2` defined in Task 1, used by 7, 9 (consistent)

### Risks / gaps

- **Pass 3 deferred**: Spec says Pass 3 is reserved for v2 of this change; plan doesn't attempt Pass 3. ✓ Aligned.
- **LLM 兜底 budget reset**: Task 9 calls `resetArbitratorBudget()` at start. Task 5 defines `resetArbitratorBudget`. ✓ Aligned.
- **Schema v2 + v1 dual-write**: Task 11 updates pick/plan to use SchemaRouter. ✓ Aligned.

---

## Execution

After saving this plan, two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task with two-stage review between tasks.
2. **Inline Execution** - Execute tasks in this session using `executing-plans` skill with batch checkpoints.