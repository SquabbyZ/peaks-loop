/**
 * Check: workspace initialization guard (`skill-presence:workspace`).
 *
 * Fail-closed rule: when a skill is actively orchestrating AND the
 * workspace session binding is absent, the check fails and tells the
 * operator to run `peaks workspace init --project <repo>`. This is
 * the #1 reported failure mode where `.peaks/` artifacts are never
 * created — the SKILL.md "MUST create the workspace" prose turned
 * into an executable check.
 *
 * When no skill is active, the check passes (workspace guard is
 * N/A). When a skill IS active AND the workspace session exists,
 * it also passes (the happy path).
 */

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

function run({ presence, workspaceInitialized }: DoctorContext): readonly DoctorCheck[] {
  if (presence !== null && !workspaceInitialized) {
    return [{
      id: 'skill-presence:workspace',
      ok: false,
      message: `Skill ${presence.skill} is active but no workspace session exists (.peaks/_runtime/session.json missing); run \`peaks workspace init --project <repo>\` — peaks-code Step 0 must anchor the workspace before any work`
    }];
  }
  return [{
    id: 'skill-presence:workspace',
    ok: true,
    message: presence === null
      ? 'No active skill presence; workspace guard not applicable'
      : `Workspace session present for active skill ${presence.skill}`
  }];
}

export const check: DoctorCheckPlugin = {
  name: 'workspace-init',
  run
};