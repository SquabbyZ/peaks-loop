/**
 * Session × binding-store × outer-session bridge layer.
 *
 * v2.18.0: extracted from `session-manager.ts` to keep that file under
 * the Karpathy 800 LOC cap while the binding-store D2 sub-slice work
 * adds ~65 LOC over the next slice. The 4 blocks that moved here are
 * the natural "bridge" concern: the lower-level session-manager
 * primitives (read / write the project-level session binding, get /
 * rotate, etc.) are wired up here into the user-facing `ensureSession`
 * and the outer-session-aware `ensureSessionWithRotation`.
 *
 * `session-manager.ts` re-exports the two functions and the two result
 * types so the 5 external callers (`request-artifact-service.ts`,
 * `upgrade-commands.ts`, `init-command.ts`, plus 2 test files) do NOT
 * need to change their import path. The re-export shim is the only
 * added code in `session-manager.ts`.
 *
 * Body of every function moved verbatim per Karpathy #3 (Surgical
 * Changes). No behavior change. The bridge adds nothing of its own.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { initWorkspace } from '../workspace/workspace-service.js';
import {
  getSessionId,
  getSessionIdCanonical,
  getSessionMeta,
  rotateSessionBinding
} from './session-manager.js';

// --- Lower-level helpers the bridge needs (moved verbatim) ---

const SESSION_FILE = join('_runtime', 'session.json');
const LEGACY_SESSION_FILE = '.session.json';
const META_FILE = 'session.json';

function getLegacySessionFilePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', LEGACY_SESSION_FILE);
}

function canonicalizeProjectRoot(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function resolveStoredAgainstCaller(stored: string, caller: string): string {
  const resolved = resolve(caller, stored);
  return canonicalizeProjectRoot(resolved);
}

function generateSessionId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const date = `${year}-${month}-${day}`;
  const random = randomBytes(3).toString('hex');
  return `${date}-session-${random}`;
}

function getSessionFilePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', SESSION_FILE);
}

function readSessionFile(projectRoot: string): { sessionId: string; createdAt: string; projectRoot: string } | null {
  const sessionFile = getSessionFilePath(projectRoot);
  const legacyFile = getLegacySessionFilePath(projectRoot);
  const pathToRead = existsSync(sessionFile) ? sessionFile : legacyFile;
  if (!existsSync(pathToRead)) return null;

  try {
    const data = JSON.parse(readFileSync(pathToRead, 'utf8'));
    if (data.sessionId && data.projectRoot === projectRoot) {
      return data as { sessionId: string; createdAt: string; projectRoot: string };
    }
    return null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function readSessionFileCanonical(projectRoot: string): { sessionId: string; createdAt: string; projectRoot: string } | null {
  const sessionFile = getSessionFilePath(projectRoot);
  const legacyFile = getLegacySessionFilePath(projectRoot);
  const pathToRead = existsSync(sessionFile) ? sessionFile : legacyFile;
  if (!existsSync(pathToRead)) return null;

  try {
    const data = JSON.parse(readFileSync(pathToRead, 'utf8'));
    const storedRaw = typeof data.projectRoot === 'string' ? data.projectRoot : null;
    if (
      data.sessionId &&
      storedRaw !== null &&
      resolveStoredAgainstCaller(storedRaw, projectRoot) === resolveStoredAgainstCaller(projectRoot, projectRoot)
    ) {
      return data as { sessionId: string; createdAt: string; projectRoot: string };
    }
    return null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function writeSessionFile(projectRoot: string, info: { sessionId: string; createdAt: string; projectRoot: string }): void {
  const sessionFile = getSessionFilePath(projectRoot);
  const dir = dirname(sessionFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(sessionFile, JSON.stringify(info, null, 2), 'utf8');
}

function getMetaFilePath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, META_FILE);
}

function readSessionMeta(
  projectRoot: string,
  sessionId: string
): { sessionId: string; projectRoot: string; createdAt: string; outerSessionId?: string; [k: string]: unknown } | null {
  const metaPath = getMetaFilePath(projectRoot, sessionId);
  if (!existsSync(metaPath)) return null;

  try {
    const raw = readFileSync(metaPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.sessionId !== 'string' || parsed.sessionId.length === 0) {
      return null;
    }
    return parsed as { sessionId: string; projectRoot: string; createdAt: string; outerSessionId?: string; [k: string]: unknown };
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function writeSessionMeta(
  projectRoot: string,
  sessionId: string,
  meta: { sessionId: string; projectRoot: string; createdAt: string; outerSessionId?: string; [k: string]: unknown }
): void {
  const metaPath = getMetaFilePath(projectRoot, sessionId);
  const metaDir = dirname(metaPath);
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

function getCurrentOuterSessionId(): string | undefined {
  const peaks = process.env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) return peaks;
  const claude = process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof claude === 'string' && claude.length > 0) return claude;
  return undefined;
}

// --- Public types and functions (moved verbatim) ---

export type EnsureSessionOptions = {
  /**
   * When `true`, suppress the outer-session-mismatch auto-rotation.
   * The caller wants today's "stamp the field, do not rotate" behaviour
   * even when the outer session id has changed. Used by
   * `peaks workspace init --no-rotate-on-outer-mismatch`.
   */
  skipRotateOnOuterMismatch?: boolean;
};

/**
 * Result of `ensureSessionWithRotation`. When the bound session was
 * rotated because the outer session id had changed, `previousSessionId`
 * is the id of the unbound session and `rotationReason` is the structured
 * reason code the CLI surfaces in its JSON envelope.
 */
export type EnsureSessionResult = {
  sessionId: string;
  previousSessionId: string | null;
  rotationReason: 'outer-session-mismatch' | null;
};

export async function ensureSession(projectRoot: string): Promise<string> {
  const existing = readSessionFile(projectRoot);
  if (existing) {
    return existing.sessionId;
  }

  // Slice 007 — sub-agent session sharing. When the strict-equality
  // read returns null (e.g. the binding was written with the relative
  // form "." from inside the project dir, but the caller passes the
  // absolute realpath), fall through to the canonical-fallback read.
  // `ensureSession` is a session-creating primitive — its caller
  // wants the existing binding if one exists, even if the projectRoot
  // forms differ. Without this fallback, a sub-agent that anchors via
  // `cd <repo> && peaks skill presence:set` and then runs
  // `peaks request init --project <abs-path>` would auto-generate a
  // new session and create an orphan dir.
  //
  // The strict-equality read is preserved for modules that depend on
  // the "no session bound" code path. The canonical-fallback is opt-in
  // for `ensureSession` only.
  const canonical = getSessionIdCanonical(projectRoot);
  if (canonical !== null) {
    return canonical;
  }

  const sessionId = generateSessionId();
  const now = new Date().toISOString();
  const info = {
    sessionId,
    createdAt: now,
    projectRoot
  };

  writeSessionFile(projectRoot, info);

  await initWorkspace({ projectRoot, sessionId });

  // Initialize session metadata inside the session directory
  const outerSessionId = getCurrentOuterSessionId();
  writeSessionMeta(projectRoot, sessionId, {
    sessionId,
    projectRoot,
    createdAt: now,
    ...(outerSessionId !== undefined ? { outerSessionId } : {})
  });

  return sessionId;
}

/**
 * Outer-session-aware wrapper around `ensureSession`.
 *
 * Slice 018 (auto-roll on outer-mismatch). When the current outer
 * session id (sourced from `PEAKS_OUTER_SESSION_ID` with
 * `CLAUDE_CODE_SESSION_ID` as the Claude-Code fallback) differs from
 * the outer session id recorded on the *bound* peaks session's
 * `.peaks/_runtime/<sid>/session.json`, the project-level session
 * binding is rotated before `ensureSession` is called. The old
 * session dir is preserved on disk (data is never wiped) — only the
 * binding changes — and the rotation is surfaced in the return value
 * so the CLI can include it in the JSON envelope.
 *
 * Rotation is suppressed in three cases (all false-positive guards):
 *
 *   1. The current outer session id is undefined (no env var set) —
 *      there is no signal to compare against, defaulting to "do not
 *      rotate" avoids orphaning the session.
 *   2. The bound session has no recorded `outerSessionId` (legacy
 *      session predating the outer-session contract) — there is no
 *      signal on the other side either.
 *   3. The bound session's recorded outer session id matches the
 *      current one (reconnect within the same Claude session) — this
 *      is the common case, not a swap.
 *
 * When `options.skipRotateOnOuterMismatch === true`, the rotation
 * check is short-circuited and the binding is preserved (opt-out for
 * `peaks workspace init --no-rotate-on-outer-mismatch`). The wrapper
 * still delegates to `ensureSession` so the caller gets the existing
 * binding on a reconnect and a fresh id on a first run.
 *
 * Existing public surface is preserved: `ensureSession` is unchanged.
 * This wrapper is the new entry point the CLI uses.
 */
export async function ensureSessionWithRotation(
  projectRoot: string,
  options?: EnsureSessionOptions
): Promise<EnsureSessionResult> {
  const skipRotate = options?.skipRotateOnOuterMismatch === true;
  const currentOuterSessionId = getCurrentOuterSessionId();

  // Compute the rotation decision up front. We only rotate when ALL
  // three pre-conditions hold: (a) the current outer session id is
  // defined, (b) the bound session has a recorded outer session id,
  // and (c) the two differ. The bound session id is the *first*
  // read so we can use it both for the comparison and for the
  // rotation result.
  const boundSessionId = getSessionId(projectRoot);
  let rotated: string | null = null;
  let rotationReason: 'outer-session-mismatch' | null = null;
  if (boundSessionId !== null && currentOuterSessionId !== undefined) {
    const boundMeta = getSessionMeta(projectRoot, boundSessionId);
    const boundOuter = boundMeta?.outerSessionId;
    if (
      typeof boundOuter === 'string' &&
      boundOuter.length > 0 &&
      boundOuter !== currentOuterSessionId &&
      !skipRotate
    ) {
      rotated = rotateSessionBinding(projectRoot);
      rotationReason = 'outer-session-mismatch';
    }
  }

  // After the rotation, `ensureSession` will either reuse the
  // canonical-fallback binding (when one still exists, e.g. a sibling
  // projectRoot form) or auto-generate a fresh id. We pass through.
  void rotated; // rotated is the *previous* session id; preserved for the caller via the return value
  const sessionId = await ensureSession(projectRoot);

  return {
    sessionId,
    previousSessionId: rotated,
    rotationReason
  };
}
