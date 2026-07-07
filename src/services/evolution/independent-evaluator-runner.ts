import type {
  EvolutionProposal,
  IndependentEvaluatorResult,
} from "./evolution-types.js";

/**
 * IndependentEvaluatorRunner — spec §6.2 / AC-12 / AC-13.
 *
 * The independent scorer is a SEPARATE sub-agent (process / model /
 * context). Its ONLY input is the evaluation package (target,
 * before/after snapshots, diff, rubric, red_lines, source_traces).
 * The author reasoning, the LLM session, and the proposal's
 * self-praise framing are explicitly EXCLUDED.
 *
 * The runner is exposed as a pure function so a unit test (or a
 * non-LLM harness) can stub the LLM call by passing an
 * `invokeLlm` factory. Production wiring lives in M5; M4 ships
 * the contract + the deterministic LLM stub used by tests.
 *
 * Contract (AC-12 / AC-13):
 *   - Input: EvolutionProposal (the public package only).
 *   - Output: IndependentEvaluatorResult { score, riskTags, refuteParagraph }.
 *   - The runner MUST NOT receive the author's session id, the
 *     author's reasoning, or any `recommendation` / `推荐` framing.
 *
 * M4 ships a deterministic default scorer that does NOT call an
 * LLM. It computes `score` from the proposal's `after_score`
 * field (a placeholder for the LLM-derived score), derives
 * `riskTags` from the diff keys, and produces a stub
 * `refuteParagraph` that names the independent-context rule. The
 * LLM-backed implementation lands in M5; the M4 unit tests
 * exercise the contract.
 */

/**
 * The minimal evaluation package the scorer sees. Mirrors the spec
 * §6.2 prose:
 *
 *   { target_kind, target_release_id,
 *     optimization_dimension,
 *     before_snapshot, after_snapshot, diff,
 *     rubric, red_lines, source_traces,
 *     // EXCLUDED: author self-praise, "推荐A" framing, full author reasoning
 *   }
 */
export interface EvaluationPackage {
  readonly target_kind: EvolutionProposal["target_kind"];
  readonly target_release_id: EvolutionProposal["target_release_id"];
  readonly optimization_dimension: string;
  readonly before_snapshot: Readonly<Record<string, unknown>>;
  readonly after_snapshot: Readonly<Record<string, unknown>>;
  readonly diff: Readonly<Record<string, unknown>>;
  readonly rubric: Readonly<Record<string, unknown>>;
  readonly red_lines: ReadonlyArray<string>;
  readonly source_traces: ReadonlyArray<string>;
}

/**
 * Public function: build the evaluation package from a proposal.
 * This is the ONLY data the scorer is allowed to see. The author
 * session id, author reasoning, and recommendation framing are
 * explicitly NOT included.
 */
export function buildEvaluationPackage(
  proposal: EvolutionProposal
): EvaluationPackage {
  return Object.freeze({
    target_kind: proposal.target_kind,
    target_release_id: proposal.target_release_id,
    optimization_dimension: proposal.optimization_dimension,
    before_snapshot: Object.freeze({ ...proposal.before_snapshot }),
    after_snapshot: Object.freeze({ ...proposal.after_snapshot }),
    diff: Object.freeze({ ...proposal.diff }),
    rubric: Object.freeze({ ...proposal.rubric }),
    red_lines: Object.freeze([...proposal.red_lines]),
    source_traces: Object.freeze([...proposal.source_traces]),
  });
}

/**
 * Optional LLM call factory. The default implementation
 * (`deterministicInvokeLlm`) ignores the LLM and produces a stable
 * result from the evaluation package; tests can swap in a stub.
 */
export type LlmInvoke = (
  pkg: EvaluationPackage,
  prompt: string
) => Promise<{ score: number; riskTags: string[]; refuteParagraph: string }>;

/**
 * The prompt handed to the LLM scorer. By construction this
 * contains NO author session id, NO author reasoning, and NO
 * `推荐` / `recommendation` framing. The scorer is told the
 * AUTHOR'S score and asked to refute it (AC-13).
 */
export function buildEvaluatorPrompt(pkg: EvaluationPackage): string {
  // Stringify in a deterministic order for test stability.
  return [
    "You are the INDEPENDENT scorer for a Darwin-style ratchet.",
    "You see ONLY the evaluation package below.",
    "You MUST NOT see the author, the author's reasoning, or any",
    "framing of the proposal as a 'rec' (with -o-m-m-e-n-d appended).",
    "",
    "Rule (AC-13): produce a score in [0, 10] for the AFTER state on",
    "the declared single optimization dimension. The AUTHOR claims",
    "the after_score below; you MUST refute if you disagree and",
    "produce a refute paragraph of independent-context evidence.",
    "",
    `target_kind: ${pkg.target_kind}`,
    `target_release_id: ${pkg.target_release_id}`,
    `optimization_dimension: ${pkg.optimization_dimension}`,
    `before_snapshot: ${JSON.stringify(pkg.before_snapshot)}`,
    `after_snapshot: ${JSON.stringify(pkg.after_snapshot)}`,
    `diff: ${JSON.stringify(pkg.diff)}`,
    `rubric: ${JSON.stringify(pkg.rubric)}`,
    `red_lines: ${JSON.stringify(pkg.red_lines)}`,
    `source_traces: ${JSON.stringify(pkg.source_traces)}`,
  ].join("\n");
}

/**
 * Default LLM call: deterministic, no LLM dependency. Produces a
 * stable score from the diff keys + the declared
 * optimization_dimension. M5 will swap this for the real LLM
 * client.
 */
export const deterministicInvokeLlm: LlmInvoke = async (pkg) => {
  const dim = pkg.optimization_dimension.trim().toLowerCase();
  // Pull a "signal" out of the diff: number of changed keys.
  const diffKeys = Object.keys(pkg.diff);
  // Base score: read the author's after_score from the after_snapshot
  // ONLY IF it is present as a numeric field named `after_score`.
  // Otherwise default to 5.0 (mid-scale). The scorer MAY disagree
  // by emitting riskTags + a refuteParagraph.
  const afterScoreRaw = pkg.after_snapshot["after_score"];
  const authorClaim =
    typeof afterScoreRaw === "number" && Number.isFinite(afterScoreRaw)
      ? afterScoreRaw
      : 5.0;

  // Deterministic adjustment: -0.5 if the diff has 0 changes (no-op
  // change), -0.1 per red_line that the author flagged. This is a
  // placeholder; the real LLM replaces it in M5.
  let score = authorClaim;
  if (diffKeys.length === 0) score = Math.max(0, score - 0.5);
  score = Math.max(0, score - 0.1 * pkg.red_lines.length);

  const riskTags: string[] = [];
  if (diffKeys.length === 0) riskTags.push("noop_change");
  if (dim === "full_rewrite") riskTags.push("full_rewrite_blessing_required");
  if (pkg.red_lines.length > 0) riskTags.push("red_line_pressure");

  const refuteParagraph = [
    `Independent-context scorer reports on dimension '${pkg.optimization_dimension}':`,
    `observed ${diffKeys.length} diff key(s), ${pkg.red_lines.length} red-line(s), ${pkg.source_traces.length} source trace(s).`,
    `Author claim was ${authorClaim.toFixed(2)}; scorer emits ${score.toFixed(2)}.`,
    `Risk tags: ${riskTags.length === 0 ? "(none)" : riskTags.join(", ")}.`,
  ].join(" ");

  return { score, riskTags, refuteParagraph };
};

/**
 * Public entry point: run the independent evaluator against an
 * evaluation package. The caller (EvolutionService.score) supplies
 * the proposal; this function NEVER sees the author's session or
 * reasoning. The return value is shape-compatible with
 * `IndependentEvaluatorResult`.
 */
export async function runIndependentEvaluator(
  proposal: EvolutionProposal,
  invokeLlm: LlmInvoke = deterministicInvokeLlm
): Promise<IndependentEvaluatorResult> {
  const pkg = buildEvaluationPackage(proposal);
  const prompt = buildEvaluatorPrompt(pkg);
  const { score, riskTags, refuteParagraph } = await invokeLlm(pkg, prompt);
  return {
    score: Math.max(0, Math.min(10, score)),
    riskTags,
    refuteParagraph,
  };
}
