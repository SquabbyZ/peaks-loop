import { basename } from 'node:path';
import type { StatusLineModel } from './skill-statusline-service.js';

/**
 * Pure formatting layer for the Peaks statusLine. Takes the read-only status
 * model and produces the single line Claude Code paints at the bottom of the
 * terminal. Kept separate from the reader so formatting can be tested without
 * touching the filesystem.
 */

const BRAND = '⛰ Peaks';

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return '';
  const hours = Math.round(ageMs / (60 * 60 * 1000));
  if (hours >= 1) return `stale ${hours}h`;
  const minutes = Math.max(1, Math.round(ageMs / (60 * 1000)));
  return `stale ${minutes}m`;
}

function rootLabel(projectRoot: string | null): string {
  if (!projectRoot) return '';
  return basename(projectRoot);
}

/**
 * Render the status line. The output is plain text with simple status glyphs so
 * it stays readable in any terminal; Claude Code applies its own styling.
 */
export function renderStatusLine(model: StatusLineModel): string {
  const root = rootLabel(model.projectRoot);
  const rootSuffix = root ? ` · ${root}` : '';

  switch (model.state) {
    case 'active': {
      const presence = model.presence;
      if (!presence) return `${BRAND} ○ idle${rootSuffix}`;
      const parts = [presence.skill];
      if (presence.mode) parts.push(presence.mode);
      if (presence.gate) parts.push(`gate:${presence.gate}`);
      return `${BRAND} ● ${parts.join(' · ')}${rootSuffix}`;
    }
    case 'stale': {
      const presence = model.presence;
      const skill = presence?.skill ?? 'unknown';
      const age = formatAge(model.ageMs);
      const ageSuffix = age ? ` · ${age}` : '';
      return `${BRAND} ⚠ ${skill}${ageSuffix}${rootSuffix}`;
    }
    case 'invalid-presence':
      return `${BRAND} ⚠ presence file unreadable${rootSuffix}`;
    case 'idle':
    default:
      return `${BRAND} ○ idle${rootSuffix}`;
  }
}
