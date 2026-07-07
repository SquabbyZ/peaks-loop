/**
 * active-skill-resolver — utility for hook enforcers.
 *
 * Resolves the active peak skill name for the current session, so hook
 * enforcers (e.g. code-ban) can decide whether to fire.
 *
 * Per `src/services/session/caller-id-types.ts`: the active-skill file is
 * at `.peaks/_runtime/<peakSessionId>/active-skill-<callerId>.json`.
 *
 * Resolution order (graceful degradation — never throws):
 *   1. PEAKS_ACTIVE_SKILL env var (explicit override, used by tests)
 *   2. .peaks/_runtime/<sid>/active-skill-<callerId>.json for each caller
 *      bound to the current peak session
 *   3. null (caller did not set a skill; enforcers can decide to skip)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionIdCanonical } from '../../session/session-manager.js';
import { getSessionDir } from '../../session/getSessionDir.js';

const ACTIVE_SKILL_PREFIX = 'active-skill-';

export interface ActiveSkillResolution {
  readonly skill: string | null;
  readonly callerId: string | null;
  readonly sessionId: string | null;
  readonly source: 'env' | 'file' | 'none';
}

/**
 * Resolve the active peak skill for the current hook invocation.
 *
 * Reads PEAKS_ACTIVE_SKILL first (test override), then walks
 * `.peaks/_runtime/<sid>/` for any `active-skill-*.json` file. Returns
 * the first match.
 */
export function resolveActiveSkillForCaller(projectRoot: string): ActiveSkillResolution {
  const envOverride = process.env.PEAKS_ACTIVE_SKILL;
  if (typeof envOverride === 'string' && envOverride.length > 0) {
    return { skill: envOverride, callerId: null, sessionId: null, source: 'env' };
  }

  let sessionId: string | null = null;
  try {
    sessionId = getSessionIdCanonical(projectRoot);
  } catch {
    return { skill: null, callerId: null, sessionId: null, source: 'none' };
  }
  if (sessionId === null) {
    return { skill: null, callerId: null, sessionId: null, source: 'none' };
  }

  const sessionDir = getSessionDir(projectRoot, sessionId);
  if (!existsSync(sessionDir)) {
    return { skill: null, callerId: null, sessionId: sessionId, source: 'none' };
  }

  let entries: string[];
  try {
    entries = readdirSync(sessionDir);
  } catch {
    return { skill: null, callerId: null, sessionId: sessionId, source: 'none' };
  }

  for (const entry of entries) {
    if (!entry.startsWith(ACTIVE_SKILL_PREFIX) || !entry.endsWith('.json')) continue;
    const callerId = entry.slice(ACTIVE_SKILL_PREFIX.length, -'.json'.length);
    const filePath = join(sessionDir, entry);
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as { skill?: unknown };
      if (typeof parsed.skill === 'string' && parsed.skill.length > 0) {
        return { skill: parsed.skill, callerId, sessionId, source: 'file' };
      }
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // skip malformed file
    }
  }

  return { skill: null, callerId: null, sessionId, source: 'none' };
}
