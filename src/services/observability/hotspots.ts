/**
 * `src/services/observability/hotspots.ts`
 *
 * The hotspot ranking: which artifact does a skill keep failing to deliver,
 * and who owns it.
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
 * WHY THE READERS LIVE NEXT DOOR. `hotspot-rows.ts` holds the reading of
 * the event stream, so this file states what a row MEANS and what the
 * ranking guarantees — the same split `aggregation.ts` and
 * `aggregation-helpers.ts` make in this directory.
 */

export { aggregateHotspots } from './hotspot-rows.js';
export {
  canonicalArtifact,
  type HotspotConfidence,
  type HotspotEvidence,
  type HotspotRequestTypes,
  type HotspotRow
} from './hotspot-shared.js';
