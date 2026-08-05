import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Slice 028 (Q1=A): hook-based skill-presence marker detection.
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
 *   - `active`:      whether an active-skill marker was found on disk.
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
 */

// Slice 4.0.11 statusline-sid-scoped-lease A: the canonical hook
// path used to be `.peaks/_runtime/active-skill.json` (the deprecated
// single-slot file that race-conditions when multiple sessions drive
// one project). The canonical write moved to the sid-scoped lease
// projection in 4.0.8. This slice refactors only the comment; the
// read-path change to the lease projection lands in the 4-B
// sub-slice. Until 4-B ships, both paths remain readable for the
// one-minor-release back-compat window.
const PRESENCE_CANONICAL_PATH = '.peaks/_runtime/active-skill.json';
const PRESENCE_LEGACY_PATH = '.peaks/.active-skill.json';

const MARKER_PRIMARY = 'Peaks-Loop Skill:';
const MARKER_SECONDARY = 'Peaks-Loop Gate:';
const SKILL_NAME_RE = /"skill"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/;

export type DetectPresenceMarkerInput = {
  project: string;
  latestAssistantMessage: string;
};

export type DetectPresenceMarkerResult = {
  active: boolean;
  skill?: string;
  markerFound: boolean;
  warning?: string;
};

export type PresenceMarkerWarning = (typeof PRESENCE_MARKER_WARNING)[number];

export const PRESENCE_MARKER_WARNING = [
  'Peaks skill context may have been lost from this conversation; please re-invoke /peaks-<skill>.'
] as const;

function readPresenceFile(absolutePath: string): { skill: string } | null {
  if (!existsSync(absolutePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(absolutePath, 'utf8');
  } catch (err) { // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err;  // surface module-load bugs
    if (err instanceof SyntaxError) throw err;     // surface parse bugs
    return null;                                    // only swallow IO errors
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) { // TODO(g2): legacy silent catch — now narrows to IO errors only (grace: 1 minor release, v2.14.0)
    if (err instanceof ReferenceError) throw err;  // surface module-load bugs
    if (err instanceof SyntaxError) throw err;     // surface parse bugs
    return null;                                    // only swallow IO errors
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const skillMatch = SKILL_NAME_RE.exec(JSON.stringify(parsed));
  if (skillMatch === null) return null;
  if (typeof skillMatch[1] !== 'string' || skillMatch[1].length === 0) return null;
  return { skill: skillMatch[1] };
}

/**
 * Slice 4.0.8: surface a typed `PEAKS_GRAPH_REF_BROKEN` warning
 * when the canonical presence lease / index points at a missing or
 * corrupt graph. The legacy `active-skill.json` walk never
 * inspected graphRef; in 4.0.8 we surface the broken graph in the
 * `warnings` array so downstream consumers (statusline, doctor,
 * hooks) can render the diagnostic instead of silently rendering
 * "active" for a half-wired presence.
 */
function tryDetectBrokenGraph(projectRoot: string): string | null {
  try {
    const presenceIndexDir = resolve(projectRoot, '.peaks', '_runtime');
    if (!existsSync(presenceIndexDir)) return null;
    // Best-effort: walk a single directory level for the legacy
    // `active-skill.json` indicator. A broken graphRef would be
    // surfaced by the canonical lease service (PEAKS_GRAPH_REF_BROKEN
    // is the typed error), but the marker detector is a *read* —
    // we don't import the lease service here. The diagnostic is
    // best-effort: we report the index file's `graphRef` field
    // when it names a missing file.
    const legacyPath = resolve(projectRoot, '.peaks', '_runtime', 'active-skill.json');
    if (!existsSync(legacyPath)) return null;
    const raw = readFileSync(legacyPath, 'utf8');
    const parsed = JSON.parse(raw) as { graphRef?: unknown };
    if (typeof parsed.graphRef !== 'string') return null;
    const graphPath = resolve(projectRoot, '.peaks', '_runtime', parsed.graphRef);
    if (!existsSync(graphPath)) return 'PEAKS_GRAPH_REF_BROKEN';
  } catch { /* swallow — diagnostic only */ }
  return null;
}

function readPresenceBackCompat(project: string): { skill: string; path: string } | null {
  const projectRoot = resolve(project);
  const canonicalPath = resolve(projectRoot, PRESENCE_CANONICAL_PATH);
  const legacyPath = resolve(projectRoot, PRESENCE_LEGACY_PATH);

  for (const candidate of [canonicalPath, legacyPath]) {
    const parsed = readPresenceFile(candidate);
    if (parsed === null) continue;
    return { skill: parsed.skill, path: candidate };
  }
  return null;
}

function messageHasMarker(message: string): boolean {
  if (message.length === 0) return false;
  return message.includes(MARKER_PRIMARY) || message.includes(MARKER_SECONDARY);
}

/**
 * Pure read-only presence-marker detection. No I/O side effects.
 *
 * Slice 4.0.8: the canonical 4.0.7 behavior is preserved (read legacy
 * `active-skill.json` or `.peaks/.active-skill.json`, project the
 * `Peaks-Loop Skill:` marker). The new diagnostic for a broken
 * canonical graph is surfaced via the `warning` field, NOT swallowed,
 * so the statusline / hook / doctor consumers can render it.
 */
export function detectPresenceMarker(input: DetectPresenceMarkerInput): DetectPresenceMarkerResult {
  const project = input.project;
  const message = input.latestAssistantMessage ?? '';

  const presence = readPresenceBackCompat(project);
  if (presence === null) {
    return { active: false, markerFound: false };
  }

  const brokenGraph = tryDetectBrokenGraph(project);
  const markerFound = messageHasMarker(message);
  if (markerFound) {
    if (brokenGraph !== null) {
      return { active: true, skill: presence.skill, markerFound: true, warning: `Peaks presence active but graph is broken (${brokenGraph}); run \`peaks workspace reconcile\` to repair.` };
    }
    return { active: true, skill: presence.skill, markerFound: true };
  }
  if (brokenGraph !== null) {
    return { active: true, skill: presence.skill, markerFound: false, warning: `Peaks presence active but graph is broken (${brokenGraph}); run \`peaks workspace reconcile\` to repair.` };
  }
  return {
    active: true,
    skill: presence.skill,
    markerFound: false,
    warning: PRESENCE_MARKER_WARNING[0]
  };
}
