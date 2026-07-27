/**
 * Check: skill presence current + freshness
 * (`skill-presence:current` and `skill-presence:freshness`).
 *
 * Two checks sharing one read of the `presence` context field.
 *   - `skill-presence:current` is informational: passes when the
 *     presence is wired, with a message describing the active
 *     skill / mode / gate / setAt. When no presence is wired, it
 *     also passes (absence is the common case outside peaks-qa
 *     flows).
 *   - `skill-presence:freshness` is the operational gate: fails
 *     when the presence's `setAt` is older than the freshness
 *     threshold (default 24h) OR when `setAt` is unparsable. When
 *     no presence is wired it passes trivially ("nothing to age-
 *     check").
 *
 * Both checks share the presence signal computed once in
 * `index.ts`; the legacy monolithic function probed it inline.
 */

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const SKILL_PRESENCE_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function run({ options, presence }: DoctorContext): readonly DoctorCheck[] {
  const freshnessThresholdMs = options.skillPresenceFreshnessThresholdMs ?? SKILL_PRESENCE_FRESHNESS_THRESHOLD_MS;

  if (presence === null) {
    return [
      {
        id: 'skill-presence:current',
        ok: true,
        message: 'No active Peaks skill presence (.peaks/.active-skill.json absent or invalid)'
      },
      {
        id: 'skill-presence:freshness',
        ok: true,
        message: 'No active Peaks skill presence to age-check'
      }
    ];
  }

  const modePart = presence.mode !== undefined ? `, mode ${presence.mode}` : '';
  const gatePart = presence.gate !== undefined ? `, gate ${presence.gate}` : '';
  const checks: DoctorCheck[] = [{
    id: 'skill-presence:current',
    ok: true,
    message: `Active Peaks skill presence: ${presence.skill}${modePart}${gatePart} (set ${presence.setAt})`
  }];

  const setAtMs = Date.parse(presence.setAt);
  if (Number.isNaN(setAtMs)) {
    checks.push({
      id: 'skill-presence:freshness',
      ok: false,
      message: `Skill presence ${presence.skill} has invalid setAt: ${presence.setAt}`
    });
  } else {
    const ageMs = Date.now() - setAtMs;
    if (ageMs > freshnessThresholdMs) {
      const ageHours = Math.round(ageMs / (60 * 60 * 1000));
      checks.push({
        id: 'skill-presence:freshness',
        ok: false,
        message: `Skill presence ${presence.skill} is stale (set ${presence.setAt}, ~${ageHours}h ago); run peaks skill presence:clear if the role has ended`
      });
    } else {
      checks.push({
        id: 'skill-presence:freshness',
        ok: true,
        message: `Skill presence ${presence.skill} is fresh (set ${presence.setAt})`
      });
    }
  }
  return checks;
}

export const check: DoctorCheckPlugin = {
  name: 'skill-presence',
  run
};