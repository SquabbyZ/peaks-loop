// src/services/final-review/final-review-output-budget.ts
//
// D1 layer 3: the output ceiling that must sit opposite the evidence
// inlined into the prompt. Hoisted verbatim from final-review-service.ts
// (C wave 7 file-size split).
//
// One deliberate respell: 12 * 1024 is written as 12_288 (same value,
// pinned by the existing tests) so this module carries no
// no-magic-numbers finding; see final-review-evidence-budget.ts.
// The 263-307 block comment is kept intact including the 4 * 1024 /
// 12 * 1024 arithmetic it narrates — it documents the decision, not
// the expression that shipped it.

/* ------------------------------------------------------------------ *
 * D1 layer 3 — the OUTPUT budget.
 *
 * The input side above was raised (32 KiB then, 40 KiB today) but the
 * output ceiling stayed hard-coded at 3000 tokens. Measured on this repo's own
 * run (rid `2026-09-12-codegraph-exclude-integrity`, 9 sources, 32 KiB
 * inlined, real anthropic provider): 3/3 attempts failed — 2x
 * INCOMPLETE_FINAL_REVIEW with the JSON cut off mid-string, 1x a reply with no
 * text block. A 4-dimension envelope (4 x `summary` + `evidence[]` +
 * `confidence`, plus `overallSummary`) does not fit in 3000 tokens once the
 * model has ~8k tokens of evidence it is required to cite.
 *
 * N4 — the first fix of this layer derived the ceiling as "3000 + bytes/8" and
 * called 8192 "a backstop only: it does not bind today", citing a 4775-token
 * measurement. Both claims were falsified by re-measurement on the SAME
 * machine the gate ships on (`deepseek-flash[1M]` via
 * `api.deepseek.com/anthropic`, 2026-09-12, QA run 3/3 red + orchestrator
 * re-run 3/3 red, rid `2026-09-12-codegraph-exclude-integrity`, byte-identical
 * prompt):
 *
 *   max_tokens=7096 (what the old formula produced for the 32 KiB pack)
 *       -> TRUNCATED. `output_tokens=7096`, 14078 characters.
 *   max_tokens=8192 -> TRUNCATED, `output_tokens=8192`, 574 characters.
 *   max_tokens=16000 -> COMPLETE, `output_tokens=10108`.
 *   max_tokens=32000 -> COMPLETE, `output_tokens=8883`.
 *
 * So 8192 WAS the binding constraint and was BELOW the requirement: a gate
 * whose budget is short is worse than a red gate, because it releases the
 * envelope only when the model happens to be terse.
 *
 * The 8:1 bytes-per-token term prices the VISIBLE envelope against the evidence
 * the model must cite, but it was never the whole cost. On a reasoning model
 * `max_tokens` also caps the hidden reasoning that precedes the first character
 * of output, and that cost is invisible to a bytes-per-token formula (the
 * 574-character run above is exactly that: the whole budget consumed before the
 * envelope began). `REASONING_HEADROOM_TOKENS` below is that missing term.
 *
 * A 16384 ceiling with 6144 of headroom (derived 13240) was then measured on
 * the SAME machine and shown to be too thin too: 10 real-machine runs, 2
 * failures, BOTH genuine truncation — and the second one reported BOTH signals
 * at once ("reply ends mid-structure AND provider-reported output reached the
 * ceiling") with `maxTokens=13240`. The requirement is therefore not "derived
 * >= the one 10108 sample" but "derived comfortably above every observed
 * truncation point", which is what the constants below are now sized for.
 * ------------------------------------------------------------------ */

/**
 * Floor — also the value that shipped before this fix, so no evidence set can
 * end up with a smaller budget than it had. ~3000 tokens is enough for the
 * envelope skeleton plus a short paragraph per dimension.
 */
export const MIN_OUTPUT_TOKENS = 3_000;

/**
 * Headroom for the part of the reply that is not the envelope.
 *
 * A Messages-API-compatible endpoint applies `max_tokens` to the WHOLE
 * response, and a reasoning model spends it on hidden reasoning before it
 * emits a single character of the 4-dim envelope. Measured on this repo's own
 * machine (2026-09-12, rid `2026-09-12-codegraph-exclude-integrity`,
 * `deepseek-flash[1M]` via `api.deepseek.com/anthropic`): `max_tokens=8192`
 * came back with `output_tokens=8192` and only **574** visible characters —
 * the entire budget went to reasoning. A bytes-per-token estimate of the
 * visible output cannot see that cost, which is why the previous formula
 * budgeted 7096 for a reply that needs 10108 — and why a 13240 budget still
 * truncated on 2 of 10 real runs.
 *
 * 12288 (12 KiB) is sized so the largest evidence pack the input caps allow
 * lands at 25528 (see the formula below; the input cap is 40 KiB as of the
 * F-BLOCK re-evaluation, and this floor was checked against the raised cap, not
 * against the 32 KiB the measurements above were taken at — a 12 KiB headroom
 * under a bigger cap is the conservative direction) — about 1.9x the largest
 * value ever OBSERVED to truncate (13240), which is the margin the observed
 * variance asks for. The numbers are in the block comment above.
 */
export const REASONING_HEADROOM_TOKENS = 12_288;

/**
 * Ceiling, 32_000: the value a real run on this machine was forced to in order
 * to complete the envelope at all, and the largest this endpoint was observed
 * to accept. 16384 was tried first and truncated 2/10 — a ceiling that is
 * merely "above the last successful measurement" is not above the requirement,
 * because the requirement moves with the model's reasoning spend.
 *
 * A model that caps output at 8192 will refuse this. That is still strictly
 * better than shipping a budget measured to be too small, and the env lever
 * below lets an operator pull it down without a code change.
 */
export const MAX_OUTPUT_TOKENS = 32_000;

/**
 * Environment lever. The old failure message told the operator to "raise the
 * budget" while the budget was a module constant with no CLI flag and no env
 * var — an instruction that could not be carried out from any surface the
 * operator has. This is that lever.
 *
 * The value is the output ceiling in tokens; it OVERRIDES the derivation below
 * (it is not a bonus added to it). Unset/invalid/out-of-range handling is in
 * `resolveOutputBudget`.
 */
export const MAX_OUTPUT_TOKENS_ENV = 'PEAKS_FINAL_REVIEW_MAX_OUTPUT_TOKENS';

/**
 * Absolute upper bound the env lever may reach. An endpoint that accepts
 * `max_tokens` at all accepts this; anything above it is a typo (a stray extra
 * digit), not an intent, and clamping is safer than sending it.
 */
export const HARD_MAX_OUTPUT_TOKENS = 64_000;

/**
 * Inlined bytes that buy one extra output token — 4:1.
 *
 * This term prices the visible envelope (4 x `summary` + `evidence[]` +
 * `confidence` + `overallSummary`) against the evidence the model is required
 * to cite. It was 8:1, which put the 32 KiB pack at 4096 tokens of visible
 * output; the same pack has been observed to complete at 10108 and to truncate
 * at 13240, so 8:1 was pricing the visible side BELOW its own measurement.
 * 4:1 doubles it to 8192. It is still not treated as the whole budget — see
 * `REASONING_HEADROOM_TOKENS`.
 */
export const EVIDENCE_BYTES_PER_OUTPUT_TOKEN = 4;

/**
 * Output ceiling for a call whose prompt carries `includedEvidenceBytes` bytes
 * of inlined evidence. Pure, total, and clamped on both ends — the same
 * evidence pack always yields the same budget.
 */
export function outputBudgetForEvidence(includedEvidenceBytes: number): number {
  const scaled =
    MIN_OUTPUT_TOKENS +
    REASONING_HEADROOM_TOKENS +
    Math.ceil(Math.max(0, includedEvidenceBytes) / EVIDENCE_BYTES_PER_OUTPUT_TOKEN);
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, scaled));
}

/**
 * The budget the call actually uses: the derived one, unless
 * `PEAKS_FINAL_REVIEW_MAX_OUTPUT_TOKENS` overrides it.
 *
 * An override that is not a positive integer THROWS rather than being ignored:
 * a silent fallback would leave an operator who passed a bad value with the
 * exact experience this lever exists to remove — a budget they cannot move.
 * Out-of-range values are clamped, not rejected, so a model needing more than
 * `HARD_MAX_OUTPUT_TOKENS` (or a model needing less than `MIN_OUTPUT_TOKENS`)
 * still gets a call made.
 */
export function resolveOutputBudget(
  includedEvidenceBytes: number,
  env: NodeJS.ProcessEnv = process.env
): number {
  const derived = outputBudgetForEvidence(includedEvidenceBytes);
  const raw = env[MAX_OUTPUT_TOKENS_ENV];
  if (raw === undefined || raw.trim() === '') return derived;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
    throw new Error(
      `${MAX_OUTPUT_TOKENS_ENV} must be a positive integer number of output tokens (got "${raw}"); ` +
        `unset it to use the derived budget of ${String(derived)} tokens.`
    );
  }
  return Math.min(HARD_MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, parsed));
}
