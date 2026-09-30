import { findProjectRoot } from '../config/config-safety.js';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { resolveActiveSkillForCaller } from '../audit/enforcers/active-skill-resolver.js';
import { listPresenceLeases } from './presence-lease-service.js';
import {
  read24hOverlay,
  readActiveLeaf,
  readCompactState,
  resolveCallerId,
  resolveCwdFromStdin,
  type StatusLineActiveLeaf,
  type StatusLineModel,
  type StatusLinePresence,
  type StatusLineState,
  type StatusLineStdin,
  type TwentyFourHourOverlay
} from './skill-statusline-model.js';

export type {
  StatusLineActiveLeaf,
  StatusLineModel,
  StatusLinePresence,
  StatusLineState,
  StatusLineStdin,
  TwentyFourHourOverlay
} from './skill-statusline-model.js';
export { parseStatusLineStdin, read24hOverlay } from './skill-statusline-model.js';

/**
 * Out-of-band Peaks skill status renderer for the Claude Code statusLine.
 *
 * Claude Code invokes the configured statusLine command on every turn and pipes
 * a JSON session payload on stdin. This renderer reads the canonical
 * sid-scoped lease projection
 * (`.peaks/_runtime/<sid>/leases/presence-<caller>-<workflow>.json` +
 * the per-caller index under `presence-index/<caller>.json`) and prints a
 * single line that Claude Code paints at the bottom of the terminal. Because
 * it is rendered by the harness — not emitted as LLM tokens — the signal
 * cannot be forgotten by the model, cannot be confused with normal output,
 * and survives context compaction.
 *
 * This module is intentionally READ-ONLY. Unlike getSkillPresence in
 * skill-presence-service.ts, it never deletes or rewrites the presence file:
 * the statusLine runs on every turn and must have zero side effects.
 *
 * Slice 2026-08-05-statusline-sid-scoped-lease-B: the read no longer falls
 * back to the project-level `.peaks/_runtime/active-skill.json` (or its
 * legacy `.peaks/.active-skill.json`). The canonical lease projection is
 * the only source. When `callerId === null` (non-IDE caller), the read
 * picks the most recent in-flight lease across all callers; this is the
 * documented back-compat path.
 */

import { normalizeSkillPresenceMode } from './skill-presence-service.js';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Read the presence file without any side effects. Returns null when the file is
 * absent (idle) and a sentinel object for malformed content (invalid-presence).
 *
 * Both branches now route through the canonical sid-scoped lease projection
 * (slice 2026-08-05-statusline-sid-scoped-lease-B):
 *   - `callerId !== null` → `resolveActiveSkillForCaller` with the canonical
 *     (non-legacy) lease projection, filtered to this callerId. When the
 *     callerId-filtered resolution returns `source: 'none'` (no lease under
 *     this callerId), retry once with `callerId: null` so the read falls back
 *     to the session's most-recent in-flight lease. AC4 multi-tenant isolation
 *     is preserved: when callerId A DOES have a lease, the first call returns
 *     it and the fallback never fires — callerId B's lease is never surfaced
 *     to callerId A. (Slice 2026-08-05-statusline-empty-render-and-short-sid-suffix.)
 *   - `callerId === null` → enumerate `listPresenceLeases` for the
 *     canonical session and pick the most recent in-flight lease. Back-compat
 *     for non-IDE callers (e.g. legacy CLI invocations) that have no callerId.
 *
 * No fallback to `.peaks/_runtime/active-skill.json` (or its legacy path):
 * the canonical lease projection is the single source of truth. When no
 * in-flight leases exist, the read returns `{ presence: null, invalid: false }`
 * and the renderer falls back to the idle state.
 */
function readPresenceReadOnly(
  projectRoot: string,
  callerId: string | null
): { presence: StatusLinePresence | null; invalid: boolean } {
  if (callerId !== null) {
    let firstResolution: ReturnType<typeof resolveActiveSkillForCaller> | null = null;
    try {
      firstResolution = resolveActiveSkillForCaller(projectRoot, { callerId });
    } catch {
      return { presence: null, invalid: true };
    }
    if (firstResolution.source !== 'none' && firstResolution.skill !== null) {
      return {
        presence: {
          skill: firstResolution.skill,
          ...(firstResolution.mode !== null ? { mode: firstResolution.mode } : {})
        },
        invalid: false
      };
    }
    // callerId didn't match any lease — fall back to the session's most
    // recent in-flight lease (the callerId === null branch below). This
    // rescues the case where the harness pipes a `CLAUDE_CODE_SESSION_ID`
    // that differs from the active lease's callerId (peaks-code sessions
    // started from a different outer session id, etc.).
    return readPresenceReadOnly(projectRoot, null);
  }
  // callerId === null branch: enumerate the canonical session dir's leases
  // and pick the most recent in-flight lease. This is the back-compat path
  // for non-IDE callers that don't supply a callerId.
  let sessionId: string | null = null;
  try {
    sessionId = getSessionIdCanonical(projectRoot);
  } catch {
    return { presence: null, invalid: false };
  }
  if (sessionId === null) {
    return { presence: null, invalid: false };
  }
  let leases: ReturnType<typeof listPresenceLeases> = [];
  try {
    leases = listPresenceLeases(projectRoot, sessionId);
  } catch {
    return { presence: null, invalid: true };
  }
  const inFlight = leases
    .filter((l) => l.status === 'preparing' || l.status === 'running')
    .filter((l) => typeof l.skill === 'string' && l.skill.length > 0);
  if (inFlight.length === 0) {
    return { presence: null, invalid: false };
  }
  // Most recent wins — sort by `lastHeartbeat` desc, fall back to `startedAt`.
  const sorted = inFlight.slice().sort((a, b) => {
    const hb = b.lastHeartbeat.localeCompare(a.lastHeartbeat);
    if (hb !== 0) return hb;
    return b.startedAt.localeCompare(a.startedAt);
  });
  const latest = sorted[0];
  if (latest === undefined || typeof latest.skill !== 'string' || latest.skill.length === 0) {
    return { presence: null, invalid: false };
  }
  // Leases on disk may carry an optional `mode` field (the lease constructor
  // spreads `input.mode` when present); the typed `SkillPresenceLease` does
  // not declare it, so widen the read shape here. Normalized on read: a
  // legacy `'swarm'` lease renders as `'full-auto'` (slice
  // 2026-09-09-mode-consolidation).
  const latestMode = normalizeSkillPresenceMode((latest as { mode?: string | undefined }).mode);
  return {
    presence: {
      skill: latest.skill,
      ...(latestMode !== undefined ? { mode: latestMode } : {}),
      setAt: latest.startedAt
    },
    invalid: false
  };
}

export function buildStatusLineModel(
  stdin: StatusLineStdin | null,
  nowMs: number
): StatusLineModel {
  const cwd = resolveCwdFromStdin(stdin);
  const projectRoot = findProjectRoot(cwd);

  // Compact state is computed independently of presence — the read is read-only
  // and reads `.peaks/_runtime/<sid>/compact-lifecycle.json` (or its legacy
  // fallbacks). It replaces the active skill content when kind != 'none'.
  const compact = readCompactState(projectRoot, nowMs);

  // Slice 2026-08-05-statusline-sid-only-marker: resolve the canonical
  // session id once, up front, so the renderer can read it from the model
  // without re-running `getSessionIdCanonical`. `null` when the project
  // root is unbound OR when no `.peaks/_runtime/<sid>/` session exists.
  let sessionId: string | null = null;
  if (projectRoot !== null) {
    try {
      sessionId = getSessionIdCanonical(projectRoot);
    } catch {
      sessionId = null;
    }
  }

  if (projectRoot === null) {
    return {
      state: 'idle',
      projectRoot: null,
      presence: null,
      ageMs: null,
      compact,
      activeLeaf: null,
      sessionId: null,
      twentyFourHourState: null
    };
  }

  // callerId resolves the read-side isolation; back-compat is `null`.
  const callerId = resolveCallerId(stdin);
  const { presence, invalid } = readPresenceReadOnly(projectRoot, callerId);
  if (invalid) {
    return {
      state: 'invalid-presence',
      projectRoot,
      presence: null,
      ageMs: null,
      compact,
      activeLeaf: null,
      sessionId,
      twentyFourHourState: null
    };
  }
  if (presence === null) {
    return {
      state: 'idle',
      projectRoot,
      presence: null,
      ageMs: null,
      compact,
      activeLeaf: null,
      sessionId,
      twentyFourHourState: null
    };
  }

  // Session binding: when the presence was stamped with a Claude session id and
  // the live session (from stdin) is a different one, the recorded skill belongs
  // to a previous session — render idle instead of a stale "active" skill. When
  // either id is absent (legacy presence, or harness that omits session_id) we
  // fall back to the time-based behavior below for backward compatibility.
  const liveSessionId =
    typeof stdin?.session_id === 'string' && stdin.session_id.length > 0 ? stdin.session_id : null;
  if (presence.claudeSessionId && liveSessionId && presence.claudeSessionId !== liveSessionId) {
    return {
      state: 'idle',
      projectRoot,
      presence: null,
      ageMs: null,
      compact,
      activeLeaf: null,
      sessionId,
      twentyFourHourState: null
    };
  }

  const setAtMs = presence.setAt ? Date.parse(presence.setAt) : Number.NaN;
  const ageMs = Number.isNaN(setAtMs) ? null : nowMs - setAtMs;
  const state: StatusLineState = ageMs !== null && ageMs > STALE_THRESHOLD_MS ? 'stale' : 'active';

  // Active leaf resolution: read-only query against the per-session
  // active-dispatches index. Filter to in-flight entries; pick the most
  // recent by createdAt. The renderer uses this to surface the in-flight
  // bee skill (e.g. `peaks-rd`) alongside the orchestrator (e.g. `peaks-code`).
  let activeLeaf: StatusLineActiveLeaf | null = null;
  try {
    activeLeaf = readActiveLeaf(projectRoot, sessionId);
  } catch {
    activeLeaf = null;
  }

  // Slice rid-statusline-24h-overlay (2026-08-10): read the 24h-mode
  // overlay snapshot ONLY when state === 'active'. Stale / idle /
  // invalid-presence / idle-via-outer-mismatch never carry the suffix
  // (per PRD §Non-goals.6 — "不在 idle / stale / invalid-presence
  // 状态下 overlay 24h suffix"). When projectRoot or sessionId is
  // missing, return null without re-reading disk.
  const twentyFourHourState: TwentyFourHourOverlay | null =
    state === 'active' ? read24hOverlay(projectRoot, sessionId ?? '') : null;

  return {
    state,
    projectRoot,
    presence,
    ageMs,
    compact,
    activeLeaf,
    sessionId,
    twentyFourHourState
  };
}
