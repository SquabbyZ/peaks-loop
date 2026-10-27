/**
 * `src/services/observability/retro-attribution.ts`
 *
 * Retro-attribution: name the artifacts behind the historical failures that
 * recorded only a COUNT.
 *
 * WHY THIS EXISTS. Every slice-transition event carries `detail.missingCount`.
 * The v1 events in this repository's own event log were written before the
 * emitter kept the missing-artifact LIST, so the list they name is not in the
 * record, and no amount of reading the record will produce it.
 *
 * WHAT CAN BE DERIVED INSTEAD. The prerequisite table is a pure function of
 * three values — the artifact role, the target state and the request type —
 * and a v1 event carries the first two. Re-deriving the table for that
 * transition yields the CANDIDATE set: the artifacts the missing entries could
 * be. The recorded count then says how many artifacts were missing in total,
 * which is what decides whether the candidates can be narrowed.
 *
 * WHY THE CONFIDENCE IS CAPPED AT `inferred`. The derivation runs over
 * TODAY's prerequisite table, and the table is version-controlled code that
 * changes between two recorded events. A retro-attribution is therefore a
 * reconstruction, not a measurement, so `exact` — which means "observed when
 * it happened" — is never returned here. Only a forward event that stored the
 * missing list as it was observed can carry it.
 *
 * WHY A COUNT MAY EXCEED THE TABLE. The recorded count is not the table's row
 * count: the missing list is also fed by the judged-declaration refusals (the
 * security artifact's own location) and by the handoff capsule's gate-evidence
 * declaration (a key naming a file that is not on disk). Neither of those two
 * sources is derivable from what a v1 event stores, so a count larger than
 * the table's list yields `ambiguous` with the table's entries as the
 * candidates. The candidate set is never widened with a guess, and the
 * confidence never rises to cover the gap.
 */

import {
  getPrerequisitesFor,
  isRequestType,
  type ArtifactPrerequisite,
  type RequestType
} from '../artifacts/artifact-prerequisites.js';
import type { RequestArtifactRole } from '../artifacts/artifact-templates.js';
import type { RequestTypeSource } from '../artifacts/request-artifact-metadata.js';
import type { RequestArtifactState } from '../artifacts/request-artifact-state-helpers.js';
import { ownerSkillForPath } from './owner-skill-map.js';

/**
 * How far an attribution can be trusted.
 *
 *   - `exact` — the missing list was measured when the event was recorded.
 *     Only a forward event carries it; the retro-attribution never does.
 *   - `inferred` — the recorded count is CONSISTENT WITH the whole candidate
 *     list being the missing set. It is not proof, and it must not be read as
 *     proof: the missing list has three sources (the prereq table, the
 *     judged-declaration refusals, the gate-evidence declaration), so a count
 *     equal to the table's length can match by coincidence while the missing
 *     entries came from the other two. `inferred` says "the count does not
 *     contradict this set", never "these artifacts were proven missing".
 *   - `ambiguous` — the count cannot single out any subset, so the candidate
 *     set stays the whole prereq list. An EMPTY candidate set means "nothing
 *     derivable" — distinguishable from "ambiguous among N" by
 *     `candidates.length === 0`, and it is the shape a transition the table
 *     holds nothing for produces.
 */
export type AttributionConfidence = 'exact' | 'inferred' | 'ambiguous';

/**
 * One attribution: how far it can be trusted, and the artifacts it can name.
 *
 * The candidates are a CANDIDATE list: the prereq paths of the transition,
 * each paired with the skill that owns it. They name the artifacts the missing
 * entries could be — not the artifacts that were proven missing, which only a
 * forward event records. `ownerSkill` is `null` when no skill owns the path —
 * a stated absence, not a missing field.
 *
 * `typeSource` says where the type that produced these candidates came from.
 * The CANDIDATES are the same either way — the effective type is the type the
 * prerequisite table was indexed by — but a reader asking "how many of these
 * attributions rested on a type nobody wrote down?" cannot answer it unless
 * the source travels with the attribution.
 */
export type RetroAttribution = {
  readonly confidence: AttributionConfidence;
  readonly candidates: ReadonlyArray<{ path: string; ownerSkill: string | null }>;
  /** Whether the type that produced these candidates was DECLARED or defaulted. */
  readonly typeSource: RequestTypeSource;
};

/** The inputs one historical failure carries, all of them derivable. */
export type RetroAttributionInput = {
  /** The role of the artifact that was moving — the event's `detail.artifactRole`. */
  readonly artifactRole: RequestArtifactRole;
  /** The state it was moving to — the event's `detail.to`. */
  readonly newState: RequestArtifactState;
  /** The request's EFFECTIVE type — read from the artifact, or the default. */
  readonly requestType: RequestType;
  /** Where that type came from: declared on the `- type:` line, or defaulted. */
  readonly typeSource: RequestTypeSource;
  /** How many artifacts the event recorded as missing. */
  readonly missingCount: number;
};

/**
 * The prereq list for one transition, or an empty list when the request type
 * is not one the table knows.
 *
 * The table is indexed by request type, and an event's type arrives from a
 * file this module does not own — so an unknown type must answer an empty
 * list rather than raise inside a read path.
 *
 * The published parameter is a `RequestType`, so this arm is reachable only
 * from a caller that ignores the signature.
 */
function prerequisitesFor(
  role: RequestArtifactRole,
  newState: RequestArtifactState,
  requestType: RequestType
): ReadonlyArray<ArtifactPrerequisite> {
  if (!isRequestType(requestType)) return [];
  return getPrerequisitesFor(role, newState, requestType);
}

/**
 * The recorded count, or `null` when it cannot be read as a count.
 *
 * A count that is missing, negative or not a number says nothing about how
 * many artifacts were missing, so the candidate set cannot be narrowed by it.
 *
 * The published parameter is a `number`, so this arm is reachable only from a
 * caller that ignores the signature.
 */
function readableCount(value: number): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
}

/**
 * The candidate list of one transition, in the table's own order.
 *
 * The path is the table's `relativePath` TEMPLATE, with the `<rid>`
 * placeholder still in it: the transition that produced the event is not
 * available here, so the template is the most specific path that can be
 * named. The owner lookup is a prefix match, so the placeholder does not
 * affect it.
 */
function candidatesFor(
  prereqs: ReadonlyArray<ArtifactPrerequisite>
): ReadonlyArray<{ path: string; ownerSkill: string | null }> {
  return prereqs.map((prereq) => ({
    path: prereq.relativePath,
    ownerSkill: ownerSkillForPath(prereq.relativePath)
  }));
}

/**
 * Attribute one historical failure to the artifacts that could have been
 * missing.
 *
 * The rules, in the order they apply:
 *
 *   - a transition the table demands nothing for → `ambiguous`, no candidate;
 *   - a count that cannot be read → `ambiguous`, the whole list as candidates;
 *   - a count of zero → `ambiguous`, no candidate (the record says nothing
 *     was missing, so naming a candidate would contradict it);
 *   - a count equal to the list's length → `inferred`, the whole list;
 *   - any other count → `ambiguous`, the whole list as candidates.
 *
 * WHAT `inferred` CLAIMS AT THE THIRD RULE. The count matches the table's
 * length, so the count is CONSISTENT WITH the whole list being the missing
 * set — and it is not proof of that. The missing list has three sources (the
 * prereq table, the judged-declaration refusals, the gate-evidence
 * declaration), and a count equal to the table's length can match by
 * coincidence while the missing entries came from the other two, leaving a
 * table entry intact. The same holds for a one-entry list and a count of one:
 * the single missing entry may have come from source two or three. So the
 * label says "the count does not contradict this set", and never "these
 * artifacts were proven missing".
 *
 * The last rule covers a count of one against a list of several, a count
 * between zero and the list's length, and a count ABOVE the list's length —
 * the last because the missing list has two further sources the table does
 * not describe, and neither of them is derivable from a v1 event.
 *
 * This function never returns `exact`. That confidence belongs to a forward
 * event, which recorded the missing list as it was observed; this one
 * reconstructs a candidate set from today's table and can therefore only
 * claim `inferred` or `ambiguous`.
 */
export function attributeV1Failure(opts: RetroAttributionInput): RetroAttribution {
  const prereqs = prerequisitesFor(opts.artifactRole, opts.newState, opts.requestType);
  const typeSource = opts.typeSource;
  if (prereqs.length === 0) return { confidence: 'ambiguous', candidates: [], typeSource };
  const candidates = candidatesFor(prereqs);
  const count = readableCount(opts.missingCount);
  if (count === null) return { confidence: 'ambiguous', candidates, typeSource };
  if (count === 0) return { confidence: 'ambiguous', candidates: [], typeSource };
  if (count === prereqs.length) return { confidence: 'inferred', candidates, typeSource };
  return { confidence: 'ambiguous', candidates, typeSource };
}
