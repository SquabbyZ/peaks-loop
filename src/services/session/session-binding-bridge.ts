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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { initWorkspace } from '../workspace/workspace-service.js';
import { projectRootsMatch, stableRealPath } from '../../shared/path-utils.js';
import {
  getSessionId,
  getSessionIdCanonical,
  getSessionMeta,
  rotateSessionBinding,
  setSessionMeta
} from './session-manager.js';

// --- Lower-level helpers the bridge needs (moved verbatim) ---

const SESSION_FILE = join('_runtime', 'session.json');
const LEGACY_SESSION_FILE = '.session.json';
const META_FILE = 'session.json';
// Slice 2026-08-06-session-outer-cache: per-project file cache for the
// outer (Claude Code / Trae / IDE) session id. Written by the
// SessionStart hook via `peaks outer-cache write` so that peaks CLI
// sub-processes (which do NOT inherit CLAUDE_CODE_SESSION_ID) can still
// resolve the current outer session. Lives under the gitignored
// `.peaks/_runtime/` tree, so no .gitignore change is required.
const OUTER_SESSION_CACHE_FILE = join('_runtime', '.outer-session-cache.json');

function getLegacySessionFilePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', LEGACY_SESSION_FILE);
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
    if (
      data.sessionId &&
      typeof data.projectRoot === 'string' &&
      projectRootsMatch(data.projectRoot, projectRoot)
    ) {
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
    if (
      data.sessionId &&
      typeof data.projectRoot === 'string' &&
      projectRootsMatch(data.projectRoot, projectRoot)
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
  let canonicalProjectRoot: string;
  try {
    canonicalProjectRoot = stableRealPath(info.projectRoot);
  } catch {
    canonicalProjectRoot = info.projectRoot;
  }
  const canonicalInfo = { ...info, projectRoot: canonicalProjectRoot };
  writeFileSync(sessionFile, JSON.stringify(canonicalInfo, null, 2), 'utf8');
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

// Slice 2026-08-06-session-cacde8-A.3: module-scoped state populated on
// every non-throw `getCurrentOuterSessionId` call. The 4th rotation
// guard in `ensureSessionWithRotation` short-circuits when both
// `currentOuterSessionId` and `boundOuter` equal the last-resolved
// value in this process — a common case for long-running presence-
// lease writers that re-resolve the outer session id within the same
// process. Each CLI invocation is a fresh process, so this guard is
// per-invocation and cannot leak across processes.
let lastResolvedOuter: { value: string | undefined; resolvedAt: number } | null = null;

function getCurrentOuterSessionId(projectRoot?: string): string | undefined {
  let resolved: string | undefined;
  const peaks = process.env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) {
    resolved = peaks;
  } else {
    const claude = process.env.CLAUDE_CODE_SESSION_ID;
    if (typeof claude === 'string' && claude.length > 0) {
      resolved = claude;
    } else {
      // Slice 2026-08-06-session-outer-cache (G1): when the peaks CLI runs
      // as a sub-process of Claude Code (or any IDE that does not export
      // CLAUDE_CODE_SESSION_ID into the child env), the env vars above are
      // undefined. Fall back to the per-project file cache written by the
      // SessionStart hook via `peaks outer-cache write`. The file lives
      // under `.peaks/_runtime/` (gitignored) so no .gitignore change is
      // required. Any IO error or non-string `outerSessionId` field is
      // treated as a cache miss — never throw.
      if (projectRoot !== undefined) {
        const cachePath = join(projectRoot, '.peaks', OUTER_SESSION_CACHE_FILE);
        if (existsSync(cachePath)) {
          try {
            const raw = readFileSync(cachePath, 'utf8');
            const parsed: unknown = JSON.parse(raw);
            if (
              parsed !== null &&
              typeof parsed === 'object' &&
              typeof (parsed as { outerSessionId?: unknown }).outerSessionId === 'string' &&
              ((parsed as { outerSessionId: string }).outerSessionId).length > 0
            ) {
              resolved = (parsed as { outerSessionId: string }).outerSessionId;
            }
          } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
            // fall through — file missing / malformed JSON / IO error → undefined
          }
        }
      }
    }
  }
  // Record the resolved value on every non-throw call (env hit,
  // cache hit, or undefined fallback). The 4th rotation guard reads
  // this field to short-circuit same-process re-resolves.
  lastResolvedOuter = { value: resolved, resolvedAt: Date.now() };
  return resolved;
}

/**
 * Test-only seam: reset the module-scoped `lastResolvedOuter` so
 * individual tests start with a clean slate. NOT exported as part
 * of the public API; marked TODO(g2) for the v2.14.0 grace window.
 */
export function _resetLastResolvedOuterForTest(): void {
  lastResolvedOuter = null;
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
    // Slice 2026-08-06-session-outer-cache (G3 / AC8-AC11): on every
    // already-bound invocation, stamp the current outer-session-id
    // onto the bound session's meta so the on-disk
    // `.peaks/_runtime/<sid>/session.json` always reflects the latest
    // outer signal — not a stale value captured at session creation
    // time. `setSessionMeta` is read-modify-write: every other field
    // (title / skill / mode / gate / createdAt / lastActivity) is
    // preserved. `getCurrentOuterSessionId(projectRoot)` reads env
    // → file-cache → undefined; an undefined value is NOT written,
    // so the previously-stamped outer (if any) survives.
    const outerSessionId = getCurrentOuterSessionId(projectRoot);
    if (outerSessionId !== undefined) {
      setSessionMeta(projectRoot, existing.sessionId, { outerSessionId });
    }
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

  // Initialize session metadata inside the session directory.
  // Slice 2026-08-06-session-outer-cache (G1): pass `projectRoot` so
  // the env → file-cache → undefined resolution chain also reads the
  // SessionStart-written cache on first bind.
  const outerSessionId = getCurrentOuterSessionId(projectRoot);
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
 * Rotation is suppressed in four cases (all false-positive guards):
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
 *   4. Slice 2026-08-06-session-cacde8-A.3: same-process re-resolve —
 *      `lastResolvedOuter.value` was already set to `currentOuterSessionId`
 *      in this process and `boundOuter` equals that same value. Long-
 *      running presence-lease writers that re-resolve within a single
 *      process must not rotate on every CLI heartbeat. The module-scoped
 *      state is per-process; each fresh CLI invocation starts with
 *      `lastResolvedOuter === null`, so this guard cannot leak across
 *      processes. The 4th guard ONLY fires when `lastResolvedOuter.value`
 *      is a defined string (an undefined last-resolved value still
 *      falls through to the legacy comparison path).
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
  // Slice 2026-08-06-session-outer-cache (G1): pass `projectRoot` so
  // the rotation-decision comparison sees the SessionStart cache
  // when the env vars are unset (sub-process / nested invocation).
  const currentOuterSessionId = getCurrentOuterSessionId(projectRoot);

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
    // Slice 2026-08-06-session-cacde8-A.3: 4th guard — same-process
    // re-resolve. When `lastResolvedOuter` was already set to the
    // current outer AND the bound session's recorded outer equals
    // the same value, the rotation decision was already evaluated
    // in this process. Without this short-circuit, a long-running
    // presence-lease writer would rotate on every heartbeat within
    // the same process. Skipping only fires when `lastResolvedOuter`
    // is a defined string (undefined last-resolved values fall
    // through to the legacy comparison path so the first-ever
    // resolve still works).
    if (
      lastResolvedOuter?.value !== undefined &&
      lastResolvedOuter.value === currentOuterSessionId &&
      lastResolvedOuter.value === boundOuter
    ) {
      const sessionId = await ensureSession(projectRoot);
      return {
        sessionId,
        previousSessionId: null,
        rotationReason: null
      };
    }
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
