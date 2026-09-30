/**
 * Slice DAG type surface — moved VERBATIM out of `slice-dag.ts` for the
 * 300-raw-line cap (slice `b1-filesplit-campaign`, wave 3C). No behavior
 * lives here: node/edge model types, the complexity tier, and the two
 * error classes, plus the wave-plan envelopes. `slice-dag.ts` re-exports
 * every name from this module, so all existing import paths keep working.
 */

/**
 * Slice complexity tier (v2.15.0 follow-up, G2 in 12 Gaps).
 * Used by Code to schedule complex slices during user-attended hours
 * and trivial / simple slices overnight.
 */
export type SliceComplexity = 'trivial' | 'simple' | 'complex';

export const SLICE_COMPLEXITIES: readonly SliceComplexity[] = [
  'trivial',
  'simple',
  'complex'
] as const;

export function isSliceComplexity(value: string): value is SliceComplexity {
  return (SLICE_COMPLEXITIES as readonly string[]).includes(value);
}

export interface SliceNode {
  readonly id: string;
  readonly role: string;
  /** Human-readable label, optional. */
  readonly label?: string;
  /** Optional prompt override; dispatch falls back to a default placeholder. */
  readonly prompt?: string;
  /**
   * v2.15.0 follow-up — G12: foundation slice. Foundation slices run before
   * business slices in the layered DAG. Business slices do NOT wait for
   * ALL foundation slices — they wait only for the foundation subset
   * they declare as `dependsOn`. Optional; default false.
   */
  readonly foundation?: boolean;
  /**
   * v2.15.0 follow-up — G11: upstream sync slice. Marks a slice that
   * syncs an upstream fork (e.g. hermes) to a new tag. UpstreamSync
   * slices take priority within their topological level. Optional.
   */
  readonly upstreamSync?: boolean;
  /**
   * v2.15.0 follow-up — G2: complexity tier. Drives Code's scheduling
   * (complex = user-attended, simple/trivial = overnight). Optional.
   */
  readonly complexity?: SliceComplexity;
  /**
   * Slice 2026-09-10-dispatch-token-and-swarm §3: files this slice is
   * expected to touch. When EVERY node of a topological level declares
   * `files`, `--from-dag` emits a file-overlap wave plan (`firstLevelWaves`)
   * so the LLM can fan the level out without serializing on a shared file.
   * Optional and additive: absent → DAG hash and dispatch behavior are
   * byte-identical to before this slice.
   */
  readonly files?: readonly string[];
}

export interface DependsOn {
  readonly from: string;
  readonly to: string;
}

export interface SliceDag {
  readonly nodes: readonly SliceNode[];
  readonly edges: readonly DependsOn[];
}

/** Thrown by `validateDag` when the graph violates one of the constraints. */
export class InvalidSliceDagError extends Error {
  readonly code = 'INVALID_SLICE_DAG' as const;
  constructor(
    message: string,
    public readonly path?: readonly string[]
  ) {
    super(message);
    this.name = 'InvalidSliceDagError';
  }
}

/** Thrown by `topologicalLevels` when the graph has a cycle (defensive). */
export class SliceDagCycleError extends Error {
  readonly code = 'SLICE_DAG_CYCLE' as const;
  constructor(public readonly cyclePath: readonly string[]) {
    super(`cycle detected in slice DAG: ${cyclePath.join(' -> ')}`);
    this.name = 'SliceDagCycleError';
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Slice 2026-07-28 — DAG wave + barrier types (rid-029 E direction).
 *
 * The E direction adds per-wave concurrency cap (default 6 leaves per
 * wave) and artifact-pass (WaveArtifact envelope flowing into next wave's
 * prompt). See dag-orchestrator.ts `planDispatchWaves` /
 * `runWaveWithArtifacts` for usage.
 *
 * Backward compatibility: types are additive only. Existing
 * `DispatchSpec` flows and `planDispatch(dag)` callers are untouched.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Knobs for wave planning + artifact-pass behaviour.
 *
 * - `maxConcurrency`: hard cap on how many slices a single Wave can hold.
 *   Each topological level is chunked into Waves of at most this many
 *   slice IDs (default 6 per `2026-07-28-24h-loop-audit.md` E direction).
 * - `passArtifacts`: when true, each Wave's prompt is augmented with a
 *   `WaveArtifact` envelope (contracts of preceding Waves). Default
 *   false — the existing `runDag` ancestor-injection path already covers
 *   per-slice contract coverage.
 */
export interface WaveOptions {
  readonly maxConcurrency: number;
  readonly passArtifacts: boolean;
}

/** Default wave options: 6 leaves per wave; artifact-pass off. */
export const DEFAULT_MAX_CONCURRENCY = 6;

export const DEFAULT_WAVE_OPTIONS: WaveOptions = {
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  passArtifacts: false
};

/**
 * Artifact envelope emitted when a Wave completes successfully.
 *
 * - `waveIndex`: sequential, 0-based across the whole plan.
 * - `completedLeaves`: slice IDs that finished (`status: 'done'`). Failed
 *    or cancelled leaves are NOT included.
 * - `contracts`: per-slice public contract snapshot (sliceId → record).
 *    Stored verbatim so a downstream Wave can re-inject this without
 *    re-reading the disk-side contract store.
 * - `passedAt`: ISO timestamp of Wave completion (caller-supplied to keep
 *    the surface pure).
 */
export interface WaveArtifact {
  readonly waveIndex: number;
  readonly completedLeaves: readonly string[];
  readonly contracts: Readonly<Record<string, unknown>>;
  readonly passedAt: string;
}

/**
 * A single dispatch Wave. Holds the slice IDs that must execute together,
 * respecting `WaveOptions.maxConcurrency`. Waves are emitted in
 * topological order; downstream consumers may treat `waveIndex` as a
 * monotonic cursor.
 */
export interface Wave {
  readonly waveIndex: number;
  readonly slices: readonly string[];
}
