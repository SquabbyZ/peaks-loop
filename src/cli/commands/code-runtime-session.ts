// The active-session probe the runtime commands share. It has a module of its own
// because six registrars read it and none of them owns it.
import { getSkillPresence } from '../../services/skills/skill-presence-service.js';

export function readActiveSid(projectRoot: string): string | null {
  try {
    const presence = getSkillPresence(projectRoot);
    if (presence === null || presence === undefined) return null;
    return presence.sessionId ?? null;
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}
