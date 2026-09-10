/**
 * Canonical path resolvers for the `peaks web` artifact tree (slice S1, AC1).
 *
 * What is actually guaranteed here, and what is not:
 *
 *   - `sessionId` is validated against a strict slug before any `join`, so a
 *     traversing sid (`..\..\..\tmp\pwn`) cannot move the whole tree out of the
 *     project. A resolver rejects it outright.
 *   - `assertUnder` then anchors each write to a parent this module derived
 *     itself, so a traversing `dispatchId` cannot escape either.
 *
 * Both halves are needed: `assertUnder(child, parent)` takes a parent derived
 * from the same `sessionId` the child is, so on its own it can only constrain
 * the components BELOW the session dir. The sid slug check is what closes the
 * sid itself.
 *
 * Every path is derived from `getSessionDir(projectRoot, sessionId)` — with one
 * declared exception, `webContextStatePath`, which is built on the pre-existing
 * `pw-profiles/<dispatchId>` convention (`playwright-profile.ts`) and therefore
 * lands beside `web/`, not inside it.
 *
 * This is the ONLY module under `src/services/web/` that may name `.peaks`;
 * every other writer in the slice imports a resolver from here (tech-doc §7.2
 * rule 1). Shape mirrors `canonicalQaDir()`
 * (`src/services/workflow/artifact-paths.ts:55`).
 *
 * The write guard for the whole slice is `assertUnder` — it is a thin wrapper
 * on the shared, cross-platform `isInsidePath` from `src/shared/path-utils.ts`
 * (see `.peaks/memory/2026-08-04-cross-platform-path-utility-rule.md`), so the
 * sibling-prefix case (`/proj2` vs `/proj`) is rejected by construction.
 */
import { resolve } from 'node:path';
import { join } from 'node:path';

import { isInsidePath } from '../../shared/path-utils.js';
import { getSessionDir } from '../session/getSessionDir.js';
import { playwrightProfilePaths } from '../worktree/playwright-profile.js';

/** Sub-directory of the session dir that owns every `peaks web` artifact. */
export const WEB_SUBDIR = 'web';

/** Sub-directory of the session dir that owns the per-dispatch storage state. */
export const WEB_PROFILES_SUBDIR = 'pw-profiles';

/**
 * A session id is a single path component. Anything else — a separator, `..`,
 * or `.` — would let the value that names the session also relocate it.
 */
const SESSION_ID_SLUG_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Reject a `sessionId` that is not a single, non-traversing path component.
 *
 * This is the check `assertUnder` structurally cannot make (see the module
 * docstring): the guard's child and parent both descend from `sessionId`, so a
 * traversing sid moves them together and the containment test still passes.
 */
function assertValidSessionId(sessionId: string): void {
  if (sessionId === '.' || sessionId === '..' || !SESSION_ID_SLUG_RE.test(sessionId)) {
    throw new Error(
      `WEB_INVALID_SESSION_ID: ${JSON.stringify(sessionId)} is not a single path component`
    );
  }
}

/** `<root>/.peaks/_runtime/<sid>/web/` — the root of every web artifact. */
export function webDir(projectRoot: string, sessionId: string): string {
  assertValidSessionId(sessionId);
  return join(getSessionDir(projectRoot, sessionId), WEB_SUBDIR);
}

/**
 * `<root>/.peaks/_runtime/<sid>/pw-profiles/` — the per-dispatch storage-state
 * root. A SIBLING of `web/`, which is why the guard for `webContextStatePath`
 * must use this resolver and never `webDir` (getting that wrong threw
 * `WEB_PATH_ESCAPE` for every dispatch).
 */
export function webProfilesDir(projectRoot: string, sessionId: string): string {
  assertValidSessionId(sessionId);
  return join(getSessionDir(projectRoot, sessionId), WEB_PROFILES_SUBDIR);
}

/** `<root>/.peaks/_runtime/<sid>/web/daemon/` — daemon info, lock, and log. */
export function webDaemonDir(projectRoot: string, sessionId: string): string {
  return join(webDir(projectRoot, sessionId), 'daemon');
}

/**
 * `<root>/.peaks/_runtime/<sid>/web/shot-<ts>.png`.
 * `<ts>` is `YYYYMMDDTHHMMSSmmmZ` — no colons, so the name is Windows-safe
 * (tech-doc §7.1).
 */
export function webShotPath(projectRoot: string, sessionId: string, ts: string): string {
  return join(webDir(projectRoot, sessionId), `shot-${ts}.png`);
}

/** `<root>/.peaks/_runtime/<sid>/web/daemon/daemon.json`. */
export function webDaemonInfoPath(projectRoot: string, sessionId: string): string {
  return join(webDaemonDir(projectRoot, sessionId), 'daemon.json');
}

/** `<root>/.peaks/_runtime/<sid>/web/daemon/daemon.lock` — the cold-start lock. */
export function webSpawnLockPath(projectRoot: string, sessionId: string): string {
  return join(webDaemonDir(projectRoot, sessionId), 'daemon.lock');
}

/** `<root>/.peaks/_runtime/<sid>/web/install.lock` — the chromium install lock. */
export function webInstallLockPath(projectRoot: string, sessionId: string): string {
  return join(webDir(projectRoot, sessionId), 'install.lock');
}

/** `<root>/.peaks/_runtime/<sid>/web/daemon/daemon.log` — daemon stdout/stderr. */
export function webLogPath(projectRoot: string, sessionId: string): string {
  return join(webDaemonDir(projectRoot, sessionId), 'daemon.log');
}

/**
 * `<root>/.peaks/_runtime/<sid>/pw-profiles/<dispatchId>/storageState.json`.
 *
 * The DIRECTORY convention is the existing `pw-profiles/<dispatchId>` one
 * (`src/services/worktree/playwright-profile.ts:21`), reused rather than
 * re-implemented. The FILE inside it is a Playwright `storageState.json`, not
 * a Chromium `userDataDir`: orchestrator decision C1 — a persistent context
 * per dispatch would spawn one browser process per dispatch and violate Q8.
 *
 * Note the sibling relationship: this path is NOT under `webDir(...)`. The
 * guard parent for it is `webProfilesDir(...)`.
 */
export function webContextStatePath(
  projectRoot: string,
  sessionId: string,
  dispatchId: string,
): string {
  assertValidSessionId(sessionId);
  const { userDataDir } = playwrightProfilePaths({ projectRoot, sessionId, dispatchId });
  return join(userDataDir, 'storageState.json');
}

/**
 * Throw unless `child` resolves to `parent` or to a path strictly inside it.
 *
 * The single write guard for the slice: every write site calls this before
 * touching disk, and a violation surfaces as `WEB_PATH_ESCAPE` in a `fail()`
 * envelope. Uses the shared `isInsidePath` so a bare `startsWith` sibling-prefix
 * collision (`/proj2` vs `/proj`) cannot pass.
 */
export function assertUnder(child: string, parent: string): void {
  if (!isInsidePath(resolve(child), resolve(parent))) {
    throw new Error(`WEB_PATH_ESCAPE: ${child} is not under ${parent}`);
  }
}
