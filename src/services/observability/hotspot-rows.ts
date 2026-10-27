/**
 * `src/services/observability/hotspot-rows.ts`
 *
 * The hotspot RANKING: the rows, in the order a reader should read them.
 *
 * WHY THIS EXISTS. The programme's premise is that the QA verdict says
 * "pass" without saying WHICH check was skipped, so a reader cannot go and
 * fix the skill that is actually failing. This ranking names the artifact and
 * its owner, so the next step ("raise this to a hook") has a target.
 *
 * TWO SOURCES, AND THE CONFIDENCE COLUMN SAYS WHICH. A FORWARD event (v2)
 * carries the missing list as it was MEASURED: the path, the mode and the
 * owner are all facts, and the row's confidence is `exact`. A HISTORICAL
 * event (v1) carries only a COUNT, so the artifact is a CANDIDATE recovered
 * by the retro-attribution, and the row's confidence is `inferred` (the count
 * matched the whole prerequisite list) or `ambiguous` (the count did not
 * localise to one entry). The spec (§2.2 S2.2) puts all three tiers in one
 * ranking and requires them to be LABELLED, because an `inferred` row says
 * "this artifact was in the missing set", NOT "this artifact was proven
 * missing". A reader who sorts by count must be able to see which rows are
 * measurements and which are reconstructions.
 *
 * A ROW WITH NO OWNER IS STILL A ROW. An artifact whose directory the
 * owner map does not know is a NEW artifact type, and a new artifact type is
 * exactly what a reader needs to see — the gate is that it is COUNTED, not
 * that it is attributed. Dropping it would hide a whole class of failures
 * behind a mapping gap, which is the failure mode the owner map exists to
 * prevent.
 *
 * WHY THE READERS LIVE NEXT DOOR. `hotspot-sources.ts` holds the reading of
 * the event stream, so this file states what a row MEANS and what the
 * ranking guarantees; `hotspot-shared.ts` holds the vocabulary the two
 * share. The same split `aggregation.ts` and `aggregation-helpers.ts` make in
 * this directory.
 */

import { forwardRows, recordedMissing, retroRows } from './hotspot-sources.js';
import {
  type HotspotConfidence,
  type HotspotRequestTypes,
  type HotspotRow,
  type RowBuilder
} from './hotspot-shared.js';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import type { ObservabilityEvent } from './observability-service.js';

/** The confidence order the ranking sorts by at equal counts. */
const CONFIDENCE_ORDER: Readonly<Record<HotspotConfidence, number>> = {
  exact: 0,
  inferred: 1,
  ambiguous: 2
};

/** The row a builder has become. */
function toRow(row: RowBuilder): HotspotRow {
  return {
    ownerSkill: row.ownerSkill,
    artifact: row.artifact,
    kind: row.kind,
    confidence: row.confidence,
    count: row.count,
    sessions: row.sessions.size,
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    evidence: row.evidence
  };
}

/**
 * The hotspot ranking over a set of events.
 *
 * The request types are the DECLARED type of each slice, resolved by the
 * caller from the request artifact: the retro-attribution needs them to
 * re-derive a transition's prerequisite list, and the event stream does
 * not carry them. Without them the historical failures cannot be
 * attributed, and the ranking would silently show only the forward events.
 */
export function aggregateHotspots(
  events: readonly ObservabilityEvent[],
  requestTypes: HotspotRequestTypes = new Map<string, RequestType>()
): HotspotRow[] {
  const builders = new Map<string, RowBuilder>();
  for (const event of events) {
    const rid = event.sliceRid;
    if (rid === undefined) continue;
    const detail = event.detail as { readonly prereqOk?: unknown };
    if (recordedMissing(event) !== null) {
      forwardRows(event, rid, builders);
      continue;
    }
    if (detail.prereqOk === false) {
      retroRows(event, rid, requestTypes.get(rid), builders);
    }
  }
  return [...builders.values()]
    .map(toRow)
    .sort(
      (a, b) =>
        b.count - a.count ||
        CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
        (a.ownerSkill ?? '').localeCompare(b.ownerSkill ?? '') ||
        a.artifact.localeCompare(b.artifact)
    );
}
