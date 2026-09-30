/**
 * Skill statusline model types + read-only helpers — moved VERBATIM out of
 * `skill-statusline-service.ts` for the 300-raw-line cap (slice
 * `b1-filesplit-campaign`, wave 3C). The original module re-exports the
 * public names (`StatusLineStdin`, `StatusLineState`, `StatusLinePresence`,
 * `StatusLineActiveLeaf`, `StatusLineModel`, `TwentyFourHourOverlay`,
 * `read24hOverlay`, `parseStatusLineStdin`), so existing import paths keep
 * working. This module stays READ-ONLY like its predecessor.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  decideCompactStatusline,
  type CompactStatuslineState
} from '../compact-statusline/compact-statusline-service.js';
import { getSessionIdCanonical } from '../session/session-manager.js';
import {
  readActiveDispatchIndex,
  type ActiveDispatchEntry
} from '../dispatch/dispatch-record-writer.js';

export type StatusLineStdin = {
  workspace?: { current_dir?: string; project_dir?: string };
  cwd?: string;
  session_id?: string;
  caller_id?: string;
  /**
   * The harness's own context numbers. Declared here because this type IS the
   * documented shape of the payload the harness pipes in; omitting a documented
   * field would make the type lie by omission, and a consumer that reached for
   * it would have to cast. Read (never written) by
   * `harness-context-witness.ts` — see that module for why
   * `context_window_size` is NOT a denominator.
   */
  context_window?:
    | {
        context_window_size?: unknown;
        used_percentage?: unknown;
        remaining_percentage?: unknown;
        current_usage?: Record<string, unknown> | undefined;
      }
    | undefined;
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
  sessionId: string
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

export function resolveCwdFromStdin(stdin: StatusLineStdin | null): string {
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
      return parsed;
    }
    return null;
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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
export function resolveCallerId(stdin: StatusLineStdin | null): string | null {
  const fromStdin =
    typeof stdin?.caller_id === 'string' && stdin.caller_id.length > 0 ? stdin.caller_id : null;
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
export function readActiveLeaf(
  projectRoot: string,
  sessionId: string | null
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
    'queued' // Slice 2026-08-05 fix: stale dispatch entries stuck at 'queued' should
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
 * Read-only compact state resolver. Resolves the canonical session id for the
 * detected project root, then delegates to {@link decideCompactStatusline}.
 * Returns `{ kind: 'none', filledCells: 0 }` when no project root is bound —
 * the renderer falls back to the C1 normal line in that case.
 */
export function readCompactState(
  projectRoot: string | null,
  nowMs: number
): CompactStatuslineState {
  if (projectRoot === null) {
    return { kind: 'none', filledCells: 0 };
  }
  try {
    const sessionId = getSessionIdCanonical(projectRoot);
    return decideCompactStatusline({
      projectRoot,
      sessionId,
      now: nowMs
    });
  } catch {
    // Read-only — never throw across the statusline boundary.
    return { kind: 'none', filledCells: 0 };
  }
}
