import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Slice 028 (Q1=A): hook-based skill-presence marker detection.
 *
 * Background: the consumer-facing CLAUDE.md template (rendered by
 * `peaks standards init` / `peaks standards update`) instructs the LLM
 * to display a compact status header
 *   `Peaks-Cli Skill: <skill> | Peaks-Cli Gate: <gate> | Next: <one short action>`
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
 *                    expected `Peaks-Cli Skill:` / `Peaks-Cli Gate:`
 *                    marker. Always `false` when `active` is `false`.
 *   - `warning?`:    a human-readable warning emitted when the marker
 *                    is missing while the presence is active.
 *
 * The function is pure: it does not write to disk, does not clear the
 * presence file, and does not depend on `process.cwd()`. The caller is
 * expected to provide the absolute project root (peaks-cli convention
 * from the standards-commands family — see dev-preference rule
 * `project-option-is-canonical-project-root-source`).
 */

const PRESENCE_CANONICAL_PATH = '.peaks/_runtime/active-skill.json';
const PRESENCE_LEGACY_PATH = '.peaks/.active-skill.json';

const MARKER_PRIMARY = 'Peaks-Cli Skill:';
const MARKER_SECONDARY = 'Peaks-Cli Gate:';
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
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const skillMatch = SKILL_NAME_RE.exec(JSON.stringify(parsed));
  if (skillMatch === null) return null;
  if (typeof skillMatch[1] !== 'string' || skillMatch[1].length === 0) return null;
  return { skill: skillMatch[1] };
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
 */
export function detectPresenceMarker(input: DetectPresenceMarkerInput): DetectPresenceMarkerResult {
  const project = input.project;
  const message = input.latestAssistantMessage ?? '';

  const presence = readPresenceBackCompat(project);
  if (presence === null) {
    return { active: false, markerFound: false };
  }

  const markerFound = messageHasMarker(message);
  if (markerFound) {
    return { active: true, skill: presence.skill, markerFound: true };
  }
  return {
    active: true,
    skill: presence.skill,
    markerFound: false,
    warning: PRESENCE_MARKER_WARNING[0]
  };
}
