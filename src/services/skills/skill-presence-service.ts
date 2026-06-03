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
   * The field is informational only — `setSkillPresence` does not
   * roll a new session on its own. peaks-solo's Step 0 reads the
   * field off the presence file and turns it into an
   * AskUserQuestion: "Start a new peaks session / Keep this one".
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

const PRESENCE_FILE = '.peaks/.active-skill.json';
const SESSION_FILE = '.peaks/.session.json';

function resolveProjectRoot(override?: string): string {
  if (override) return resolve(override);
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

function resolvePresencePath(projectRootOverride?: string): string {
  return resolve(resolveProjectRoot(projectRootOverride), PRESENCE_FILE);
}

function getCurrentSessionId(projectRootOverride?: string): string | null {
  const sessionPath = resolve(resolveProjectRoot(projectRootOverride), SESSION_FILE);
  if (!existsSync(sessionPath)) return null;
  try {
    const data = JSON.parse(readFileSync(sessionPath, 'utf8'));
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
 * `.peaks/<sid>/session.json` by `ensureSession`/`initWorkspace`. This
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
 * straight off `.peaks/.active-skill.json` *before* we overwrite it.
 * Used to detect "the LLM just opened a fresh outer session" — if
 * the previously-recorded outer session id differs from the one we
 * are about to stamp, the user probably closed the previous outer
 * session and is now driving peaks from a new one. We do NOT auto-
 * roll a new peaks session (that is destructive — it would leave
 * the in-flight session with no LLM watching it). Instead we emit
 * a structured `outerSessionMismatch` field on the presence
 * envelope, and peaks-solo's Step 0 turns that into an
 * AskUserQuestion. The user can opt to keep the current session
 * (most common when the swap is a no-op reconnect) or to roll a
 * fresh session (when the new outer session is genuinely a new
 * task).
 */
function getPreviousOuterSessionId(projectRootOverride?: string): string | undefined {
  const presencePath = resolvePresencePath(projectRootOverride);
  if (!existsSync(presencePath)) return undefined;
  try {
    const raw = readFileSync(presencePath, 'utf8');
    const parsed = JSON.parse(raw) as { outerSessionId?: unknown; claudeSessionId?: unknown };
    if (typeof parsed.outerSessionId === 'string' && parsed.outerSessionId.length > 0) {
      return parsed.outerSessionId;
    }
    // Legacy field name. Honour it on the read side so v1.2.x
    // presence files do not show as a false mismatch.
    if (typeof parsed.claudeSessionId === 'string' && parsed.claudeSessionId.length > 0) {
      return parsed.claudeSessionId;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function exportSkillPresence(projectRootOverride?: string): string {
  return resolvePresencePath(projectRootOverride);
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
  const presencePath = resolvePresencePath(projectRootOverride);
  if (!existsSync(presencePath)) {
    return null;
  }

  try {
    const raw = readFileSync(presencePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skill !== 'string' || parsed.skill.length === 0) {
      return null;
    }

    if (typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      const currentSessionId = getCurrentSessionId(projectRootOverride);
      if (currentSessionId && parsed.sessionId !== currentSessionId) {
        unlinkSync(presencePath);
        return null;
      }
    }

    return parsed as SkillPresence;
  } catch {
    return null;
  }
}

export function touchSkillHeartbeat(projectRootOverride?: string): SkillPresence | null {
  const presencePath = resolvePresencePath(projectRootOverride);
  if (!existsSync(presencePath)) {
    return null;
  }

  try {
    const raw = readFileSync(presencePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.skill !== 'string' || parsed.skill.length === 0) {
      return null;
    }

    if (typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) {
      const currentSessionId = getCurrentSessionId(projectRootOverride);
      if (currentSessionId && parsed.sessionId !== currentSessionId) {
        unlinkSync(presencePath);
        return null;
      }
    }

    parsed.lastHeartbeat = new Date().toISOString();
    writeFileSync(presencePath, JSON.stringify(parsed, null, 2), 'utf8');
    return parsed as SkillPresence;
  } catch {
    return null;
  }
}

export function clearSkillPresence(projectRootOverride?: string): boolean {
  const presencePath = resolvePresencePath(projectRootOverride);
  if (!existsSync(presencePath)) {
    return false;
  }

  try {
    unlinkSync(presencePath);
    return true;
  } catch {
    return false;
  }
}
