/**
 * Check: skill name matches its directory (`skill-name:<directory>`).
 *
 * Emits one `DoctorCheck` per loaded skill. Passes when the parsed
 * frontmatter `name` matches the on-disk directory name. A mismatch
 * is a hard failure — the LLM picks skills by directory, so a drift
 * between name and directory would silently lose routing.
 */

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

function run({ registry }: DoctorContext): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  for (const skill of registry.skills) {
    checks.push({
      id: `skill-name:${skill.directory}`,
      ok: skill.name === skill.directory,
      message: skill.name === skill.directory
        ? `Skill ${skill.name} matches its directory`
        : `Skill ${skill.directory} declares mismatched name ${skill.name}`
    });
  }
  return checks;
}

export const check: DoctorCheckPlugin = {
  name: 'skill-name-match',
  run
};