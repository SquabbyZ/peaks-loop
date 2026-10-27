/**
 * `src/services/observability/hotspot-shared.ts`
 *
 * The vocabulary the hotspot ranking and its two source readers share: what
 * a row IS, the key rows are grouped by, and the counting primitive that
 * adds one occurrence to a row.
 *
 * WHY IT IS ITS OWN MODULE. The ranking, the forward reader and the
 * historical reader all need these, and the ranking CALLS the readers — so
 * the shared vocabulary cannot live in the ranking without a cycle. This
 * module is the seam.
 *
 * WHY THE ARTIFACT IS ITS TEMPLATE. The path a forward event carries has
 * the slice's rid substituted into it, so the same artifact missed by two
 * slices would be two rows and the count would be useless. The template the
 * path came from is recognised by re-filling the slot with the rid and
 * comparing, which is exact — a substring search could match the wrong
 * template. Paths no template claims (a declaration key, a legacy
 * location) keep their own shape.
 */

import { allPrerequisitePaths } from '../artifacts/prerequisite-path-census.js';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { ownerSkillForPath } from './owner-skill-map.js';
import type { AttributionConfidence } from './retro-attribution.js';
import type { ObservabilityEvent } from './observability-service.js';

/** How a row's artifact was known. */
export type HotspotConfidence = AttributionConfidence;

/** A pointer at one raw event. */
export type HotspotEvidence = {
  readonly sessionId: string;
  readonly ts: string;
  /** The slice the event belongs to. */
  readonly rid?: string;
};

/** One row of the hotspot ranking. */
export type HotspotRow = {
  /** The skill that owns the artifact, or null when no row claims it. */
  readonly ownerSkill: string | null;
  /** The artifact path, with the rid slot emptied. */
  readonly artifact: string;
  /**
   * The failure mode. For an `exact` row this is MEASURED — the file was
   * absent, or it existed and lacked a marker. For a reconstructed row it is
   * the surface the prerequisite checks, which is what a count alone can
   * support.
   */
  readonly kind: 'absent' | 'body';
  /**
   * How the row was known.
   *
   *   - `exact` — the missing list was MEASURED when the event was written.
   *   - `inferred` — recovered by the retro-attribution; the count matched the
   *     whole prerequisite list.
   *   - `ambiguous` — a CANDIDATE SET: the count did not localise to one
   *     entry, so the row says the artifact was a candidate, NOT that it was
   *     missing. An `ambiguous` row is not proof, and the report must not
   *     present it as such.
   */
  readonly confidence: HotspotConfidence;
  /**
   * How many times the artifact was missing — or, for a reconstructed row,
   * how many times it appeared in the candidate set. A reconstructed row's
   * count is therefore an UPPER BOUND on the real number, and the
   * confidence column is what says so.
   */
  readonly count: number;
  /** How many sessions the occurrences came from. */
  readonly sessions: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  /** The raw events the row was counted from. */
  readonly evidence: readonly HotspotEvidence[];
};

/** The request type of each slice, for the retro-attribution of v1 failures. */
export type HotspotRequestTypes = ReadonlyMap<string, RequestType>;

/** The templates a path can be recognised as, with the rid slot filled. */
const PREREQ_TEMPLATES: readonly string[] = allPrerequisitePaths().filter((path) =>
  path.includes('<rid>')
);

/** The artifact path with the rid slot emptied. */
export function canonicalArtifact(path: string, rid: string): string {
  for (const template of PREREQ_TEMPLATES) {
    if (template.replace('<rid>', rid) === path) return template.replace('<rid>', '');
  }
  return path.split('<rid>').join('');
}

/** The owner of an artifact, or null when no row claims it. */
export function ownerOf(artifact: string): string | null {
  return ownerSkillForPath(artifact);
}

/** The row under construction. */
export type RowBuilder = {
  ownerSkill: string | null;
  artifact: string;
  kind: 'absent' | 'body';
  confidence: HotspotConfidence;
  count: number;
  readonly sessions: Set<string>;
  firstSeen: string;
  lastSeen: string;
  readonly evidence: HotspotEvidence[];
};

/** One occurrence of an artifact, ready to be counted. */
export type Occurrence = {
  readonly ownerSkill: string | null;
  readonly artifact: string;
  readonly kind: 'absent' | 'body';
  readonly confidence: HotspotConfidence;
  readonly event: ObservabilityEvent;
  readonly rid: string;
};

/** The key a row is grouped by. */
function rowKey(
  ownerSkill: string | null,
  artifact: string,
  kind: 'absent' | 'body',
  confidence: HotspotConfidence
): string {
  return [ownerSkill ?? '', artifact, kind, confidence].join(' :: ');
}

/** Add one occurrence to a row. */
function accumulate(row: RowBuilder, occurrence: Occurrence): void {
  const { event, rid } = occurrence;
  row.count += 1;
  row.sessions.add(event.sessionId);
  if (row.firstSeen === '' || event.ts < row.firstSeen) row.firstSeen = event.ts;
  if (event.ts > row.lastSeen) row.lastSeen = event.ts;
  row.evidence.push({ sessionId: event.sessionId, ts: event.ts, rid });
}

/** Count one occurrence into the row the key names, creating it if new. */
export function count(into: Map<string, RowBuilder>, occurrence: Occurrence): void {
  const key = rowKey(
    occurrence.ownerSkill,
    occurrence.artifact,
    occurrence.kind,
    occurrence.confidence
  );
  const existing = into.get(key);
  if (existing !== undefined) {
    accumulate(existing, occurrence);
    return;
  }
  const row: RowBuilder = {
    ownerSkill: occurrence.ownerSkill,
    artifact: occurrence.artifact,
    kind: occurrence.kind,
    confidence: occurrence.confidence,
    count: 0,
    sessions: new Set<string>(),
    firstSeen: '',
    lastSeen: '',
    evidence: []
  };
  into.set(key, row);
  accumulate(row, occurrence);
}
