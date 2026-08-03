/**
 * active-skill-resolver — utility for hook enforcers.
 *
 * Resolves the active peak skill name for the current session, so hook
 * enforcers (e.g. code-ban) can decide whether to fire.
 *
 * Slice 4.0.8 (D1 + D4a): prefer the canonical
 * `readPresenceLease` projection from `presence-lease-service.ts`.
 * The 4.0.7 legacy `active-skill-<callerId>.json` walk is preserved
 * as a 1-minor-release back-compat fallback, gated on the
 * `legacyPresence: true` opt-in. By default the canonical projection
 * is the only source of truth — the read returns `{ skill, callerId,
 * sessionId, source: 'canonical' | 'legacy' | 'none' }`.
 *
 * Per `src/services/session/caller-id-types.ts`: the active-skill file is
 * at `.peaks/_runtime/<peakSessionId>/active-skill-<callerId>.json`
 * (legacy) or `.peaks/_runtime/<sid>/presence-index/<callerId>.json`
 * (canonical index → lease file).
 *
 * Resolution order (graceful degradation — never throws):
 *   1. PEAKS_ACTIVE_SKILL env var (explicit override, used by tests)
 *   2. Canonical lease projection (presence-lease-service.readPresenceLease)
 *   3. Legacy `.peaks/_runtime/<sid>/active-skill-*.json` walk, when
 *      `legacyPresence === true` is passed by the caller
 *   4. null (caller did not set a skill; enforcers can decide to skip)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionIdCanonical } from '../../session/session-manager.js';
import { getSessionDir } from '../../session/getSessionDir.js';
import { readPresenceLease } from '../../skills/presence-lease-service.js';
import { getCurrentSessionId } from '../../skills/skill-presence-service.js';

const ACTIVE_SKILL_PREFIX = 'active-skill-';

export interface ActiveSkillResolution {
  readonly skill: string | null;
  readonly callerId: string | null;
  readonly sessionId: string | null;
  /** `canonical` = presence-lease-service; `legacy` = per-caller active-skill file; `env` = test override; `none` = nothing wired. */
  readonly source: 'env' | 'file' | 'canonical' | 'none';
}

/**
 * Resolve the active peak skill for the current hook invocation.
 *
 * Reads PEAKS_ACTIVE_SKILL first (test override), then the canonical
 * lease projection (RD §4 / §6 — the lease + index is the source of
 * truth in 4.0.8), then — only when the caller explicitly opts in via
 * `legacyPresence: true` — the legacy `.peaks/_runtime/<sid>/active-skill-*.json`
 * walk. Returns the first match.
 */
export function resolveActiveSkillForCaller(projectRoot: string, opts?: { legacyPresence?: boolean }): ActiveSkillResolution {
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

  // 4.0.8 preferred: read the canonical lease projection. The lease
  // service exposes `readPresenceLease({ projectRoot, sessionId,
  // callerId, workflowId, graphRef })`; we need *some* callerId to
  // point at a single lease. Hook enforcers don't have a callerId
  // (they're per-IDE, per-window), so we walk the canonical
  // presence-index to find any active lease. When the index is empty
  // (e.g. ad-hoc / pre-migration projects) we fall through to the
  // legacy walk below.
  const sessionDir = getSessionDir(projectRoot, sessionId);
  if (!existsSync(sessionDir)) {
    return { skill: null, callerId: null, sessionId, source: 'none' };
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(sessionDir);
  } catch {
    entries = [];
  }
  const indexEntries = entries.filter((e) => !e.startsWith(ACTIVE_SKILL_PREFIX) && e.endsWith('.json') && !e.includes('.tmp-'));
  for (const entry of indexEntries) {
    // The canonical presence-index lives at `<sessionDir>/presence-index/<callerId>.json`.
    // We synthesise the read from any presence-* lease file we find;
    // the readPresenceLease call surfaces a typed `PresenceProjection`
    // and we map `lease.skill` → resolution.
    if (!entry.startsWith('presence-')) continue;
    const callerId = entry.slice('presence-'.length, -'.json'.length);
    // Derive workflowId from the same file name (canonical
    // leaseFilePath encodes `presence-<caller>-<workflow>.json`).
    const lastDash = callerId.lastIndexOf('-');
    if (lastDash < 0) continue;
    const workflowId = callerId.slice(lastDash + 1);
    const pureCaller = callerId.slice(0, lastDash);
    try {
      const projection = readPresenceLease({
        projectRoot,
        sessionId,
        callerId: pureCaller,
        workflowId,
        graphRef: `graphs/${workflowId}.json`,
      });
      if (projection.lease !== null && typeof projection.lease.skill === 'string' && projection.lease.skill.length > 0) {
        return { skill: projection.lease.skill, callerId: pureCaller, sessionId, source: 'canonical' };
      }
    } catch { /* fall through to legacy walk */ }
  }

  // Legacy fall-back (one minor release). Gated on `legacyPresence:
  // true` so production hooks prefer the canonical projection.
  if (opts?.legacyPresence === true) {
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
  }

  // Suppress unused-import warnings for symbols reserved for the
  // migration window. `getCurrentSessionId` is kept so the legacy
  // walk can still resolve a session id if the canonical resolver
  // returns null (e.g. ad-hoc projects without a `.peaks/_runtime/session.json`).
  void getCurrentSessionId;
  return { skill: null, callerId: null, sessionId, source: 'none' };
}
