import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDirectory } from '../../shared/fs.js';
import { getSessionId, setCurrentSessionBinding, setSessionMeta } from '../session/session-manager.js';
import { setCurrentChangeId } from '../../shared/change-id.js';
import {
  buildClaudeSettingsLocalJson,
  CLAUDE_SETTINGS_LOCAL_FILENAME,
  templateContentMatches
} from './claude-settings-template.js';
import {
  detectMissingProjectStandards,
  type MissingProjectStandardsDiagnostic
} from '../standards/missing-standards-detector.js';
import {
  detectLanguage,
  executeProjectStandardsInit,
  type StandardsLanguage
} from '../standards/project-standards-service.js';

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
  /**
   * Slice 2.0.1-bug3-fact-forcing-bypass: opt out of writing the
   * consumer-project `.claude/settings.local.json` file. Default
   * (`false`) writes the file so the [Fact-Forcing Gate] is bypassed
   * for tool calls inside `.peaks/**`. The CLI surfaces this as
   * `--no-claude-hooks`.
   */
  noClaudeHooks?: boolean;
  /**
   * Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7): opt-in flag for
   * auto-applying `peaks standards init` when the consumer project's
   * `.claude/rules/` is missing or empty. Default (`false`) only emits
   * the diagnostic; set to `true` to also scaffold the rules tree via
   * `executeProjectStandardsInit({ projectRoot, apply: true })`. The
   * CLI surfaces this as `--init-standards`.
   */
  initStandards?: boolean;
  /**
   * Optional language override for the standards scaffold. When unset,
   * `detectLanguage(projectRoot)` is used (looks for tsconfig.json /
   * package.json / pyproject.toml / go.mod / Cargo.toml). Pass this to
   * force a specific language for the auto-apply path.
   */
  language?: StandardsLanguage;
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
  /**
   * Slice 2.0.1-bug3-fact-forcing-bypass: what the consumer-project
   * `.claude/settings.local.json` materialization did this call.
   *   - written:        the file was freshly written
   *   - refreshed:      the file already existed and was rewritten to
   *                     match the current peaks-cli release's template
   *   - already-current: the file already matched the template; no
   *                     rewrite needed
   *   - skipped:        the caller passed noClaudeHooks=true
   * The LLM and the user both see this in the JSON envelope so they
   * can decide whether the bypass is in effect.
   *
   * Slice 2026-06-13-selfheal-claude-settings-template: adds the
   * `offlineTemplate` sub-field, which describes the self-heal action
   * taken on the offline `.peaks/.claude-settings-template.json` copy.
   * The offline copy is ALWAYS written/checked (regardless of
   * noClaudeHooks) because it is the manual-recovery anchor — see
   * `skills/peaks-solo/references/anchoring-and-session-info.md`.
   *   - written:        the file did not exist; it was created
   *   - refreshed:      the file existed but its parsed hooks tree
   *                     diverged from the current `buildClaudeSettingsLocalJson()`;
   *                     it was rewritten
   *   - already-current: the file already matched; no rewrite needed
   */
  claudeSettings: {
    action: 'written' | 'refreshed' | 'already-current' | 'skipped';
    path: string;
    offlineTemplate: {
      action: 'written' | 'refreshed' | 'already-current';
      path: string;
    };
  };
  /**
   * Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7): structured
   * diagnostic for missing or empty `.claude/rules/{common,<language>}/`.
   * Always present (the detector runs on every init); `missing: false`
   * means the project's rules tree is already populated and no action is
   * required. The CLI copies this descriptor into the JSON envelope's
   * `data.standardsMissing` so the LLM can read it programmatically.
   */
  standardsMissing: MissingProjectStandardsDiagnostic;
  /**
   * Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7): when the caller
   * passed `initStandards: true` AND the detector reported `missing:
   * true`, this field lists the files written by
   * `executeProjectStandardsInit({ projectRoot, apply: true })`.
   * Undefined when `initStandards` was not requested.
   */
  standardsApplied?: {
    readonly language: StandardsLanguage;
    readonly writtenFiles: string[];
    readonly skippedFiles: string[];
  };
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

  // Slice 2026-06-16-peaks-solo-auto-scaffold (RD#7):
  //   - Always run the detector and surface the descriptor so the CLI can
  //     put it on stderr + into the JSON envelope's `data.standardsMissing`.
  //   - When `initStandards: true` AND the detector reports missing, run
  //     `executeProjectStandardsInit({ apply: true })` to auto-apply.
  const detectedLanguage: StandardsLanguage = options.language ?? detectLanguage(options.projectRoot);
  const standardsMissing = detectMissingProjectStandards(options.projectRoot, detectedLanguage);
  let standardsApplied: WorkspaceInitReport['standardsApplied'];
  if (options.initStandards === true && standardsMissing.missing) {
    const initResult = executeProjectStandardsInit({
      projectRoot: options.projectRoot,
      apply: true
    });
    standardsApplied = {
      language: initResult.language,
      writtenFiles: initResult.writtenFiles,
      skippedFiles: initResult.plannedWrites
        .filter((write) => write.status === 'existing')
        .map((write) => write.relativePath)
    };
  }

  return {
    sessionId: options.sessionId,
    sessionRoot,
    created,
    alreadyExisted,
    bound,
    previousSessionId,
    changeId: resolvedChangeId,
    changeIdAction,
    claudeSettings: await materializeClaudeSettingsLocal(options.projectRoot, options.noClaudeHooks === true),
    standardsMissing,
    ...(standardsApplied !== undefined ? { standardsApplied } : {})
  };
}

/**
 * The peaks-managed snippet appended to the consumer project's
 * `.peaks/.gitignore` so the local-only settings file never lands
 * in a commit. Marked with a managed-by header so we can detect (and
 * not double-append) on subsequent inits.
 */
const PEAKS_GITIGNORE_HEADER = '# >>> peaks-cli managed snippet (slice 2.0.1-bug3) — do not edit by hand';
const PEAKS_GITIGNORE_FOOTER = '# <<< peaks-cli managed snippet';

const PEAKS_GITIGNORE_SNIPPET = [
  PEAKS_GITIGNORE_HEADER,
  '# Consumer-project .claude/settings.local.json: written by `peaks workspace init`',
  '# to bypass Claude Code [Fact-Forcing Gate] for .peaks/** writes. Local-only.',
  '.claude/settings.local.json',
  '# Offline template copy (.peaks/.claude-settings-template.json): written by',
  '# `peaks workspace init` as a manual-recovery anchor. The source-of-truth is',
  '# peaks-cli\'s own `buildClaudeSettingsLocalJson()` — NOT this committed copy.',
  '# Gitignored so the init flow\'s drift-driven refresh does not show up as',
  '# "modified" in `git status` on every release bump. Recovery path: re-run',
  '# `peaks workspace init` to regenerate; or copy from peaks-cli source.',
  '.peaks/.claude-settings-template.json',
  PEAKS_GITIGNORE_FOOTER,
  ''
].join('\n');

/**
 * Materialize the consumer-project `.claude/settings.local.json` and
 * ensure the consumer's `.peaks/.gitignore` covers it. Returns a
 * `claudeSettings` descriptor that the caller surfaces in the JSON
 * envelope.
 *
 * The function is idempotent: re-running on an already-materialized
 * project is a no-op (the file is rewritten only when its content
 * diverges from the current peaks-cli release's template, which
 * keeps the consumer up to date as the template evolves).
 *
 * Even when the caller passes `noClaudeHooks: true`, the function
 * still writes a copy of the template at
 * `.peaks/.claude-settings-template.json` so the user has an offline
 * recovery path: copy the file contents into
 * `.claude/settings.local.json` manually. The recovery path is
 * documented in
 * `skills/peaks-solo/references/anchoring-and-session-info.md`.
 *
 * Slice 2026-06-13-selfheal-claude-settings-template: the offline copy
 * is now ALSO drift-checked (via `templateContentMatches`) so stale
 * on-disk copies from earlier peaks-cli releases (which lacked the
 * `node -e "..."` wrapper) get refreshed automatically on the next
 * init. The action taken on the offline copy is surfaced in
 * `claudeSettings.offlineTemplate.action`.
 */
async function materializeClaudeSettingsLocal(
  projectRoot: string,
  noClaudeHooks: boolean
): Promise<{
  action: 'written' | 'refreshed' | 'already-current' | 'skipped';
  path: string;
  offlineTemplate: { action: 'written' | 'refreshed' | 'already-current'; path: string };
}> {
  const settingsRel = CLAUDE_SETTINGS_LOCAL_FILENAME;
  const settingsPath = join(projectRoot, settingsRel);
  const template = buildClaudeSettingsLocalJson();
  const serialized = JSON.stringify(template, null, 2) + '\n';

  // Always drop (or self-heal) a copy of the template under .peaks/
  // so the --no-claude-hooks recovery flow has a known source-of-truth
  // on disk. The file is gitignored by the snippet below.
  const offlineAction = await writeOfflineTemplateCopy(projectRoot, serialized);
  const offlineTemplate = {
    action: offlineAction,
    path: '.peaks/.claude-settings-template.json'
  };

  if (noClaudeHooks) {
    return { action: 'skipped', path: settingsRel, offlineTemplate };
  }

  // Best-effort: ensure .claude/ exists, then write the file. We do
  // not assertSafeSettingsPath here (the .claude/ dir is local to
  // the consumer and we trust it on first init; the existing
  // hooks-settings-service applies the safety check for the Bash
  // gate-enforce path).
  await mkdir(join(projectRoot, '.claude'), { recursive: true });

  let action: 'written' | 'refreshed' | 'already-current' = 'written';
  if (existsSync(settingsPath)) {
    try {
      const { readFile } = await import('node:fs/promises');
      const existing = await readFile(settingsPath, 'utf8');
      if (existing === serialized) {
        action = 'already-current';
      } else {
        action = 'refreshed';
      }
    } catch {
      // Treat any read failure as "needs refresh" so the consumer
      // always ends up with a valid template on disk.
      action = 'refreshed';
    }
  }
  if (action !== 'already-current') {
    await writeFile(settingsPath, serialized, 'utf8');
  }

  // Ensure the consumer's .peaks/.gitignore covers the local-only
  // settings file. The snippet is appended only when the header is
  // missing, so subsequent inits do not double-append.
  await upsertPeaksGitignoreSnippet(projectRoot);

  return { action, path: settingsRel, offlineTemplate };
}

/**
 * Always write (or refresh) a copy of the template at
 * `.peaks/.claude-settings-template.json` so the user has a known
 * source-of-truth on disk for the manual recovery flow. The file is
 * GITIGNORED (added to `.peaks/.gitignore` by
 * `upsertPeaksGitignoreSnippet`) — the source-of-truth lives in
 * peaks-cli's own `buildClaudeSettingsLocalJson()`, NOT in any
 * committed copy. Gitignoring it ensures the init flow's drift-driven
 * refresh does not show up as "modified" in `git status` on every
 * peaks-cli release bump.
 *
 * Recovery path for users who need to re-create their
 * `.claude/settings.local.json`: re-run `peaks workspace init`
 * (the file is regenerated); or copy the template straight from
 * peaks-cli source (`src/services/workspace/claude-settings-template.ts`).
 *
 * Slice 2026-06-13-selfheal-claude-settings-template: drift-check via
 * `templateContentMatches` BEFORE writing. If the on-disk copy's
 * parsed hooks tree matches the current `buildClaudeSettingsLocalJson()`
 * output, the write is skipped (`already-current`). If the file is
 * missing, it is written (`written`). If it exists but has drifted
 * (e.g. an earlier release's template without the `node -e "..."`
 * wrapper, or a user-customised copy), it is rewritten (`refreshed`).
 * The CLI caller surfaces a warning when `refreshed` because manual
 * edits the user may have made would be overwritten.
 *
 * Returns the action taken so the caller can surface it in the
 * envelope. Read failures are treated as drift so a malformed
 * on-disk file always self-heals on the next init.
 */
async function writeOfflineTemplateCopy(
  projectRoot: string,
  serialized: string
): Promise<'written' | 'refreshed' | 'already-current'> {
  const copyPath = join(projectRoot, '.peaks', '.claude-settings-template.json');
  await mkdir(join(projectRoot, '.peaks'), { recursive: true });

  let action: 'written' | 'refreshed' | 'already-current' = 'written';
  if (existsSync(copyPath)) {
    try {
      const { readFile } = await import('node:fs/promises');
      const existing = await readFile(copyPath, 'utf8');
      if (templateContentMatches(serialized, existing)) {
        action = 'already-current';
      } else {
        action = 'refreshed';
      }
    } catch {
      // Treat any read failure as drift so the file self-heals.
      action = 'refreshed';
    }
  }
  if (action !== 'already-current') {
    await writeFile(copyPath, serialized, 'utf8');
  }
  return action;
}

/**
 * Append the peaks-managed `.claude/settings.local.json` snippet to
 * the consumer project's `.peaks/.gitignore`. Preserves any user-
 * managed entries above the snippet. Idempotent: re-running on a
 * project that already has the snippet is a no-op.
 */
async function upsertPeaksGitignoreSnippet(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, '.peaks', '.gitignore');
  await mkdir(join(projectRoot, '.peaks'), { recursive: true });

  let existing = '';
  if (existsSync(gitignorePath)) {
    try {
      const { readFile } = await import('node:fs/promises');
      existing = await readFile(gitignorePath, 'utf8');
    } catch {
      existing = '';
    }
  }
  if (existing.includes(PEAKS_GITIGNORE_HEADER)) {
    return;
  }
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const next = existing + separator + (existing.length > 0 ? '\n' : '') + PEAKS_GITIGNORE_SNIPPET;
  await writeFile(gitignorePath, next, 'utf8');
}
