# Cross-pass edge interpretation

Source of truth: `src/services/slice/cross-pass-edge-merger.ts` (`merge` function) + `src/services/slice/llm-arbitrator.ts` (`arbitrate`). Read this together with `references/v2-schema.md` for the field-level definitions.

## What is a `CrossPassEdge`

A directed edge connecting a slice in one pass (the **upper / coarser** pass) to a slice in another pass (the **lower / finer** pass). Direction: `fromSliceId` ∈ upper pass → `toSliceId` ∈ lower pass. Edges are produced ONLY when `--granularity` is non-default AND `opts.llmRunner` is provided to `MultiPassOrchestrator.decompose`. Without an `llmRunner`, the envelope ships `crossPassEdges: []` and `llmArbitrations: []`.

## Pipeline per adjacent pass pair

```
for each adjacent (upper, lower) pair in passes:
    build upperFileToSlice: Map<file, sliceId> from upper.slices
    for each slice in lower.slices:
        for each file in slice.files:
            detectStaticEdges(file, slice.id, ...)  # appends CrossPassEdges
        if no edge emitted for this slice AND llmRunner available AND budget remaining:
            runLlmFallback(upper, slice, ...)        # at most one edge per slice
```

Pairs are processed left-to-right so the order of `crossPassEdges[]` is deterministic.

## The 4 edge kinds

### 1. `type-shares`

**Meaning:** a lower-pass file has `import type { ... } from '...'` whose target resolves to a file owned by an upper-pass slice. The two slices share a TypeScript type across the granularity boundary.

| Field | Value |
|---|---|
| `kind` | `'type-shares'` |
| `confidence` | `'structural'` |
| `arbitratedBy` | `null` |
| `evidence` | The matched `import type { ... } from '...'` line. |
| Detector regex | `/import\s+type\s+(?:\{[^}]*\}\|\*\s+as\s+\w+\|\w+)\s+from\s+['"]([^'"]+)['"]/g` |

**Dispatch ordering for `peaks-rd`:** a `type-shares` edge means the lower slice's runtime correctness depends on the upper slice's type definitions shipping first. Add the upper slice as a `dependsOn` ancestor of the lower slice in the dispatch graph.

### 2. `fixture-shares`

**Meaning:** a lower-pass file is a test file (`.test.ts` / `.test.tsx` / `.test.js`, OR under `__tests__/`, OR under `tests/`) AND it has a `from '...'` import whose target resolves to a file owned by an upper-pass slice.

| Field | Value |
|---|---|
| `kind` | `'fixture-shares'` |
| `confidence` | `'structural'` |
| `arbitratedBy` | `null` |
| `evidence` | The matched `from '...'` line. |
| File predicate | `isTestFile(filePath)` (see `cross-pass-edge-merger.ts:330`) |

**Dispatch ordering for `peaks-rd`:** the lower slice's tests cannot run until the upper slice is built. Sequence the upper slice first; treat the lower slice as part of the upper slice's verification chain.

### 3. `import-re-export`

**Meaning:** a lower-pass file has `export { ... } from '...'` (or `export * from '...'` / `export type { ... } from '...'`) whose target resolves to a file owned by an upper-pass slice. The lower slice re-exports an upper-slice symbol.

| Field | Value |
|---|---|
| `kind` | `'import-re-export'` |
| `confidence` | `'structural'` |
| `arbitratedBy` | `null` |
| `evidence` | The matched `export ... from '...'` line. |
| Detector regex | `/\bexport\s+(?:type\s+)?(?:\*\|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g` |

**Dispatch ordering for `peaks-rd`:** the lower slice's public API is a re-export of the upper slice's symbols. Sequencing must put the upper slice first; consumers of the lower slice's exports cannot resolve until the upper slice's symbols exist.

### 4. `llm-arbitrated`

**Meaning:** the static detectors produced NO edge for this lower slice, the budget allowed, and the LLM arbitrator returned `{"depends": true, "reason": "..."}` for the prompt `"Does upper slice <upper> depend on lower slice <lower>?"`.

| Field | Value |
|---|---|
| `kind` | `'llm-arbitrated'` |
| `confidence` | `'llm'` |
| `arbitratedBy` | The `LlmArbitration.callId` (non-null; foreign key into `llmArbitrations[]`). |
| `evidence` | `llm:<callId>: <reason>` — the LLM's free-text reason. |

**Dispatch ordering for `peaks-rd`:** `llm-arbitrated` edges are LLM inferences, not ground truth. Treat them as a dispatch-ordering **hint**, not a hard dependency. The auditor at `peaks-qa` may challenge the edge by reading the arbitration trace (`llmArbitrations[callId]`). For the initial dispatch pass, sequence the upper slice first; if a `peaks-rd` reviewer later concludes the LLM was wrong, drop the edge and re-dispatch.

## Resolution algorithm

`resolveImport(fromFile, spec)` (in `cross-pass-edge-merger.ts`):

1. If `spec` is absolute, take it as-is. Otherwise resolve relative to `dirname(fromFile)`.
2. Try each extension in `RESOLVE_EXTENSIONS` (`'', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx', '/index.js'`) and return the first that exists on disk.
3. If none exist (virtual / generated), fall back to `<base>.ts` so the upper-index lookup still matches against the same key the orchestrator indexed.

## Static-vs-LLM dispatch summary

| Edge kind | Confidence | Source | Auditor action |
|---|---|---|---|
| `type-shares` | `structural` | regex | none — trust as-is |
| `fixture-shares` | `structural` | regex + `isTestFile` | none — trust as-is |
| `import-re-export` | `structural` | regex | none — trust as-is |
| `llm-arbitrated` | `llm` | LLM via `arbitrate()` | read `llmArbitrations[arbitratedBy]`; reject if reason is empty or contradicts codegraph |

## Reading the `LlmArbitration` trace

`llmArbitrations[]` is the audit trail for every LLM call made during decomposition. Cap: **≤ 2 calls per invocation** (`maxLlmCalls = 2`, default; the merger returns early when the budget is exhausted and never crashes).

```ts
interface LlmArbitration {
  readonly callId: string;
  readonly promptHash: string;        // sha256 hex; '' for MultiPassOrchestrator-produced entries (W2)
  readonly input: string;             // the actual prompt; '' for MultiPassOrchestrator-produced entries
  readonly output: string;            // the raw LLM response; '' for MultiPassOrchestrator-produced entries
  readonly confidence: 'high' | 'medium' | 'low';  // currently 'low' from MultiPassOrchestrator
  readonly tokens: { input: number; output: number };  // coalesced from null
}
```

### Walk-the-trace pseudocode

```ts
const v2 = readResult(outPath);  // DecompositionResultV2

for (const edge of v2.crossPassEdges) {
  if (edge.kind !== 'llm-arbitrated') continue;
  const arb = v2.llmArbitrations.find(a => a.callId === edge.arbitratedBy);
  if (!arb) {
    // foreign-key violation — log and skip
    continue;
  }
  // arb.confidence, arb.tokens, arb.promptHash are the audit handle.
  // arb.input / arb.output are currently '' for MultiPassOrchestrator entries;
  // W5+ will fill them in.
}
```

### What to do when audit fields are empty

`MultiPassOrchestrator`'s `llmCallsToArbitrations` helper fills `promptHash`, `input`, `output` with empty strings and `confidence` with `'low'`. This is a known limitation of W2 — the merger traces only `callId` and `tokens`. For full LLM provenance, either:

- re-run `merge(passes, opts)` programmatically with `opts.cacheDir` pointing at `.peaks/cache/arbitrator`, OR
- wait for W5+ to extend `merge` to surface the full trace into `LlmArbitration`.

Until then, `callId` is the only stable foreign key. A future `peaks-rd` revision will index `.peaks/cache/arbitrator` by `promptHash` so reviewers can replay the call.

## Field reference

```ts
type CrossPassEdgeKind =
  | 'type-shares'
  | 'fixture-shares'
  | 'import-re-export'
  | 'llm-arbitrated';

interface CrossPassEdge {
  readonly fromPass: PassNumber;        // 1 | 2 | 3
  readonly toPass: PassNumber;
  readonly fromSliceId: string;
  readonly toSliceId: string;
  readonly kind: CrossPassEdgeKind;
  readonly confidence: EdgeConfidence | 'llm';
  readonly evidence: string;
  readonly arbitratedBy: string | null; // foreign key into LlmArbitration.callId
}
```