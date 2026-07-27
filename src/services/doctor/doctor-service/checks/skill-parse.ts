/**
 * Check: skill parse failures (`skill-parse:<directory>`).
 *
 * Emits one `DoctorCheck` per registry failure (one per skill whose
 * SKILL.md frontmatter did not parse). All checks fail — the skill
 * is unusable, so the doctor surfaces it. The message echoes the
 * parse error so the operator can locate the broken metadata.
 */

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

function run({ registry }: DoctorContext): readonly DoctorCheck[] {
  return registry.failures.map<DoctorCheck>((failure) => ({
    id: `skill-parse:${failure.directory}`,
    ok: false,
    message: `Skill ${failure.directory} has invalid metadata: ${failure.message}`
  }));
}

export const check: DoctorCheckPlugin = {
  name: 'skill-parse',
  run
};