/**
 * `src/services/observability/hotspot-attribution-summary.ts`
 *
 * The retro-attribution's own accounting: how many historical failures were
 * attributed, how confidently, and on what basis.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE RANKING. The ranking answers
 * "which artifact does a skill keep failing to deliver"; this answers "how
 * much of that rests on a fact nobody wrote down". The two share the
 * attribution gate (`hotspot-sources.ts`) so they cannot disagree about
 * WHICH failures were attributed — but they report different things, and a
 * reader asking "how many of these attributions rested on a type nobody
 * wrote down?" needs this one.
 *
 * WHY THE PROVENANCE IS COUNTED HERE AND NOT IN THE RANKING. The ranking's
 * rows are per ARTIFACT, and one failure fans out into many candidate rows.
 * Counting there would count one failure many times and answer a question
 * nobody asked. This counts failures.
 *
 * WHY A DEFAULTED TYPE IS NOT A MISSING TYPE. An artifact with no usable
 * `- type:` line still has an EFFECTIVE type — the system's default — and
 * that is the type the prerequisite table was indexed by when the transition
 * ran, so the attribution uses it. The attribution is real; only its
 * PROVENANCE is weak. The two facts are reported apart: `fromDeclaredType`
 * and `fromDefaultedType` are separate numbers, and `unresolved` counts the
 * failures whose request artifact could not be read at all — a fact that is
 * NOT the same as "nobody wrote the type down".
 */

import { attributeFailure, isHistoricalFailure } from './hotspot-sources.js';
import type { RequestTypeReading } from './hotspot-shared.js';
import type { ObservabilityEvent } from './observability-service.js';

/**
 * What the CLI's reader found while it read the request artifacts.
 *
 * WHY THESE ARE COUNTED APART FROM EACH OTHER AND FROM `unresolved`. The
 * reader used to count "a type this command does not recognise" — a THIRD
 * fact, and one that never fired, because the canonical reader substitutes
 * the default rather than refusing. So a request whose type line was
 * absent, one whose line named something unknown, and one whose artifact
 * could not be read all looked alike. They do not.
 */
export type RequestArtifactCounts = {
  /** Artifacts that could not be read at all — their slice's type is unknown. */
  readonly unreadable: number;
  /** Artifacts that read fine but carried no usable `- type:` line. */
  readonly withoutTypeLine: number;
};

/** How the historical failures in a scope were attributed. */
export type HotspotAttributionSummary = {
  /**
   * How many historical failures were attributed at all — the population the
   * confidence counts divide.
   */
  readonly attributed: number;
  /** How many the count matched the whole prerequisite list to. */
  readonly inferred: number;
  /** How many the count could not narrow to one entry. */
  readonly ambiguous: number;
  /** How many rested on a type the request artifact DECLARED. */
  readonly fromDeclaredType: number;
  /** How many rested on the DEFAULT type — a type nobody wrote down. */
  readonly fromDefaultedType: number;
  /**
   * How many historical failures had NO usable request type — their artifact
   * could not be read, so nothing could be attributed to them.
   *
   * A DIFFERENT FACT FROM `fromDefaultedType`. A defaulted type is a real
   * type that was not written down; an unresolved one is a type nobody can
   * supply at all. Conflating them would report a missing artifact as a
   * missing line.
   */
  readonly unresolved: number;
  /** The request artifacts the reader could not read. */
  readonly artifactsUnreadable: number;
  /** The request artifacts that read fine but carried no usable type line. */
  readonly artifactsWithoutTypeLine: number;
};

/**
 * The attribution summary of a scope.
 *
 * `requestTypes` is keyed by slice rid and carries each type WITH its
 * provenance, so a failure whose type was defaulted is counted as defaulted
 * rather than being indistinguishable from a declared one.
 */
export function summarizeAttribution(
  events: readonly ObservabilityEvent[],
  requestTypes: ReadonlyMap<string, RequestTypeReading>,
  artifacts: RequestArtifactCounts
): HotspotAttributionSummary {
  let attributed = 0;
  let inferred = 0;
  let ambiguous = 0;
  let fromDeclaredType = 0;
  let fromDefaultedType = 0;
  let unresolved = 0;
  for (const event of events) {
    if (!isHistoricalFailure(event)) continue;
    const rid = event.sliceRid;
    const reading = rid === undefined ? undefined : requestTypes.get(rid);
    const resolved = attributeFailure(event, reading);
    if (resolved === null) {
      unresolved += 1;
      continue;
    }
    attributed += 1;
    if (resolved.attribution.confidence === 'inferred') inferred += 1;
    else ambiguous += 1;
    if (resolved.attribution.typeSource === 'declared') fromDeclaredType += 1;
    else fromDefaultedType += 1;
  }
  return {
    attributed,
    inferred,
    ambiguous,
    fromDeclaredType,
    fromDefaultedType,
    unresolved,
    artifactsUnreadable: artifacts.unreadable,
    artifactsWithoutTypeLine: artifacts.withoutTypeLine
  };
}
