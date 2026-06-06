import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory } from '../../shared/fs.js';
import { getSessionId, setCurrentSessionBinding, setSessionMeta } from '../session/session-manager.js';
import { setCurrentChangeId } from '../../shared/change-id.js';

export type WorkspaceInitOptions = {
  projectRoot: string;
  sessionId: string;
  /**
   * When true, the conflict check is skipped and the new session id is
   * written to .peaks/.session.json even if the project is already bound
   * to a different (real) session. Use only with explicit user authorization
   * — the CLI surfaces this as `--allow-session-rebind`.
   */
  allowSessionRebind?: boolean;
  /**
   * Optional change-id to bind as the active unit of work. When set,
   * `peaks workspace init` also writes a `.peaks/_runtime/current-change`
   * symlink pointing at `.peaks/<changeId>/`, so RD/QA/PRD services
   * know which `<change-id>` directory to write reviewable artifacts
   * into. The session id is still the binding for ephemeral state
   * (live sub-agent progress, spawn records).
   */
  changeId?: string;
};

export type WorkspaceInitReport = {
  sessionId: string;
  sessionRoot: string;
  created: string[];
  alreadyExisted: string[];
  bound: boolean;
  previousSessionId: string | null;
  changeId: string | null;
  changeIdAction: 'bound' | 'preserved' | 'none';
};

const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9]$/;

const PROHIBITED_SUFFIXES: ReadonlyArray<string> = ['session', 'work', 'task', 'test', 'temp', 'tmp'];

// Auto-generated session ID pattern: YYYY-MM-DD-session-<6位hex>
const AUTO_SESSION_PATTERN = /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]{6}$/;

export class InvalidSessionIdError extends Error {
  readonly code = 'INVALID_SESSION_ID';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSessionIdError';
  }
}

export class ConflictingSessionError extends Error {
  readonly code = 'CONFLICTING_SESSION';
  constructor(
    message: string,
    readonly existingSessionId: string,
    readonly requestedSessionId: string
  ) {
    super(message);
    this.name = 'ConflictingSessionError';
  }
}

export function validateSessionId(sessionId: string): void {
  // Auto-generated session IDs (YYYY-MM-DD-session-<hex>) bypass manual validation
  if (AUTO_SESSION_PATTERN.test(sessionId)) {
    return;
  }

  if (/^\d+$/.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" is numeric-only. Use the format YYYY-MM-DD-<kebab-slug> with a 2-5 word topic description.`);
  }
  if (/^\d{8}T\d{6}$/.test(sessionId) || /^\d{8}$/.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" looks like a bare timestamp. Use YYYY-MM-DD-<kebab-slug>.`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" is a bare date. Append a 2-5 word topic slug (e.g. "${sessionId}-add-user-auth").`);
  }
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new InvalidSessionIdError(`Session id "${sessionId}" must match YYYY-MM-DD-<kebab-slug>, all lowercase, dashes only.`);
  }
  const suffix = sessionId.slice(11); // strip "YYYY-MM-DD-"
  if (PROHIBITED_SUFFIXES.includes(suffix)) {
    throw new InvalidSessionIdError(`Session id suffix "${suffix}" is a generic placeholder. Use a real topic slug (e.g. "add-user-auth", "v3-indicator-model").`);
  }
}

export async function initWorkspace(options: WorkspaceInitOptions): Promise<WorkspaceInitReport> {
  validateSessionId(options.sessionId);

  // Phase 6 refactor (slice 2026-06-05-change-id-as-unit-of-work) +
  // slice 006 (2026-06-06-change-folder-simplify-and-lazy-role-subdirs):
  //   - Reviewable artifacts (rd/, qa/, prd/, txt/) live at
  //     `.peaks/<change-id>/<role>/` (tracked in git) when a change-id
  //     is given. The role subdirs are NOT pre-created — the writer
  //     (e.g. `peaks request init`, `peaks rd`) creates the parent
  //     dirs on demand via `mkdirSync(..., { recursive: true })`.
  //   - The session dir `.peaks/_runtime/<session-id>/` (gitignored)
  //     now holds ONLY the canonical `session.json` metadata. The
  //     F3-introduced `system/` subdir is gone — slice 006 removes
  //     it via `peaks workspace reconcile`; new init calls do not
  //     pre-create it.
  //   - The change-id dir is created when `--change-id` is given,
  //     but its role subdirs (prd/, qa/, rd/, sc/, txt/) are NOT
  //     pre-created either — same lazy-mkdir rule.
  //
  // The CLI accepts `--change-id <id>` to bind the change. The legacy
  // session-scoped layout (`.peaks/<session-id>/<role>/<file>`) is
  // no longer used by writes; pre-1.3.1 trees get their session
  // files migrated to the change-id dir by `peaks workspace reconcile`.

  const runtimeRoot = join(options.projectRoot, '.peaks', '_runtime');
  const sessionRoot = join(runtimeRoot, options.sessionId);
  const created: string[] = [];
  const alreadyExisted: string[] = [];

  // 1. Create the session dir (canonical location `.peaks/_runtime/<sid>/`)
  //    with NO subdirs. The session dir is gitignored; the role
  //    subdirs and the `system/` subdir are gone entirely (slice 006).
  if (await isDirectory(sessionRoot)) {
    alreadyExisted.push('.');
  } else {
    await mkdir(sessionRoot, { recursive: true });
    created.push('.');
  }
  // 1a. Write the per-session metadata file. Slice 006 makes
  //     `.peaks/_runtime/<sid>/session.json` the durable session
  //     metadata (the body's source of truth, the `peaks workspace
  //     reconcile` discovery source). The file is created on first
  //     init and refreshed on every subsequent init. Idempotent.
  setSessionMeta(options.projectRoot, options.sessionId, {});

  // 2. If a change-id is given, also create the change-id dir at
  //    `.peaks/<change-id>/` (tracked) with NO role subdirs. The
  //    role subdirs (prd/, qa/, rd/, sc/, txt/) are created on demand
  //    by the writer at the write site. When the caller did NOT
  //    specify a change-id, this step is skipped — reviewable writes
  //    for this session are then blocked until a change-id is bound
  //    (or the user re-runs init with `--change-id`). Surfaces in
  //    `changeIdAction: 'none'`.
  let resolvedChangeId: string | null = null;
  let changeIdAction: 'bound' | 'preserved' | 'none' = 'none';
  if (options.changeId !== undefined && options.changeId.length > 0) {
    resolvedChangeId = options.changeId;
    const changeDir = join(options.projectRoot, '.peaks', resolvedChangeId);
    if (await isDirectory(changeDir)) {
      alreadyExisted.push(resolvedChangeId);
    } else {
      await mkdir(changeDir, { recursive: true });
      created.push(resolvedChangeId);
    }
    // 3. Bind the change-id so RD/QA/PRD services know where to write
    //    reviewable artifacts. The binding is a symlink at
    //    `.peaks/_runtime/current-change` pointing at the change-id dir.
    setCurrentChangeId(options.projectRoot, resolvedChangeId);
    changeIdAction = 'bound';
  } else if (options.changeId !== undefined && options.changeId.length === 0) {
    // Empty string — same as undefined; treat as no change-id.
    changeIdAction = 'none';
  }

  // 4. Bind this session as the project's current one.
  //
  // Single source of truth: `peaks workspace init` is the only CLI entry point
  // that takes an explicit --session-id, so it owns the binding to .session.json.
  // Without this write, downstream commands that fall through to
  // `ensureSession()` would auto-generate a *different* id and create a second
  // session directory — the bug that confuses the LLM in peaks-solo.
  //
  // Conflict rule: if .session.json already points at a different session
  // whose directory is real (has session.json inside), the caller is starting
  // a parallel session without closing the previous one. Refuse to bind —
  // this is the "strict" mode the user picked. The user must finish or delete
  // the existing session first.
  const existingSessionId = getSessionId(options.projectRoot);
  let previousSessionId: string | null = null;
  let bound = false;
  if (existingSessionId === null) {
    // No prior binding — adopt the requested id.
    setCurrentSessionBinding(options.projectRoot, options.sessionId);
    bound = true;
  } else if (existingSessionId === options.sessionId) {
    // Already bound to the same id — idempotent.
    bound = true;
  } else {
    // Different id already bound. The existing session is "real" if its
    // directory is non-empty — that holds the user's data (rd/, qa/, ui/,
    // etc.) regardless of whether the per-session metadata file is present.
    // Refuse to rebind without explicit authorization.
    previousSessionId = existingSessionId;
    const existingSessionDir = join(runtimeRoot, existingSessionId);
    if (await isDirectory(existingSessionDir) && !options.allowSessionRebind) {
      const { readdirSync } = await import('node:fs');
      const entries = readdirSync(existingSessionDir);
      if (entries.length > 0) {
        throw new ConflictingSessionError(
          `Project is already bound to session "${existingSessionId}". ` +
            `Cannot start session "${options.sessionId}" without closing the previous one. ` +
            `Either finish/abandon the prior session first, or pass --allow-session-rebind to override.`,
          existingSessionId,
          options.sessionId
        );
      }
    }
    // Either: existing session dir is empty (true leftover, no user data),
    // or the caller explicitly authorised a rebind. Overwrite.
    setCurrentSessionBinding(options.projectRoot, options.sessionId);
    bound = true;
  }

  return {
    sessionId: options.sessionId,
    sessionRoot,
    created,
    alreadyExisted,
    bound,
    previousSessionId,
    changeId: resolvedChangeId,
    changeIdAction
  };
}
