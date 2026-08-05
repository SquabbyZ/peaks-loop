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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionIdCanonical } from '../../session/session-manager.js';
import { getSessionDir } from '../../session/getSessionDir.js';
import { readPresenceLease, listPresenceLeases } from '../../skills/presence-lease-service.js';
import { getCurrentSessionId } from '../../skills/skill-presence-service.js';

const ACTIVE_SKILL_PREFIX = 'active-skill-';

export interface ActiveSkillResolution {
  readonly skill: string | null;
  readonly callerId: string | null;
  readonly sessionId: string | null;
  /**
   * Mode token recorded on the canonical lease (e.g. `full-auto`,
   * `assisted`, `swarm`, `strict`). `null` when the source is not
   * `canonical` (the legacy `active-skill-*.json` files do not
   * surface a mode field, and the `env` / `none` cases are test
   * overrides). Slice 2026-08-04-rid-005 surfaced this so the
   * statusline can render the orchestrator's mode alongside the
   * active leaf role.
   */
  readonly mode: string | null;
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
export function resolveActiveSkillForCaller(
  projectRoot: string,
  opts?: { legacyPresence?: boolean; callerId?: string | null },
): ActiveSkillResolution {
  const envOverride = process.env.PEAKS_ACTIVE_SKILL;
  if (typeof envOverride === 'string' && envOverride.length > 0) {
    return { skill: envOverride, callerId: null, sessionId: null, mode: null, source: 'env' };
  }

  let sessionId: string | null = null;
  try {
    sessionId = getSessionIdCanonical(projectRoot);
  } catch {
    return { skill: null, callerId: null, sessionId: null, mode: null, source: 'none' };
  }
  if (sessionId === null) {
    return { skill: null, callerId: null, sessionId: null, mode: null, source: 'none' };
  }

  // 4.0.8 preferred: read the canonical lease projection. The lease
  // service writes leases to `<sessionDir>/leases/presence-<caller>-<workflow>.json`
  // (RD §4). We enumerate that directory via `listPresenceLeases`,
  // which is the lease-service's own helper and knows the canonical
  // layout. The first in-flight (status === 'preparing' | 'running')
  // lease wins; this preserves the prior behaviour of returning a
  // single skill per resolution. When the lease dir is empty (e.g.
  // ad-hoc / pre-migration projects) we fall through to the legacy
  // walk below.
  const sessionDir = getSessionDir(projectRoot, sessionId);
  if (!existsSync(sessionDir)) {
    return { skill: null, callerId: null, sessionId, mode: null, source: 'none' };
  }
  let canonicalLeases: ReturnType<typeof listPresenceLeases> = [];
  try {
    canonicalLeases = listPresenceLeases(projectRoot, sessionId);
  } catch {
    canonicalLeases = [];
  }
  for (const lease of canonicalLeases) {
    if (lease.status !== 'preparing' && lease.status !== 'running') continue;
    if (typeof lease.skill !== 'string' || lease.skill.length === 0) continue;
    // When a callerId is supplied, restrict the walk to that
    // caller's lease. Slice 2026-08-04-rid-005 surfaces this for the
    // statusline read so two concurrent sessions bound to the same
    // project session do not see each other's skill.
    if (typeof opts?.callerId === 'string' && opts.callerId.length > 0 && lease.callerId !== opts.callerId) continue;
    try {
      const projection = readPresenceLease({
        projectRoot,
        sessionId,
        callerId: lease.callerId,
        workflowId: lease.workflowId,
        graphRef: lease.graphRef,
      });
      if (projection.lease !== null && typeof projection.lease.skill === 'string' && projection.lease.skill.length > 0) {
        return {
          skill: projection.lease.skill,
          callerId: lease.callerId,
          sessionId,
          mode: typeof projection.mode === 'string' && projection.mode.length > 0 ? projection.mode : null,
          source: 'canonical',
        };
      }
    } catch { /* fall through to next lease */ }
  }

  // Legacy fall-back (one minor release). Gated on `legacyPresence:
  // true` so production hooks prefer the canonical projection. Reads
  // the session dir root for the per-caller `active-skill-*.json`
  // marker files written by the 4.0.7 `setSkillPresenceForCaller`.
  if (opts?.legacyPresence === true) {
    let legacyEntries: string[] = [];
    try {
      legacyEntries = readdirSync(sessionDir);
    } catch {
      legacyEntries = [];
    }
    for (const entry of legacyEntries) {
      if (!entry.startsWith(ACTIVE_SKILL_PREFIX) || !entry.endsWith('.json')) continue;
      const callerId = entry.slice(ACTIVE_SKILL_PREFIX.length, -'.json'.length);
      const filePath = join(sessionDir, entry);
      try {
        const raw = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { skill?: unknown; mode?: unknown };
        if (typeof parsed.skill === 'string' && parsed.skill.length > 0) {
          const legacyMode = typeof parsed.mode === 'string' && parsed.mode.length > 0
            ? parsed.mode
            : null;
          return { skill: parsed.skill, callerId, sessionId, mode: legacyMode, source: 'file' };
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
  return { skill: null, callerId: null, sessionId, mode: null, source: 'none' };
}
