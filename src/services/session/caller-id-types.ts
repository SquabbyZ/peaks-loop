/**
 * Caller-Id Resolution types (slice 020 — caller-keyed session binding).
 *
 * The single shared `.peaks/_runtime/session.json` and
 * `.peaks/_runtime/active-skill.json` files are replaced with per-caller
 * layouts: `.peaks/_runtime/callers/<callerId>.json` and
 * `.peaks/_runtime/<peakSid>/active-skill-<callerId>.json`. The
 * `callerId` is a generic identifier the calling platform declares
 * itself (Claude Code via `CLAUDE_CODE_SESSION_ID`, future platforms
 * via `PLATFORM_FALLBACKS`).
 *
 * See `.peaks/_runtime/2026-06-09-session-8bfe7d/prd/source/caller-id-contract.md`
 * for the freeze-in contract (D1-D7 + M1-M5).
 */

export type CallerIdSource = 'flag' | 'env' | 'fallback' | 'none';

/**
 * On-disk shape of `.peaks/_runtime/callers/<callerId>.json`. One file
 * per caller; two callers may point to the same `peakSessionId` (D6).
 */
export interface CallerBinding {
  /** Echo of the filename stem; matches D1 regex. */
  callerId: string;
  /** The peak session this caller is bound to. */
  peakSessionId: string;
  /** Absolute path to the project root, canonicalized. */
  projectRoot: string;
  /** ISO 8601 timestamp; stamped at first write. */
  createdAt: string;
  /** ISO 8601 timestamp; bumped on every `peaks <cmd>` that touches the binding. */
  lastActivityAt: string;
  /** Last skill that touched this binding, e.g. "peaks-code". */
  skill: string;
  /** Last mode, e.g. "full-auto". */
  mode: string;
  /** Last gate, e.g. "startup". */
  gate: string;
}

/**
 * Per-(peakSessionId, callerId) presence record at
 * `.peaks/_runtime/<peakSid>/active-skill-<callerId>.json`. Each caller
 * has its own file (D6); two callers bound to the same peak session
 * never clobber each other's presence.
 */
export interface CallerSkillPresence {
  callerId: string;
  skill: string;
  mode?: string;
  gate?: string;
  setAt: string;
  lastHeartbeat?: string;
}

/**
 * D1 callerId regex: ASCII letters, digits, dot, underscore, hyphen;
 * 1-200 chars. Excludes path separators (Windows: `\`, Unix: `/`),
 * NUL, control chars, whitespace, all other Unicode — callerId is
 * embedded in a file path and must be portable across Windows / macOS
 * / Linux.
 */
export const CALLER_ID_REGEX = /^[a-zA-Z0-9._-]{1,200}$/;

/**
 * Thrown by `resolveCallerId` for two cases:
 *
 *   - `code: 'EX_USAGE'` (exit 64, D2): no callerId available
 *     anywhere (flag/env/fallback all empty).
 *   - `code: 'EX_DATAERR'` (exit 65, D5): resolved callerId does not
 *     match D1's regex.
 *
 * The `source` field tells the user where the bad id came from
 * (`flag` / `env` / `fallback` / `none`) so the error message points
 * at the right thing to fix.
 */
export class CallerIdError extends Error {
  readonly code: 'EX_USAGE' | 'EX_DATAERR';
  readonly source: CallerIdSource;
  readonly value: string | undefined;

  constructor(
    code: 'EX_USAGE' | 'EX_DATAERR',
    source: CallerIdSource,
    message: string,
    value?: string
  ) {
    super(message);
    this.name = 'CallerIdError';
    this.code = code;
    this.source = source;
    this.value = value;
  }
}
