// The deferral's REASON, carried from the in-flight probe into the envelope.
//
// WHY THIS FILE EXISTS. The in-flight probe answers two different questions with
// one boolean: "is a dispatch running?" and "can the ledger be believed?". A
// dispatch that really is running and a ledger that could not be read BOTH defer
// the compaction — the safe direction — and both reached the operator as the same
// sentence, so "In-flight batch detected" could mean "this is normal" and "the
// ledger is unreadable, so the compaction is being postponed for a reason nobody
// can see" at the same time. The probe already tells the two apart: it returns a
// `reason` and the warning and error codes it collected, and the codes exist for
// exactly this. This module is the seam that carries that difference into the
// envelope and into the printed output.
//
// THE DECISION IS NOT TOUCHED HERE. Every unknown still defers, and a dispatch
// that is really in flight still defers; this file only says WHICH deferral it
// was. The probe's own answer is the only input.
import type { ResultEnvelope } from 'peaks-loop-shared/result';
import type { ProbeResult, ProbeWarning } from '../../services/workflow/workflow-inflight-probe.js';

/** One probe diagnostic, reduced to the two fields a consumer needs. */
export interface DeferralCode {
  readonly code: string;
  readonly message: string;
}

/** What the deferral was, in the shape the envelope carries it. */
export interface DeferralDetail {
  /** The probe's own reason: `fresh-dispatch` or `unknown-ledger-state`. */
  readonly reason: string;
  /** True when the deferral rests on something the probe could not establish. */
  readonly unknown: boolean;
  readonly warnings: readonly DeferralCode[];
  readonly errors: readonly DeferralCode[];
}

/** The probe's reason when it defers because a fact about the batch is unknown. */
const UNKNOWN_REASON = 'unknown-ledger-state';

function toCode(warning: ProbeWarning): DeferralCode {
  return { code: warning.code, message: warning.message };
}

/** The probe's answer, in the shape the envelope carries it. */
export function describeDeferral(probe: ProbeResult): DeferralDetail {
  return {
    reason: probe.reason,
    unknown: probe.reason === UNKNOWN_REASON,
    warnings: probe.warnings.map(toCode),
    errors: probe.errors.map(toCode)
  };
}

/**
 * The one sentence that tells the two deferrals apart.
 *
 * The codes are named because they are the machine-readable half of the same
 * fact, and an operator who wants the detail can grep the code.
 */
export function deferralSentence(detail: DeferralDetail): string {
  const codes = [...detail.errors, ...detail.warnings].map((code) => code.code);
  const head = detail.unknown
    ? 'Deferral reason: the dispatch ledger state is UNKNOWN'
    : 'Deferral reason: a dispatch IS in flight';
  const why = detail.unknown
    ? 'the ledger, or one of the records it names, could not be read, or a record said ' +
      'something this probe does not recognise, so this deferral is NOT a known running batch'
    : 'the ledger holds a live dispatch, so the compaction waits for it; this is the ' +
      'expected deferral, not a ledger problem';
  const named = codes.length === 0 ? '' : ` Codes: ${codes.join(', ')}.`;
  return `${head} (reason=${detail.reason}) — ${why}.${named}`;
}

/**
 * The envelope, with the deferral's reason attached.
 *
 * The detail lands in three places, because three readers exist: `data.deferral`
 * for a machine, `warnings` for the codes the probe collected, and the message
 * itself for whoever reads the printed output. An envelope that did not defer
 * comes back unchanged.
 */
export function withDeferralDetail(
  envelope: ResultEnvelope<unknown>,
  detail: DeferralDetail | null
): ResultEnvelope<unknown> {
  if (detail === null) return envelope;
  const sentence = deferralSentence(detail);
  const codes = [...detail.errors, ...detail.warnings].map(
    (code) => `${code.code}: ${code.message}`
  );
  const data =
    typeof envelope.data === 'object' && envelope.data !== null ? { ...envelope.data } : {};
  const nextActions = [...envelope.nextActions];
  if (nextActions.length === 0) nextActions.push(sentence);
  else nextActions[0] = `${nextActions[0]} ${sentence}`;
  return {
    ...envelope,
    data: { ...data, deferral: detail },
    warnings: [...envelope.warnings, ...codes],
    nextActions
  };
}
