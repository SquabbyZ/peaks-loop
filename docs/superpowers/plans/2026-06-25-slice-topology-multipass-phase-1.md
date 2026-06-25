<!--
Extracted from: 2026-06-25-slice-topology-multipass.md (1626-line original, split on 2026-06-25 post Wave 1)
Section: Phase 1: Foundation Types and Schemas (incl. Slice 3 Handoff)
Original lines: 109-741
This file is part of the slice-topology-multipass plan split.
See the index at ./2026-06-25-slice-topology-multipass.md for navigation.
-->

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

