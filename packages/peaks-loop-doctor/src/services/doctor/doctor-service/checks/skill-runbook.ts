/**
 * Check: required skill declares a `## Default runbook` section
 * (`skill-runbook:<skill-name>`).
 *
 * Emits one `DoctorCheck` per *required* skill (we don't gate
 * user-added skills; only the ones the doctor guarantees exist).
 * Passes when the SKILL.md body contains a `## Default runbook`
 * heading; fails with an actionable "missing a ## Default runbook
 * section" message. Read failures degrade to a single
 * `skill-runbook:<name>` fail (no second `skill-apply-note`
 * emitted for the same skill).
 */

import { readText } from 'peaks-loop-shared/fs';
import { requiredSkillNames } from 'peaks-loop-shared/paths';
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const REQUIRED_SKILL_NAMES = new Set<string>(requiredSkillNames);

async function run({ registry }: DoctorContext): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const skill of registry.skills) {
    if (!REQUIRED_SKILL_NAMES.has(skill.name)) {
      continue;
    }
    try {
      const body = await readText(skill.skillPath);
      const hasRunbook = /## Default runbook\s/.test(body);
      checks.push({
        id: `skill-runbook:${skill.name}`,
        ok: hasRunbook,
        message: hasRunbook
          ? `Skill ${skill.name} declares a Default runbook`
          : `Skill ${skill.name} is missing a ## Default runbook section`
      });
    } catch (error) {
      checks.push({
        id: `skill-runbook:${skill.name}`,
        ok: false,
        message: `Skill ${skill.name} runbook check failed: ${getErrorMessage(error)}`
      });
    }
  }
  return checks;
}

export const check: DoctorCheckPlugin = {
  name: 'skill-runbook',
  run
};