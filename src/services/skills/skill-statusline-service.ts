import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findProjectRoot } from '../config/config-safety.js';
import { decideCompactStatusline } from '../compact-statusline/compact-statusline-service.js';
import { getSessionIdCanonical } from '../session/session-manager.js';
import { resolveActiveSkillForCaller } from '../audit/enforcers/active-skill-resolver.js';
import { readActiveDispatchIndex, type ActiveDispatchEntry } from '../dispatch/dispatch-record-writer.js';
import type { CompactStatuslineState } from '../compact-statusline/compact-statusline-service.js';

/**
 * Out-of-band Peaks skill status renderer for the Claude Code statusLine.
 *
 * Claude Code invokes the configured statusLine command on every turn and pipes
 * a JSON session payload on stdin. This renderer reads the durable presence file
 * (`.peaks/_runtime/active-skill.json`, with a one-minor-release back-compat
 * fallback to `.peaks/.active-skill.json`) and prints a single line that
 * Claude Code paints at the bottom of the terminal. Because it is rendered
 * by the harness — not emitted as LLM tokens — the signal cannot be forgotten
 * by the model, cannot be confused with normal output, and survives context
 * compaction.
 *
 * This module is intentionally READ-ONLY. Unlike getSkillPresence in
 * skill-presence-service.ts, it never deletes or rewrites the presence file:
 * the statusLine runs on every turn and must have zero side effects.
 */

const PRESENCE_FILE = '.peaks/_runtime/active-skill.json';
const PRESENCE_FILE_LEGACY = '.peaks/.active-skill.json';
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
};

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
 * When `callerId` is non-null, delegates to the canonical lease resolver
 * (presence-lease-service via active-skill-resolver) so the read is
 * session+caller-isolated. When `callerId` is null, falls back to the
 * project-level single-file read (back-compat for callers that don't pass
 * a callerId yet, e.g. legacy CLI invocations).
 */
function readPresenceReadOnly(
  projectRoot: string,
  callerId: string | null,
): { presence: StatusLinePresence | null; invalid: boolean } {
  if (callerId !== null) {
    try {
      const resolution = resolveActiveSkillForCaller(projectRoot, { legacyPresence: true, callerId });
      if (resolution.source === 'none' || resolution.skill === null) {
        return { presence: null, invalid: false };
      }
      return {
        presence: {
          skill: resolution.skill,
          ...(resolution.mode !== null ? { mode: resolution.mode } : {}),
        },
        invalid: false,
      };
    } catch {
      return { presence: null, invalid: true };
    }
  }
  const presencePath = resolve(projectRoot, PRESENCE_FILE);
  // Back-compat: prefer the new canonical path; fall back to the legacy
  // `.peaks/.active-skill.json` for one minor release.
  const pathToRead = existsSync(presencePath) ? presencePath : resolve(projectRoot, PRESENCE_FILE_LEGACY);
  if (!existsSync(pathToRead)) {
    return { presence: null, invalid: false };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(pathToRead, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return { presence: null, invalid: true };
    }
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.skill !== 'string' || candidate.skill.length === 0) {
      return { presence: null, invalid: true };
    }
    return {
      presence: {
        skill: candidate.skill,
        ...(typeof candidate.mode === 'string' ? { mode: candidate.mode } : {}),
        ...(typeof candidate.gate === 'string' ? { gate: candidate.gate } : {}),
        ...(typeof candidate.setAt === 'string' ? { setAt: candidate.setAt } : {}),
        ...(typeof candidate.claudeSessionId === 'string' ? { claudeSessionId: candidate.claudeSessionId } : {})
      },
      invalid: false
    };
  } catch {
    return { presence: null, invalid: true };
  }
}

export function buildStatusLineModel(stdin: StatusLineStdin | null, nowMs: number): StatusLineModel {
  const cwd = resolveCwdFromStdin(stdin);
  const projectRoot = findProjectRoot(cwd);

  // Compact state is computed independently of presence — the read is read-only
  // and reads `.peaks/_runtime/<sid>/compact-lifecycle.json` (or its legacy
  // fallbacks). It replaces the active skill content when kind != 'none'.
  const compact = readCompactState(projectRoot, nowMs);

  if (projectRoot === null) {
    return { state: 'idle', projectRoot: null, presence: null, ageMs: null, compact, activeLeaf: null };
  }

  // callerId resolves the read-side isolation; back-compat is `null`.
  const callerId = resolveCallerId(stdin);
  const { presence, invalid } = readPresenceReadOnly(projectRoot, callerId);
  if (invalid) {
    return { state: 'invalid-presence', projectRoot, presence: null, ageMs: null, compact, activeLeaf: null };
  }
  if (presence === null) {
    return { state: 'idle', projectRoot, presence: null, ageMs: null, compact, activeLeaf: null };
  }

  // Session binding: when the presence was stamped with a Claude session id and
  // the live session (from stdin) is a different one, the recorded skill belongs
  // to a previous session — render idle instead of a stale "active" skill. When
  // either id is absent (legacy presence, or harness that omits session_id) we
  // fall back to the time-based behavior below for backward compatibility.
  const liveSessionId = typeof stdin?.session_id === 'string' && stdin.session_id.length > 0 ? stdin.session_id : null;
  if (presence.claudeSessionId && liveSessionId && presence.claudeSessionId !== liveSessionId) {
    return { state: 'idle', projectRoot, presence: null, ageMs: null, compact, activeLeaf: null };
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
    const sessionId = getSessionIdCanonical(projectRoot);
    activeLeaf = readActiveLeaf(projectRoot, sessionId);
  } catch {
    activeLeaf = null;
  }

  return { state, projectRoot, presence, ageMs, compact, activeLeaf };
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
