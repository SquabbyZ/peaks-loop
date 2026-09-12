import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Inline copy of LlmRunner interface from src/services/audit/audit-goal-service.ts.
// Carried into peaks-loop/final-review so the module stays self-contained.
// (no back-dep on main peaks-loop, which would create a workspace:* circular
// trap). Source of truth lives in audit/audit-goal-service.ts.
export interface LlmRunner {
  call(
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens: number }
  ): Promise<{
    output: string;
    tokens: { input: number; output: number };
  }>;
}
type _LlmRunnerRef = LlmRunner;
import type {
  DimensionEvidence,
  DimensionKind,
  EvidenceItem,
  FinalReviewOutput
} from './final-review-types.js';
import { isStale } from '../capability-audit-service/staleness.js';
import type { CapabilityAuditResult } from '../capability-audit-service/types.js';
import {
  API_DIFF_ARTIFACT_SEGMENTS,
  PRE_POST_DIFF_VERDICT_MARKER,
  classifyPrePostDiffVerdict,
  producePrePostDiff,
  type PrePostDiffConclusion,
  type PrePostDiffResult
} from './pre-post-diff.js';

export interface PrepareFinalReviewOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly llmRunner: LlmRunner;
  /**
   * Explicit base ref for the pre/post baseline diff. Unset ⇒ the producer
   * resolves the merge-base with the upstream default branch itself, and
   * reports the dimension `unavailable` when it cannot.
   */
  readonly baseRef?: string;
}

const REQUIRED_DIMENSIONS: readonly DimensionKind[] = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
];

const SYSTEM_PROMPT = `You are preparing a 4-dimension business review for human acceptance. Produce a JSON response with EXACTLY these fields:
- rid (string)
- generatedAt (ISO timestamp)
- dimensions (array of EXACTLY 4 objects, one per dimension: functional-completeness, problem-resolution, no-new-bugs, existing-functionality-intact; each with dimension, verdict (pass | fail | inconclusive), summary, evidence (list of {kind, description, [artifact], [link]}), confidence (high | medium | low))
- overallSummary (one paragraph)
- allPass (boolean)
- needsAttention (list of dimension names that need human attention)

Output ONLY valid JSON, no prose.`;

export class IncompleteFinalReviewError extends Error {
  readonly code = 'INCOMPLETE_FINAL_REVIEW' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteFinalReviewError';
  }
}

/**
 * N4 — the reply carried no text block at all.
 *
 * Measured 2/3 on this repo's own machine, and it is NOT truncation: the
 * provider answered with a response whose `content` has no `text` block (a
 * reasoning-only turn, a refusal, or a content filter), so there is no JSON to
 * parse and no budget to raise — an operator sent to "raise the budget" for
 * this failure would be sent the wrong way. It gets its own class, its own
 * `code`, and a message that says so, so it is diagnosable instead of being
 * flattened into "not valid JSON".
 */
export class EmptyReviewReplyError extends Error {
  readonly code = 'EMPTY_FINAL_REVIEW_REPLY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'EmptyReviewReplyError';
  }
}

/**
 * How many times an empty reply is retried before it is reported. The failure
 * was 2/3 on the observed machine — intermittent, not systematic — so a small
 * bounded retry converts most of it into a completed review, while 3 attempts
 * keeps a genuinely broken provider from being hammered.
 */
export const MAX_EMPTY_REPLY_ATTEMPTS = 3;

/** The runner's own wording for "the response had no text block to return". */
function isEmptyReplyError(error: unknown): boolean {
  return error instanceof Error && /no text block/i.test(error.message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ *
 * D1 — on-disk evidence collection.
 *
 * The reviewer LLM has NO tools and NO filesystem access: whatever the
 * service does not inline into the prompt does not exist for it. Feeding it
 * only the success criteria forced a guess — the observed failure mode was a
 * 4/4 `inconclusive` verdict, and the dangerous one is an invented `pass`
 * that SKILL.md would read as a clean handoff. Everything below exists so the
 * verdicts rest on what is actually on disk, and so a missing artifact is
 * reported as MISSING instead of being silently skipped.
 * ------------------------------------------------------------------ */

/**
 * Total evidence budget across all sources. 40 KB ≈ 10k tokens of input, which
 * keeps the prompt far inside any modern context window. Sources that do not
 * fit are reported as OMITTED — never dropped silently.
 *
 * This is an INPUT cap and stays fixed per run. The output ceiling that has to
 * sit opposite it is derived per call by `outputBudgetForEvidence()` below —
 * the two used to drift apart, and that drift was the defect.
 *
 * RE-EVALUATED 2026-09-12 (F-BLOCK) — 32 KiB did NOT hold once the tenth
 * source (`final-review-pre-post-diff`) was appended. Measured on this repo's
 * own run (`2026-09-12-session-e37ef0`, rid
 * `2026-09-12-codegraph-exclude-integrity`), the ten sources are 2,621 / 8,164
 * / 9,492 / 10,839 / 11,422 / 13,050 / 13,462 / 13,852 / 17,745 / 20,543
 * bytes — 121,190 bytes on disk, 76,321 bytes once the 8 KiB per-file cap is
 * applied. Four sources at the cap spent the old 32,768 to the byte, so the
 * appended tenth (added LAST, by design) was the first block the budget
 * dropped — on every run, and on the compact set QA measured too (9 x 3.8 KB
 * ≈ 34 KB, which the old cap already could not hold).
 *
 * 40 KiB is a budget that fits the measured ten-source set at the allocator's
 * per-source unit (5 x 8 KiB units + the smaller ones), and it is the largest
 * this budget may grow to today: the derived output ceiling is
 * `3000 + 12288 + bytes/4`, so it reaches MAX_OUTPUT_TOKENS (32,000) at exactly
 * 66,848 bytes of inlined evidence and is clamped from there on — a cap at or
 * above that point buys the reviewer no more output room at all.
 *
 * F-CAP — an earlier version of this comment claimed 40 KiB (40,960 =
 * 10 x 4,096) was "the smallest cap that affords one floor-sized slice to EVERY
 * source in the ten-source set". That was arithmetic about a budget, not a
 * statement about the allocator: sources are capped at
 * MAX_EVIDENCE_BYTES_PER_FILE (10 KiB each, derived — see below) while a floor
 * is per DIMENSION (four of them), so 10 x 4,096 was never what any source
 * received. Re-measured on
 * the same two saturated fixtures (QA round 4: the 9 x 40 KB fixture and this
 * repo's own file sizes), raising the cap from 32 KiB to 40 KiB left **4 of the
 * 10 sources inlined with zero bytes** — `rd/security-review`,
 * `rd/bug-analysis`, `prd/handoff` and the appended
 * `final-review-pre-post-diff` — and it did not deliver the baseline either;
 * all it did was change WHICH source was starved (at 32 KiB that source was
 * `rd/code-review`).
 *
 * So read this constant as "how much evidence fits", never as "which sources
 * arrive". Arrival is decided by the allocator below (one whole unit per source,
 * with a dimension's floor reserving its holder's unit) and, for the two sources
 * a dimension's verdict may not outlive, by the delivery gates on top of it.
 * And note the honest consequence, stated rather than papered over: on a
 * saturated run the allocator still omits sources, so `prd/handoff.md` and the
 * pre/post diff can be dropped — which is exactly why
 * `enforceScopeContractDelivery()` and `enforcePrePostDiffAvailability()` exist
 * and why a `pass` on those two dimensions is keyed on delivery, not on
 * existence.
 */
export const MAX_EVIDENCE_BYTES_TOTAL = 40 * 1024;

/**
 * Per-file evidence cap — and the allocator's UNIT. DERIVED, never typed.
 *
 * F5 — this used to be the literal `8 * 1024`, and the whole floor guarantee
 * below was silently conditioned on `4 x perFile <= total`: the reservation
 * promises every pending holder its own unit, and that promise holds only while
 * the four units fit the budget together. At `8 * 1024` the inequality held by
 * coincidence (4 x 8,192 = 32,768 <= 40,960) and nothing in the code said so —
 * raising the cap past 10,240 would have starved all four dimensions in the
 * same run, which reads as four independent red gates rather than one broken
 * constant. The cap is therefore DIVIDED OUT OF the total: the relation is
 * definitional instead of remembered, and `assertFloorReservationAffordable()`
 * still checks it at the point of use (the division must also be exact).
 *
 * The value is 10,240 because that is `40,960 / 4` — the largest unit the
 * four-dimension reservation can afford. It is also the smallest cap at which
 * the decisive evidence source of this repo's own run can be delivered WHOLE:
 * `qa/test-reports/<rid>.md` measured 9,492 bytes there, and `whole` is the
 * delivery rule for every source whose producer publishes no conclusion literal
 * (see `isDelivered`), so a cap under 9,492 makes `problem-resolution` and
 * `no-new-bugs` undeliverable on every run — the always-red gate this module
 * refuses to ship. Enforced in BYTES against the raw buffer, so multi-byte
 * (CJK) content cannot slip past the cap.
 *
 * A source is inlined as `min(bytes, this cap)` — its whole unit — or not at
 * all. So a `TRUNCATED` source block can only ever mean "the FILE is bigger
 * than this cap"; it can no longer mean "the budget ran out while this file was
 * being copied in". That distinction is the point of the all-or-nothing
 * allocator below: the second reading is what let one byte of a 4,226-byte
 * artifact be counted as delivered evidence (F-BLOCK-1BYTE).
 */
export const MAX_EVIDENCE_BYTES_PER_FILE =
  MAX_EVIDENCE_BYTES_TOTAL / REQUIRED_DIMENSIONS.length;

/* ------------------------------------------------------------------ *
 * The anti-starvation reservation (the "floor").
 *
 * The allocator would otherwise be strictly first-come-first-served, and with
 * this repo's own evidence set (`2026-09-12-session-e37ef0`, measured) the
 * first four sources consumed the entire 32 KiB cap — 4 x 8,192 = 32,768, to
 * the byte — before source 5 was even opened. `existing-functionality-intact`
 * is supplied ONLY by `rd/tech-doc.md` (6th), `prd/handoff.md` (9th) and the
 * appended pre/post diff (10th), so that dimension reached the reviewer with
 * zero evidence on every run and its verdict was structurally locked to
 * `inconclusive` no matter how good the work was. A gate that is always red is
 * noise, and an operator trained to ignore noise has no gate at all — the same
 * harm as a gate that never fires, only quieter.
 *
 * So each dimension with at least one readable source on disk gets one
 * reservation, held for the FIRST such source; no source that is not that
 * holder may spend it, and it is released the instant its holder is served.
 * `floorHolders()` below decides who holds what and `collectEvidence()` is the
 * only thing that spends it.
 *
 * WHAT A RESERVATION IS SIZED AT (all-or-nothing): the holder's own UNIT — its
 * whole `min(bytes, perFileCap)` slice — not a fixed number of bytes. Under the
 * all-or-nothing allocator a holder needs its entire unit to be served at all,
 * so reserving less than that would promise something the allocator cannot
 * keep. The promise stays affordable because a holder is at most one per
 * dimension and there are four dimensions:
 *
 *     REQUIRED_DIMENSIONS.length x MAX_EVIDENCE_BYTES_PER_FILE
 *         = 4 x 10,240 = 40,960  ==  MAX_EVIDENCE_BYTES_TOTAL = 40,960
 *
 * L4 — those are the DERIVED numbers and the relation is an EQUALITY, not an
 * inequality with room to spare: the reservation spends the entire budget and
 * leaves ZERO slack. This block used to read `= 4 x 8,192 = 32,768 <= 40,960`,
 * which was true of the typed-literal cap and stopped being true the moment the
 * cap was divided out of the total; left as written it read as 8 KiB of
 * headroom that does not exist and would have invited "just raise the cap a
 * little". One byte more per file breaks the invariant outright, which is why
 * the cap is derived rather than typed and why
 * `assertFloorReservationAffordable()` re-checks the derivation (exact integer
 * quotient, product <= total) at the point of use instead of trusting this
 * comment (pinned by a test).
 *
 * That equality is the whole invariant: at every step `budgetLeft` covers the
 * units still owed to the pending holders, so a holder is always served once it
 * is reached, and the invariant cannot silently rot while the three constants
 * keep their published relationship.
 *
 * A reservation is held for a DIMENSION, not for any particular SOURCE:
 * reserving one for `final-review-pre-post-diff` on top of its dimension's
 * would make "a computed baseline the reviewer never saw" UNREACHABLE, and an
 * unreachable branch inside a gate is one nobody can verify. The delivery gates
 * below are the guarantee; see `enforcePrePostDiffAvailability` and
 * `enforceScopeContractDelivery`.
 * ------------------------------------------------------------------ */

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
export const REASONING_HEADROOM_TOKENS = 12 * 1024;

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

/**
 * What DELIVERED means for one source — the module's ONE delivery definition,
 * declared per source and read in exactly one place (`isDelivered`).
 *
 *   whole       the reviewer must have received the whole document. A
 *               truncated slice is not a weaker version of a document, it is a
 *               DIFFERENT document, and the conclusion may be in the part that
 *               was cut — which is precisely the state `found` used to call
 *               "delivered".
 *   conclusion  the reviewer must have received the literal that IS the
 *               document's conclusion. Used where the producer publishes one
 *               (the pre/post diff opens with its `VERDICT:` line).
 *
 * `whole` is the rule wherever the producer is another role's skill and
 * publishes no conclusion literal: the module may not GUESS where a document's
 * conclusion lives. The two are the same judgement — "did the reviewer receive
 * the conclusion" — checked at the only place the module can check it.
 */
type DeliveryRule =
  | { readonly kind: 'whole' }
  | { readonly kind: 'conclusion'; readonly marker: string };

interface EvidenceSource {
  /** Stable id quoted by the model in its citations. */
  readonly key: string;
  readonly label: string;
  /** Path segments under `.peaks/_runtime/<sessionId>/`. */
  readonly segments: readonly string[];
  /** Dimensions this source can supply evidence for. */
  readonly supports: readonly DimensionKind[];
  /** What DELIVERED means for this source. See `isDelivered()` — every source
   *  must declare one, and the declaration is the only thing the module's
   *  delivery judgement reads. */
  readonly delivery: DeliveryRule;
}

/**
 * The one source whose ABSENCE from the delivered prompt is not merely a
 * missing file: it is the only source in the set that is a before/after
 * comparison, and `existing-functionality-intact` is defined by it. Named once
 * so the source builder and the delivery check cannot drift apart.
 */
const PRE_POST_DIFF_SOURCE_KEY = 'final-review-pre-post-diff';

/**
 * The approved-scope contract. Also named once: it is the source
 * `functional-completeness` is defined against and the one its delivery gate
 * keys on.
 */
const SCOPE_CONTRACT_SOURCE_KEY = 'prd-handoff';

/**
 * The source a DIMENSION'S DELIVERY GATE depends on — i.e. the source the
 * dimension's `pass` may not outlive. `floorHolders` reserves that source's
 * unit, and this table is why the reservation protects the RIGHT source.
 *
 * F1 — the floor used to go to the FIRST source that merely *mentioned* the
 * dimension (`qa-test-report`, index 0, and `rd/tech-doc`, index 6), while both
 * delivery gates keyed on sources at the very END of the order
 * (`prd-handoff`, index 8, and the appended pre/post diff, index 9) that no
 * reservation covered. On this repo's own run the budget was exhausted at
 * source 4, so BOTH gate sources were omitted on every run — necessarily, not
 * accidentally — while 8,192 bytes of floor were spent on `rd/tech-doc`, the
 * one source prompt rule 6 declares insufficient for that same dimension.
 *
 *   measured floor reservation after the fix:
 *     prd/handoff.md 8,164  +  api-diff.txt 4,713  +  qa/test-reports 9,492
 *       = 22,369  <=  MAX_EVIDENCE_BYTES_TOTAL 40,960
 *
 * so all three holders are served WHOLE and the two gate-backed dimensions
 * become deliverable again. A dimension absent from this table has no delivery
 * gate, and its floor stays with the earliest source that supports it.
 */
const GATE_SOURCE_FOR_DIMENSION: Partial<Record<DimensionKind, string>> = {
  'functional-completeness': SCOPE_CONTRACT_SOURCE_KEY,
  'existing-functionality-intact': PRE_POST_DIFF_SOURCE_KEY
};

/**
 * The on-disk sources, in allocation order.
 *
 * `prePostDiffAvailable` is the ONE conditional member, and it is opt-in rather
 * than always-present: the `pre-post-diff` producer writes
 * `final-review/api-diff.txt` only when it actually computed a baseline (see
 * `pre-post-diff.ts`), so when the artifact is absent there is nothing behind
 * that source at all. Rendering a permanently-MISSING tenth block would add
 * prompt bytes to every run and hide nothing — the producer's own status block
 * (`renderPrePostDiffStatus`) states the absence and the reason to the reviewer
 * in as many words. When the artifact IS there, it is appended LAST so it
 * cannot displace the byte-allocation order the other nine sources rely on.
 *
 * Being appended last is also why it was the FIRST source the budget dropped —
 * see MAX_EVIDENCE_BYTES_TOTAL for the measurement. Appending it last stays
 * correct for the other nine sources; what changed is that a `pass` on this
 * dimension now requires the block to have been DELIVERED, not merely computed.
 */
function evidenceSourcesFor(
  rid: string,
  prePostDiffAvailable: boolean
): readonly EvidenceSource[] {
  const sources: EvidenceSource[] = [
    {
      key: 'qa-test-report',
      label: 'QA execution report (per-command pass/fail counts)',
      segments: ['qa', 'test-reports', `${rid}.md`],
      supports: ['functional-completeness', 'problem-resolution', 'no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'qa-test-cases',
      label: 'QA test cases (acceptance-criterion to test mapping)',
      segments: ['qa', 'test-cases', `${rid}.md`],
      supports: ['functional-completeness', 'problem-resolution'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'qa-security-findings',
      label: 'QA security findings',
      segments: ['qa', `security-findings-${rid}.md`],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'qa-performance-findings',
      label: 'QA performance findings',
      segments: ['qa', `performance-findings-${rid}.md`],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'rd-code-review',
      label: 'RD code review',
      segments: ['rd', 'code-review.md'],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'rd-security-review',
      label: 'RD security review',
      segments: ['rd', 'security-review.md'],
      supports: ['no-new-bugs'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'rd-tech-doc',
      label: 'RD tech doc (public surface / design intent)',
      segments: ['rd', 'tech-doc.md'],
      supports: ['existing-functionality-intact'],
      delivery: { kind: 'whole' }
    },
    {
      key: 'rd-bug-analysis',
      label: 'RD bug analysis (original problem statement)',
      segments: ['rd', 'bug-analysis.md'],
      supports: ['problem-resolution'],
      delivery: { kind: 'whole' }
    },
    {
      key: SCOPE_CONTRACT_SOURCE_KEY,
      label: 'PRD handoff (approved scope + non-goals)',
      segments: ['prd', 'handoff.md'],
      supports: ['functional-completeness', 'existing-functionality-intact'],
      delivery: { kind: 'whole' }
    }
  ];

  if (prePostDiffAvailable) {
    sources.push({
      key: PRE_POST_DIFF_SOURCE_KEY,
      label: 'Pre/post structural baseline diff (test surface + public API surface)',
      segments: [...API_DIFF_ARTIFACT_SEGMENTS],
      // The dimension's own contract asks for a `pre-post-diff`; this is the
      // only source in the set that is one.
      supports: ['existing-functionality-intact'],
      // The one source whose producer publishes its conclusion as a literal:
      // the artifact opens with its `VERDICT:` line, so delivery is checkable
      // against the BYTES the reviewer received rather than against the size of
      // the slice it happened to get.
      delivery: { kind: 'conclusion', marker: PRE_POST_DIFF_VERDICT_MARKER }
    });
  }

  return sources;
}

/**
 * `found` is the only status that carries bytes. The other four exist so the
 * prompt can name *why* a source carries nothing: an absent file, one that
 * exists but is empty, one that exists but could not be READ, and one that did
 * not fit the byte budget are four different facts, and the model is told all
 * four explicitly.
 *
 * F4 — `missing` and `unreadable` used to be one status. `readFileSync`'s catch
 * collapsed EACCES / EBUSY / EPERM into the same `raw === null` as ENOENT, so a
 * contract file that EXISTS and could not be opened was reported to the
 * reviewer — and, worse, to the delivery gate — as "there was no PRD phase".
 * Those are opposite facts about a run: one says "nothing to deliver", the
 * other says "there is something to deliver and it did not arrive".
 */
type EvidenceStatus = 'found' | 'empty' | 'missing' | 'unreadable' | 'omitted';

interface CollectedEvidence {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly status: EvidenceStatus;
  /** Full size on disk (0 when nothing could be read). */
  readonly totalBytes: number;
  /** Bytes actually inlined into the prompt. */
  readonly includedBytes: number;
  readonly content: string;
  /** Why this source carries no evidence (non-`found` statuses only). */
  readonly reason: string;
}

/**
 * A source plus the bytes it turned out to hold. Reading and spending are two
 * separate phases because the allocator has to know which sources are actually
 * readable BEFORE it can promise any of them a byte: a floor reserved for a file
 * that does not exist is a floor spent on nothing.
 */
interface EvidenceCandidate {
  readonly source: EvidenceSource;
  readonly relativePath: string;
  readonly absolutePath: string;
  /** File bytes, or `null` when the file could not be read. */
  readonly raw: Buffer | null;
  /**
   * Why there are no bytes: `'ok'` when `raw` is set, otherwise the two facts
   * F4 requires the module to keep apart — `'missing'` is ENOENT (there is no
   * such file for this run), `'unreadable'` is anything else (the file is
   * there and this process could not read it).
   */
  readonly read: 'ok' | 'missing' | 'unreadable';
  /** Read failure message (`raw === null` only). */
  readonly error: string;
  /** A file whose content is all whitespace carries no evidence whichever
   *  slice of it the budget would have paid for. */
  readonly blank: boolean;
}

/**
 * ENOENT is "no such file"; every other errno is "the file is there and this
 * read failed". Only the first means the source does not exist for this run.
 */
function classifyReadFailure(error: unknown): 'missing' | 'unreadable' {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' ? 'missing' : 'unreadable';
}

/** Pure read: no commands, no git, no test execution — files only. */
function readEvidence(
  projectRoot: string,
  sessionId: string,
  rid: string,
  prePostDiffAvailable: boolean
): readonly EvidenceCandidate[] {
  const runtimeRoot = join(projectRoot, '.peaks', '_runtime', sessionId);

  return evidenceSourcesFor(rid, prePostDiffAvailable).map(source => {
    const relativePath = ['.peaks', '_runtime', sessionId, ...source.segments].join('/');
    const absolutePath = join(runtimeRoot, ...source.segments);
    let raw: Buffer | null = null;
    let error = '';
    let read: 'ok' | 'missing' | 'unreadable' = 'ok';
    try {
      raw = readFileSync(absolutePath);
    } catch (err) {
      read = classifyReadFailure(err);
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      source,
      relativePath,
      absolutePath,
      raw,
      read,
      error,
      blank: raw === null || raw.toString('utf8').trim().length === 0
    };
  });
}

/**
 * The one source per dimension that the budget promises to reach — the source
 * that dimension's DELIVERY GATE depends on where there is one, and otherwise
 * the first non-blank candidate that can supply it. A dimension with several
 * candidates needs exactly one of them to survive, so naming it costs the other
 * sources nothing they were not already losing.
 *
 * F1 — the gate sources used to be eligible for no reservation at all, because
 * they are last in the order and a later source can never be a "first mention".
 * Reserving for them is what makes the two gates' promises reachable rather
 * than merely correct: a gate that always fires because its source never fits
 * is noise, not a gate. A dimension with no gate entry keeps the old rule.
 *
 * A blank source is deliberately not a holder: a floor reserved for a file that
 * carries no evidence is a floor spent on nothing.
 */
function floorHolders(
  candidates: readonly EvidenceCandidate[]
): ReadonlyMap<number, DimensionKind> {
  const holders = new Map<number, DimensionKind>();
  const covered = new Set<DimensionKind>();
  const indexByKey = new Map<string, number>();

  candidates.forEach((candidate, index) => {
    if (candidate.blank) return;
    if (!indexByKey.has(candidate.source.key)) indexByKey.set(candidate.source.key, index);
  });

  // Pass 1 — the source each delivery gate depends on, whether or not it is the
  // first to mention its dimension.
  for (const dimension of REQUIRED_DIMENSIONS) {
    const gateKey = GATE_SOURCE_FOR_DIMENSION[dimension];
    if (gateKey === undefined) continue;
    const index = indexByKey.get(gateKey);
    // No such source this run (e.g. no baseline was computed): the dimension
    // falls back to the first-mention rule below.
    if (index === undefined) continue;
    covered.add(dimension);
    if (!holders.has(index)) holders.set(index, dimension);
  }

  // Pass 2 — every dimension without a gate: the first source that mentions it.
  candidates.forEach((candidate, index) => {
    if (candidate.blank) return;
    for (const dimension of candidate.source.supports) {
      if (covered.has(dimension)) continue;
      covered.add(dimension);
      if (!holders.has(index)) holders.set(index, dimension);
    }
  });

  return holders;
}

/**
 * The unit the allocator hands out: one source's WHOLE slice — its bytes up to
 * the per-file cap — or nothing at all.
 *
 * F-BLOCK-1BYTE — the allocator used to take `min(perFileCap, budgetLeft)`, so
 * the last source the budget reached was cut wherever the budget ran out.
 * `status: 'found'` then meant "at least one byte arrived", and every gate that
 * asked "did the reviewer see this source?" was answering a question with a
 * continuum of possible answers. The observed output (QA round 4, 9 x 4,551 B
 * sources, `api-diff.txt` at 4,226 B): the pre/post diff was inlined as **1
 * byte** — the character `#` — while the producer block still said
 * `STATUS: COMPUTED … cite it`, the dimension kept its `pass`/`high`, the
 * artifact was attached as evidence, and the envelope returned `allPass: true`.
 * Each earlier fix had moved the threshold that separated "some bytes" from
 * "the evidence"; this removes the continuum instead, so no predicate can be
 * re-tuned into the same hole a fifth time.
 */
function sourceUnit(candidate: EvidenceCandidate): number {
  return candidate.raw === null
    ? 0
    : Math.min(candidate.raw.byteLength, MAX_EVIDENCE_BYTES_PER_FILE);
}

/**
 * F5 — the floor promise, checked where it is relied on instead of remembered.
 *
 * The allocator's loop invariant is `budgetLeft >= sum(units of pending
 * holders)`, and its INITIAL condition is
 * `REQUIRED_DIMENSIONS.length x MAX_EVIDENCE_BYTES_PER_FILE <=
 * MAX_EVIDENCE_BYTES_TOTAL`. While that holds, every holder is served when it
 * is reached and the reservation is a guarantee; the moment it fails, all four
 * dimensions are starved in the same run — which surfaces as four independent
 * red gates rather than as one broken constant, and is therefore the kind of
 * breakage nobody diagnoses correctly.
 *
 * The cap is derived from the total so the inequality cannot be typed wrong,
 * and this check covers the two ways a derivation can still go bad: a
 * non-integer quotient (a fifth dimension, say) and a future re-typing of
 * either constant. It is exported because a test asserts it directly.
 */
export function assertFloorReservationAffordable(): void {
  if (!Number.isInteger(MAX_EVIDENCE_BYTES_PER_FILE)) {
    throw new Error(
      `MAX_EVIDENCE_BYTES_PER_FILE is not an integer (${String(MAX_EVIDENCE_BYTES_PER_FILE)} = ${String(MAX_EVIDENCE_BYTES_TOTAL)} / ${String(REQUIRED_DIMENSIONS.length)}): the per-dimension floor reservation is not affordable at a fractional unit.`
    );
  }
  const owed = REQUIRED_DIMENSIONS.length * MAX_EVIDENCE_BYTES_PER_FILE;
  if (owed > MAX_EVIDENCE_BYTES_TOTAL) {
    throw new Error(
      `the floor reservation is not affordable: ${String(REQUIRED_DIMENSIONS.length)} dimensions x ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes per file = ${String(owed)} exceeds MAX_EVIDENCE_BYTES_TOTAL (${String(MAX_EVIDENCE_BYTES_TOTAL)}). Every dimension would be starved in the same run.`
    );
  }
}

function collectEvidence(
  projectRoot: string,
  sessionId: string,
  rid: string,
  prePostDiffAvailable: boolean
): readonly CollectedEvidence[] {
  assertFloorReservationAffordable();
  const candidates = readEvidence(projectRoot, sessionId, rid, prePostDiffAvailable);
  const holders = floorHolders(candidates);
  /** Every source's all-or-nothing unit, computed before any byte is spent. */
  const units = candidates.map(candidate => sourceUnit(candidate));
  /** Holders that have not been served yet — the floors still owed. */
  const pending = new Set<number>(holders.keys());
  const collected: CollectedEvidence[] = [];
  let budgetLeft = MAX_EVIDENCE_BYTES_TOTAL;

  for (const [index, candidate] of candidates.entries()) {
    const { source, relativePath, absolutePath, raw } = candidate;
    const base = { source, relativePath, absolutePath };

    if (raw === null) {
      // `read` is never `'ok'` here (it is set exactly when the read failed),
      // and `'ok'` is not a status — the branch is what says which of the two
      // failure facts this is.
      const status: EvidenceStatus = candidate.read === 'unreadable' ? 'unreadable' : 'missing';
      collected.push({
        ...base,
        status,
        totalBytes: 0,
        includedBytes: 0,
        content: '',
        reason:
          candidate.read === 'missing'
            ? candidate.error
            : `the file exists but could not be read (${candidate.error})`
      });
      continue;
    }

    if (candidate.blank) {
      collected.push({
        ...base,
        status: 'empty',
        totalBytes: raw.byteLength,
        includedBytes: 0,
        content: '',
        reason: `file exists but contains no reviewable content (${raw.byteLength} bytes)`
      });
      continue;
    }

    const unit = units[index] ?? 0;
    // The floors still owed to dimensions whose holder has not been served are
    // spent only on those holders: a source that needs no help cannot eat the
    // last dimension's only chance at being reviewed. Reserved at the holder's
    // own unit, because under all-or-nothing a partial slice serves nothing.
    const reservedElsewhere = [...pending]
      .filter(holder => holder !== index)
      .reduce((sum, holder) => sum + (units[holder] ?? 0), 0);
    const allowance = budgetLeft - reservedElsewhere;

    // ALL-OR-NOTHING: this source is inlined as its whole unit or it is
    // reported omitted. There is deliberately no third outcome — a partial
    // slice would re-create the continuum F-BLOCK-1BYTE was found in.
    if (allowance < unit) {
      const waiting = [...pending]
        .filter(holder => holder !== index)
        .map(holder => `${holders.get(holder)} (source ${candidates[holder]?.source.key ?? '?'})`);
      collected.push({
        ...base,
        status: 'omitted',
        totalBytes: raw.byteLength,
        includedBytes: 0,
        content: '',
        reason:
          reservedElsewhere > 0
            ? `${reservedElsewhere} bytes of the budget are reserved for dimension(s) ${waiting.join(', ')} — their only remaining evidence comes later in the source order; this source is inlined WHOLE or not at all and needs ${unit} bytes, while ${budgetLeft} were left (${allowance} after the reservation)`
            : `total evidence budget (${MAX_EVIDENCE_BYTES_TOTAL} bytes) is exhausted — this source is inlined WHOLE or not at all and needs ${unit} bytes, ${budgetLeft} were left`
      });
      continue;
    }

    const content = raw.subarray(0, unit).toString('utf8');
    budgetLeft -= unit;
    pending.delete(index);
    collected.push({
      ...base,
      status: 'found',
      totalBytes: raw.byteLength,
      includedBytes: unit,
      content,
      reason: ''
    });
  }

  return collected;
}

function renderEvidenceSection(collected: readonly CollectedEvidence[]): string {
  return collected
    .map((item, index) => {
      const heading = `### [${index + 1}] ${item.source.key} — ${item.source.label}`;
      const supports = `SUPPORTS: ${item.source.supports.join(', ')}`;
      if (item.status === 'found') {
        const status =
          item.includedBytes < item.totalBytes
            ? `FOUND at ${item.relativePath} — TRUNCATED, showing the first ${item.includedBytes} of ${item.totalBytes} bytes`
            : `FOUND at ${item.relativePath} — ${item.totalBytes} bytes`;
        return `${heading}\n${supports}\nSTATUS: ${status}\n<<<EVIDENCE\n${item.content}\n>>>EVIDENCE`;
      }
      if (item.status === 'unreadable') {
        // F4 — NOT "missing". The reviewer is told the file is there and the
        // read failed, which is a different instruction to a human than "this
        // run had no PRD phase": one is a fact about the run, the other is a
        // fact about the machine, and only the second is fixable.
        return `${heading}\n${supports}\nSTATUS: UNREADABLE — no evidence available from ${item.relativePath}: ${item.reason}`;
      }
      return `${heading}\n${supports}\nSTATUS: MISSING (${item.status}) — no evidence available from ${item.relativePath}: ${item.reason}`;
    })
    .join('\n\n');
}

/**
 * The producer's own status, told to the reviewer in as many words.
 *
 * It exists because the artifact's ABSENCE is not self-explanatory: a reviewer
 * shown nothing about `existing-functionality-intact` beyond two design-intent
 * documents cannot tell "the diff was clean" from "no diff was ever computed",
 * and the pre-fix run resolved that ambiguity by quietly returning
 * `inconclusive` forever. Naming the reason is what makes the unavailable case
 * a stated fact instead of an invisible one.
 *
 * Kept short on purpose: it rides inside the same prompt that is byte-capped at
 * `MAX_EVIDENCE_BYTES_TOTAL` + scaffolding.
 *
 * F-BLOCK: this block may only say COMPUTED when the artifact it names was
 * actually inlined. Saying "computed — cite it" one line above a source block
 * reading `STATUS: MISSING (omitted)` told the reviewer to cite evidence it had
 * not been given, and that contradiction is what let a `pass` survive a
 * baseline nobody saw.
 */
function renderPrePostDiffStatus(prePostDiff: PrePostDiffResult, delivered: boolean): string {
  const heading = '## Pre/post baseline diff producer (existing-functionality-intact)';
  if (prePostDiff.status === 'computed' && delivered) {
    return [
      heading,
      `STATUS: COMPUTED — ${prePostDiff.summary}`,
      `Artifact: ${prePostDiff.relativePath} (the next source block). Cite it with evidence kind "pre-post-diff"; it is the structural before/after comparison this dimension's definition asks for.`
    ].join('\n');
  }
  if (prePostDiff.status === 'computed') {
    return [
      heading,
      `STATUS: COMPUTED ON DISK, NOT DELIVERED — the baseline was produced at ${prePostDiff.relativePath}, but its source block could not be inlined into this prompt (the evidence budget omitted it), so it is NOT among the evidence above and you have NOT seen it.`,
      'Report "existing-functionality-intact" as "inconclusive" and name this in its summary. Do NOT report "pass": the service downgrades a "pass" on this dimension whenever the comparison was not delivered, and a comparison you were not shown is not a comparison that came back clean.'
    ].join('\n');
  }
  const consequence = prePostDiff.inGitWorkTree
    ? 'This project IS a git work tree, so a baseline was expected to be computable: the service treats its absence as a tooling failure and downgrades a "pass" on this dimension to "inconclusive" before any human sees it.'
    : 'This project is not a git work tree, so no baseline can be computed at all. The service downgrades a "pass" on this dimension to "inconclusive" here TOO: "this project keeps no baseline" explains why the evidence is absent, and the absence of a comparison is not a comparison that came back clean.';
  return [
    heading,
    `STATUS: UNAVAILABLE — ${prePostDiff.reason}.`,
    `No pre/post baseline diff exists for this run. Report "existing-functionality-intact" as "inconclusive" with confidence "low" and name the reason above in its summary. Do NOT report "pass": a missing baseline is not evidence of no drift. ${consequence}`
  ].join('\n');
}

const EVIDENCE_RULES = `## Binding rules for the four verdicts
1. A dimension may be "pass" ONLY if at least one source in its SUPPORTS list has STATUS: FOUND above, and that source's content actually supports the verdict. The service re-checks this: a "pass" whose supporting sources are all missing/empty/omitted is downgraded to "inconclusive" before any human sees it.
2. If the evidence a dimension needs is MISSING, EMPTY, or OMITTED, return "inconclusive" with confidence "low". Do not guess "pass".
3. Absence of evidence is not evidence of absence: "no problem found in what I was given" is "inconclusive", never "pass".
4. Cite the bracketed source numbers (e.g. "[1]", "[5]") you relied on in each dimension's "evidence[].description"; use an empty list when the verdict is "inconclusive".
5. "allPass" may be true only when all four verdicts are "pass", and every non-"pass" dimension must be listed in "needsAttention".
6. "existing-functionality-intact" may be "pass" ONLY when the pre/post baseline diff block above shows STATUS: FOUND. A design-intent document (RD tech doc, PRD handoff) states what was INTENDED; it is not a before/after comparison of the test surface or the public API surface, and a "pass" resting on one is downgraded to "inconclusive" by the service before any human sees it.
7. An "inconclusive" verdict cannot be confident: report it with confidence "low" (or "medium" when the reviewer is sure the evidence is merely incomplete). "high" on "inconclusive" is a contradiction and the service clamps it.
8. "functional-completeness" may be "pass" ONLY when the approved-scope contract block (prd-handoff, the source carrying the approved scope and non-goals) is present above with its WHOLE byte count — a STATUS line reading "FOUND at ... — N bytes", not a truncated or an omitted one. A passing test report shows that something was built; only the contract shows that what was built IS the approved scope. The service re-checks this: it downgrades a "pass" on this dimension whenever that contract exists for the run but was not delivered in full.`;

/**
 * Which dimensions the reviewer was actually given evidence FOR. A dimension
 * absent from this set has no delivered evidence behind it.
 *
 * F3 / 1.3 — this used to read `status !== 'found'`, i.e. "a source that
 * mentions this dimension was inlined (at least a byte of it)". Two things were
 * wrong with that, and both are the same thing: it asked about the SOURCE (was
 * it included) instead of about the DIMENSION (was its evidence seen), and it
 * answered with whatever the allocator's unit happened to be. Measured on this
 * repo's own run, eight of the ten sources are larger than the per-file cap, so
 * every dimension's evidence set was the cap-sized HEAD of a document — and a
 * head can be a table of contents while the findings live past the cut (QA
 * reproduced exactly that: one 20,545-byte source whose first 10,240 bytes are
 * front matter, four `pass`/`high` verdicts). "Some bytes of a source that
 * lists this dimension" is not evidence; the source's conclusion is.
 *
 * It now delegates, one dimension at a time, to the module's single delivery
 * judgement — so a source that cannot be delivered for a dimension cannot back
 * a pass on it either, here or anywhere else.
 */
function dimensionsWithEvidence(
  collected: readonly CollectedEvidence[]
): ReadonlySet<DimensionKind> {
  const available = new Set<DimensionKind>();
  for (const item of collected) {
    for (const dimension of item.source.supports) {
      if (isDelivered(item, dimension)) available.add(dimension);
    }
  }
  return available;
}

/**
 * The honesty guarantee (D1), enforced after parsing rather than merely asked
 * for in the prompt. Prompt instructions are advisory — a model can still
 * answer `pass` — so this pass makes the property structural: a dimension with
 * no supporting evidence on disk is rewritten to `inconclusive` / `low`
 * regardless of what the model returned.
 *
 * A `fail` is never softened: it is already stricter than `inconclusive`.
 */
function enforceEvidenceBackedVerdicts(
  dimensions: readonly DimensionEvidence[],
  evidenceAvailableFor: ReadonlySet<DimensionKind>
): readonly DimensionEvidence[] {
  return dimensions.map(dimension => {
    if (dimension.verdict !== 'pass') return dimension;
    if (evidenceAvailableFor.has(dimension.dimension)) return dimension;
    const downgraded: DimensionEvidence = {
      ...dimension,
      verdict: 'inconclusive',
      confidence: 'low',
      summary: `${dimension.summary} [evidence-gate: verdict downgraded from "pass" to "inconclusive" — no on-disk evidence source supporting "${dimension.dimension}" was available to the reviewer.]`
    };
    return downgraded;
  });
}

/**
 * DELIVERED — the module's ONE delivery judgement.
 *
 * A source is delivered TO A DIMENSION when the bytes the reviewer actually
 * received carry the source's conclusion FOR THAT DIMENSION. Nothing else is
 * consulted: not the file's existence, not `status`, not a byte count. The
 * question it answers is "did the reviewer see this dimension's supporting
 * content?", never "was this source included?".
 *
 * Why one predicate and not four. Every one of the six holes this primitive has
 * shipped was the same shape: a local predicate that was satisfied by a PROXY
 * for delivery — the substring's presence, the stub's usefulness, "this is not
 * a git repo", `status === 'computed'`, `status === 'found'`, and finally
 * `totalBytes === 0` / `status !== 'found'` in two more places. Each fix was
 * correct where it was applied, and the shape reappeared next door because
 * "was it delivered?" had as many answers as there were call sites. There is
 * now one: this function, reading one declaration per source
 * (`EvidenceSource.delivery`).
 *
 * The two rules are the two ways a conclusion can be said to have arrived:
 *  - `whole` — the whole document arrived. A truncated document is not a
 *    weaker version of itself; the conclusion may be in the part that was cut.
 *    This is the rule everywhere the producer is another role's skill and
 *    publishes no conclusion literal: the module may not guess where a
 *    document's conclusion lives.
 *  - `conclusion(marker)` — the literal that IS the conclusion is among the
 *    bytes received.
 *
 * F-BLOCK-1BYTE — `found` was read as "delivered", and `found` was defined by a
 * byte COUNT, so 1 byte of a 4,226-byte artifact passed for a delivered
 * comparison. A count can be satisfied by a fragment; a conclusion cannot.
 *
 * A dimension the source does not SUPPORT is never delivered: `supports` is a
 * claim about what a document can evidence, and reading it as "the reviewer saw
 * this dimension's evidence" is exactly the presence-as-substance error. The
 * check lives here so no caller can skip it.
 */
function isDelivered(item: CollectedEvidence, dimension: DimensionKind): boolean {
  if (!item.source.supports.includes(dimension)) return false;
  // No bytes arrived at all: missing, empty, unreadable, omitted.
  if (item.status !== 'found') return false;
  const rule = item.source.delivery;
  switch (rule.kind) {
    case 'whole':
      return item.totalBytes > 0 && item.includedBytes === item.totalBytes;
    case 'conclusion':
      return item.content.includes(rule.marker);
  }
}

/**
 * Was the pre/post-diff source delivered to the dimension it exists for?
 *
 * Kept as a name because three call sites share it and the reason they share it
 * is the point: the gate, the artifact attachment and the evidence set must all
 * mean the same thing by "the reviewer saw the comparison". It reads the ONE
 * predicate; it does not re-decide anything.
 */
function prePostDiffDelivered(collected: readonly CollectedEvidence[]): boolean {
  const block = collected.find(item => item.source.key === PRE_POST_DIFF_SOURCE_KEY);
  return block !== undefined && isDelivered(block, 'existing-functionality-intact');
}

/**
 * H2 — the reason a dimension is red PERMANENTLY, as opposed to merely unfed on
 * this run. Reported per source, so the arithmetic is checkable by the reader.
 */
export interface UndeliverableDimensionEvidence {
  readonly dimension: DimensionKind;
  readonly sources: readonly {
    readonly key: string;
    readonly relativePath: string;
    readonly totalBytes: number;
  }[];
}

/**
 * Can this source EVER be delivered, whatever the budget?
 *
 * `whole` is the only rule with a structural ceiling. Its test is
 * `includedBytes === totalBytes`, and the allocator can only ever inline
 * `min(bytes, MAX_EVIDENCE_BYTES_PER_FILE)` — so a `whole`-rule source LARGER
 * than the per-file cap can never be delivered: not on this run, not on any
 * run, not with any budget, because the budget is not what cuts it. Raising
 * `MAX_EVIDENCE_BYTES_TOTAL` changes nothing either, since the per-file cap is
 * derived from it and the reservation spends all of it.
 *
 * (`conclusion` sources are deliberately NOT covered. A marker missing from the
 * first cap-sized bytes of an oversize artifact might simply live past the cut,
 * so "undeliverable forever" is not a claim this module can make about them —
 * and an over-claiming check is the failure mode this file keeps closing.)
 */
function isStructurallyUndeliverable(item: CollectedEvidence): boolean {
  if (item.source.delivery.kind !== 'whole') return false;
  return item.totalBytes > MAX_EVIDENCE_BYTES_PER_FILE;
}

/**
 * H2 — every required dimension whose verdict is locked to `inconclusive` by
 * BYTE ARITHMETIC rather than by the reviewer's judgement.
 *
 * The defect this exists for: `qa/test-reports/<rid>.md` measured 9,492 bytes
 * on this repo's own run and is the ONLY source on disk for `problem-resolution`
 * and `no-new-bugs` (the other sources that support them are absent), against a
 * per-file cap of 10,240 — a 748-byte margin on a file that is REWRITTEN every
 * round and only grows. The moment it crosses 10,240 both dimensions go
 * permanently red, and NOTHING said so: `assertFloorReservationAffordable()`
 * only checks the constant-level relation (`4 x cap <= total`), never whether
 * any actual source fits the cap it must live under, so the red handoff read as
 * "the reviewer was unsure" instead of "no evidence can ever reach the
 * reviewer". A gate that is always red and never explains itself is noise, and
 * this is the same "always red" harm the floor reservation was built to remove
 * — one layer down.
 *
 * The conditions, all three of which must hold, are chosen so the report cannot
 * be noise:
 *   1. NOTHING on disk can back the dimension (no `isDelivered`), and
 *   2. there IS something on disk to deliver (a source that was never written
 *      is not a delivery failure — same reasoning as the scope-contract gate's
 *      `missing` exemption: a run with no QA phase has no report to lose), and
 *   3. EVERY one of those on-disk sources is structurally undeliverable — a
 *      single source that merely did not fit TODAY (budget-exhausted `omitted`)
 *      is a different, self-correcting state and is left to the allocator.
 *
 * The report is consumed by the prompt (stated to the reviewer), by the
 * envelope (a marker on each dimension's summary) and by `needsAttention`
 * (which also clears `allPass`) — see `enforceDeliveryReachability` and
 * `renderDeliveryReachabilityStatus`. It is a LOUD STATEMENT, not a silent
 * downgrade, and it is deliberately not a throw: a crash would destroy the
 * evidence for the three dimensions that ARE deliverable, and the honest fact
 * here is per-dimension, so it is reported per-dimension.
 */
export function undeliverableDimensions(
  collected: readonly CollectedEvidence[]
): readonly UndeliverableDimensionEvidence[] {
  const report: UndeliverableDimensionEvidence[] = [];
  for (const dimension of REQUIRED_DIMENSIONS) {
    const supporting = collected.filter(item => item.source.supports.includes(dimension));
    if (supporting.some(item => isDelivered(item, dimension))) continue;
    const onDisk = supporting.filter(item => item.totalBytes > 0);
    if (onDisk.length === 0) continue;
    if (!onDisk.every(isStructurallyUndeliverable)) continue;
    report.push({
      dimension,
      sources: onDisk.map(item => ({
        key: item.source.key,
        relativePath: item.relativePath,
        totalBytes: item.totalBytes
      }))
    });
  }
  return report;
}

/**
 * H2 — tell the reviewer, in the prompt, that a dimension has no deliverable
 * source at all. Emitted only when there is something to say, so the byte
 * budget is not spent on an empty section every run.
 *
 * It reads like `renderPrePostDiffStatus` on purpose: the reviewer is told the
 * FACT and what to answer with, so a permanently red dimension arrives at the
 * human with its cause attached instead of as an unexplained `inconclusive`.
 */
function renderDeliveryReachabilityStatus(
  report: readonly UndeliverableDimensionEvidence[]
): string {
  if (report.length === 0) return '';
  // Kept to one line per source and one line per dimension: this block rides
  // inside the same byte-capped prompt as the evidence it describes, and the
  // evidence blocks above already carry each source's path and status.
  const lines = report.map(entry => {
    const sources = entry.sources
      .map(item => `${item.key} (${String(item.totalBytes)} bytes)`)
      .join(', ');
    return `  - ${entry.dimension}: NO deliverable source. ${sources} exceeds the per-file cap of ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes, and a source is inlined WHOLE or not at all.`;
  });
  return [
    '## Evidence delivery reachability (structural)',
    `The allocator inlines at most ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes of any one source, WHOLE or not at all, and a source delivered under the "whole" rule is delivered only when the reviewer received ALL of it. For the dimension(s) below, every source on disk that supports it is larger than that cap, so no source CAN be delivered — not on this run and not on any run, whatever the budget.`,
    ...lines,
    'Report each of them as "inconclusive" with confidence "low" and name this reason in its summary. Do NOT report "pass": the service re-checks it, and a "pass" here is downgraded. This is a STRUCTURAL impossibility, not a judgement you are being asked to make — say so rather than reporting an unexplained "inconclusive".'
  ].join('\n');
}

/**
 * H2 — the envelope half of the same fact. A dimension named by
 * `undeliverableDimensions()` cannot be `pass` (no source on disk can carry its
 * conclusion), so this is not where the verdict is decided — that is
 * `enforceEvidenceBackedVerdicts`, and this gate re-applies it so the property
 * does not depend on that gate's order. What this adds is the REASON: the
 * dimension's own summary says it is red by construction. Because the verdict
 * it leaves behind is non-`pass`, the dimension also reaches `needsAttention`
 * (and clears `allPass`) through the ordinary verdict route, which is the field
 * the CLI envelope prints — so the human is told WHY instead of being left to
 * read a permanent red as the reviewer's uncertainty.
 */
function enforceDeliveryReachability(
  dimensions: readonly DimensionEvidence[],
  report: readonly UndeliverableDimensionEvidence[]
): readonly DimensionEvidence[] {
  if (report.length === 0) return dimensions;
  const byDimension = new Map(report.map(entry => [entry.dimension, entry]));
  return dimensions.map(dimension => {
    const entry = byDimension.get(dimension.dimension);
    if (entry === undefined) return dimension;
    // The ENVELOPE is not byte-capped, so it names the path as well as the
    // size: the path is what a human has to act on to fix it.
    const detail = entry.sources
      .map(item => `${item.key} at ${item.relativePath} (${String(item.totalBytes)} bytes)`)
      .join(', ');
    const marker = `[delivery-reachability: ${
      dimension.verdict === 'pass'
        ? 'verdict downgraded from "pass" to "inconclusive"'
        : `gate ran; verdict "${dimension.verdict}" is already non-"pass" and is left unchanged`
    } — EVERY source on disk that supports "${dimension.dimension}" (${detail}) is larger than the per-file delivery cap of ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes, and a source is inlined WHOLE or not at all, so no evidence for this dimension can ever reach the reviewer. The dimension is red by byte arithmetic, not by the reviewer's judgement, and it is listed in needsAttention for that reason.]`;
    const annotated: DimensionEvidence = {
      ...dimension,
      summary: `${dimension.summary} ${marker}`
    };
    if (dimension.verdict !== 'pass') return annotated;
    return { ...annotated, verdict: 'inconclusive', confidence: 'low' };
  });
}

/**
 * The pre/post-diff half of the honesty rule: a `pass` on
 * `existing-functionality-intact` may not outlive the baseline it claims.
 *
 * It fires whenever no baseline was DELIVERED to the reviewer, for EVERY reason:
 * no base ref resolvable, a base that resolves to HEAD itself, a project that is
 * not a git work tree at all, or a baseline that WAS computed but whose source
 * block never reached the prompt (the budget omitted it). The first three are
 * causes of a missing artifact; the last is a missing DELIVERY of an artifact
 * that exists. None of the four is a licence to trust the claim: they are the
 * CAUSE of the missing evidence, and a comparison the reviewer never saw is the
 * absence of an answer, never an answer that came back clean.
 *
 * The earlier version exempted the non-git case, reasoning that "a non-git
 * project would otherwise be permanently red". That reasoning was wrong in the
 * one way this whole primitive exists to prevent: the permanently red verdict is
 * the HONEST one (nothing was ever compared), while green-with-no-evidence is a
 * forged clean handoff. Worse, it pierced the structural gate that
 * `enforceEvidenceBackedVerdicts` exists to be — a `pass` whose supporting
 * evidence is entirely absent is downgraded there, and it must not be let
 * through by supplying a REASON for the absence.
 *
 * The version that followed it keyed on `prePostDiff.status === 'computed'` —
 * "a baseline exists on disk" read as "the reviewer saw one". Those two facts
 * separate the moment the budget omits the block, and the observed output was
 * self-contradicting: the producer's own block said `STATUS: COMPUTED` one line
 * above the source block's `STATUS: MISSING (omitted)`, the model was handed a
 * `pass` it could not have justified, and the service attached the artifact to
 * the dimension as evidence on top. `delivered` is that missing term.
 *
 * The gate also leaves its marker on the dimension whenever it fires, even if
 * that dimension is already non-`pass`: with both gates firing, the earlier
 * version's early return left only the OTHER gate's marker behind, so the
 * envelope could not tell an operator that this gate had run at all.
 */
function enforcePrePostDiffAvailability(
  dimensions: readonly DimensionEvidence[],
  prePostDiff: PrePostDiffResult,
  collected: readonly CollectedEvidence[]
): readonly DimensionEvidence[] {
  if (prePostDiff.status === 'computed' && prePostDiffDelivered(collected)) return dimensions;
  const why =
    prePostDiff.status !== 'computed'
      ? prePostDiff.inGitWorkTree
        ? 'this is a git work tree, but no pre/post baseline diff could be produced for this run'
        : 'this project is not a git work tree, so no pre/post baseline diff can exist for it'
      : 'a baseline WAS computed for this run, but its source block was not delivered into the reviewer prompt (the evidence budget omitted it), so the reviewer never saw the comparison it would have to rest on';
  const reason =
    prePostDiff.status === 'computed'
      ? 'the artifact exists on disk but did not reach the reviewer'
      : prePostDiff.reason;
  return dimensions.map(dimension => {
    if (dimension.dimension !== 'existing-functionality-intact') return dimension;
    const marker = `[pre-post-diff-gate: ${
      dimension.verdict === 'pass'
        ? 'verdict downgraded from "pass" to "inconclusive"'
        : `gate ran; verdict "${dimension.verdict}" is already non-"pass" and is left unchanged`
    } — ${why}. Reason: ${reason}]`;
    const annotated: DimensionEvidence = {
      ...dimension,
      summary: `${dimension.summary} ${marker}`
    };
    if (dimension.verdict !== 'pass') return annotated;
    return { ...annotated, verdict: 'inconclusive', confidence: 'low' };
  });
}

/**
 * F-NIT — `inconclusive` is the one verdict that cannot carry `high`
 * confidence. "I am highly confident that I could not tell" is the schema's
 * one self-contradicting combination, and it reads as a strong statement to the
 * human this envelope is handed to. Both service gates that produce an
 * `inconclusive` a reviewer did not write already write `low`; this closes the
 * same hole for the ones the reviewer DID write, clamping to `medium` (the
 * upper bound `references/4-dimensions.md` documents for this verdict) and
 * leaving a marker so the clamp is auditable rather than silent.
 *
 * `fail` and `pass` are untouched: their confidence says something real.
 */
function clampInconclusiveConfidence(
  dimensions: readonly DimensionEvidence[]
): readonly DimensionEvidence[] {
  return dimensions.map(dimension => {
    if (dimension.verdict !== 'inconclusive' || dimension.confidence !== 'high') return dimension;
    return {
      ...dimension,
      confidence: 'medium',
      summary: `${dimension.summary} [confidence-gate: confidence clamped from "high" to "medium" — an "inconclusive" verdict cannot be highly confident that it could not tell.]`
    };
  });
}

/**
 * The source whose absence from the delivered prompt is a DELIVERY failure for
 * `functional-completeness`: the approved-scope contract.
 *
 * F-SAME-SHAPE — the hole the pre/post-diff gate closes for
 * `existing-functionality-intact` was still open one dimension over. That
 * dimension's rule is "a `pass` may not outlive the source it rests on", and
 * `functional-completeness` is DEFINED against the approved scope and its
 * non-goals — `prd/handoff.md` — but its `pass` only requires SOME source in its
 * SUPPORTS list to be FOUND, and `qa-test-report` (the first source in the
 * order, so the one the budget can never starve) also supports it. Measured on
 * both saturated fixtures: `prd/handoff.md` was inlined with zero bytes on every
 * run while the dimension still came back `pass`/`high` — the contract that
 * says what "complete" meant was never shown to the reviewer judging
 * completeness. Exactly the forged-clean-handoff shape, one dimension over.
 *
 * The delivery test for this source is the module's `whole` rule (`isDelivered`),
 * not "some bytes arrived": the contract is prose whose point is the part a
 * truncation would cut (scope then non-goals), so a partial slice is not a
 * weaker version of the contract — it is a different document, and the reviewer
 * would be judging "complete" against a scope list that stops mid-sentence.
 *
 * The gate deliberately does NOT fire when the contract is `missing` — ENOENT,
 * i.e. the file is absent from the project, whether because the workflow has no
 * PRD phase or because it never wrote one. A workflow with no PRD phase has no
 * contract to lose, and reddening that dimension forever would be the "gate
 * that is always red is noise" failure this primitive already names.
 *
 * F4 — what the gate fires on is the opposite fact: the contract IS there for
 * this run and did not reach the reviewer. `totalBytes === 0` used to stand in
 * for "not there", and it was wider than the comment above it: a 0-byte
 * `prd/handoff.md` is `empty`, not `missing` — the file exists, the PRD phase
 * ran, and the reviewer received no contract at all — yet the early return
 * skipped the gate and let `functional-completeness` come back `pass`/`high`.
 * The same line collapsed `unreadable` (EACCES / EBUSY: the contract exists and
 * this process could not open it) into "no PRD phase". The test is now the
 * STATUS the read phase produced, so "there is nothing to deliver" and "there
 * is something to deliver and it did not arrive" cannot be the same branch.
 */
function enforceScopeContractDelivery(
  dimensions: readonly DimensionEvidence[],
  collected: readonly CollectedEvidence[]
): readonly DimensionEvidence[] {
  const block = collected.find(item => item.source.key === SCOPE_CONTRACT_SOURCE_KEY);
  if (block === undefined || block.status === 'missing') return dimensions;
  if (isDelivered(block, 'functional-completeness')) return dimensions;

  return dimensions.map(dimension => {
    if (dimension.dimension !== 'functional-completeness') return dimension;
    const marker = `[scope-contract-gate: ${
      dimension.verdict === 'pass'
        ? 'verdict downgraded from "pass" to "inconclusive"'
        : `gate ran; verdict "${dimension.verdict}" is already non-"pass" and is left unchanged`
    } — the approved-scope contract (${block.relativePath}) exists for this run, but it did not reach the reviewer in full (${block.includedBytes} of ${block.totalBytes} bytes, status "${block.status}"), so "functional-completeness" was judged without the scope and non-goals it is defined against. Reason: ${block.reason || 'inlined only in part'}]`;
    const annotated: DimensionEvidence = {
      ...dimension,
      summary: `${dimension.summary} ${marker}`
    };
    if (dimension.verdict !== 'pass') return annotated;
    return { ...annotated, verdict: 'inconclusive', confidence: 'low' };
  });
}

/**
 * Attach the computed diff to the dimension as a first-class `pre-post-diff`
 * `EvidenceItem`.
 *
 * The service does this rather than trusting the reviewer to cite the source:
 * the dimension's contract NAMES this evidence kind and this artifact path, and
 * a machine-produced fact that only appears when an LLM remembers to type it is
 * not a guarantee. Appending cannot upgrade a verdict — the gate above has
 * already run, and this only makes the artifact the verdict rests on auditable.
 *
 * It follows the same delivery rule as the gate — it asks the SAME function, on
 * purpose: attaching the artifact to a dimension whose reviewer never received
 * that block would re-create the very contradiction this layer exists to remove
 * — an envelope claiming a `pre-post-diff` evidence item next to an
 * `inconclusive` verdict that says the comparison was never seen.
 */
function attachPrePostDiffEvidence(
  dimensions: readonly DimensionEvidence[],
  prePostDiff: PrePostDiffResult,
  collected: readonly CollectedEvidence[]
): readonly DimensionEvidence[] {
  if (prePostDiff.status !== 'computed' || !prePostDiffDelivered(collected)) return dimensions;
  const item: EvidenceItem = {
    kind: 'pre-post-diff',
    description: prePostDiff.summary,
    artifact: prePostDiff.relativePath
  };
  return dimensions.map(dimension => {
    if (dimension.dimension !== 'existing-functionality-intact') return dimension;
    const alreadyPresent = dimension.evidence.some(
      existing => existing.kind === 'pre-post-diff' && existing.artifact === item.artifact
    );
    if (alreadyPresent) return dimension;
    return { ...dimension, evidence: [...dimension.evidence, item] };
  });
}

/**
 * F2 — read what the delivered conclusion SAYS, and make a detected drift
 * impossible to hand over as "nothing needs attention".
 *
 * The layer that made delivery a machine fact stopped one step short: it
 * verified that the reviewer received the `VERDICT:` line and then threw the
 * line away, keeping only a boolean. Measured (QA round 5, one export removed,
 * the model replying 4/4 `pass`):
 *
 *   VERDICT: STRUCTURAL DRIFT DETECTED — ... 1 export name(s).
 *   existing-functionality-intact: pass/high
 *   allPass: true | needsAttention: []
 *
 * — an envelope that says "clean handoff" directly above the evidence it
 * attached itself, whose first line says a removal was detected. That is the
 * same shape as every other hole here: a check that ran, whose RESULT was never
 * consumed, so the check's presence was mistaken for its verdict.
 *
 * The verdict is deliberately NOT forced to `fail`: a removal can be authorized
 * by the approved scope, and that judgement belongs to the reviewer and to the
 * human. What is refused is SILENCE — a drift the service detected is a
 * dimension a human has to look at, so it is named in `needsAttention` (which
 * also clears `allPass`: a handoff with an open question is not a clean one)
 * and its dimension says so in its own summary.
 *
 * `indeterminate` counts too. A delivered conclusion this service cannot
 * classify is not "no drift" — it is a conclusion nobody read, which is the
 * defect this function exists to close, so it is surfaced rather than dropped.
 */
function enforceStructuralDriftAttention(
  dimensions: readonly DimensionEvidence[],
  deliveredConclusion: PrePostDiffConclusion | null
): { readonly dimensions: readonly DimensionEvidence[]; readonly mustAttend: boolean } {
  // `null` is "no conclusion was DELIVERED" — the gate above owns that case. It
  // must not be folded into `indeterminate`: a project with no baseline has not
  // delivered an unreadable conclusion, it has delivered none, and saying
  // otherwise would put a false "the comparison was never read" marker on every
  // non-git run.
  if (deliveredConclusion === null) return { dimensions, mustAttend: false };
  if (deliveredConclusion === 'no-drift' || deliveredConclusion === 'additions-only') {
    return { dimensions, mustAttend: false };
  }
  const what =
    deliveredConclusion === 'drift-detected'
      ? 'the delivered pre/post baseline diff reports STRUCTURAL DRIFT DETECTED'
      : 'the delivered pre/post baseline diff carries a VERDICT line this service cannot classify, so the comparison was never actually read';
  return {
    dimensions: dimensions.map(dimension => {
      if (dimension.dimension !== 'existing-functionality-intact') return dimension;
      return {
        ...dimension,
        summary: `${dimension.summary} [pre-post-diff-drift-gate: ${what}. The removal may well be authorized by the approved scope — that is the reviewer's and the human's call — but a detected drift is never "nothing needs attention": this dimension is listed in needsAttention and allPass is false.]`
      };
    }),
    mustAttend: true
  };
}

/**
 * True when the reply ends INSIDE a JSON string or with brackets still open —
 * i.e. it was cut off mid-structure rather than being malformed. Distinguishing
 * the two is the whole point: "the reply is not JSON" sends an operator looking
 * for a schema bug, when the real cause is that nobody raised the output
 * budget after the prompt grew.
 *
 * A minimal scanner is enough — braces and quotes inside string literals are
 * skipped, escapes are honoured, and the text is never parsed.
 */
function looksTruncated(text: string): boolean {
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
  }
  return inString || depth > 0;
}

/** The facts an operator needs to tell a budget problem from a format problem. */
function describeOutputBudget(maxTokens: number, outputTokens: number, characters: number): string {
  return `output budget: maxTokens=${maxTokens}, provider-reported output tokens=${outputTokens}, characters returned=${characters}`;
}

/**
 * N4 — say WHICH signal diagnosed the truncation, and flag the provider's usage
 * numbers when they are the only thing pointing at the ceiling. Measured on
 * this repo's machine: `input_tokens: 150` for a ~32 KiB prompt, so a reporter
 * that cannot count the input should not be trusted to count the output.
 */
function describeTruncationSignal(structurallyCut: boolean, ceilingReached: boolean): string {
  if (structurallyCut && ceilingReached) {
    return 'reply ends mid-structure AND provider-reported output reached the ceiling';
  }
  if (structurallyCut) {
    return 'reply ends mid-structure (structural)';
  }
  return 'provider-reported output reached the ceiling only — the provider’s usage reporting is not trustworthy on its own, so verify before raising anything';
}

/**
 * N4 — call the reviewer, retrying an EMPTY reply a bounded number of times.
 *
 * The empty reply is a separate failure mode from truncation and was measured
 * at 2/3 on this repo's machine. It is intermittent, so a bounded retry turns
 * most occurrences back into a completed review; when it does not, the caller
 * gets `EmptyReviewReplyError` — classified and diagnosable — instead of a
 * truncation message that sends the operator to raise a budget that was never
 * the problem.
 *
 * The classification reads the runner's message because `LlmRunner` is a
 * structural interface here (this module deliberately does not depend on the
 * concrete provider module); "no text block" is the runner's own fixed wording
 * for a response with no text content.
 */
async function callReviewer(
  runner: LlmRunner,
  userPrompt: string,
  budget: { readonly maxTokens: number; readonly derivedMaxTokens: number }
): Promise<{ output: string; tokens: { input: number; output: number } }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EMPTY_REPLY_ATTEMPTS; attempt += 1) {
    try {
      return await runner.call(SYSTEM_PROMPT, userPrompt, { maxTokens: budget.maxTokens });
    } catch (error) {
      if (!isEmptyReplyError(error)) throw error;
      lastError = error;
    }
  }
  throw new EmptyReviewReplyError(
    `The provider returned NO TEXT BLOCK on ${String(MAX_EMPTY_REPLY_ATTEMPTS)}/${String(MAX_EMPTY_REPLY_ATTEMPTS)} attempts — this is an EMPTY-REPLY failure, NOT an output-budget truncation: the response carried no text content (a reasoning-only turn, a refusal, or a content filter), so there was no JSON to parse and raising the budget would not have helped. ${describeOutputBudget(budget.maxTokens, 0, 0)}. Last provider error: ${errorText(lastError)}`
  );
}

/**
 * `allPass` / `needsAttention` are DERIVED from the verdicts, never copied
 * verbatim from the model's own summary fields: a model that writes a fabricated
 * `pass` line plus a matching `allPass: true` would otherwise produce exactly
 * the forged clean handoff this primitive exists to prevent, and once the gate
 * above rewrites a verdict the two would silently disagree.
 *
 * Both fields are only ever NARROWED, never widened — `allPass` cannot become
 * true unless the model also said true and no dimension is non-`pass`, and a
 * dimension the model itself flagged is never dropped from `needsAttention`.
 */
function summarizeVerdicts(
  dimensions: readonly DimensionEvidence[],
  modelFlags: { readonly allPass: unknown; readonly needsAttention: unknown },
  /**
   * Dimensions the SERVICE must flag whatever the model said — today, the one
   * F2 names when the delivered baseline reports structural drift. A handoff
   * with a machine-detected drift in it is not clean, so this also clears
   * `allPass`, exactly as a non-`pass` verdict does.
   */
  mustAttend: readonly DimensionKind[] = []
): {
  readonly allPass: boolean;
  readonly needsAttention: readonly DimensionKind[];
} {
  const nonPass = dimensions.filter(d => d.verdict !== 'pass').map(d => d.dimension);
  const flaggedByModel = Array.isArray(modelFlags.needsAttention)
    ? (modelFlags.needsAttention as readonly DimensionKind[])
    : [];
  return {
    allPass:
      modelFlags.allPass !== false &&
      dimensions.length > 0 &&
      nonPass.length === 0 &&
      mustAttend.length === 0,
    needsAttention: [...new Set<DimensionKind>([...flaggedByModel, ...nonPass, ...mustAttend])]
  };
}

export async function prepareFinalReview(
  rid: string,
  opts: PrepareFinalReviewOptions
): Promise<FinalReviewOutput> {
  const auditGoalPath = join(
    opts.projectRoot,
    '.peaks',
    '_runtime',
    opts.sessionId,
    'audit-goal',
    `${rid}.json`
  );

  let approvedGoal: { successCriteria: readonly string[] };
  try {
    approvedGoal = JSON.parse(readFileSync(auditGoalPath, 'utf8')) as {
      successCriteria: readonly string[];
    };
  } catch (err) {
    throw new Error(
      `Cannot read approved goal from ${auditGoalPath}: ${(err as Error).message}`
    );
  }

  // The pre/post baseline diff is produced BEFORE the read phase: it is the one
  // step in this service that runs a command (`git`, read-only) and writes a
  // file, and it has to finish first because its artifact is also an evidence
  // source below. Everything after this line is still pure file reading.
  const prePostDiff = producePrePostDiff({
    projectRoot: opts.projectRoot,
    sessionId: opts.sessionId,
    ...(opts.baseRef === undefined ? {} : { baseRef: opts.baseRef })
  });

  const evidence = collectEvidence(
    opts.projectRoot,
    opts.sessionId,
    rid,
    prePostDiff.status === 'computed'
  );

  // F-BLOCK: the fourth dimension needs the baseline to have been DELIVERED,
  // not merely computed, so the delivery fact is measured on the collected
  // evidence (what the prompt carries) rather than read off the producer's
  // status (what exists on disk).
  const ppdDelivered = prePostDiffDelivered(evidence);

  // H2: a dimension whose every on-disk source is structurally undeliverable is
  // a fact about the EVIDENCE, so it is measured where the evidence is and
  // stated in both the prompt and the envelope — an always-red dimension that
  // explains itself is a finding; one that does not is noise.
  const undeliverable = undeliverableDimensions(evidence);
  const reachabilityStatus = renderDeliveryReachabilityStatus(undeliverable);

  const userPrompt = [
    `Approved goal's success criteria: ${JSON.stringify(approvedGoal.successCriteria)}`,
    '',
    '## On-disk evidence',
    'You have NO tools and NO filesystem access — the blocks below are ALL the evidence that exists for this review. They were collected read-only by the service; nothing was executed.',
    '',
    renderEvidenceSection(evidence),
    '',
    renderPrePostDiffStatus(prePostDiff, ppdDelivered),
    '',
    ...(reachabilityStatus === '' ? [] : [reachabilityStatus, '']),
    EVIDENCE_RULES,
    '',
    'Prepare the 4-dim review evidence.'
  ].join('\n');

  // D1 layer 3: the ceiling follows the evidence actually inlined, so the two
  // sides of the call cannot drift apart again. N4 adds the env lever on top.
  const includedEvidenceBytes = evidence.reduce((sum, item) => sum + item.includedBytes, 0);
  const derivedMaxTokens = outputBudgetForEvidence(includedEvidenceBytes);
  const maxTokens = resolveOutputBudget(includedEvidenceBytes);

  const response = await callReviewer(opts.llmRunner, userPrompt, { maxTokens, derivedMaxTokens });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output);
  } catch (err) {
    const budget = describeOutputBudget(
      maxTokens,
      response.tokens.output,
      response.output.length
    );
    // N4 — the STRUCTURAL judgement is primary: `looksTruncated()` reads the
    // reply itself and needs no cooperation from the provider. The
    // `output_tokens >= maxTokens` comparison is kept as a corroborating
    // signal, but it cannot be the only one: this endpoint reported
    // `input_tokens: 150` for a ~32 KiB prompt, so its usage numbers are not
    // trustworthy on their own, and a provider that under-reports a truncated
    // reply would otherwise have it filed below as "not valid JSON" — sending
    // an operator to look for a schema bug that does not exist. Which signal
    // fired is reported, so the diagnosis is auditable rather than inferred.
    const structurallyCut = looksTruncated(response.output);
    const ceilingReached = response.tokens.output >= maxTokens;
    if (structurallyCut || ceilingReached) {
      throw new IncompleteFinalReviewError(
        `LLM output was TRUNCATED by the output budget before the 4-dim envelope was complete — this is an OUTPUT-BUDGET failure, not a malformed reply. Raise the budget: it scales with inlined evidence bytes, and ${MAX_OUTPUT_TOKENS_ENV} overrides it outright for this run. Signal: ${describeTruncationSignal(structurallyCut, ceilingReached)}. ${budget}. Parser said: ${(err as Error).message}`
      );
    }
    throw new IncompleteFinalReviewError(
      `LLM output is not valid JSON: ${(err as Error).message} (${budget})`
    );
  }

  const output = parsed as FinalReviewOutput;
  const presentDimensions = new Set<DimensionKind>(
    output.dimensions.map((d: DimensionEvidence) => d.dimension)
  );
  const missing = REQUIRED_DIMENSIONS.filter(d => !presentDimensions.has(d));
  if (missing.length > 0) {
    // A reply that stopped at the ceiling and still parsed is still a budget
    // problem, so the same diagnosis is attached here. N4: the structural
    // reading counts too — a reply cut off mid-array parses only because the
    // envelope it produced happened to be closed early.
    const budgetExhausted = response.tokens.output >= maxTokens || looksTruncated(response.output);
    throw new IncompleteFinalReviewError(
      `Missing required dimensions: ${missing.join(', ')}${
        budgetExhausted
          ? ` — the provider hit the output budget and the reply was cut short (${describeOutputBudget(maxTokens, response.tokens.output, response.output.length)}); raise the budget instead of retrying blindly.`
          : ''
      }`
    );
  }

  // F2: what the DELIVERED conclusion says. Read before the verdicts are
  // assembled, because a detected drift has to reach `needsAttention` whatever
  // the reviewer answered. `null` — nothing delivered — is NOT
  // `indeterminate`: see `enforceStructuralDriftAttention`.
  const ppdBlock = evidence.find(item => item.source.key === PRE_POST_DIFF_SOURCE_KEY);
  const ppdConclusion: PrePostDiffConclusion | null =
    ppdBlock !== undefined && ppdDelivered ? classifyPrePostDiffVerdict(ppdBlock.content) : null;

  // D1: the verdicts must rest on evidence that actually existed, and the
  // derived summary flags must match the verdicts — see the helpers above.
  const gated = enforceStructuralDriftAttention(output.dimensions, ppdConclusion);
  const dimensions = attachPrePostDiffEvidence(
    enforceDeliveryReachability(
      enforceScopeContractDelivery(
        enforcePrePostDiffAvailability(
          enforceEvidenceBackedVerdicts(
            clampInconclusiveConfidence(gated.dimensions),
            dimensionsWithEvidence(evidence)
          ),
          prePostDiff,
          evidence
        ),
        evidence
      ),
      undeliverable
    ),
    prePostDiff,
    evidence
  );
  // H2 adds nothing to `mustAttend` on purpose: `enforceDeliveryReachability`
  // has already made every undeliverable dimension non-`pass`, so it is in
  // `needsAttention` (and `allPass` is false) through the verdict route. A
  // second flag for the same dimension would be a check whose result nothing
  // reads — the shape this primitive exists to catch.
  const { allPass, needsAttention } = summarizeVerdicts(dimensions, output, [
    ...(gated.mustAttend ? (['existing-functionality-intact'] as const) : [])
  ]);

  return { ...output, dimensions, allPass, needsAttention };
}

export function decideFifthDimension(input: { readonly audit: CapabilityAuditResult | null; readonly nowMs: number }): {
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  readonly reason: string;
} {
  if (input.audit === null) return { verdict: 'inconclusive', reason: 'AUDIT_GUARD_NOT_RUN' };
  if (isStale(input.audit.auditedAt, input.nowMs)) return { verdict: 'inconclusive', reason: 'AUDIT_STALE' };
  if (input.audit.crossCheck.guardVsAudit === 'diverge') return { verdict: 'inconclusive', reason: 'AUDIT_CROSS_CHECK_DIVERGE' };
  if (input.audit.verdict === 'consistent') return { verdict: 'pass', reason: 'audit consistent' };
  if (input.audit.verdict === 'drifted')    return { verdict: 'fail',  reason: 'audit drifted' };
  return { verdict: 'inconclusive', reason: 'audit inconclusive' };
}
