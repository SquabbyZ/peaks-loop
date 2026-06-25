/**
 * MultiPassOrchestrator — Phase 2 of slice-topology-multipass (W2 T9).
 *
 * Top-level orchestrator that runs the existing 6-stage algorithm
 * (`decomposeSlices`) at service-level and/or file-level granularity, then
 * stitches the passes together with `merge` to produce a v2
 * `DecompositionResultV2` with cross-pass edges.
 *
 * Granularity semantics:
 *   - 'service': Pass 1 only. Each workUnit becomes a SliceV2 with
 *                granularity='service' and parentSliceId=null.
 *   - 'file':    Pass 2 only. `decomposeSlices` is called once on the full
 *                scope (no parent subdivision). Each workUnit becomes a
 *                SliceV2 with granularity='file' and parentSliceId=null.
 *   - 'both':    Pass 1 + N Pass 2 (one per parent). Pass 2 runs for every
 *                Pass 1 slice without decider filtering.
 *   - 'auto':    Same as 'both' but Pass 2 only runs for parents where
 *                `shouldSubdivide(wu).subdivide !== false` (both `true` and
 *                `'tie-break'` qualify).
 *
 * Granularity-mapping approach (see pre-flight note in the task spec):
 *   Approach 1 — pass-through with post-hoc filter. The 6-stage algorithm
 *   (`decomposeSlices`) does NOT accept a `granularity` or `scopeFilter`
 *   option, and the pre-flight note recommends NOT extending `DecomposeOptions`
 *   (surgical change rule). We therefore:
 *     1. Pass the full `opts` (including the orchestrator-only `granularity`
 *        and `llmRunner` fields) through to `decomposeSlices`; the algorithm
 *        ignores the extra fields.
 *     2. Filter Pass 2 `result.workUnits` post-hoc so each Pass 2 result
 *        only contains files inside the parent slice's file scope.
 *
 * Cross-pass edges are produced by `merge` whenever there are ≥2 passes.
 * The merger handles both static detection (type-shares, fixture-shares,
 * import-re-export — runs UNCONDITIONALLY) and the LLM fallback path (only
 * when `opts.llmRunner` is provided). Without an llmRunner the orchestrator
 * still gets statically-detected cross-pass edges; only `llmArbitrations`
 * stays empty.
 *
 * @see ./slice-decompose-service.ts  — the 6-stage algorithm (reused as-is)
 * @see ./granularity-decider.ts      — subdivide decision
 * @see ./cross-pass-edge-merger.ts   — cross-pass edge detection
 * @see ./llm-arbitrator.ts           — LLM fallback for cross-pass edges
 * @see ./slice-topology-types.ts     — DecompositionResultV2, PassResult, etc.
 */

import type { LlmRunner } from '../audit/audit-goal-service.js';
import type {
  CodegraphEnvelope,
  DecomposeOptions,
  DependencyEdge,
  UnderstandAnythingEnvelope,
  WorkUnit
} from './slice-decompose-types.js';
import { decomposeSlices } from './slice-decompose-service.js';
import { resetArbitratorBudget } from './llm-arbitrator.js';
import { shouldSubdivide } from './granularity-decider.js';
import { merge } from './cross-pass-edge-merger.js';
import type {
  CrossPassEdge,
  DecompositionResultV2,
  InternalEdge,
  LlmArbitration,
  PassResult,
  SliceGranularity,
  SliceV2
} from './slice-topology-types.js';
import type { LlmCallTrace } from './cross-pass-edge-merger.js';

export type Granularity = 'service' | 'file' | 'both' | 'auto';

export interface MultiPassOptions extends DecomposeOptions {
  /** Service-level vs file-level vs both. Defaults to `'both'`. */
  readonly granularity?: Granularity;
  /** Optional LLM runner; when present, cross-pass edges are computed via `merge`. */
  readonly llmRunner?: LlmRunner;
}

/**
 * Run the multi-pass decomposition algorithm and return a v2 result.
 *
 * 1. Reset the LLM arbitrator budget for this invocation.
 * 2. Run Pass 1 (service-level) if granularity includes 'service'.
 * 3. Run Pass 2 (file-level) — for every qualifying parent in 'both'/'auto',
 *    or once on the full scope in 'file'-only mode.
 * 4. Compute cross-pass edges via `merge` whenever there are ≥2 passes
 *    (static detection runs unconditionally; LLM fallback only when an
 *    llmRunner is supplied).
 * 5. Return a `DecompositionResultV2` with `partial: false`.
 */
export async function decompose(
  rid: string,
  prdMarkdown: string,
  projectRoot: string,
  opts: MultiPassOptions = {}
): Promise<DecompositionResultV2> {
  resetArbitratorBudget();

  const granularity: Granularity = opts.granularity ?? 'both';
  const wantService =
    granularity === 'service' || granularity === 'both' || granularity === 'auto';
  const wantFile =
    granularity === 'file' || granularity === 'both' || granularity === 'auto';

  const passes: PassResult[] = [];
  let codegraph: CodegraphEnvelope = zeroCodegraph();
  let understandAnything: UnderstandAnythingEnvelope = zeroUnderstand();
  let pass1WorkUnits: readonly WorkUnit[] = [];

  if (wantService) {
    const result1 = await decomposeSlices(rid, prdMarkdown, projectRoot, opts);
    pass1WorkUnits = result1.workUnits;
    passes.push({
      passNumber: 1,
      granularity: 'service',
      slices: result1.workUnits.map((wu) =>
        workUnitToSliceV2(wu, 'service')
      ),
      internalEdges: v1EdgesToV2(result1.dependencyDAG.edges)
    });
    codegraph = result1.codegraph;
    understandAnything = result1.understandAnything;
  }

  if (wantFile) {
    if (pass1WorkUnits.length > 0) {
      // Per-parent subdivision. In 'auto' mode, only parents where
      // shouldSubdivide is not explicitly false qualify.
      const qualifyingParents =
        granularity === 'auto'
          ? pass1WorkUnits.filter(
              (wu) => shouldSubdivide(wu).subdivide !== false
            )
          : pass1WorkUnits;

      const pass2Results = await Promise.all(
        qualifyingParents.map(async (parent) => {
          const result = await decomposeSlices(
            rid,
            prdMarkdown,
            projectRoot,
            opts
          );
          const filtered = filterWorkUnitsByScope(result.workUnits, parent.files);
          const pass2Slices: SliceV2[] = filtered.map((wu, i) =>
            workUnitToSliceV2(wu, 'file', {
              id: `${parent.id}.${i + 1}`,
              parentSliceId: parent.id
            })
          );
          const pass2: PassResult = {
            passNumber: 2,
            granularity: 'file',
            slices: pass2Slices,
            internalEdges: v1EdgesToV2(result.dependencyDAG.edges)
          };
          return pass2;
        })
      );
      passes.push(...pass2Results);
    } else if (!wantService) {
      // file-only mode: call decomposeSlices once on the full scope and
      // treat the result as Pass 2 (no parent subdivision).
      const result = await decomposeSlices(rid, prdMarkdown, projectRoot, opts);
      const slices: SliceV2[] = result.workUnits.map((wu) =>
        workUnitToSliceV2(wu, 'file')
      );
      passes.push({
        passNumber: 2,
        granularity: 'file',
        slices,
        internalEdges: v1EdgesToV2(result.dependencyDAG.edges)
      });
      codegraph = result.codegraph;
      understandAnything = result.understandAnything;
    }
  }

  let crossPassEdges: readonly CrossPassEdge[] = [];
  let llmArbitrations: readonly LlmArbitration[] = [];
  if (passes.length > 1) {
    const mergeResult = await merge(passes, {
      projectRoot,
      ...(opts.llmRunner ? { llmRunner: opts.llmRunner } : {})
    });
    crossPassEdges = mergeResult.edges;
    llmArbitrations = mergeResult.llmCalls.map(toLlmArbitration);
  }

  return {
    schemaVersion: 'v2',
    rid,
    generatedAt: new Date().toISOString(),
    passes,
    crossPassEdges,
    llmArbitrations,
    codegraph,
    understandAnything,
    partial: false
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a v1 `WorkUnit` into a v2 `SliceV2`. The `granularity` is supplied
 * by the caller (per-pass) so it matches the pass's `PassResult.granularity`.
 * `id` and `parentSliceId` default to the workUnit's own id and null
 * (i.e. a Pass 1 slice). For Pass 2 children, the orchestrator supplies
 * `${parent.id}.${i + 1}` as the new id and the parent's id as parent.
 */
function workUnitToSliceV2(
  wu: WorkUnit,
  granularity: SliceGranularity,
  overrides: { readonly id?: string; readonly parentSliceId?: string | null } = {}
): SliceV2 {
  return {
    id: overrides.id ?? wu.id,
    label: wu.label,
    granularity,
    files: wu.files,
    loc: wu.loc,
    parentSliceId: overrides.parentSliceId ?? null,
    semanticAnchor: `file:${wu.filePath}`
  };
}

/**
 * Keep only workUnits that touch at least one file in the parent's scope.
 * Used to scope Pass 2 results to their parent slice's file set, since the
 * 6-stage algorithm does not accept a `scopeFilter` option.
 */
function filterWorkUnitsByScope(
  wus: readonly WorkUnit[],
  scope: readonly string[]
): WorkUnit[] {
  const scopeSet = new Set(scope);
  return wus.filter((wu) => wu.files.some((f) => scopeSet.has(f)));
}

/**
 * Map a v1 `DependencyEdge[]` (from the 6-stage algorithm's `dependencyDAG`)
 * to v2 `InternalEdge[]`. The two kinds unions are identical
 * (`'imports' | 'calls' | 'depends_on' | 'contains_flow' | 'flow_step'`), so
 * `kind` is a direct pass-through. `confidence` collapses `isSemantic`
 * (`true` → `'semantic'`, `false` → `'structural'`) to match the v2
 * `EdgeConfidence` union.
 */
function v1EdgesToV2(v1Edges: readonly DependencyEdge[]): InternalEdge[] {
  return v1Edges.map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
    weight: e.weight,
    evidence: e.evidence,
    confidence: e.isSemantic ? 'semantic' : 'structural'
  }));
}

/**
 * Pure shape pass-through from `MergeResult.llmCalls` to v2 `LlmArbitration`.
 * The merger now populates `promptHash`/`input`/`output`/`confidence` itself;
 * we just coalesce a possible `null` `tokens` to a zeroed pair to satisfy
 * the non-nullable `LlmArbitration.tokens` contract.
 */
function toLlmArbitration(c: LlmCallTrace): LlmArbitration {
  return {
    callId: c.callId,
    promptHash: c.promptHash,
    input: c.input,
    output: c.output,
    confidence: c.confidence,
    tokens: c.tokens ?? { input: 0, output: 0 }
  };
}

function zeroCodegraph(): CodegraphEnvelope {
  return {
    nodes: 0,
    edges: 0,
    dbMB: 0,
    freshness: 'unindexed',
    affectedCrossFile: false,
    note: 'no decomposition run'
  };
}

function zeroUnderstand(): UnderstandAnythingEnvelope {
  return {
    kgNodes: 0,
    kgEdges: 0,
    available: false,
    fallback: 'structural-only',
    note: 'no decomposition run'
  };
}
