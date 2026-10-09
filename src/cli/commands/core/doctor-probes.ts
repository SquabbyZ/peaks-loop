import { findProjectRoot } from '../../../services/config/config-safety.js';
import { planStatusLineInstall } from '../../../services/skills/statusline-settings-service.js';

// slice-3b Option C: the doctor subpackage owns the check pipeline but
// does NOT import cross-domain utils from the main package (avoids
// circular deps). The CLI is the natural wiring point — every cross-
// domain util the doctor used to import directly is now injected as a
// probe on DoctorOptions at call-site:
//
//   loadSkills           ← loadSkillRegistry (main/services/skills/skill-registry.ts)
//   skillPresenceProbe   ← leave as-is; doctor-command does not own the presence probe
//   statusLineInstalledProbe ← defaults to a `planStatusLineInstall` wrapper below
//   projectRootResolver  ← findProjectRoot (main/services/config/config-safety.ts)
//   isValidSessionIdProbe ← the regex kept in main/services/workspace/sid-naming-guard.ts
//
// Inlining isValidSessionId via the doctor subpackage's default regex
// (which mirrors the upstream file byte-for-byte) keeps the L3 orphan
// check behaviour-identical without dragging sid-naming-guard into a
// workspace package. If sid-naming-guard is ever moved into
// peaks-loop-shared, swap this for a re-import.
export function doctorIsValidSessionId(sid: string): boolean {
  return /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-session-[0-9a-z]{3,6}$/.test(sid);
}

export function statusLineAlreadyInstalledForScope(
  scope: 'project' | 'global',
  projectRoot?: string
): boolean {
  try {
    if (scope === 'project') {
      if (projectRoot === undefined) return false;
      return planStatusLineInstall('project', projectRoot).alreadyInstalled;
    }
    return planStatusLineInstall('global').alreadyInstalled;
  } catch {
    return false;
  }
}

export function doctorStatusLineInstalledProbe(): boolean {
  const projectRoot = findProjectRoot(process.cwd());
  // Check both scopes: a user may have installed the statusLine globally, which
  // the project-only check would miss and falsely report as "not installed".
  try {
    if (projectRoot !== null && statusLineAlreadyInstalledForScope('project', projectRoot)) {
      return true;
    }
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* fall through to global */
  }
  try {
    return statusLineAlreadyInstalledForScope('global');
  } catch {
    return false;
  }
}
