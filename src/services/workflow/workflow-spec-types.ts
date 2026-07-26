/**
 * peaks-workflow v3.0.0 — Slice A.1 + Slice B.1
 *
 * Public type and interface declarations for the workflow spec schema.
 * Pure data shapes only — no constants, no runtime helpers, no
 * implementations. Constants (`ID_PATTERN`, `VALID_EVALUATORS`)
 * remain private to `workflow-spec.ts`; the YAML field helpers
 * live in `workflow-spec-yaml.ts`; the lint function lives in
 * `workflow-spec-lint.ts`.
 *
 * File budget: ≤ 400 lines (rid-006 split).
 */

/** A workflow phase = a single step the runtime executes. */
export interface WorkflowPhase {
  /** Stable id within the workflow (kebab-case). Used as the SOP gate key. */
  readonly id: string;
  /** peaks-* role that runs the phase (e.g. "peaks-rd"). */
  readonly role: string;
  /** Free-text prompt template sent to the role. */
  readonly promptTemplate: string;
  /** Phase-level gate references; runtime looks up the SOP gate by id. */
  readonly gates: readonly string[];
  /** Output contract — keys the runtime should expect in the role's verdict. */
  readonly outputContract: readonly string[];
  /** Optional ordered list of sibling phase ids that must complete first. */
  readonly dependsOn?: readonly string[];
  /** When true, runtime may run this phase in parallel with siblings at the same depth. */
  readonly parallelGroup?: string;
}

/** A gate entry is a thin pointer to a peaks-sop gate; the gate definition
 *  itself lives in peaks-sop, never in the workflow yaml. */
export interface WorkflowGate {
  /** Gate id (matches peaks-sop gate-id). */
  readonly id: string;
  /** SOP id that owns the gate definition. */
  readonly sopId: string;
  /** Optional human-readable hint shown when the gate fails. */
  readonly description?: string;
}

/** Native evaluator types — the 4 reviewer fan-out members + verdict aggregator
 *  + Slice C monotonic-improvement guard + Slice D G13/G14/G15 quality-loop
 *  primitives. Sketch-grade: the 3 quality-loop evaluators shell out to
 *  existing `peaks impact scan`, `peaks smoke run`, and
 *  `peaks release canary` CLI surfaces. The authoritative score
 *  conversion for the monotonic guard lives in
 *  `src/services/loop/monotonic-guard.ts`. */
export type EvaluatorKind =
  | 'karpathy'              // 4 Karpathy guidelines review
  | 'code-review'           // peaks-rd code-reviewer
  | 'security-review'       // peaks-security-audit
  | 'perf-baseline'         // peaks-perf-audit
  | 'verdict-aggregate'     // cross-source verdict merge
  | 'monotonic-improvement' // Slice C: per-evaluator monotonic score check
  | 'impact-scan'           // Slice D / G13: peaks impact scan
  | 'smoke-run'             // Slice D / G14: peaks smoke run
  | 'canary-watch';         // Slice D / G15: peaks release canary

/** Evaluator binding — runtime calls `peaks loop eval` directly, no LLM scheduling. */
export interface WorkflowEvaluator {
  readonly type: EvaluatorKind;
  /** Optional gate id this evaluator produces evidence for (e.g. "Gate B3"). */
  readonly gate?: string;
  /** Optional scope expression (path or glob) — kept as string for v3.0.0. */
  readonly scope?: string;
  /** Optional SLA threshold (evaluator-specific; evaluators interpret their own scale). */
  readonly threshold?: string;
}

/** Context snapshot — files + scope the role/worker should preload. */
export interface WorkflowContextSnapshot {
  /** Files the role should read before running (paths, relative to project root). */
  readonly files: readonly string[];
  /** Optional memory anchors (e.g. ".peaks/memory/parked-peaks-workflow-primitive.md"). */
  readonly memory: readonly string[];
}

/** Budget caps — runtime stops the loop when any cap is exceeded. */
export interface WorkflowBudget {
  /** Hard token cap (sum of role invocations + evaluator outputs). */
  readonly tokens?: number;
  /** Wall-clock cap in seconds. */
  readonly wallSeconds?: number;
  /** Cycle cap — maximum repair iterations before guard aborts. */
  readonly cycles?: number;
}

export interface WorkflowSpec {
  /** Schema version; always 1 for v3.0.0. */
  readonly schemaVersion: 1;
  /** Stable id (matches filename `<id>.yaml`). */
  readonly id: string;
  /** Human-readable label shown in `peaks workflow list`. */
  readonly label: string;
  /** Description; one short paragraph. */
  readonly description: string;
  /** Phases in declaration order; runtime may parallelize siblings within a group. */
  readonly phases: readonly WorkflowPhase[];
  /** Gates referenced by phases; runtime resolves them via peaks-sop. */
  readonly gates: readonly WorkflowGate[];
  /** Native evaluators the runtime should invoke. */
  readonly evaluators: readonly WorkflowEvaluator[];
  /** Context snapshot for the workflow. */
  readonly contextSnapshot: WorkflowContextSnapshot;
  /** Budget caps. */
  readonly budget: WorkflowBudget;
}

/** Result of `lintWorkflowSpec` — pure data, never throws. */
export interface WorkflowLintReport {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly normalizedSpec?: WorkflowSpec;
}