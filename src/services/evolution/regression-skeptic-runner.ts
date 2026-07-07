import type {
  EvolutionProposal,
  EvolutionVerdict,
  IndependentEvaluatorResult,
  RegressionSkepticResult,
} from "./evolution-types.js";
import {
  buildEvaluationPackage,
  type EvaluationPackage,
} from "./independent-evaluator-runner.js";

/**
 * RegressionSkepticRunner — spec §6.1 #4 / AC-14.
 *
 * The regression skeptic is a SEPARATE sub-agent (independent of
 * the author AND the independent evaluator). Its job is to
 * REFUTE the proposal — find drift, overfit, and safety
 * regression risks. A `blocker` field is a hard revert signal:
 * the proposal cannot be promoted while a blocker stands.
 *
 * Inputs:
 *   - The same evaluation package the scorer sees
 *     (target_kind / target_release_id / optimization_dimension /
 *     before_snapshot / after_snapshot / diff / rubric /
 *     red_lines / source_traces).
 *   - The proposal verdict (from the post-evaluator aggregation).
 *   - The independent evaluator's result.
 *
 * Output: RegressionSkepticResult { driftRisks, overfitRisks,
 * safetyRegressionRisks, blocker? }.
 *
 * M4 ships a deterministic default skeptic that does NOT call an
 * LLM. The real LLM-backed skeptic lands in M5; the M4 unit tests
 * exercise the contract via a stub `invokeLlm` factory.
 */

/**
 * Optional LLM call factory for the skeptic. The default
 * implementation (`deterministicInvokeSkepticLlm`) is fully
 * deterministic; tests can swap in a stub.
 */
export type SkepticLlmInvoke = (
  pkg: EvaluationPackage,
  prompt: string
) => Promise<RegressionSkepticResult>;

/**
 * Build the prompt handed to the skeptic LLM. By construction
 * this contains the SAME evaluation package the scorer saw
 * (independent context: separate call, separate model, separate
 * session), the proposal verdict, and the evaluator's result.
 */
export function buildSkepticPrompt(
  pkg: EvaluationPackage,
  verdict: EvolutionVerdict,
  evaluatorResult: IndependentEvaluatorResult
): string {
  return [
    "You are the REGRESSION SKEPTIC for a Darwin-style ratchet.",
    "Your job is to REFUTE the proposal. Find drift, overfit,",
    "and safety regression risks. A `blocker` you emit is a HARD",
    "REVERT signal: the proposal cannot be promoted while any",
    "blocker stands (AC-14).",
    "",
    "Inputs:",
    `verdict (post-evaluator): ${verdict}`,
    `evaluator_score: ${evaluatorResult.score.toFixed(2)}`,
    `evaluator_riskTags: ${JSON.stringify(evaluatorResult.riskTags)}`,
    `evaluator_refuteParagraph: ${evaluatorResult.refuteParagraph}`,
    "",
    "Evaluation package:",
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
 * Default skeptic LLM call: deterministic, no LLM dependency.
 *
 * The default skeptic looks for three classes of risk:
 *   1. Drift: any red_line that is NEW in the after_snapshot and
 *      not present in the before_snapshot.
 *   2. Overfit: the diff mentions a tight `prompt_template` change
 *      without an accompanying rubric entry (proxy for prompt
 *      inflation).
 *   3. Safety regression: any red_line that the author DROPPED
 *      from the after_snapshot.
 *
 * The skeptic emits a `blocker` when (a) the evaluator's score
 * is below the after_score the author claimed AND a red_line
 * was dropped, or (b) the red_lines count grew by more than 0
 * (a "red line added" is treated as drift, not a hard blocker).
 */
export const deterministicInvokeSkepticLlm: SkepticLlmInvoke = async (
  pkg,
  prompt
) => {
  void prompt;
  const driftRisks: string[] = [];
  const overfitRisks: string[] = [];
  const safetyRegressionRisks: string[] = [];

  // (1) Drift: red_lines in the rubric package that the author
  // did not pass through. The deterministic stub treats any
  // package red_line as a drift signal.
  if (pkg.red_lines.length > 0) {
    driftRisks.push(
      `red_line(s) present but not addressed: ${pkg.red_lines.join("; ")}`
    );
  }

  // (2) Overfit: a diff with `prompt_template` or `gates_weakening`
  // keys without a rubric entry is a prompt-inflation / gate-
  // weakening signal.
  const diffKeys = Object.keys(pkg.diff);
  const hasPromptTemplateChange =
    diffKeys.includes("prompt_template") || diffKeys.includes("gates_weakening");
  const rubricHasCounter =
    Object.keys(pkg.rubric).length > 0;
  if (hasPromptTemplateChange && !rubricHasCounter) {
    overfitRisks.push(
      "diff touches prompt_template or gates_weakening without an explicit rubric counter — possible prompt inflation / gate weakening"
    );
  }

  // (3) Safety regression: dropped red_line is the canonical
  // signal; the stub flags it when the after_snapshot carries a
  // `dropped_red_lines` array.
  const dropped = (pkg.after_snapshot as Record<string, unknown>)[
    "dropped_red_lines"
  ];
  if (Array.isArray(dropped) && dropped.length > 0) {
    for (const entry of dropped) {
      if (typeof entry === "string") {
        safetyRegressionRisks.push(
          `red_line dropped from after_snapshot: ${entry}`
        );
      }
    }
  }

  // Blocker: a hard revert signal. Emit when safety regression is
  // non-empty (a dropped red line is a hard blocker per spec).
  let blocker: string | undefined;
  if (safetyRegressionRisks.length > 0) {
    blocker = `safety_regression: ${safetyRegressionRisks.length} red_line(s) dropped`;
  } else if (overfitRisks.length > 0) {
    // Overfit is a soft blocker; only emit a `blocker` if the
    // driftRisks also flag a new red line added (drift + overfit
    // together = hard block).
    if (driftRisks.length > 0) {
      blocker = `drift+overfit: ${driftRisks[0]}; ${overfitRisks[0]}`;
    }
  }

  return {
    driftRisks,
    overfitRisks,
    safetyRegressionRisks,
    ...(blocker !== undefined ? { blocker } : {}),
  };
};

/**
 * Public entry point: run the regression skeptic against the
 * evaluation package, the proposal verdict, and the independent
 * evaluator's result. The skeptic is a SEPARATE sub-agent call:
 * it does NOT share a context with the evaluator or the author.
 */
export async function runRegressionSkeptic(
  proposal: EvolutionProposal,
  verdict: EvolutionVerdict,
  evaluatorResult: IndependentEvaluatorResult,
  invokeLlm: SkepticLlmInvoke = deterministicInvokeSkepticLlm
): Promise<RegressionSkepticResult> {
  const pkg = buildEvaluationPackage(proposal);
  const prompt = buildSkepticPrompt(pkg, verdict, evaluatorResult);
  return await invokeLlm(pkg, prompt);
}
