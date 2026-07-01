import { mkdir } from 'node:fs/promises';
import { existsSync, lstatSync, readdirSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { isDirectory } from '../../shared/fs.js';
import { getSessionId, setCurrentSessionBinding, setSessionMeta } from '../session/session-manager.js';

/**
 * Slice 2026-06-29-change-id-root-removal: list the immediate children of
 * `.peaks/` so the legacy sibling-dir guard can enumerate date-stamped
 * residue dirs without re-implementing `readdirSync` inline. Returns
 * `[]` when the `.peaks/` dir does not exist (legitimate first-run
 * outcome).
 */
function listPeaksRuntimeSiblings(projectRoot: string): string[] {
  const peaksDir = join(projectRoot, '.peaks');
  if (!existsSync(peaksDir)) return [];
  try {
    return readdirSync(peaksDir);
  } catch {
    return [];
  }
}

/**
 * Slice 2026-06-29-change-id-root-removal: list the immediate children of
 * `.peaks/_runtime/` so the legacy sibling-dir guard can enumerate
 * date-stamped residue dirs at the runtime layer. Returns `[]` when
 * the `.peaks/_runtime/` dir does not exist.
 */
function listRuntimeSiblings(projectRoot: string): string[] {
  const runtimeDir = join(projectRoot, '.peaks', '_runtime');
  if (!existsSync(runtimeDir)) return [];
  try {
    return readdirSync(runtimeDir);
  } catch {
    return [];
  }
}

/**
 * Slice 2026-06-29-change-id-root-removal: returns `true` when the
 * basename matches the auto-generated session-id shape
 * `YYYY-MM-DD-<slug>` (the v2.8.3 hard-ban target). Bare dates
 * (`YYYY-MM-DD`) are NOT auto-generated and are kept as plain dates.
 */
function isDateStampedSiblingId(name: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}-/.test(name)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(name)) return false;
  return true;
}
// Slice 2026-06-29-change-id-root-removal: `setCurrentChangeId` and
// `validateChangeIdOrThrow` were removed with the change-id axis. Init
// preserves the legacy-sibling-dir guard via inline `lstatSync`; the
// path-safety helpers moved to `shared/path-safety.ts` but this module
// does not currently use them.
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
  /**
   * Slice 2.0.1-bug3-fact-forcing-bypass: what the consumer-project
   * `.claude/settings.local.json` materialization did this call.
   *   - written:        the file was freshly written
   *   - refreshed:      the file already existed and was rewritten to
   *                     match the current peaks-loop release's template
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

/**
 * Slice C10 (2026-06-24-legacy-change-id-sibling): the relative path
 * patterns under `.peaks/_runtime/<sessionId>/` that the lazy WRITER (peaks-qa,
 * peaks-rd, peaks-prd, peaks-txt, peaks-sc) creates via
 * `mkdir(parent, { recursive: true })` immediately before a write. When
 * a sibling `.peaks/_runtime/<sessionId>/` exists on disk AND every entry below
 * it matches one of these patterns (AND no entry is a symlink), the
 * dir is treated as legitimate writer output and `initWorkspace`
 * re-init is tolerant — the binding is rewritten without throwing.
 *
 * Adding a new pattern here is a deliberate, reviewed change because
 * it widens the heuristic. The list is intentionally narrow:
 *   - `qa/screenshots/<file>.{png,jpg,jpeg,webp,gif}` — peaks-qa screenshots
 *   - `<role>/requests/<file>.md`                     — RD/QA/PRD/TXT/SC artifacts
 *   - `<role>/findings/<file>.md`                     — QA findings files
 *
 * Re-exported so unit tests can assert the pattern list directly.
 */
export const WRITER_ALLOWED_RELATIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /^qa\/screenshots\/[^/]+\.(png|jpg|jpeg|webp|gif)$/i,
  /^[^/]+\/requests\/[^/]+\.md$/,
  /^[^/]+\/findings\/[^/]+\.md$/
];

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

/**
 * Thrown when `peaks workspace init --change-id <id>` is invoked but a
 * 2.8.0-era legacy sibling directory `.peaks/_runtime/<sessionId>/` already exists
 * at top level. Under the 2.8.0+ two-axis convention, change-id is a
 * logical identifier in the SESSION axis — NOT a top-level sibling dir.
 *
 * The caller is expected to:
 *   1. Inspect `.peaks/_runtime/<sessionId>/` to see if it contains user-authored
 *      content worth preserving.
 *   2. Migrate or delete the sibling dir.
 *   3. Re-run `peaks workspace init --change-id <id>`.
 */
export class LegacyChangeIdSiblingError extends Error {
  readonly code = 'LEGACY_CHANGE_ID_SIBLING';
  constructor(
    readonly sessionId: string,
    readonly legacyPath: string
  ) {
    super(
      `peaks-loop 2.8.3+ forbids the legacy sibling dir ${legacyPath}. ` +
      `Under the two-axis convention, change-id "${sessionId}" must live in the SESSION axis ` +
      `(.peaks/_runtime/<sessionId>/), not as a top-level sibling of .peaks/_runtime/. ` +
      `Migration: (1) inspect ${legacyPath} for user-authored content; ` +
      `(2) move any desired files into .peaks/_runtime/<sessionId>/<role>/; ` +
      `(3) delete ${legacyPath}; (4) re-run 'peaks workspace init --change-id ${sessionId}'.`
    );
    this.name = 'LegacyChangeIdSiblingError';
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
  // slice 006 (2026-06-06-change-folder-simplify-and-lazy-role-subdirs) +
  // slice 2026-06-22-top-level-change-id-cleanup (2.8.3):
  //   - Reviewable artifacts (rd/, qa/, prd/, txt/) live at
  //     `.peaks/_runtime/<change-id>/<role>/` (tracked in git) when a change-id
  //     is given. The role subdirs are NOT pre-created — the writer
  //     (e.g. `peaks request init`, `peaks rd`) creates the parent
  //     dirs on demand via `mkdirSync(..., { recursive: true })`.
  //   - The session dir `.peaks/_runtime/<session-id>/` (gitignored)
  //     now holds ONLY the canonical `session.json` metadata. The
  //     F3-introduced `system/` subdir is gone — slice 006 removes
  //     it via `peaks workspace reconcile`; new init calls do not
  //     pre-create it.
  //   - The change-id dir is NOT created at top level when `--change-id`
  //     is given. Slice 2.8.3+ redirects the binding to
  //     `.peaks/_runtime/current-change` as a plain text file (see
  //     `LegacyChangeIdSiblingError` for the migration guard). Reviewable
  //     artifacts still land under `.peaks/_runtime/<sessionId>/<role>/`, but
  //     that dir is created lazily by the WRITER, not by init. Init only
  //     writes the binding.
  //
  // The CLI accepts `--change-id <id>` to bind the change. The legacy
  // session-scoped layout (`.peaks/_runtime/<session-id>/<role>/<file>`) is
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

  // 2. Slice 2026-06-29-change-id-root-removal: the change-id axis is
  //    gone. The session id IS the binding — there is no separate
  //    `.peaks/_runtime/current-change` file. The v2.8.3 hard-ban on
  //    `.peaks/<YYYY-MM-DD-*>/` siblings still fires via the inline
  //    `lstatSync` block below, scoped to legacy residue
  //    directories (NOT the canonical session dir, which lives at
  //    `.peaks/_runtime/<sid>/`).
  //
  //    Pre-flight guard: refuse to silently walk into a date-stamped
  //    sibling dir at the `.peaks/` top level. `lstatSync`
  //    distinguishes file/dir/symlink/broken-symlink. ENOENT (path
  //    absent) is the legitimate outcome. The guard fires ONLY on
  //    date-stamped sibling dirs at `.peaks/<date-stamped>/` —
  //    NOT on the canonical session dir at `.peaks/_runtime/<sid>/`,
  //    which is a legitimate in-flight or completed session.
  for (const entry of listPeaksRuntimeSiblings(options.projectRoot)) {
    if (entry === '_runtime') continue; // canonical session dir layer
    if (!isDateStampedSiblingId(entry)) continue;
    const legacySiblingDir = join(options.projectRoot, '.peaks', entry);
    let legacyStat: Stats;
    try {
      legacyStat = lstatSync(legacySiblingDir);
    } catch {
      // ENOENT or transient — accept.
      continue;
    }
    if (!legacyStat.isDirectory()) continue;
    if (legacyStat.isSymbolicLink()) {
      // A symlink AT a date-stamped sibling path is unambiguous
      // evasion — even if the target is writer-shaped, refuse.
      throw new LegacyChangeIdSiblingError(entry, legacySiblingDir);
    }
    const shapeOk = isWriterCreatedSiblingShape(legacySiblingDir);
    if (!shapeOk) {
      throw new LegacyChangeIdSiblingError(entry, legacySiblingDir);
    }
    // Writer-shaped content: silently tolerate. No binding file is
    // written (the change-id binding store is gone).
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
    claudeSettings: await materializeClaudeSettingsLocal(options.projectRoot, options.noClaudeHooks === true),
    standardsMissing,
    ...(standardsApplied !== undefined ? { standardsApplied } : {})
  };
}

// Re-export the consumer `.claude/settings.local.json` materialization
// surface so external callers (CLI, tests) keep importing from this
// module unchanged. The 3 helpers (`materializeClaudeSettingsLocal`,
// `writeOfflineTemplateCopy`, `upsertPeaksGitignoreSnippet`) and the
// `PEAKS_GITIGNORE_*` constants live in the sibling
// `workspace-claude-settings-materializer.ts` module — see v2.18.3
// file-split for the rationale. Function signatures and behaviour
// are unchanged (verbatim move).
import { materializeClaudeSettingsLocal } from './workspace-claude-settings-materializer.js';
export { materializeClaudeSettingsLocal } from './workspace-claude-settings-materializer.js';

/**
 * Slice C10 (2026-06-24-legacy-change-id-sibling): whole-dir shape check
 * for the legacy sibling `.peaks/_runtime/<sessionId>/`. Returns `true` ONLY when
 * every leaf path under the sibling matches one of
 * `WRITER_ALLOWED_RELATIVE_PATTERNS` AND no entry is a symlink (anywhere
 * in the tree).
 *
 * Heuristic rationale (Karpathy #1 — name the tradeoff):
 *   - False negative (reject writer-shaped content): we accept this
 *     failure mode because it preserves the 2.8.3+ hard ban. The user
 *     gets a clear migration message and can re-run after deleting the
 *     sibling dir.
 *   - False positive (accept legacy residue as writer output): we
 *     REJECT this failure mode by requiring EVERY entry to match the
 *     writer-allowed shape. One mismatched leaf ⇒ `false`. The whole-dir
 *     check is conservative on purpose.
 *
 * Symlink rejection (Karpathy #3 — surgical): any symlinked entry — at
 * the root or nested — returns `false` immediately. A symlinked
 * `.peaks/_runtime/<sessionId>/qa/foo.png` could otherwise bypass the file-extension
 * check by resolving to user content outside the project.
 *
 * Implementation note: the helper is synchronous and uses `lstatSync`
 * recursively so the caller (the guard in `initWorkspace`) can decide
 * inline without paying an async round-trip. Tree depth is bounded by
 * the writer's mkdir pattern (≤3 levels: `<role>/<subdir>/<file>`).
 * We cap the recursion at 8 levels as a defense-in-depth limit.
 */
export function isWriterCreatedSiblingShape(siblingDir: string): boolean {
  const MAX_DEPTH = 8;
  const stack: Array<{ abs: string; rel: string; depth: number }> = [
    { abs: siblingDir, rel: '', depth: 0 }
  ];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.depth > MAX_DEPTH) {
      // Pathological depth — reject. The writer never goes this deep.
      return false;
    }
    let stat: Stats;
    try {
      stat = lstatSync(node.abs);
    } catch {
      // Any lstat failure (broken symlink, EACCES, etc.) ⇒ not
      // writer-shaped. Be conservative.
      return false;
    }
    if (stat.isSymbolicLink()) {
      // Symlink anywhere — reject.
      return false;
    }
    if (stat.isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(node.abs);
      } catch {
        return false;
      }
      if (entries.length === 0) {
        if (node.depth === 0) {
          // The top-level sibling dir is empty — no writer output.
          // Reject: an empty `.peaks/<YYYY-MM-DD-*>/` dir is the most
          // common legacy residue shape (the user mkdir'd it then
          // forgot). The writer never creates an empty top-level
          // dir; it always writes at least one file.
          return false;
        }
        // Nested empty subdir under the sibling is fine — writer
        // creates parent dirs lazily and may leave a placeholder
        // behind. Skip.
        continue;
      }
      for (const entry of entries) {
        stack.push({
          abs: join(node.abs, entry),
          rel: node.rel.length > 0 ? `${node.rel}/${entry}` : entry,
          depth: node.depth + 1
        });
      }
      continue;
    }
    if (stat.isFile()) {
      const rel = node.rel.replace(/\\/g, '/');
      const matches = WRITER_ALLOWED_RELATIVE_PATTERNS.some((re) => re.test(rel));
      if (!matches) {
        return false;
      }
      continue;
    }
    // Sockets, FIFOs, devices, etc. — not writer-shaped.
    return false;
  }
  return true;
}
