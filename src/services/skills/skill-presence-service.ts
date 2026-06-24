import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findProjectRoot } from '../config/config-safety.js';
import { ensureMemoryBootstrap } from '../memory/project-memory-service.js';
import { getSessionMeta } from '../session/session-manager.js';

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
   * `setSkillPresence`. `peaks-solo`'s Step 0 used to read this
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

// As of slice 2026-06-05-peaks-runtime-layer the orchestrator's
// active-skill marker lives under `.peaks/_runtime/active-skill.json`.
// The legacy `.peaks/.active-skill.json` path is preserved as a
// read-only fallback for one minor release so older CLI versions (or
// trees that have not been migrated by `peaks workspace reconcile`)
// keep working without a forced re-init.
const PRESENCE_FILE = join('.peaks', '_runtime', 'active-skill.json');
const PRESENCE_FILE_LEGACY = '.peaks/.active-skill.json';
const SESSION_FILE = join('.peaks', '_runtime', 'session.json');
const SESSION_FILE_LEGACY = '.peaks/.session.json';

function resolveProjectRoot(override?: string): string {
  if (override) return resolve(override);
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

function resolvePresencePath(projectRootOverride?: string): string {
  return resolve(resolveProjectRoot(projectRootOverride), PRESENCE_FILE);
}

/**
 * Back-compat read for the active-skill marker. Prefers the new
 * canonical `.peaks/_runtime/active-skill.json`; falls back to the
 * legacy `.peaks/.active-skill.json` for one minor release.
 *
 * Returns the parsed SkillPresence object, or null when neither
 * file is present / valid. The legacy file is never written by
 * current code — only the new path receives writes.
 */
function readSkillPresenceBackCompat(projectRootOverride?: string): { presence: SkillPresence; path: string } | null {
  const presencePath = resolvePresencePath(projectRootOverride);
  const legacyPath = resolve(resolveProjectRoot(projectRootOverride), PRESENCE_FILE_LEGACY);
  const pathToRead = existsSync(presencePath) ? presencePath : legacyPath;
  if (!existsSync(pathToRead)) return null;
  try {
    const raw = readFileSync(pathToRead, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skill !== 'string' || parsed.skill.length === 0) {
      return null;
    }
    return { presence: parsed as SkillPresence, path: pathToRead };
  } catch {
    return null;
  }
}

function getCurrentSessionId(projectRootOverride?: string): string | null {
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
  } catch {
    return null;
  }
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
 * promise — `peaks-solo`'s Step 0 no longer needs to surface an
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
  const result = readSkillPresenceBackCompat(projectRootOverride);
  if (result === null) return undefined;
  const parsed = result.presence as { outerSessionId?: unknown; claudeSessionId?: unknown };
  if (typeof parsed.outerSessionId === 'string' && parsed.outerSessionId.length > 0) {
    return parsed.outerSessionId;
  }
  // Legacy field name. Honour it on the read side so v1.2.x
  // presence files do not show as a false mismatch.
  if (typeof parsed.claudeSessionId === 'string' && parsed.claudeSessionId.length > 0) {
    return parsed.claudeSessionId;
  }
  return undefined;
}

export function exportSkillPresence(projectRootOverride?: string): string {
  return resolvePresencePath(projectRootOverride);
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
  const validatedMode = mode && isSkillPresenceMode(mode) ? mode : undefined;
  const sessionId = getCurrentSessionId(projectRootOverride);
  const outerSessionId = getCurrentOuterSessionId();
  const previousOuterSessionId = getPreviousOuterSessionId(projectRootOverride);

  const now = new Date().toISOString();
  const presence: SkillPresence = {
    skill,
    ...(validatedMode ? { mode: validatedMode } : {}),
    ...(gate ? { gate } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(outerSessionId ? { outerSessionId } : {}),
    setAt: now,
    lastHeartbeat: now
  };

  // Outer-session-mismatch detection. Fires only when:
  //   (a) we have a *current* outer session id (i.e. some harness is
  //       driving peaks right now — PEAKS_OUTER_SESSION_ID or
  //       CLAUDE_CODE_SESSION_ID is set), AND
  //   (b) the previous presence write recorded a *different* outer
  //       session id (or none), AND
  //   (c) the current peaks session is bound to a different outer
  //       session id (or no outer session id is bound).
  //
  // The combination of (b) and (c) is what tells us "this is a
  // genuine outer-session swap, not a transient env-var change".
  // When only (b) fires (current bound session was started in this
  // same outer session), no mismatch is reported — that is the
  // common reconnect case.
  if (outerSessionId !== undefined) {
    const boundOuterSessionId = getBoundOuterSessionId(projectRootOverride);
    const outerChanged = previousOuterSessionId !== outerSessionId;
    const boundOuterMatches = boundOuterSessionId === outerSessionId;
    // Suppress the false-positive where neither side ever recorded
    // an outer session id. Two unknowns are not a swap — they are
    // simply "no outer-session signal available yet". Only report
    // a mismatch when at least one side has a recorded outer id.
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

  const presencePath = resolvePresencePath(projectRootOverride);
  const presenceDir = dirname(presencePath);
  if (!existsSync(presenceDir)) {
    mkdirSync(presenceDir, { recursive: true });
  }

  writeFileSync(presencePath, JSON.stringify(presence, null, 2), 'utf8');

  // Skill-activation side effect: ensure `.peaks/memory/` and a full-shape
  // empty `index.json` exist for the project. This is the user-facing fix
  // for "stock projects never get a memory directory or index". Every peaks
  // skill starts with `peaks skill presence:set peaks-<role>`, so doing the
  // bootstrap here means the very first skill invocation in a fresh project
  // (or in a stock project that pre-dates the memory layer) brings the
  // memory store into existence. The helper is fail-open, so a failure here
  // does not block presence from being written.
  const projectRoot = resolveProjectRoot(projectRootOverride);
  ensureMemoryBootstrap(projectRoot);

  return presence;
}

export function getSkillPresence(projectRootOverride?: string): SkillPresence | null {
  const result = readSkillPresenceBackCompat(projectRootOverride);
  if (result === null) return null;
  const { presence, path: presencePath } = result;
  if (typeof presence.sessionId === 'string' && presence.sessionId.length > 0) {
    const currentSessionId = getCurrentSessionId(projectRootOverride);
    if (currentSessionId && presence.sessionId !== currentSessionId) {
      try {
        unlinkSync(presencePath);
      } catch {
        // best effort
      }
      return null;
    }
  }
  return presence;
}

export function touchSkillHeartbeat(projectRootOverride?: string): SkillPresence | null {
  const result = readSkillPresenceBackCompat(projectRootOverride);
  if (result === null) return null;
  const { presence, path: presencePath } = result;
  if (typeof presence.sessionId === 'string' && presence.sessionId.length > 0) {
    const currentSessionId = getCurrentSessionId(projectRootOverride);
    if (currentSessionId && presence.sessionId !== currentSessionId) {
      try {
        unlinkSync(presencePath);
      } catch {
        // best effort
      }
      return null;
    }
  }
  presence.lastHeartbeat = new Date().toISOString();
  writeFileSync(presencePath, JSON.stringify(presence, null, 2), 'utf8');
  return presence;
}

export function clearSkillPresence(projectRootOverride?: string): boolean {
  // Clear both the new canonical path and the legacy path, so a stale
  // presence marker from a prior CLI version cannot resurrect after
  // a fresh `clear`.
  const presencePath = resolvePresencePath(projectRootOverride);
  const legacyPath = resolve(resolveProjectRoot(projectRootOverride), PRESENCE_FILE_LEGACY);
  let cleared = false;
  for (const p of [presencePath, legacyPath]) {
    if (!existsSync(p)) continue;
    try {
      unlinkSync(p);
      cleared = true;
    } catch {
      // best effort
    }
  }
  return cleared;
}
