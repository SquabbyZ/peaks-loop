import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findProjectRoot } from '../config/config-safety.js';
import { ensureMemoryBootstrap } from '../memory/project-memory-service.js';
import { getSessionId, getSessionMeta } from '../session/session-manager.js';
// Slice 4.0.8 compat shim: the canonical write path lives in
// `presence-lease-service.ts`. The legacy shim dynamically imports
// it inside `setSkillPresence` so the cold path of the legacy
// `getSkillPresence` / `checkStalePresence` / `clearStalePresenceOnRotation`
// read paths stays cheap. The static imports below are reserved for
// the migration window and are referenced through the dynamic
// `leaseMod.*` accessor at runtime.
import { listPresenceLeases } from './presence-lease-service.js';
import type {
  SetPresenceLeaseResult,
} from './presence-lease-service.js';
// Re-export the 4.0.8 compat surface so legacy callers
// (`presence-service` consumers in `code-mode-gate-commands.ts`,
// `mode-enforcement.ts`, `code-job-shape-commands.ts`, etc.) keep
// their `setSkillPresence` / `getSkillPresence` / etc. import paths
// while the actual work flows through the canonical lease service.
void (null as unknown as SetPresenceLeaseResult | null);

export type SkillPresenceMode = 'full-auto' | 'assisted' | 'swarm' | 'strict';

export const VALID_SKILL_PRESENCE_MODES: ReadonlyArray<SkillPresenceMode> = [
  'full-auto',
  'assisted',
  'swarm',
  'strict'
];

export function isSkillPresenceMode(value: string): value is SkillPresenceMode {
  return (VALID_SKILL_PRESENCE_MODES as ReadonlyArray<string>).includes(value);
}

export type SkillPresence = {
  skill: string;
  mode?: SkillPresenceMode;
  gate?: string;
  sessionId?: string;
  /**
   * Identifier of the *outer* session — the Claude Code / Cursor /
   * VSCode-plugin / other harness session that is currently driving
   * the LLM. Sourced from the `PEAKS_OUTER_SESSION_ID` environment
   * variable when set, with `CLAUDE_CODE_SESSION_ID` as a fallback for
   * Claude Code. Stamped onto the presence file so the status line
   * can tell whether the recorded skill belongs to the live outer
   * session (show it) or a previous one (render idle), and so
   * `setSkillPresence` can detect a session swap and AskUserQuestion
   * the user about rolling a new peaks session.
   */
  outerSessionId?: string;
  /**
   * Set by `setSkillPresence` when the outer session id changed
   * between the last presence write and this one AND the bound
   * peaks session has a different (or no) recorded outer session id.
   *
   * As of slice 018 (auto-roll on outer-mismatch), the field is
   * informational only — it tells the statusline and any log /
   * observability consumer that an outer-session swap was observed
   * on the previous heartbeat. The actual binding rotation is
   * performed by `ensureSessionWithRotation` (slice 018), not by
   * `setSkillPresence`. `peaks-code`'s Step 0 used to read this
   * field and turn it into an AskUserQuestion; that ask is no
   * longer needed because the rotation already happened by the time
   * the skill is invoked.
   */
  outerSessionMismatch?: {
    previous?: string;
    current: string;
    boundSessionId: string;
    boundOuterSessionId?: string;
  };
  setAt: string;
  lastHeartbeat?: string;
};

/**
 * The current outer session id, exposed to Bash tool calls via the
 * `PEAKS_OUTER_SESSION_ID` environment variable. Stamping it onto the
 * presence file lets the read-only status line tell whether the recorded
 * skill belongs to the live session (show it) or a previous one
 * (render idle). Falls back to `CLAUDE_CODE_SESSION_ID` for Claude Code
 * so existing Claude Code users get the field populated without any
 * configuration; other harnesses that want a presence stamp can set
 * either variable.
 */
function getCurrentOuterSessionId(): string | undefined {
  const peaks = process.env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) return peaks;
  const claude = process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof claude === 'string' && claude.length > 0) return claude;
  return undefined;
}

// Slice 4.0.11 statusline-sid-scoped-lease C: the deprecated
// project-level single-slot presence files
// `.peaks/_runtime/active-skill.json` and `.peaks/.active-skill.json`
// are REMOVED from this module. The canonical sid-scoped lease
// projection (`.peaks/_runtime/<sid>/leases/presence-*.json`) is the
// only source of truth. The legacy constants `PRESENCE_FILE` and
// `PRESENCE_FILE_LEGACY` are deleted; readers use `listPresenceLeases`.

const SESSION_FILE = join('.peaks', '_runtime', 'session.json');
const SESSION_FILE_LEGACY = '.peaks/.session.json';

function resolveProjectRoot(override?: string): string {
  if (override) return resolve(override);
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

/**
 * Resolve the active peaks session id from
 * `.peaks/_runtime/session.json` (legacy: `.peaks/.session.json`).
 * Returns `null` when no session is bound.
 *
 * Public export: callers like `peaks sub-agent dispatch` use this
 * to auto-resolve `--session-id` when the LLM driver forgets to
 * pass the flag, so dispatch records land in the right
 * `.peaks/_sub_agents/<sid>/` tree instead of an `unknown-sid`
 * fallback (slice 2026-06-26-unknown-sid-fallback-fix).
 */
export function getCurrentSessionId(projectRootOverride?: string): string | null {
  const projectRoot = resolveProjectRoot(projectRootOverride);
  const sessionPath = resolve(projectRoot, SESSION_FILE);
  const legacyPath = resolve(projectRoot, SESSION_FILE_LEGACY);
  // Back-compat window: prefer the new canonical path; fall back to the
  // legacy `.peaks/.session.json` for one minor release.
  const pathToRead = existsSync(sessionPath) ? sessionPath : legacyPath;
  if (!existsSync(pathToRead)) return null;
  try {
    const data = JSON.parse(readFileSync(pathToRead, 'utf8'));
    return typeof data.sessionId === 'string' && data.sessionId.length > 0
      ? data.sessionId
      : null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

/**
 * Slice 4.0.11 statusline-sid-scoped-lease C: read the canonical
 * sid-scoped lease projection and project the freshest in-flight
 * lease into the legacy `SkillPresence` shape that the public
 * `getSkillPresence` / `checkStalePresence` /
 * `clearStalePresenceOnRotation` consumers expect. The projection
 * is lossy (the lease does not carry `outerSessionId`; `setAt`
 * maps to `startedAt`; `lastHeartbeat` is reused as `lastHeartbeat`).
 *
 * Returns `null` when the bound session has no in-flight leases
 * (`running` or `preparing`); terminalized leases are ignored so
 * the read does not resurrect a stale skill on a fresh session.
 */
function readSkillPresenceFromLease(projectRootOverride?: string): SkillPresence | null {
  const projectRoot = resolveProjectRoot(projectRootOverride);
  const sessionId = getSessionId(projectRoot);
  if (sessionId === null) return null;
  const leases = listPresenceLeases(projectRoot, sessionId);
  const inFlight = leases.filter((l) => l.status === 'running' || l.status === 'preparing');
  if (inFlight.length === 0) return null;
  inFlight.sort((a, b) => b.lastHeartbeat.localeCompare(a.lastHeartbeat));
  const lease = inFlight[0];
  if (lease === undefined) return null;
  // The lease carries `callerId` (the adapter / harness session id),
  // not the legacy `outerSessionId` field. Project it for back-compat
  // with `clearStalePresenceOnRotation`'s outer-mismatch check.
  return {
    skill: lease.skill,
    sessionId,
    outerSessionId: lease.callerId,
    setAt: lease.startedAt,
    lastHeartbeat: lease.lastHeartbeat
  };
}

/**
 * Look up the outer-session-id that was bound to the *current* peaks
 * session, i.e. the one written to the per-session
 * `.peaks/_runtime/<sid>/session.json` by `ensureSession`/`initWorkspace`. This
 * is the source of truth for "which outer session owns the
 * in-flight peaks session".
 *
 * Returns `null` if no peaks session is bound yet, or if the bound
 * session has no recorded outer session id (legacy sessions predating
 * the outer-session contract).
 */
function getBoundOuterSessionId(projectRootOverride?: string): string | undefined {
  const sessionId = getCurrentSessionId(projectRootOverride);
  if (sessionId === null) return undefined;
  const projectRoot = resolveProjectRoot(projectRootOverride);
  const meta = getSessionMeta(projectRoot, sessionId);
  if (meta === null) return undefined;
  return typeof meta.outerSessionId === 'string' && meta.outerSessionId.length > 0
    ? meta.outerSessionId
    : undefined;
}

/**
 * Snapshot of the previous peaks session's outer session id, read
 * straight off the active-skill marker *before* we overwrite it.
 * Used to detect "the LLM just opened a fresh outer session" — if
 * the previously-recorded outer session id differs from the one we
 * are about to stamp, the user probably closed the previous outer
 * session and is now driving peaks from a new one.
 *
 * As of slice 018 (auto-roll on outer-mismatch), the actual rotation
 * is `ensureSessionWithRotation`'s job, not this one. The presence
 * service still emits the structured `outerSessionMismatch` field on
 * the presence envelope (useful for the statusline to render a stale
 * marker and for the QA / log consumers to know an outer-session swap
 * happened), but it no longer carries the implicit "ask the user"
 * promise — `peaks-code`'s Step 0 no longer needs to surface an
 * AskUserQuestion, because the rotation already fired by the time the
 * skill is invoked.
 *
 * `getPreviousOuterSessionId` keeps its read-side role: it powers the
 * informational `outerSessionMismatch` field below and the legacy
 * `claudeSessionId` back-compat. Reads from
 * `.peaks/_runtime/active-skill.json` first; falls back to the
 * legacy `.peaks/.active-skill.json` for one minor release.
 */
function getPreviousOuterSessionId(projectRootOverride?: string): string | undefined {
  const result = readSkillPresenceFromLease(projectRootOverride);
  if (result === null) return undefined;
  if (typeof result.outerSessionId === 'string' && result.outerSessionId.length > 0) {
    return result.outerSessionId;
  }
  return undefined;
}

// ============================================================================
// Slice 020 — caller-keyed active-skill marker (D6).
// ============================================================================
//
// Today's per-project active-skill marker (`.peaks/_runtime/active-skill.json`)
// races when multiple Claude Code windows (or different platforms) drive the
// same project concurrently. Slice 020 introduces a per-caller file at
// `.peaks/_runtime/<peakSid>/active-skill-<callerId>.json` (D6). Two callers
// bound to the same peak session never clobber each other.
//
// The single-file marker is RETAINED for one minor release as read-only
// back-compat (M1, M4). The new write path is `setSkillPresenceForCaller`;
// the legacy `setSkillPresence` is now a thin wrapper that synthesises a
// legacy callerId from `process.env.CLAUDE_CODE_SESSION_ID` (or
// `projectRoot` for the truly-anonymous case) and delegates.

/**
 * Write the per-caller active-skill marker to
 * `.peaks/_runtime/<peakSid>/active-skill-<callerId>.json` (D6). Returns
 * the written presence with the `callerId` field set.
 *
 * The caller is responsible for resolving the `callerId` (via
 * `resolveCallerId` from `src/services/session/resolve-caller-id.ts`)
 * and the `peakSessionId` (via `getCallerBinding` then reading
 * `peakSessionId`, OR via `ensureSession` for the first-time case).
 */
export function setSkillPresenceForCaller(
  projectRootOverride: string,
  callerId: string,
  peakSessionId: string,
  skill: string,
  mode?: string,
  gate?: string
): SkillPresence {
  const validatedMode = mode && isSkillPresenceMode(mode) ? mode : undefined;
  const now = new Date().toISOString();
  const presence: SkillPresence = {
    skill,
    ...(validatedMode ? { mode: validatedMode } : {}),
    ...(gate ? { gate } : {}),
    ...(peakSessionId ? { sessionId: peakSessionId } : {}),
    ...(callerId ? { outerSessionId: callerId } : {}),
    setAt: now,
    lastHeartbeat: now
  };
  const presencePath = getActiveSkillFileForCallerPath(
    resolveProjectRoot(projectRootOverride),
    peakSessionId,
    callerId
  );
  const presenceDir = dirname(presencePath);
  if (!existsSync(presenceDir)) {
    mkdirSync(presenceDir, { recursive: true });
  }
  writeFileSync(presencePath, JSON.stringify(presence, null, 2), 'utf8');

  // Skill-activation side effect: bring the memory store into existence for
  // fresh projects. Same fail-open contract as the legacy path.
  ensureMemoryBootstrap(resolveProjectRoot(projectRootOverride));
  return presence;
}

/**
 * Compute the per-caller active-skill file path. Re-exported for test
 * ergonomics; canonical path lives in
 * `src/services/session/caller-binding-service.ts` but inlined here to
 * avoid a circular import (`caller-binding-service` reads
 * `skill-presence-service` for the `setCallerBinding` integration in
 * future slices; the inverse import would deadlock).
 */
function getActiveSkillFileForCallerPath(
  projectRoot: string,
  peakSessionId: string,
  callerId: string
): string {
  return resolve(projectRoot, '.peaks', '_runtime', peakSessionId, `active-skill-${callerId}.json`);
}

export function setSkillPresence(skill: string, mode?: string, gate?: string, projectRootOverride?: string): SkillPresence {
  // Slice 4.0.8 compat wrapper: the canonical write path is
  // `presence-lease-service.setPresenceLease`. The legacy
  // `setSkillPresence` is retained as a thin shim so callers that
  // haven't migrated (statusline consumers, code-mode-gate, the
  // dashboard's read-side) keep working. The compat shim:
  //   1. resolves the canonical session id (legacy file
  //      `.peaks/_runtime/session.json` -> canonical
  //      `.peaks/_runtime/session.json` + caller binding);
  //   2. resolves the adapter-owned caller id (PEAKS_CALLER_ID override
  //      > active IDE adapter); the resolution happens in
  //      `resolveCallerId`; if it fails we still write a *legacy*
  //      `SkillPresence` record (so non-4.0.8 callers that expect
  //      the old shape don't break) but we surface a warning to the
  //      CLI boundary via the `outerSessionMismatch` field.
  //   3. delegates the canonical write to `setPresenceLease`.
  const validatedMode = mode && isSkillPresenceMode(mode) ? mode : undefined;
  const sessionId = getCurrentSessionId(projectRootOverride);
  const outerSessionId = getCurrentOuterSessionId();
  const previousOuterSessionId = getPreviousOuterSessionId(projectRootOverride);
  const now = new Date().toISOString();

  // v2.15.0 slice 002 repair: always write `outerSessionId` (even
  // as `''`) when no harness env var is set. Without this, the JSON
  // envelope omits the key entirely, which makes downstream staleness
  // detection unreliable (consumers can't tell "no signal" from
  // "stale-missing-key"). Presence-shape consumers should treat
  // `outerSessionId === ''` as "no signal", matching the
  // `getCurrentOuterSessionId()` resolution contract.
  const presence: SkillPresence = {
    skill,
    ...(validatedMode ? { mode: validatedMode } : {}),
    ...(gate ? { gate } : {}),
    ...(sessionId ? { sessionId } : {}),
    outerSessionId: outerSessionId ?? '',
    setAt: now,
    lastHeartbeat: now
  };

  // Outer-session-mismatch detection. Same logic as the 4.0.7
  // implementation; we keep the legacy field for back-compat with
  // statusline consumers.
  if (outerSessionId !== undefined) {
    const boundOuterSessionId = getBoundOuterSessionId(projectRootOverride);
    const outerChanged = previousOuterSessionId !== outerSessionId;
    const boundOuterMatches = boundOuterSessionId === outerSessionId;
    const hasOuterSignal = previousOuterSessionId !== undefined || boundOuterSessionId !== undefined;
    if (hasOuterSignal && outerChanged && !boundOuterMatches && sessionId !== null) {
      presence.outerSessionMismatch = {
        ...(previousOuterSessionId !== undefined ? { previous: previousOuterSessionId } : {}),
        current: outerSessionId,
        boundSessionId: sessionId,
        ...(boundOuterSessionId !== undefined ? { boundOuterSessionId } : {})
      };
    }
  }

  // Canonical lease write — when a session is bound and we can derive
  // a (callerId, workflowId, graphRef) tuple, we route through
  // `setPresenceLease`. The lease service is fail-closed on missing
  // session or unresolved caller; the shim's behavior in that case
  // is the legacy `setSkillPresence` (write a flat `SkillPresence`
  // record) so callers that pre-date 4.0.8 keep their shape contract.
  const projectRoot = resolveProjectRoot(projectRootOverride);
  if (sessionId !== null) {
    // Lazy ESM dynamic import: the presence-lease-service and
    // resolve-caller-id services are imported here so the cold
    // path of the legacy compat shim doesn't pull in the canonical
    // lease / adapter machinery at module load. The try/catch
    // converts the typed failure (PEAKS_CALLER_NOT_RESOLVED,
    // PEAKS_SESSION_NOT_BOUND) into a fall-through to the legacy
    // write path — production CLI traffic is gated upstream in
    // `skill-command.ts` (exit 1) and this shim exists for legacy
    // statusline / hook / dashboard consumers.
    void (async () => {
      try {
        const [{ resolveCallerProjection }, leaseMod] = await Promise.all([
          import('../session/resolve-caller-id.js'),
          import('./presence-lease-service.js'),
        ]);
        const projection = resolveCallerProjection({ projectRoot, env: process.env });
        const workflowId = `wf-${sessionId}-compat`;
        const result: SetPresenceLeaseResult = leaseMod.setPresenceLease({
          projectRoot,
          sessionId,
          callerId: projection.callerId,
          workflowId,
          graphRef: `graphs/${workflowId}.json`,
          skill,
          now,
          ...(validatedMode !== undefined ? { mode: validatedMode } : {}),
          ...(gate !== undefined ? { gate } : {}),
        });
        // Suppress unused-import warnings for inputs reserved for the
        // migration window.
        void (leaseMod.readPresenceLease as unknown);
        void (leaseMod.markPresenceLost as unknown);
        void (leaseMod.listPresenceLeases as unknown);
        void (result as SetPresenceLeaseResult);
      } catch { /* fall through to legacy write */ }
    })();
  }

  // Slice 4.0.11 statusline-sid-scoped-lease A: the canonical write
  // path is now exclusively `presence-lease-service.setPresenceLease`.
  // The legacy single-slot marker file write was removed in this
  // slice: every `setSkillPresence` call flows through the sid-scoped
  // lease + presence-index machinery above. The legacy
  // `active-skill.json` file is NOT recreated here.

  // Skill-activation side effect: ensure `.peaks/memory/` and a full-shape
  // empty `index.json` exist for the project. This is the user-facing fix
  // for "stock projects never get a memory directory or index". Every peaks
  // skill starts with `peaks skill presence:set peaks-<role>`, so doing the
  // bootstrap here means the very first skill invocation in a fresh project
  // (or in a stock project that pre-dates the memory layer) brings the
  // memory store into existence. The helper is fail-open, so a failure here
  // does not block presence from being written.
  ensureMemoryBootstrap(projectRoot);

  return presence;
}

export function getSkillPresence(projectRootOverride?: string): SkillPresence | null {
  // Slice 4.0.11 statusline-sid-scoped-lease C: read from the
  // canonical sid-scoped lease projection. The legacy
  // `unlinkSync(presencePath)` purge on session-mismatch is
  // removed: the lease projection is keyed off the bound session
  // id, so a mismatch cannot happen — `listPresenceLeases`
  // already filters by the session-id resolved from the workspace
  // binding.
  return readSkillPresenceFromLease(projectRootOverride);
}

/**
 * Slice 002 (v2.15.0) — presence staleness detection (AC-1).
 *
 * Compare the *outer* session id stamped onto the current presence
 * marker against the *current* outer session id (from
 * `PEAKS_OUTER_SESSION_ID` / `CLAUDE_CODE_SESSION_ID`).
 *
 * Stale reasons (in priority order):
 *
 *   - `'outer-session-mismatch'` — the presence was stamped by a
 *     different outer (Claude / harness) session than the one that
 *     is now driving peaks. Most common cause: the LLM closed the
 *     previous Claude session, the next session boots and finds a
 *     presence leftover from the old one. peaks-code Step 1 must
 *     AskUserQuestion to confirm the user wants the old mode.
 *
 *   - `'no-presence'`            — there is no presence file on disk.
 *     Not strictly "stale", but callers (peaks-code Step 1, `peaks
 *     code should-pause --step step-1-mode-select`) want to treat
 *     this case as "no opinion yet — must ask". Surfaced as
 *     `stale: true` with reason `'no-presence'` so the ask path is
 *     uniform.
 *
 *   - `null`                     — the presence exists AND its outer
 *     session id matches the current outer session id. Not stale.
 *     Caller may safely reuse the recorded mode.
 *
 * Pure read-only: never deletes the presence file (the rotation
 * auto-clear path is a separate concern; see
 * `clearStalePresenceOnRotation`). Test seam: `--current-outer` lets
 * tests inject a deterministic current outer id without touching env
 * vars.
 */
export type StaleReason = 'outer-session-mismatch' | 'no-presence';

export type StalenessCheck = {
  stale: boolean;
  reason: StaleReason | null;
  /** What was on disk; null when no presence was found. */
  presence: SkillPresence | null;
  /** Current outer session id (env-driven). Undefined when no signal. */
  currentOuterSessionId: string | undefined;
  /** Outer session id recorded on the presence marker. Undefined when no signal. */
  recordedOuterSessionId: string | undefined;
};

export function checkStalePresence(opts?: {
  projectRootOverride?: string | undefined;
  /**
   * Override the *current* outer session id. Test seam only.
   *   - `undefined` (omitted): read from `PEAKS_OUTER_SESSION_ID` /
   *     `CLAUDE_CODE_SESSION_ID` env vars.
   *   - explicit `string`: use the value verbatim (empty string means
   *     "no signal", same as a missing env var).
   */
  currentOuter?: string | undefined;
}): StalenessCheck {
  const result = readSkillPresenceFromLease(opts?.projectRootOverride);
  // `opts?.currentOuter === undefined` is the omitted-key case. A
  // falsy string `''` is an explicit "no signal" (used by tests to
  // simulate a CLI run with no harness env vars).
  const current = opts && 'currentOuter' in opts
    ? opts.currentOuter
    : getCurrentOuterSessionId();
  if (result === null) {
    return {
      stale: true,
      reason: 'no-presence',
      presence: null,
      currentOuterSessionId: current,
      recordedOuterSessionId: undefined
    };
  }
  const recorded = result.outerSessionId;
  // Suppress false-positives when NEITHER side recorded an outer
  // session id (legacy project, no harness signal). Two unknowns
  // are not a swap — they are "no signal available yet".
  const hasSignal = (recorded !== undefined && recorded.length > 0)
    || (current !== undefined && current.length > 0);
  if (!hasSignal) {
    return {
      stale: false,
      reason: null,
      presence: result,
      currentOuterSessionId: current,
      recordedOuterSessionId: recorded
    };
  }
  if (recorded === current) {
    return {
      stale: false,
      reason: null,
      presence: result,
      currentOuterSessionId: current,
      recordedOuterSessionId: recorded
    };
  }
  return {
    stale: true,
    reason: 'outer-session-mismatch',
    presence: result,
    currentOuterSessionId: current,
    recordedOuterSessionId: recorded
  };
}

/**
 * Slice 002 (v2.15.0) — auto-clear stale presence on session
 * rotation (AC-1).
 *
 * Called from `peaks workspace init` immediately after a successful
 * `outer-session-mismatch` rotation. When the previous session's
 * presence is still on disk under the OLD outer session id,
 * clearing it prevents peaks-code Step 1 from picking up a stale
 * `mode` field that the user never explicitly chose.
 *
 * Only clears when:
 *   - the recorded outer session id does NOT match the current outer
 *     session id (i.e. the presence IS stale), AND
 *   - the recorded outer session id matches the just-rotated-out
 *     session id (i.e. we're clearing exactly the old binding, not a
 *     user-explicitly-set mode from another live outer session).
 *
 * Returns `{ cleared, reason }` so callers can surface the outcome
 * in the JSON envelope and audit log. Pure: no env-var reads, all
 * inputs are passed explicitly so the call site (init command) can
 * decide what the "rotated-out" id was.
 */
export function clearStalePresenceOnRotation(opts: {
  projectRootOverride?: string;
  currentOuterSessionId: string | undefined;
  rotatedOutSessionId: string | null;
}): { cleared: boolean; reason: string | null; recordedOuter?: string } {
  const result = readSkillPresenceFromLease(opts.projectRootOverride);
  if (result === null) {
    return { cleared: false, reason: 'no-presence' };
  }
  const recorded = result.outerSessionId;
  const current = opts.currentOuterSessionId;
  // If the recorded outer id matches the new (current) outer id,
  // this presence is NOT stale — the user just reconnected from
  // the same outer session after rotation. Leave it alone.
  if (recorded === current && recorded !== undefined) {
    return {
      cleared: false,
      reason: 'not-stale',
      ...(recorded !== undefined ? { recordedOuter: recorded } : {})
    };
  }
  // If we have a recorded outer id AND it does NOT match the
  // rotated-out session id, the user explicitly set this presence
  // from a DIFFERENT outer session that is still live. Do NOT clear
  // — would destroy user intent.
  if (
    opts.rotatedOutSessionId !== null &&
    recorded !== undefined &&
    recorded !== opts.rotatedOutSessionId
  ) {
    return {
      cleared: false,
      reason: 'recorded-by-different-outer',
      recordedOuter: recorded
    };
  }
  // Stale by outer-mismatch (either recorded === undefined and
  // current is set, or recorded !== current). Clear it.
  const cleared = clearSkillPresence(opts.projectRootOverride);
  return {
    cleared,
    reason: cleared ? 'outer-session-mismatch' : 'clear-failed',
    ...(recorded !== undefined ? { recordedOuter: recorded } : {})
  };
}

export function touchSkillHeartbeat(projectRootOverride?: string): SkillPresence | null {
  // Slice 4.0.11 statusline-sid-scoped-lease C: read from the
  // canonical sid-scoped lease projection. The legacy
  // unlink-on-session-mismatch purge is removed: the lease is
  // keyed off the bound session id, so the mismatch path cannot
  // fire (a lease under session A is never returned when the bound
  // session is B).
  const presence = readSkillPresenceFromLease(projectRootOverride);
  if (presence === null) return null;
  // Slice 4.0.11 statusline-sid-scoped-lease A: the legacy write to
  // the single-slot marker file was removed. Heartbeat refresh now
  // lives exclusively in `presence-lease-service.setPresenceLease`
  // (the canonical sid-scoped lease). This function remains as a
  // read-only back-compat shim for the 4-B / 4-C sub-slices; callers
  // still receive the in-memory `presence` (with the new
  // `lastHeartbeat` stamped) but the legacy `active-skill.json` file
  // is no longer touched. The canonical lease / presence-index
  // entries are the source of truth for heartbeat freshness.
  presence.lastHeartbeat = new Date().toISOString();
  return presence;
}

export function clearSkillPresence(projectRootOverride?: string): boolean {
  // Slice 4.0.8 (DR): `clearSkillPresence` is the compat shim for
  // `presence:clear`. Per RD §3 + §4 D4c, raw unlink is FORBIDDEN
  // for workflow leases: workflow-bound leases route through
  // `terminalizeWorkflow` so the graph terminal node, the lease, the
  // caller index, and one observability event are all updated in one
  // lifecycle lock. Ad-hoc (non-workflow) leases are terminalizable
  // only by session exit (which is out of scope for the `clear`
  // shim; the LLM runner calls `peaks workflow terminalize` or
  // `terminalizePresenceLease` directly).
  //
  // The shim still removes the legacy `active-skill.json` /
  // `.peaks/.active-skill.json` so a stale marker from a prior CLI
  // version cannot resurrect after a fresh `clear`. The canonical
  // lease + index entries are NOT touched by this shim — they
  // Slice 4.0.11 statusline-sid-scoped-lease C: the deprecated
  // single-slot presence files (`.peaks/_runtime/active-skill.json`
  // and `.peaks/.active-skill.json`) are removed. The canonical
  // sid-scoped lease projection (under
  // `.peaks/_runtime/<sid>/leases/`) is untouched here — workflow
  // leases route through `terminalizeWorkflow`, NOT this shim.
  //
  // This shim remains as a best-effort stale-file cleanup for
  // projects that still carry the deprecated single-slot file from
  // a pre-4.0.11 CLI version. After one minor release the legacy
  // paths are gone and the loop is a no-op. Returns true when a
  // stale file was actually removed.
  const projectRoot = resolveProjectRoot(projectRootOverride);
  const candidates: ReadonlyArray<string> = [
    resolve(projectRoot, '.peaks', '_runtime', 'active-skill.json'),
    resolve(projectRoot, '.peaks', '.active-skill.json')
  ];
  let cleared = false;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      unlinkSync(p);
      cleared = true;
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // best effort
    }
  }
  return cleared;
}
