/**
 * `src/services/observability/hotspot-sources.ts`
 *
 * The two readers the hotspot ranking is built from: a FORWARD event's
 * measured missing list, and a HISTORICAL event's count-only failure.
 *
 * WHY THEY ARE HERE AND NOT IN THE RANKING. The ranking says what a row
 * MEANS; this file says how each SOURCE of a row is turned into one. The
 * two are kept apart so the difference between a measurement and a
 * reconstruction is a difference of FILES, not of a branch buried in the
 * middle of a sort.
 *
 * WHY A HISTORICAL EVENT CANNOT CARRY A MODE. A v1 event recorded only a
 * COUNT — not which artifacts were missing, and not whether each was absent
 * or short. So a reconstructed row names the failure SURFACE the
 * prerequisite checks, and the row's confidence is what marks it as a
 * reconstruction rather than a measurement.
 */

import { getPrerequisitesFor, type RequestType } from '../artifacts/artifact-prerequisites.js';
import type { RequestArtifactRole } from '../artifacts/artifact-templates.js';
import {
  ALLOWED_STATES_PER_ROLE,
  type RequestArtifactState
} from '../artifacts/request-artifact-state-helpers.js';
import { attributeV1Failure } from './retro-attribution.js';
import { canonicalArtifact, count, ownerOf, type RowBuilder } from './hotspot-shared.js';
import type { ObservabilityEvent } from './observability-service.js';

/**
 * The artifact roles a transition can belong to.
 *
 * READ FROM THE CANONICAL TABLE, not from a list written here: a second
 * copy of the state vocabulary is a list that rots, and a state missing from
 * it silently drops every failure of that transition — which is how a whole
 * class of failures stops being counted.
 */
const TRANSITION_ROLES: readonly string[] = Object.keys(ALLOWED_STATES_PER_ROLE);

/** One missing entry as the event recorded it. */
type RecordedMissing = {
  readonly path?: unknown;
  readonly kind?: unknown;
  readonly ownerSkill?: unknown;
};

/** The measured missing list of a forward event, or null when it has none. */
export function recordedMissing(event: ObservabilityEvent): readonly RecordedMissing[] | null {
  const detail = event.detail as { readonly missing?: unknown };
  if (!Array.isArray(detail.missing)) return null;
  return detail.missing as readonly RecordedMissing[];
}

/**
 * The failure mode a prerequisite's own check reports.
 *
 * A prerequisite with no body markers can only fail by the file being
 * ABSENT; one WITH body markers is a file whose MARKERS may be short. The
 * row therefore names the surface the prerequisite checks, which is what a
 * count alone can support.
 */
function failureSurface(
  path: string,
  role: string,
  state: string,
  type: RequestType
): 'absent' | 'body' {
  const entry = getPrerequisitesFor(
    role as RequestArtifactRole,
    state as RequestArtifactState,
    type
  ).find((candidate) => candidate.relativePath === path);
  if (entry === undefined) return 'absent';
  const demandsMarkers =
    (entry.mustContain?.length ?? 0) > 0 ||
    (entry.mustContainAny?.length ?? 0) > 0 ||
    (entry.headingMustContain?.length ?? 0) > 0;
  return demandsMarkers ? 'body' : 'absent';
}

/** The rows a slice's forward (measured) missing list contributes. */
export function forwardRows(
  event: ObservabilityEvent,
  rid: string,
  into: Map<string, RowBuilder>
): void {
  const missing = recordedMissing(event);
  if (missing === null) return;
  for (const entry of missing) {
    if (typeof entry.path !== 'string') continue;
    const artifact = canonicalArtifact(entry.path, rid);
    const kind = entry.kind === 'body' ? 'body' : 'absent';
    // The owner is the ONE THE EVENT RECORDED, including a null: the event
    // resolved it when it was written, and a path the owner map does not know
    // is exactly the case that must stay visible. The map is only consulted
    // for an entry that carries no owner field at all.
    const ownerSkill =
      'ownerSkill' in entry
        ? typeof entry.ownerSkill === 'string'
          ? entry.ownerSkill
          : null
        : ownerOf(artifact);
    count(into, { ownerSkill, artifact, kind, confidence: 'exact', event, rid });
  }
}

/** The rows a slice's historical (count-only) failure contributes. */
export function retroRows(
  event: ObservabilityEvent,
  rid: string,
  requestType: RequestType | undefined,
  into: Map<string, RowBuilder>
): void {
  if (requestType === undefined) return;
  const detail = event.detail as {
    readonly artifactRole?: unknown;
    readonly to?: unknown;
    readonly missingCount?: unknown;
  };
  const role = typeof detail.artifactRole === 'string' ? detail.artifactRole : '';
  const state = typeof detail.to === 'string' ? detail.to : '';
  const missingCount = typeof detail.missingCount === 'number' ? detail.missingCount : 0;
  if (!TRANSITION_ROLES.includes(role)) return;
  if (
    !ALLOWED_STATES_PER_ROLE[role as RequestArtifactRole].includes(state as RequestArtifactState)
  ) {
    return;
  }
  const attribution = attributeV1Failure({
    artifactRole: role as RequestArtifactRole,
    newState: state as RequestArtifactState,
    requestType,
    missingCount
  });
  for (const candidate of attribution.candidates) {
    const artifact = canonicalArtifact(candidate.path, rid);
    const kind = failureSurface(candidate.path, role, state, requestType);
    const ownerSkill = candidate.ownerSkill ?? ownerOf(artifact);
    count(into, {
      ownerSkill,
      artifact,
      kind,
      confidence: attribution.confidence,
      event,
      rid
    });
  }
}
