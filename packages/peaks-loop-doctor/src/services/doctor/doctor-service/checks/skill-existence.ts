/**
 * Check: skill existence (`skill:<name>`).
 *
 * Emits one `DoctorCheck` per `requiredSkillNames` entry. The check
 * passes when the loaded registry contains a skill whose `name`
 * equals the required skill name. Fails with an actionable message
 * identifying which required skill is missing.
 *
 * The required skill names come from `peaks-loop-shared/paths` so the
 * doctor and the CLI agree on what "required" means.
 */

import { requiredSkillNames } from 'peaks-loop-shared/paths';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

function run({ registry }: DoctorContext): readonly DoctorCheck[] {
  const skillNames = new Set(registry.skills.map((skill) => skill.name));
  const checks: DoctorCheck[] = [];
  for (const requiredSkill of requiredSkillNames) {
    checks.push({
      id: `skill:${requiredSkill}`,
      ok: skillNames.has(requiredSkill),
      message: skillNames.has(requiredSkill)
        ? `Required skill ${requiredSkill} exists`
        : `Missing required skill ${requiredSkill}`
    });
  }
  return checks;
}

export const check: DoctorCheckPlugin = {
  name: 'skill-existence',
  run
};