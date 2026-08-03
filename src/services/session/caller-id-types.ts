/**
 * Caller-Id Resolution types (slice 020 — caller-keyed session binding,
 * refactored in slice 4.0.8 to be adapter-owned per RD §5).
 *
 * Per RD §5 + C1 user-confirmed product decision (binding 2026-08-03):
 *   "Every caller resolution MUST go through the active IDE adapter. Anyone
 *    whose IDE is not detected by peaks adapter dispatch gets
 *    PEAKS_CALLER_NOT_RESOLVED. This is the desired product contract
 *    (vendor-neutral)."
 *
 * As of 4.0.8 the per-platform `PLATFORM_FALLBACKS` table is DELETED. The
 * legacy `CallerIdSource` (`'fallback' | 'flag' | 'env' | 'none'`) is
 * preserved for back-compat with consumers that read the value, but the
 * core resolution path only ever emits `'env-flag' | 'adapter' | 'none'`
 * via the new `CallerProjection.source` field.
 *
 * See `.peaks/_runtime/2026-08-03-session-bee258/rd/requests/001-2026-08-03-presence-lease-graph-design.md`
 * for the slice 4.0.8 contract.
 */

export type CallerIdSource = 'flag' | 'env' | 'fallback' | 'none';

/**
 * The 4.0.8 slice-2 source union: caller was resolved by the
 * PEAKS_CALLER_ID vendor-neutral override (`env-flag`) or by the active
 * IDE adapter (`adapter`). `none` is reserved for the "could not resolve
 * any callerId" failure case.
 */
export type CallerProjectionSource = 'env-flag' | 'adapter' | 'none';

/**
 * Canonical typed error union for caller-id resolution failures. The
 * adapter contract already throws `PEAKS_CALLER_NOT_RESOLVED` via the
 * `code: 'PEAKS_CALLER_NOT_RESOLVED'` field on the thrown Error. The
 * new union keeps the typed projection + the typed code so callers can
 * branch on either.
 */
export type CallerResolveErrorCode = 'PEAKS_CALLER_NOT_RESOLVED' | 'PEAKS_SESSION_NOT_BOUND';

/**
 * Canonical caller projection returned by `resolveCallerId` in 4.0.8.
 * Replaces the bare-string return shape so callers (and the statusline
 * / hook consumers) can read `{ adapterId, callerId, workflowId, graphRef,
 * source }` directly without re-reading the on-disk lease / index.
 */
export interface CallerProjection {
  /** Active adapter id (e.g. 'claude-code', 'trae'). */
  readonly adapterId: string;
  /** Resolved callerId (validated against CALLER_ID_REGEX). */
  readonly callerId: string;
  /** Workflow id the caller is bound to (from the per-(sid, caller) index). */
  readonly workflowId: string | null;
  /** graphRef the caller's lease points at, or null when no active lease. */
  readonly graphRef: string | null;
  /**
   * Origin of the resolved callerId. `env-flag` = PEAKS_CALLER_ID
   * override; `adapter` = active IDE adapter's resolveCallerId;
   * `none` = resolution failed (PEAKS_CALLER_NOT_RESOLVED).
   */
  readonly source: CallerProjectionSource;
}

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
 * Thrown by `resolveCallerId` for two cases (legacy shape; preserved
 * for back-compat with consumers that catch `CallerIdError`):
 *
 *   - `code: 'EX_USAGE'` (exit 64, D2): no callerId available
 *     anywhere (flag/env/adapter all empty / not resolvable).
 *   - `code: 'EX_DATAERR'` (exit 65, D5): resolved callerId does not
 *     match D1's regex.
 *
 * In 4.0.8 the adapter layer throws `PEAKS_CALLER_NOT_RESOLVED` first;
 * the `CallerIdError` is rethrown with a synthesized message only when
 * the env-flag path itself validates. New code should branch on
 * `(err as Error & { code?: string }).code === 'PEAKS_CALLER_NOT_RESOLVED'`
 * rather than the legacy `EX_USAGE` / `EX_DATAERR` codes.
 *
 * The `source` field tells the user where the bad id came from
 * (`flag` / `env` / `adapter` / `none`) so the error message points
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
