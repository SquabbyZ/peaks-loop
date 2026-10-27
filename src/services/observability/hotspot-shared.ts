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
 * WHY THE ARTIFACT IS ITS TEMPLATE, AND WHY THE PLACEHOLDER STAYS. The path
 * a forward event carries has the slice's rid substituted into it, so the same
 * artifact missed by two slices would be two rows and the count would be
 * useless. The template the path came from is recognised by re-filling the
 * slot with the rid and comparing, which is exact — a substring search could
 * match the wrong template.
 *
 * The template is named WITH its `<rid>` placeholder intact. Stripping the
 * placeholder produced paths that name no real file — `qa/test-cases/.md` is
 * a directory and a dot, not an artifact — and a reader could not tell which
 * artifact the row was about. The placeholder is the template's own way of
 * saying "the slice's id goes here", and it is what makes a forward row and a
 * retro-attributed row for the same artifact land on the SAME row.
 *
 * Paths no template claims (a declaration key, a legacy location) keep their
 * own shape.
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
  /** The artifact path, with the `<rid>` placeholder left in place. */
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
   * How many times the artifact was COUNTED.
   *
   * WHAT THE NUMBER COUNTS DEPENDS ON THE CONFIDENCE, and the row says which
   * — see `countMeaning`. For an `exact` row it is how many times the
   * artifact was observed MISSING. For a reconstructed row it is how many
   * times the artifact appeared in the CANDIDATE SET, which is not the same
   * thing at all: one real failure contributes to every candidate the
   * attribution could not narrow, so the number is candidate mentions, not
   * failures.
   */
  readonly count: number;
  /**
   * What `count` counts, so a reader cannot take a candidate mention for a
   * missing artifact.
   *
   *   - `observed-missing` — the artifact was seen to be missing, this many
   *     times. Only an `exact` row says this.
   *   - `candidate-mentions` — the artifact was one of the candidates, this
   *     many times. One real failure contributes to SEVERAL candidates, so
   *     this number is an UPPER BOUND on the real count and is NOT a count of
   *     failures.
   */
  readonly countMeaning: 'observed-missing' | 'candidate-mentions';
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

/**
 * The artifact path with the `<rid>` placeholder left in place.
 *
 * The template is recognised by re-filling the slot with the rid and
 * comparing, which is exact. The template is then returned AS IT IS: the
 * placeholder is part of the artifact's name, and stripping it produced paths
 * that name no real file.
 *
 * WHY A `<rid>`-LESS PATH IS RETURNED AS IT IS. The templates matched here
 * are the ones that CARRY a slot, so a path that came from a template
 * without one — `qa/.initiated` is a real artifact — never matches and is
 * returned unchanged. That asymmetry is DELIBERATE: there is nothing to
 * canonicalise, because the path already names the artifact it is. Do not
 * "fix" it by widening the template list — a template with no slot would
 * match EVERY path it happened to equal, and the comparison is only exact
 * for the form that carries the substituted id.
 */
export function canonicalArtifact(path: string, rid: string): string {
  for (const template of PREREQ_TEMPLATES) {
    if (template.replace('<rid>', rid) === path) return template;
  }
  return path;
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

/**
 * What a row's count counts, decided by the row's confidence.
 *
 * Only a row whose missing list was MEASURED counts missing artifacts. A
 * reconstructed row counts CANDIDATE MENTIONS, and one real failure
 * contributes to every candidate the attribution could not narrow — so the
 * number is not a count of failures and must not be read as one.
 */
export function countMeaningOf(
  confidence: HotspotConfidence
): 'observed-missing' | 'candidate-mentions' {
  return confidence === 'exact' ? 'observed-missing' : 'candidate-mentions';
}

/**
 * The ranking split by what each row's count counts.
 *
 * WHY THE SPLIT EXISTS. A row's `count` means DIFFERENT THINGS depending on
 * how the row was known: an `exact` row counted the artifact being MISSING,
 * and a reconstructed row counted the artifact being one of the CANDIDATES —
 * one real failure contributes to every candidate the attribution could not
 * narrow, so the number is candidate mentions, not failures.
 *
 * A consumer that sees `count: 91` and `countMeaning` as a SIBLING field has
 * to look up the meaning before reading the number. Splitting the rows by
 * their meaning puts the meaning in the NAME the reader sees — the group a
 * row is in says what its count counts — and the same split serves the
 * markdown report, so there is ONE structure in two places.
 */
export type HotspotGroups = {
  /** Rows whose count is how many times the artifact was OBSERVED missing. */
  readonly observedOmissions: readonly HotspotRow[];
  /** Rows whose count is how many times the artifact was a CANDIDATE mention. */
  readonly candidateMentions: readonly HotspotRow[];
};

/**
 * The ranking, split by what each row's count counts.
 *
 * The split is by the row's `countMeaning`, so it cannot disagree with the
 * column the report renders.
 */
export function groupHotspotsByMeaning(rows: readonly HotspotRow[]): HotspotGroups {
  return {
    observedOmissions: rows.filter((row) => row.countMeaning === 'observed-missing'),
    candidateMentions: rows.filter((row) => row.countMeaning === 'candidate-mentions')
  };
}

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
