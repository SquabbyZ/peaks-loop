import { resolvePresenceLease } from '../skills/presence-lease-resolver.js';
import { readPresenceGate } from '../skills/presence-gate.js';

/**
 *
 * Background: the consumer-facing CLAUDE.md template (rendered by
 * `peaks standards init` / `peaks standards update`) instructs the LLM
 * to display a compact status header
 *   `Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`
 * on every turn while a peaks skill is active. If the LLM forgets (e.g.
 * because of context compaction or a fresh session), the user is left
 * without an at-a-glance signal that peaks is orchestrating the work.
 *
 * This service is the read-only side of the slice-028 detection
 * mechanism. The PostToolUse hook (or any other consumer, e.g.
 * `peaks skill detect-marker-loss`) calls
 * `detectPresenceMarker({ project, latestAssistantMessage })`
 * and gets back:
 *
 *   - `active`:      whether an active lease was found on disk.
 *   - `skill?`:      the active skill name, if any.
 *   - `markerFound`: whether the latest assistant message carries the
 *                    expected `Peaks-Loop Skill:` / `Peaks-Loop Gate:`
 *                    marker. Always `false` when `active` is `false`.
 *   - `warning?`:    a human-readable warning emitted when the marker
 *                    is missing while the presence is active.
 *
 * The function is pure: it does not write to disk, does not clear the
 * presence file, and does not depend on `process.cwd()`. The caller is
 * expected to provide the absolute project root (peaks-loop convention
 * from the standards-commands family — see dev-preference rule
 * `project-option-is-canonical-project-root-source`).
 *
 * Slice 4.0.11 statusline-sid-scoped-lease C: the deprecated
 * project-level `active-skill.json` single-slot file is REMOVED
 * from this module. The canonical sid-scoped lease projection
 * (`.peaks/_runtime/<sid>/leases/presence-*.json`) is the only
 * source of truth; no legacy fallback is retained.
 */

const MARKER_PRIMARY = 'Peaks-Loop Skill:';
const MARKER_SECONDARY = 'Peaks-Loop Gate:';

export type DetectPresenceMarkerInput = {
  project: string;
  latestAssistantMessage: string;
};

export type DetectPresenceMarkerResult = {
  active: boolean;
  skill?: string;
  /** The gate the active presence is parked on — the machine fact behind
   * the status header's middle cell. Absent when the lease carries none. */
  gate?: string;
  markerFound: boolean;
  warning?: string;
};

export type PresenceMarkerWarning = (typeof PRESENCE_MARKER_WARNING)[number];

export const PRESENCE_MARKER_WARNING = [
  'Peaks skill context may have been lost from this conversation; please re-invoke /peaks-<skill>.'
] as const;

/**
 * Slice 4.0.11 statusline-sid-scoped-lease C: read the canonical
 * sid-scoped lease projection.
 *
 * Slice 4.0.17 (presence cross-session): the read goes through
 * the SAME resolver the `peaks skill presence` CLI uses — the lease that
 * is eligible across EVERY session tree, not just the bound one. The
 * two readers must not disagree: the CLI says "peaks-code is running"
 * and the hook says "no presence" is not a state a user can act on.
 *
 * Returns the freshest eligible lease (freshest `lastHeartbeat` wins,
 * with a total tie-break), or null when no tree holds one.
 */
function readCanonicalLease(projectRoot: string): { skill: string; gate?: string } | null {
  const selection = resolvePresenceLease(projectRoot);
  if (selection === null) return null;
  const gate = readPresenceGate(selection.lease.gate);
  return { skill: selection.lease.skill, ...(gate !== undefined ? { gate } : {}) };
}

/**
 * Slice 4.0.11 statusline-sid-scoped-lease C: the deprecated
 * broken-graph diagnostic walked the legacy `active-skill.json`
 * `graphRef` field. The canonical lease projection surfaces broken
 * graphs as a typed `PEAKS_GRAPH_REF_BROKEN` lease status at read
 * time (see `presence-lease-service.readJsonStrict`), so a separate
 * diagnostic walk is no longer needed. Kept as a no-op for the
 * public-surface stability of `detectPresenceMarker` (the warning
 * field shape stays the same); returns null unless the canonical
 * graph lookup is wired in a future slice.
 */
function tryDetectBrokenGraph(_projectRoot: string): string | null {
  return null;
}

function messageHasMarker(message: string): boolean {
  if (message.length === 0) return false;
  return message.includes(MARKER_PRIMARY) || message.includes(MARKER_SECONDARY);
}

/**
 * Pure read-only presence-marker detection. No I/O side effects.
 *
 * Slice 4.0.11 statusline-sid-scoped-lease C: the deprecated
 * `.peaks/_runtime/active-skill.json` (and legacy
 * `.peaks/.active-skill.json`) read paths are removed. The
 * canonical sid-scoped lease projection at
 * `.peaks/_runtime/<sid>/leases/presence-*.json` is the only source.
 * The `warning` field is preserved for downstream consumers
 * (statusline, doctor, hooks).
 */
export function detectPresenceMarker(input: DetectPresenceMarkerInput): DetectPresenceMarkerResult {
  const project = input.project;
  const message = input.latestAssistantMessage ?? '';

  const presence = readCanonicalLease(project);
  if (presence === null) {
    return { active: false, markerFound: false };
  }
  const gateField = presence.gate !== undefined ? { gate: presence.gate } : {};

  const brokenGraph = tryDetectBrokenGraph(project);
  const markerFound = messageHasMarker(message);
  if (markerFound) {
    if (brokenGraph !== null) {
      return {
        active: true,
        skill: presence.skill,
        ...gateField,
        markerFound: true,
        warning: `Peaks presence active but graph is broken (${brokenGraph}); run \`peaks workspace reconcile\` to repair.`
      };
    }
    return { active: true, skill: presence.skill, ...gateField, markerFound: true };
  }
  if (brokenGraph !== null) {
    return {
      active: true,
      skill: presence.skill,
      ...gateField,
      markerFound: false,
      warning: `Peaks presence active but graph is broken (${brokenGraph}); run \`peaks workspace reconcile\` to repair.`
    };
  }
  return {
    active: true,
    skill: presence.skill,
    ...gateField,
    markerFound: false,
    warning: PRESENCE_MARKER_WARNING[0]
  };
}
