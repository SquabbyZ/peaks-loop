import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findProjectRoot } from '../config/config-safety.js';
import { decideCompactStatusline } from '../compact-statusline/compact-statusline-service.js';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { resolveActiveSkillForCaller } from '../audit/enforcers/active-skill-resolver.js';
import { listPresenceLeases } from './presence-lease-service.js';
import { readActiveDispatchIndex, type ActiveDispatchEntry } from '../dispatch/dispatch-record-writer.js';
import type { CompactStatuslineState } from '../compact-statusline/compact-statusline-service.js';

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

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type StatusLineStdin = {
  workspace?: { current_dir?: string; project_dir?: string };
  cwd?: string;
  session_id?: string;
  caller_id?: string;
};

export type StatusLineState = 'active' | 'idle' | 'stale' | 'invalid-presence';

export type StatusLinePresence = {
  skill: string;
  mode?: string;
  gate?: string;
  setAt?: string;
  claudeSessionId?: string;
};

export type StatusLineActiveLeaf = {
  role: string;
  pendingCount: number;
};

export type StatusLineModel = {
  state: StatusLineState;
  projectRoot: string | null;
  presence: StatusLinePresence | null;
  ageMs: number | null;
  compact: CompactStatuslineState;
  activeLeaf: StatusLineActiveLeaf | null;
  /**
   * Slice 2026-08-05-statusline-sid-only-marker: the canonical session
   * id resolved for the project root (`getSessionIdCanonical`), or
   * `null` when no project root is bound or no `.peaks/_runtime/<sid>/`
   * session is on disk. The renderer reads this to append ` [shortSid]`
   * to the project name cell for idle / stale states (G1); invalid-
   * presence still suppresses the suffix (G2).
   *
   * Carry-forward for AC1/AC2/AC3: the value is `null` whenever
   * `projectRoot === null` — the renderer relies on this to skip the
   * suffix without re-running `getSessionIdCanonical` against a non-
   * existent root.
   */
  sessionId: string | null;
  /**
   * Slice rid-statusline-24h-overlay (2026-08-10): the 24h-mode
   * overlay snapshot read from `.peaks/_runtime/<sid>/24h-state.json`,
   * or `null` when no file exists / file is corrupt / file has wrong
   * shape. The renderer reads this to append `[24h-<state>]` after
   * the existing `<baseMode>` token in the ACTIVE state only.
   *
   * Always present (never undefined). `null` means "no overlay" —
   * the renderer skips the suffix without re-reading disk.
   */
  twentyFourHourState: TwentyFourHourOverlay | null;
};

/**
 * Slice rid-statusline-24h-overlay (2026-08-10): minimal overlay
 * type returned by `read24hOverlay`. The renderer only consumes
 * `state` (to format `[24h-<state.toLowerCase()>]`). The canonical
 * schema at `src/services/24h-mode/state.ts:55-66` carries additional
 * fields (`attempts: Record<DecisionKey, number>`, `enteredAt`,
 * `checkpoints`, etc.) but the overlay is deliberately MINIMAL —
 * it tolerates forward compatibility with new states the writer
 * may add, and it never throws on malformed shapes (PRD AC-3:
 * graceful null on any invalid input).
 */
export type TwentyFourHourOverlay = {
  state: string;
};

/**
 * Slice rid-statusline-24h-overlay (2026-08-10): name-distinct from
 * the canonical `read24hState` in `src/services/24h-mode/store.ts:108`.
 * The canonical reader calls `coerceSnapshot` (which throws on
 * malformed shapes via `24H_STATE_INVALID`); this overlay reader
 * returns `null` for ANY malformed shape (per PRD AC-3 — never
 * throw across the statusline boundary).
 *
 * Returns null when:
 *   - `projectRoot` or `sessionId` is empty
 *   - the file does not exist (ENOENT)
 *   - JSON.parse fails (corrupt file)
 *   - root is not a non-array object
 *   - `state` is missing, non-string, or empty string
 */
export function read24hOverlay(
  projectRoot: string,
  sessionId: string,
): TwentyFourHourOverlay | null {
  if (!projectRoot || !sessionId) return null;
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, '24h-state.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // ENOENT, EACCES, EISDIR — all treated as "no overlay"
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // corrupt JSON — graceful null (PRD AC-3)
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['state'] !== 'string' || obj['state'].length === 0) return null;
  return { state: obj['state'] };
}

function resolveCwdFromStdin(stdin: StatusLineStdin | null): string {
  const fromWorkspace = stdin?.workspace?.current_dir ?? stdin?.workspace?.project_dir;
  if (typeof fromWorkspace === 'string' && fromWorkspace.length > 0) {
    return resolve(fromWorkspace);
  }
  if (typeof stdin?.cwd === 'string' && stdin.cwd.length > 0) {
    return resolve(stdin.cwd);
  }
  return process.cwd();
}

export function parseStatusLineStdin(raw: string): StatusLineStdin | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return parsed as StatusLineStdin;
    }
    return null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

/**
 * Resolve the callerId for the read-side isolation. Order of resolution:
 *   1. `stdin?.caller_id` (when the harness / IDE adapter forwards it)
 *   2. `process.env.CLAUDE_CODE_SESSION_ID` (Claude Code's ambient session id;
 *      used as a coarse callerId surrogate when stdin omits caller_id)
 *   3. `null` (no callerId — caller falls back to the project-level
 *      single-file read for back-compat)
 */
function resolveCallerId(stdin: StatusLineStdin | null): string | null {
  const fromStdin = typeof stdin?.caller_id === 'string' && stdin.caller_id.length > 0
    ? stdin.caller_id
    : null;
  if (fromStdin !== null) return fromStdin;
  const fromEnv = process.env['CLAUDE_CODE_SESSION_ID'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}

/**
 * Read the active-dispatch index for the canonical session, filter to
 * in-flight entries (status NOT IN { done, failed, cancelled, no-execution,
 * never-started, unreadable, stale }), and return the most-recent leaf role
 * plus the total in-flight count. Returns `{ role: null, pendingCount: 0 }`
 * when no session id resolves, the index is empty, or every entry is terminal.
 *
 * READ-ONLY: only reads `.peaks/_sub_agents/<sid>/active-dispatches.json`.
 * Never mutates the on-disk record.
 */
function readActiveLeaf(
  projectRoot: string,
  sessionId: string | null,
): StatusLineActiveLeaf | null {
  if (sessionId === null) return null;
  let index: Record<string, ActiveDispatchEntry> = {};
  try {
    index = readActiveDispatchIndex(projectRoot, sessionId);
  } catch {
    return null;
  }
  const terminalStatuses: ReadonlySet<ActiveDispatchEntry['status']> = new Set([
    'done',
    'failed',
    'cancelled',
    'no-execution',
    'never-started',
    'unreadable',
    'stale',
    'queued', // Slice 2026-08-05 fix: stale dispatch entries stuck at 'queued' should
              // not pollute statusline as in-flight leaves.
  ]);
  const inFlight = Object.values(index).filter((e) => !terminalStatuses.has(e.status));
  if (inFlight.length === 0) return null;
  // Sort by createdAt descending — the most recently dispatched leaf wins.
  const sorted = inFlight.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = sorted[0];
  if (latest === undefined) return null;
  return { role: latest.role, pendingCount: inFlight.length };
}

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
  callerId: string | null,
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
          ...(firstResolution.mode !== null ? { mode: firstResolution.mode } : {}),
        },
        invalid: false,
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
  // not declare it, so widen the read shape here.
  const latestMode = (latest as { mode?: unknown }).mode;
  return {
    presence: {
      skill: latest.skill,
      ...(typeof latestMode === 'string' && latestMode.length > 0 ? { mode: latestMode } : {}),
      setAt: latest.startedAt,
    },
    invalid: false,
  };
}

export function buildStatusLineModel(stdin: StatusLineStdin | null, nowMs: number): StatusLineModel {
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
    return { state: 'idle', projectRoot: null, presence: null, ageMs: null, compact, activeLeaf: null, sessionId: null, twentyFourHourState: null };
  }

  // callerId resolves the read-side isolation; back-compat is `null`.
  const callerId = resolveCallerId(stdin);
  const { presence, invalid } = readPresenceReadOnly(projectRoot, callerId);
  if (invalid) {
    return { state: 'invalid-presence', projectRoot, presence: null, ageMs: null, compact, activeLeaf: null, sessionId, twentyFourHourState: null };
  }
  if (presence === null) {
    return { state: 'idle', projectRoot, presence: null, ageMs: null, compact, activeLeaf: null, sessionId, twentyFourHourState: null };
  }

  // Session binding: when the presence was stamped with a Claude session id and
  // the live session (from stdin) is a different one, the recorded skill belongs
  // to a previous session — render idle instead of a stale "active" skill. When
  // either id is absent (legacy presence, or harness that omits session_id) we
  // fall back to the time-based behavior below for backward compatibility.
  const liveSessionId = typeof stdin?.session_id === 'string' && stdin.session_id.length > 0 ? stdin.session_id : null;
  if (presence.claudeSessionId && liveSessionId && presence.claudeSessionId !== liveSessionId) {
    return { state: 'idle', projectRoot, presence: null, ageMs: null, compact, activeLeaf: null, sessionId, twentyFourHourState: null };
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

  return { state, projectRoot, presence, ageMs, compact, activeLeaf, sessionId, twentyFourHourState };
}

/**
 * Read-only compact state resolver. Resolves the canonical session id for the
 * detected project root, then delegates to {@link decideCompactStatusline}.
 * Returns `{ kind: 'none', filledCells: 0 }` when no project root is bound —
 * the renderer falls back to the C1 normal line in that case.
 */
function readCompactState(projectRoot: string | null, nowMs: number): CompactStatuslineState {
  if (projectRoot === null) {
    return { kind: 'none', filledCells: 0 };
  }
  try {
    const sessionId = getSessionIdCanonical(projectRoot);
    return decideCompactStatusline({
      projectRoot,
      sessionId,
      now: nowMs,
    });
  } catch {
    // Read-only — never throw across the statusline boundary.
    return { kind: 'none', filledCells: 0 };
  }
}
