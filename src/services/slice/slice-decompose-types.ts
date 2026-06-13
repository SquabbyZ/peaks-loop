/**
 * Type envelope for `peaks slice decompose` and its outputs.
 *
 * The slice-decomposition algorithm is a 6-stage deterministic function
 * (see `peaks-solo/references/slice-algorithm.md` for the full spec):
 *
 *   1. workUnitResolution  -- codegraph.query + knowledge_graph.grep
 *   2. buildDependencyDAG  -- real import edges + codegraph.affected fallback
 *   3. scc + criticalPath  -- Tarjan + longest_path on the condensation
 *   4. minCut              -- Stoer-Wagner with semantic-preference weights
 *   5. estimateWork        -- calibration-store (LoC+test heuristic v1)
 *   6. emit                -- serialise DecompositionResult to JSON
 *
 * The pure function is `decomposeSlices(rid, prdMarkdown, projectRoot, options)`
 * (exported from `slice-decompose-service.ts`). All types in this file are
 * stable input/output contracts; do not change field names without a
 * migration path because the JSON envelope is consumed by:
 *
 *   - `peaks slice pick` (reads candidates, spawns fzf)
 *   - `peaks slice plan` (reads picked batch, calls peaks request init)
 *   - `peaks-rd` and `peaks-qa` in unit tests
 *   - user inspection via `cat .peaks/sc/slice-decomposition/<rid>.json`
 *
 * Codegraph is local project-analysis evidence; its output is
 * **untrusted supporting evidence**, never authoritative for QA verdict.
 * DecompositionResult fields derived from codegraph are tagged with
 * `confidence: 'semantic' | 'structural'` so downstream consumers can
 * discount structural-only cuts.
 */

export type EdgeKind = 'imports' | 'depends_on' | 'calls' | 'contains_flow' | 'flow_step';

export interface WorkUnit {
  /** Stable id within the decomposition; usually "W1".."Wn". */
  id: string;
  /** Human-readable label; shown in `peaks slice pick` fzf list. */
  label: string;
  /** Primary files this work unit touches (1-N). */
  files: readonly string[];
  /** Total LoC across all `files`. */
  loc: number;
  /** Number of test files this work unit adds (0 if none). */
  testsAdded: number;
  /** If any file in `files` pre-existed, the sum of delta-LoC; undefined if all files are new. */
  deltaLoc?: number;
  /** The primary file path; the algorithm picks the largest file as primary. */
  filePath: string;
  /** Graph node ids (file:<path> | function:<path>:<name>) that resolved this work unit. */
  candidates: readonly string[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /**
   * Edge weight for Stoer-Wagner. Lower weight = prefer to cut here.
   * Locked values: flow_step=0.05, contains_flow=0.1, depends_on=5.0, calls=8.0, imports=10.0.
   */
  weight: number;
  /** Human-readable evidence: the actual import statement or graph edge. */
  evidence: string;
  /** True iff kind is contains_flow or flow_step (i.e. from understand-anything). */
  isSemantic: boolean;
  /** 'semantic' if the edge came from understand-anything; 'structural' if from import-grep or codegraph. */
  confidence: 'semantic' | 'structural';
}

export interface WorkEstimate {
  complexitySum: number;
  testCount: number;
  locSum: number;
  minutesP50: number;
  minutesP90: number;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
}

export interface SliceCandidate {
  rid: string;
  label: string;
  files: readonly string[];
  testsAdded?: readonly string[];
  estimate: WorkEstimate;
  /** Domain anchor; "domain:<name>" if understand-anything indexed, else "file:<path>". */
  semanticAnchor: string;
}

export interface ParallelBatch {
  batch: number;
  dependsOn: readonly number[];
  slices: readonly SliceCandidate[];
  parallelizableWithinBatch: boolean;
}

export interface SccAnalysis {
  sccCount: number;
  trivialSCCs: readonly string[];
  nonTrivialSCCs: readonly string[];
  condensationEdges: number;
}

export interface CriticalPath {
  nodes: readonly string[];
  edges: readonly string[]; // "<from> -> <to>" pairs
  totalLoc: number;
  totalDeltaLoc: number;
  rationale: string;
}

export interface MinCutEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  isSemantic: boolean;
  confidence: 'semantic' | 'structural';
}

export interface MinCutPartition {
  name: string;
  nodes: readonly string[];
}

export interface MinCutResult {
  algorithm: string;
  cutEdges: readonly MinCutEdge[];
  partitions: readonly MinCutPartition[];
}

export interface CodegraphEnvelope {
  nodes: number;
  edges: number;
  dbMB: number;
  /** Git commit SHA at which the codegraph index was built, or 'unindexed'. */
  freshness: string;
  /** True iff codegraph.affected returned > 0 cross-file dependents. */
  affectedCrossFile: boolean;
  note: string;
}

export interface UnderstandAnythingEnvelope {
  kgNodes: number;
  kgEdges: number;
  available: boolean;
  fallback: 'semantic' | 'structural-only';
  note: string;
}

export interface DecompositionResult {
  rid: string;
  /** ISO 8601 UTC, e.g. "2026-06-13T12:00:00.000Z". */
  generatedAt: string;
  codegraph: CodegraphEnvelope;
  understandAnything: UnderstandAnythingEnvelope;
  workUnits: readonly WorkUnit[];
  dependencyDAG: { edges: readonly DependencyEdge[] };
  sccAnalysis: SccAnalysis;
  criticalPath: CriticalPath;
  minCutResult: MinCutResult;
  parallelBatches: readonly ParallelBatch[];
  /** Free-form operator hint; e.g. "split into multiple pick sessions" when N > 10. */
  pickHint?: string;
}

/**
 * Per-run metrics for the 2.1.1 algorithm. Emitted only when
 * `peaks slice decompose --benchmark` is passed. The shape is stable
 * across algorithm versions so it can be diffed across runs.
 */
export interface SliceBenchmark {
  rid: string;
  totalMs: number;
  /** Codegraph calls observed during the run (query + status + affected). */
  codegraphQueries: number;
  /** Distribution of slice estimate.confidence across all batches. */
  p50ConfidenceDistribution: { low: number; mid: number; high: number };
  /** Approximate input bytes (PRD body + work-units + codegraph hits, post-load). */
  inputApproxBytes: { prd: number };
  /** Bytes of the serialized decomposition JSON. */
  outputJsonBytes: number;
  capturedAt: string;
}

export interface DecomposeOptions {
  /** When true, re-run `peaks codegraph index` before reading. */
  refresh?: boolean;
  /**
   * Inject a codegraph-shell replacement. The default uses `peaks codegraph` CLI.
   * Tests pass a function-returning-promise fake.
   */
  codegraphRunner?: CodegraphRunner;
  /**
   * Inject an understand-anything shell replacement. Default reads
   * `.understand-anything/knowledge-graph.json` if present.
   */
  understandRunner?: UnderstandRunner;
  /**
   * Inject a function that returns the real import-edge set for a list of files.
   * Default: spawns `git grep` + parses output. Tests pass a synchronous fake.
   */
  importEdgeRunner?: ImportEdgeRunner;
}

export interface CodegraphRunner {
  query(text: string, projectRoot: string): Promise<readonly CodegraphQueryHit[]>;
  affected(files: readonly string[], projectRoot: string): Promise<CodegraphAffectedResult>;
  status(projectRoot: string): Promise<{ indexed: boolean; nodes: number; edges: number; dbMB: number; freshness: string }>;
}

export interface CodegraphQueryHit {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  score: number;
  /** Optional LoC, when codegraph can report it; used for work estimates. */
  loc?: number;
}

export interface CodegraphAffectedResult {
  changedFiles: readonly string[];
  affectedTests: readonly string[];
  totalDependentsTraversed: number;
}

export interface UnderstandRunner {
  /** Returns the parsed knowledge graph, or null if not indexed. */
  read(projectRoot: string): Promise<KnowledgeGraph | null>;
}

export interface KnowledgeGraph {
  nodes: readonly KgNode[];
  edges: readonly KgEdge[];
  layers: readonly { id: string; name: string; nodeIds: readonly string[] }[];
}

export type KgNodeType =
  | 'file' | 'function' | 'class' | 'module' | 'concept'
  | 'config' | 'document' | 'service' | 'table' | 'endpoint'
  | 'pipeline' | 'schema' | 'resource' | 'domain' | 'flow' | 'step';

export interface KgNode {
  id: string;
  type: KgNodeType;
  name: string;
  filePath?: string;
  summary?: string;
  tags: readonly string[];
  complexity?: number;
}

export interface KgEdge {
  source: string;
  target: string;
  type: string; // imports | contains | calls | depends_on | configures | documents | deploys | triggers | contains_flow | flow_step | related | cites
  weight?: number;
}

export interface ImportEdgeRunner {
  /**
   * Returns real static import edges for the given file paths.
   * For each file, parses the `import ... from '...'` statements and resolves
   * relative paths to project-relative paths.
   * Output: array of {from, to, evidence} where `evidence` is the import line.
   */
  importsOf(projectRoot: string, files: readonly string[]): Promise<readonly ImportEdge[]>;
}

export interface ImportEdge {
  from: string; // project-relative
  to: string;   // project-relative
  evidence: string; // the import statement
}
