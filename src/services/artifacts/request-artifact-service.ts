import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDirectory, listDirectories, pathExists } from '../../shared/fs.js';
import { checkPrerequisites, DEFAULT_REQUEST_TYPE, isRequestType, VALID_REQUEST_TYPES, type PrerequisiteCheckResult, type RequestType } from './artifact-prerequisites.js';
import { ensureSession, getSessionIdCanonical } from '../session/session-manager.js';
import { getCurrentChangeId } from '../../shared/change-id.js';
import { getNextNumber, buildNumberedFilename } from '../../shared/incrementing-number.js';
import { lintRequestArtifact } from './artifact-lint-service.js';
import { checkTypeSanity } from '../scan/type-sanity-service.js';
import { requireUserConfirmation } from '../mode/mode-enforcement.js';
import { scanFileSize } from '../scan/file-size-scan.js';
import { emitObservabilityEvent } from '../observability/observability-service.js';

export { VALID_REQUEST_TYPES, DEFAULT_REQUEST_TYPE, isRequestType, type RequestType };

// Re-export the pure-function template surface so external callers (CLI,
// tests) keep importing from this module unchanged. The render templates,
// handoff-path helpers, and `RequestArtifactRole` type all live in the
// sibling `artifact-templates.ts` module — see slice
// 2026-06-24-handoff-path-canonicalization for the rationale.
//
// `import type` is required so the type is in scope as a bare identifier
// within this file (the value re-export alone does not bring types into
// the local namespace under `isolatedModules`).
import type { RequestArtifactRole } from './artifact-templates.js';
import { renderTemplate } from './artifact-templates.js';
export type { RequestArtifactRole } from './artifact-templates.js';
export { formatHandoffPath, formatCommitBoundaryPath, formatSkillUsageLessonsPath, formatChangeScopePath } from './artifact-templates.js';

export type CreateRequestArtifactOptions = {
  role: RequestArtifactRole;
  requestId: string;
  projectRoot: string;
  sessionId?: string;
  /**
   * Optional explicit change-id. When set, the artifact file lands at
   * `.peaks/_runtime/<changeId>/<role>/requests/...` regardless of any
   * `current-change` binding. When unset, falls back to the binding, then
   * to the requestId. The CLI's `--session-id <scope>` flag uses this to
   * preserve the legacy "session-id as scope dir name" behavior.
   */
  changeId?: string;
  apply?: boolean;
  requestType?: RequestType;
  clock?: () => string;
  /**
   * Slice 020 — caller-keyed session binding. The callerId that initiated
   * this artifact creation (resolved via `resolveCallerId` by the CLI).
   * Recorded in the JSON envelope and on the artifact body's frontmatter
   * so a future reader knows which caller produced it. The caller-keyed
   * binding file itself is at `.peaks/_runtime/callers/<callerId>.json`;
   * the per-caller active-skill marker is at
   * `.peaks/_runtime/<peakSid>/active-skill-<callerId>.json` (D6).
   */
  callerId?: string;
};

export type CreateRequestArtifactResult = {
  role: RequestArtifactRole;
  requestId: string;
  sessionId: string;
  path: string;
  content: string;
  applied: boolean;
  /**
   * Slice 020 — caller-keyed session binding. The resolved callerId
   * (D4 priority: flag > env > platform fallback) when --caller-id
   * was passed. Omitted from the result when no callerId was set.
   */
  callerId?: string;
  /**
   * Slice 2026-06-23-request-init-change-scope-leak. The canonical
   * change-id scope dir under `.peaks/_runtime/change/<changeId>/`.
   * Pre-created on `--apply` (idempotent) so the sub-agent prompt
   * always has a single, well-known place to write reviewable
   * artifacts — never the forbidden top-level `.peaks/_runtime/<id>/`. In
   * dry-run mode this is the would-be path (the dir is NOT created).
   * Absolute path.
   */
  scopeDir?: string;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALID_ROLES: ReadonlySet<RequestArtifactRole> = new Set(['prd', 'ui', 'rd', 'qa', 'sc']);

function defaultClock(): string {
  return new Date().toISOString();
}

function dateSlugFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function defaultSessionId(iso: string): string {
  return `${dateSlugFromIso(iso)}-session`;
}

export async function createRequestArtifact(options: CreateRequestArtifactOptions): Promise<CreateRequestArtifactResult> {
  if (!VALID_ROLES.has(options.role)) {
    throw new Error(`Invalid role: ${String(options.role)} (expected prd, ui, rd, qa, or sc)`);
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new Error(`Invalid request id: ${options.requestId} (expected letters, digits, dots, underscores, or dashes)`);
  }
  const requestType = options.requestType ?? DEFAULT_REQUEST_TYPE;

  const clock = options.clock ?? defaultClock;
  const timestamp = clock();

  // Use provided session ID or get/create current session. The session
  // id is the binding for the artifact file's location.
  //
  // Slice 006 collapses the per-change-id top-level dirs. The artifact
  // file is now written under the SESSION dir
  // (`.peaks/_runtime/<sid>/<role>/requests/`) instead of the
  // change-id dir. The 2-tier fallback (canonical session → legacy
  // session) replaces the F3 3-tier fallback (per-change-id →
  // canonical session → legacy session). The change-id is preserved
  // in the artifact body's frontmatter (under `- change-id:`) for
  // human navigation; it is no longer a filesystem path key.
  const sessionId = options.sessionId ?? await ensureSession(options.projectRoot);
  const boundChangeId = getCurrentChangeId(options.projectRoot);
  // Resolution order for the change-id (file body metadata):
  //   1. Explicit `options.changeId` (CLI `--change-id`).
  //   2. `current-change` binding (live developer working context).
  //   3. The requestId itself (every request is its own scope by default).
  const changeId = options.changeId ?? boundChangeId ?? options.requestId;

  // Slice 008 (F21 fix): fail fast when the resolved session id
  // looks like a real session id (matches the date+session prefix)
  // but does NOT correspond to an actual session dir under
  // `.peaks/_runtime/`. Pre-F21 a sub-agent with a typo or stale
  // binding (e.g. `2025-01-01-session-deadbe`) silently planned
  // to write to a non-existent path. The check is intentionally
  // scoped to "looks like a real session id" — a sid like
  // `test-session` or `s` (no date prefix) is allowed through so
  // the existing F3 / slice-007 back-compat flows (e.g. the
  // `peaks request init --session-id <arbitrary-scope>` tests)
  // can still create the dir on demand via the writer's
  // `mkdir(..., { recursive: true })`.
  const LOOKS_LIKE_SESSION_ID = /^\d{4}-\d{2}-\d{2}-session-/;
  if (LOOKS_LIKE_SESSION_ID.test(sessionId)) {
    const sessionDir = join(options.projectRoot, '.peaks', '_runtime', sessionId);
    if (!(await isDirectory(sessionDir))) {
      const canonicalSid = getSessionIdCanonical(options.projectRoot);
      const hint = canonicalSid !== null
        ? `Use --session-id ${canonicalSid} or run 'peaks workspace init' to create a new session.`
        : `Run 'peaks workspace init' to create a new session.`;
      throw new Error(
        `session id '${sessionId}' does not exist in _runtime/. Current canonical binding is '${canonicalSid ?? '<none>'}'. ${hint}`
      );
    }
  }

  // Build numbered path under the session dir (canonical post-F3 home).
  const requestsDir = join(options.projectRoot, '.peaks', '_runtime', sessionId, options.role, 'requests');

  // Check if a file with this requestId already exists (regardless of number prefix)
  if (await isDirectory(requestsDir)) {
    const existingFiles = await listMarkdownFiles(requestsDir);
    const alreadyExists = existingFiles.some((file) => {
      if (file === `${options.requestId}.md`) return true;
      if (/^\d+-/.test(file) && file.endsWith(`-${options.requestId}.md`)) return true;
      return false;
    });
    if (alreadyExists) {
      throw new Error(`A request artifact with id "${options.requestId}" already exists in ${requestsDir}. Remove it before re-running peaks request init.`);
    }
  }

  const number = getNextNumber(requestsDir);
  const filename = buildNumberedFilename(number, options.requestId);
  const path = join(requestsDir, filename);

  const content = renderTemplate(options.role, options.requestId, changeId, sessionId, timestamp, requestType);

  if (options.apply !== true) {
    // Slice 2026-06-23-request-init-change-scope-leak. Even in dry-run
    // we surface the canonical scopeDir so the user (and the LLM
    // sub-agent prompt downstream) knows exactly where the dir WOULD
    // be created on `--apply`. We do NOT touch the filesystem here.
    const { ensureChangeScopeDir } = await import('./change-scope-service.js');
    const scopeResult = ensureChangeScopeDir(options.projectRoot, changeId, { dryRun: true });
    return {
      role: options.role,
      requestId: options.requestId,
      sessionId,
      path,
      content,
      applied: false,
      scopeDir: scopeResult.path,
      ...(options.callerId !== undefined ? { callerId: options.callerId } : {})
    };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');

  // Slice 2026-06-23-request-init-change-scope-leak. Pre-create the
  // canonical change-id scope dir so the sub-agent prompt always has
  // a well-known place to write reviewable artifacts — never the
  // forbidden top-level `.peaks/_runtime/<id>/`. Idempotent: re-running with
  // the same change-id is a no-op. The dir lives under
  // `.peaks/_runtime/change/<changeId>/` so it is covered by the
  // existing `.peaks/_runtime/` gitignore rule.
  const { ensureChangeScopeDir } = await import('./change-scope-service.js');
  const scopeResult = ensureChangeScopeDir(options.projectRoot, changeId);

  // Create QA initiated marker so rd:qa-handoff gate can verify QA was invoked.
  // Slice 006: the marker lives under the SESSION dir (canonical post-F3
  // home), not the change-id dir. The gate's prereq scan finds it at
  // `.peaks/_runtime/<sid>/qa/.initiated`.
  if (options.role === 'qa') {
    const qaDir = join(options.projectRoot, '.peaks', '_runtime', sessionId, 'qa');
    const initiatedPath = join(qaDir, '.initiated');
    if (!existsSync(initiatedPath)) {
      await mkdir(qaDir, { recursive: true });
      await writeFile(initiatedPath, '', 'utf8');
    }
  }

  return {
    role: options.role,
    requestId: options.requestId,
    sessionId,
    path,
    content,
    applied: true,
    scopeDir: scopeResult.path,
    ...(options.callerId !== undefined ? { callerId: options.callerId } : {})
  };
}

export type RequestArtifactSummary = {
  role: RequestArtifactRole;
  /**
   * Durable scope of the artifact: the top-level `.peaks/_runtime/<changeId>/`
   * directory the file lives in. As of slice 2026-06-05-change-id-as-unit-of-work,
   * the prerequisite gate resolves paths under this dir (not the body
   * `- session:` line), so the file body and the on-disk path agree.
   */
  changeId: string;
  /**
   * Session binding (which developer's local session wrote the file).
   * Read from the file body's `- session:` line. Falls back to `changeId`
   * when the body is missing the line. For back-compat with legacy
   * session-id dirs, this may equal the dir name; for new change-id
   * dirs, it is the metadata session that produced the file.
   */
  sessionId: string;
  requestId: string;
  path: string;
  state: string;
  requestType: RequestType;
  createdAt?: string;
};

export type ListRequestArtifactsOptions = {
  projectRoot: string;
  sessionId?: string;
  role?: RequestArtifactRole;
};

export type ShowRequestArtifactOptions = {
  projectRoot: string;
  role: RequestArtifactRole;
  requestId: string;
  sessionId?: string;
};

export type ShowRequestArtifactResult = RequestArtifactSummary & {
  content: string;
};

function extractMetadata(markdown: string): { state: string; requestType: RequestType; createdAt?: string; sessionId?: string } {
  let state = 'unknown';
  let createdAt: string | undefined;
  let requestType: RequestType = DEFAULT_REQUEST_TYPE;
  let sessionId: string | undefined;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const stateMatch = /^-\s*state:\s*(.+?)\s*$/.exec(line);
    if (stateMatch !== null && stateMatch[1] !== undefined) {
      state = stateMatch[1];
      continue;
    }
    const createdMatch = /^-\s*created:\s*(.+?)\s*$/.exec(line);
    if (createdMatch !== null && createdMatch[1] !== undefined) {
      createdAt = createdMatch[1];
      continue;
    }
    const typeMatch = /^-\s*type:\s*(.+?)\s*$/.exec(line);
    if (typeMatch !== null && typeMatch[1] !== undefined) {
      const candidate = typeMatch[1];
      if (isRequestType(candidate)) {
        requestType = candidate;
      }
      // Placeholder values (e.g. "feature | bug | refactor | clarification") fall back to default.
      continue;
    }
    const sessionMatch = /^-\s*session:\s*(.+?)\s*$/.exec(line);
    if (sessionMatch !== null && sessionMatch[1] !== undefined) {
      sessionId = sessionMatch[1];
      continue;
    }
  }
  const base: { state: string; requestType: RequestType; createdAt?: string; sessionId?: string } = { state, requestType };
  if (createdAt !== undefined) base.createdAt = createdAt;
  if (sessionId !== undefined) base.sessionId = sessionId;
  return base;
}

async function readSummary(
  projectRoot: string,
  changeId: string,
  role: RequestArtifactRole,
  fileName: string
): Promise<RequestArtifactSummary> {
  const path = join(projectRoot, '.peaks', changeId, role, 'requests', fileName);
  const body = await readFile(path, 'utf8');
  const { state, createdAt, requestType, sessionId: bodySessionId } = extractMetadata(body);
  // Strip numbered prefix (e.g., "001-requestId.md" -> "requestId")
  // Only strip 3-digit zero-padded prefixes (our incrementing number format)
  const requestId = fileName.replace(/^0\d{2}-/, '').replace(/\.md$/, '');
  // `changeId` is the durable scope (the directory the file lives in).
  // `sessionId` is metadata (the session that wrote the file, parsed from
  // the `- session:` body line). They may differ when a request is read
  // across sessions (back-compat) or after a session re-bind.
  const summary: RequestArtifactSummary = {
    role,
    changeId,
    sessionId: bodySessionId ?? changeId,
    requestId,
    path,
    state,
    requestType
  };
  if (createdAt !== undefined) {
    summary.createdAt = createdAt;
  }
  return summary;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!(await isDirectory(dir))) {
    return [];
  }
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

export async function listRequestArtifacts(options: ListRequestArtifactsOptions): Promise<RequestArtifactSummary[]> {
  const peaksRoot = join(options.projectRoot, '.peaks');
  if (!(await isDirectory(peaksRoot))) {
    return [];
  }
  // One-axis (session-id-only) layout: the canonical on-disk root for
  // request artifacts is `.peaks/_runtime/<sid>/<role>/requests/`. The
  // pre-F3 `.peaks/_runtime/<sid>/<role>/requests/` legacy home is no longer
  // scanned. The user has forbidden the `.peaks/_runtime/<id>/` root layout —
  // the CLI guarantees no such dirs are created. See
  // `.peaks/memory/2026-06-21-peaks-request-session-id-leaks-into-change-id.md`.
  const scopes: string[] = [];
  if (options.sessionId !== undefined) {
    scopes.push(join('_runtime', options.sessionId));
  } else {
    const runtimeRoot = join(peaksRoot, '_runtime');
    if (await isDirectory(runtimeRoot)) {
      for (const sid of await listDirectories(runtimeRoot)) {
        scopes.push(join('_runtime', sid));
      }
    }
  }
  const roles = options.role !== undefined ? [options.role] : Array.from(VALID_ROLES);
  const summaries: RequestArtifactSummary[] = [];
  for (const scope of scopes) {
    for (const role of roles) {
      const dir = join(peaksRoot, scope, role, 'requests');
      const fileNames = await listMarkdownFiles(dir);
      for (const fileName of fileNames) {
        summaries.push(await readSummary(options.projectRoot, scope, role, fileName));
      }
    }
  }
  return summaries;
}

export async function showRequestArtifact(options: ShowRequestArtifactOptions): Promise<ShowRequestArtifactResult | null> {
  if (!VALID_ROLES.has(options.role)) {
    throw new Error(`Invalid role: ${String(options.role)} (expected prd, ui, rd, qa, or sc)`);
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new Error(`Invalid request id: ${options.requestId} (expected letters, digits, dots, underscores, or dashes)`);
  }

  // Search for files matching the requestId (supports both legacy and numbered formats)
  const findFileInDir = async (dir: string): Promise<{ fileName: string; path: string } | null> => {
    const files = await listMarkdownFiles(dir);
    for (const file of files) {
      // Match legacy format: ${requestId}.md
      if (file === `${options.requestId}.md`) {
        return { fileName: file, path: join(dir, file) };
      }
      // Match numbered format: ${number}-${requestId}.md
      if (/^\d+-/.test(file) && file.endsWith(`-${options.requestId}.md`)) {
        return { fileName: file, path: join(dir, file) };
      }
    }
    return null;
  };

  // One-axis (session-id-only) layout: the canonical on-disk root is
  // `.peaks/_runtime/<sid>/<role>/requests/`. The pre-F3
  // `.peaks/_runtime/<sid>/<role>/requests/` legacy home is no longer
  // scanned. The user has forbidden the `.peaks/_runtime/<id>/` root layout.
  if (options.sessionId !== undefined) {
    const dir = join(options.projectRoot, '.peaks', '_runtime', options.sessionId, options.role, 'requests');
    const scope = join('_runtime', options.sessionId);
    const found = await findFileInDir(dir);
    if (found === null) {
      return null;
    }
    return await readRequestArtifact(options.projectRoot, scope, options.role, found);
  }

  const peaksRoot = join(options.projectRoot, '.peaks');
  const runtimeRoot = join(peaksRoot, '_runtime');
  if (!(await isDirectory(runtimeRoot))) {
    return null;
  }
  for (const sid of await listDirectories(runtimeRoot)) {
    const dir = join(runtimeRoot, sid, options.role, 'requests');
    const found = await findFileInDir(dir);
    if (found !== null) {
      return await readRequestArtifact(options.projectRoot, join('_runtime', sid), options.role, found);
    }
  }
  return null;
}

/** Read the summary + content for a found request file; treat a read
 * error on the content as "not found" so the caller can fall through
 * to the next candidate (the on-disk file may be partially written). */
async function readRequestArtifact(
  projectRoot: string,
  scope: string,
  role: RequestArtifactRole,
  found: { fileName: string; path: string }
): Promise<ShowRequestArtifactResult | null> {
  const summary = await readSummary(projectRoot, scope, role, found.fileName);
  try {
    const content = await readFile(found.path, 'utf8');
    return { ...summary, content };
  } catch {
    return null;
  }
}

export type RequestArtifactState =
  | 'draft'
  | 'confirmed-by-user'
  | 'direction-locked'
  | 'spec-locked'
  | 'implemented'
  | 'qa-handoff'
  | 'running'
  | 'verdict-issued'
  | 'impact-recorded'
  | 'boundary-recorded'
  | 'handed-off'
  | 'blocked';

const ALLOWED_STATES_PER_ROLE: Record<RequestArtifactRole, ReadonlyArray<RequestArtifactState>> = {
  prd: ['draft', 'confirmed-by-user', 'handed-off', 'blocked'],
  ui:  ['draft', 'direction-locked', 'handed-off', 'blocked'],
  rd:  ['draft', 'spec-locked', 'implemented', 'qa-handoff', 'handed-off', 'blocked'],
  qa:  ['draft', 'running', 'verdict-issued', 'blocked'],
  sc:  ['draft', 'impact-recorded', 'boundary-recorded', 'handed-off', 'blocked']
};

export function allowedStatesForRole(role: RequestArtifactRole): ReadonlyArray<RequestArtifactState> {
  return ALLOWED_STATES_PER_ROLE[role];
}

export type TransitionRequestArtifactOptions = {
  role: RequestArtifactRole;
  requestId: string;
  projectRoot: string;
  newState: RequestArtifactState;
  sessionId?: string;
  reason?: string;
  allowIncomplete?: boolean;
  confirmed?: boolean;
  forceConfirm?: boolean;
  typeSanityCheck?: { projectRoot: string; declaredType: RequestType };
  clock?: () => string;
};

export type TransitionRequestArtifactResult = RequestArtifactSummary & {
  previousState: string;
  content: string;
  bypassedPrerequisites?: PrerequisiteCheckResult;
};

export class PrerequisitesNotSatisfiedError extends Error {
  readonly code = 'PREREQUISITES_MISSING';
  readonly role: RequestArtifactRole;
  readonly newState: RequestArtifactState;
  readonly sessionId: string;
  readonly missing: PrerequisiteCheckResult['missing'];
  /**
   * v2.13.3 AC-3 — soft-block warnings carried alongside the missing
   * entries. Surfaced in the CLI error response under `data.warnings`
   * so the operator can see which prereqs were soft-blocked under
   * the 1-minor-release back-compat window (e.g. MUT_REPORT). Always
   * present (possibly empty array) to keep the response shape stable.
   */
  readonly warnings: PrerequisiteCheckResult['warnings'];
  constructor(
    role: RequestArtifactRole,
    newState: RequestArtifactState,
    sessionId: string,
    missing: PrerequisiteCheckResult['missing'],
    warnings: PrerequisiteCheckResult['warnings'] = []
  ) {
    super(
      `Cannot transition ${role} to ${newState}: ${missing.length} required artifact${missing.length === 1 ? '' : 's'} missing under .peaks/_runtime/${sessionId}/`
    );
    this.name = 'PrerequisitesNotSatisfiedError';
    this.role = role;
    this.newState = newState;
    this.sessionId = sessionId;
    this.missing = missing;
    this.warnings = warnings;
  }
}

export class LintGateError extends Error {
  readonly code = 'LINT_GATE_FAILED';
  readonly role: RequestArtifactRole;
  readonly newState: RequestArtifactState;
  readonly errorCount: number;
  constructor(role: RequestArtifactRole, newState: RequestArtifactState, errorCount: number) {
    super(
      `Cannot transition ${role} to ${newState}: ${errorCount} lint error(s) found in artifact. ` +
      'Fix lint errors or use --allow-incomplete to bypass.'
    );
    this.name = 'LintGateError';
    this.role = role;
    this.newState = newState;
    this.errorCount = errorCount;
  }
}

export class TypeSanityViolationError extends Error {
  readonly code = 'TYPE_SANITY_VIOLATION';
  readonly declaredType: RequestType;
  readonly suggestedTypes: ReadonlyArray<RequestType>;
  readonly rationale: string;
  constructor(declaredType: RequestType, suggestedTypes: ReadonlyArray<RequestType>, rationale: string) {
    super(
      `Type sanity violation: declared --type=${declaredType} disagrees with changed files. ` +
      `Suggested types: ${suggestedTypes.join(' | ')}. ` +
      `Rationale: ${rationale}`
    );
    this.name = 'TypeSanityViolationError';
    this.declaredType = declaredType;
    this.suggestedTypes = suggestedTypes;
    this.rationale = rationale;
  }
}

export class FileSizeViolationError extends Error {
  readonly code = 'FILE_SIZE_VIOLATION';
  readonly violations: Array<{ file: string; lines: number }>;
  readonly threshold: number;
  constructor(violations: Array<{ file: string; lines: number }>, threshold: number) {
    const summary = violations.map((v) => `${v.file} (${v.lines} lines)`).join(', ');
    super(
      `File size violation: ${violations.length} file(s) exceed ${threshold} lines: ${summary}. ` +
      'Split into smaller modules, or consider reusing existing components / existing API data ' +
      '(karpathy-guidelines §2 Simplicity First), or use --allow-incomplete to bypass.'
    );
    this.name = 'FileSizeViolationError';
    this.violations = violations;
    this.threshold = threshold;
  }
}

function updateStatusBlock(markdown: string, newState: RequestArtifactState, timestamp: string, reason?: string): { updated: string; previousState: string } {
  const lines = markdown.split(/\r?\n/);
  let previousState = 'unknown';
  let stateLineIndex = -1;
  let lastUpdateLineIndex = -1;

  for (const [index, raw] of lines.entries()) {
    const trimmed = raw.trim();
    const stateMatch = /^-\s*state:\s*(.+?)\s*$/.exec(trimmed);
    if (stateMatch !== null && stateMatch[1] !== undefined) {
      previousState = stateMatch[1];
      stateLineIndex = index;
      continue;
    }
    if (/^-\s*last update:\s*/.test(trimmed)) {
      lastUpdateLineIndex = index;
    }
  }

  if (stateLineIndex >= 0) {
    lines[stateLineIndex] = `- state: ${newState}`;
  } else {
    lines.push('', '## Status', '', `- state: ${newState}`);
  }

  if (lastUpdateLineIndex >= 0) {
    lines[lastUpdateLineIndex] = `- last update: ${timestamp}`;
  } else if (stateLineIndex >= 0) {
    lines.splice(stateLineIndex, 0, `- last update: ${timestamp}`);
  } else {
    lines.push(`- last update: ${timestamp}`);
  }

  if (reason !== undefined && reason.length > 0) {
    lines.push(`- transition note (${timestamp}): ${reason}`);
  }

  return { updated: lines.join('\n'), previousState };
}

export async function transitionRequestArtifact(options: TransitionRequestArtifactOptions): Promise<TransitionRequestArtifactResult | null> {
  if (!VALID_ROLES.has(options.role)) {
    throw new Error(`Invalid role: ${String(options.role)} (expected prd, ui, rd, qa, or sc)`);
  }
  if (!REQUEST_ID_PATTERN.test(options.requestId)) {
    throw new Error(`Invalid request id: ${options.requestId} (expected letters, digits, dots, underscores, or dashes)`);
  }
  const allowed = ALLOWED_STATES_PER_ROLE[options.role];
  if (!allowed.includes(options.newState)) {
    throw new Error(`Invalid state for role ${options.role}: ${options.newState} (expected one of ${allowed.join(', ')})`);
  }

  const showOptions: ShowRequestArtifactOptions = {
    projectRoot: options.projectRoot,
    role: options.role,
    requestId: options.requestId
  };
  if (options.sessionId !== undefined) {
    showOptions.sessionId = options.sessionId;
  }
  const existing = await showRequestArtifact(showOptions);
  if (existing === null) {
    return null;
  }

  // Mode enforcement: require user confirmation in assisted/strict modes
  const transitionKey = `${options.role}:${options.newState}` as `${RequestArtifactRole}:${RequestArtifactState}`;
  await requireUserConfirmation({
    projectRoot: options.projectRoot,
    transitionKey,
    confirmed: options.confirmed,
    forceConfirm: options.forceConfirm
  });

  const prerequisiteResult = await checkPrerequisites({
    projectRoot: options.projectRoot,
    changeId: existing.changeId,
    // F3 repair cycle 1: pass the session binding so the gate can fall
    // back to `.peaks/_runtime/<sid>/<role>/` (and the legacy
    // `.peaks/_runtime/<sid>/<role>/`) for prerequisite artifacts that still
    // live under the session dir rather than the change-id dir. This
    // mirrors the F1/F2 back-compat pattern.
    sessionId: existing.sessionId,
    role: options.role,
    newState: options.newState,
    requestId: options.requestId,
    requestType: existing.requestType
  });

  if (!prerequisiteResult.ok && options.allowIncomplete !== true) {
    throw new PrerequisitesNotSatisfiedError(
      options.role,
      options.newState,
      existing.sessionId,
      prerequisiteResult.missing,
      prerequisiteResult.warnings
    );
  }

  // (Removed in v2.11.0 Group A: the tech-doc-presence + tech-doc-mandatory-
  // sections gates. The rd → spec-locked transition now relies on the
  // immutable peaks-prd handoff (sha256-frontmatter) for the same intent;
  // see PRD for `v2-11-rd-techdoc-removal-and-runtime-friction` AC-3/AC-4.)

  // Type sanity check for PRD handoff
  if (options.typeSanityCheck !== undefined && options.role === 'prd' && options.newState === 'handed-off') {
    const sanityReport = checkTypeSanity({
      projectRoot: options.typeSanityCheck.projectRoot,
      declaredType: options.typeSanityCheck.declaredType
    });
    if (!sanityReport.consistent) {
      throw new TypeSanityViolationError(
        options.typeSanityCheck.declaredType,
        sanityReport.suggestedTypes,
        sanityReport.rationale
      );
    }
  }

  // Lint gate: when transitioning OUT of draft, lint must pass (unless --allow-incomplete)
  if (existing.state === 'draft' && options.allowIncomplete !== true) {
    const lintReport = await lintRequestArtifact({
      projectRoot: options.projectRoot,
      role: options.role,
      requestId: options.requestId,
      sessionId: existing.sessionId
    });
    if (lintReport !== null && !lintReport.ok) {
      const errorCount = lintReport.findings.filter((f) => f.severity === 'error').length;
      if (errorCount > 0) {
        throw new LintGateError(options.role, options.newState, errorCount);
      }
    }
  }

  // File size gate: when RD declares implemented, scan for oversized files (karpathy-skills "Simplicity First")
  if (options.role === 'rd' && options.newState === 'implemented' && options.allowIncomplete !== true) {
    const sizeResult = scanFileSize({ projectRoot: options.projectRoot });
    if (!sizeResult.ok) {
      throw new FileSizeViolationError(sizeResult.violations, sizeResult.threshold);
    }
  }

  const clock = options.clock ?? defaultClock;
  const timestamp = clock();
  const bypassNote = !prerequisiteResult.ok && options.allowIncomplete === true
    ? `bypassed prerequisites (${prerequisiteResult.missing.map((entry) => entry.path).join(', ')})`
    : undefined;
  const combinedReason = [options.reason, bypassNote].filter((part): part is string => part !== undefined && part.length > 0).join(' | ');
  const reasonForNote = combinedReason.length > 0 ? combinedReason : undefined;
  const { updated, previousState } = updateStatusBlock(existing.content, options.newState, timestamp, reasonForNote);
  await writeFile(existing.path, updated, 'utf8');

  // Slice v2.11.1 — observability hook #1/7. Fire-and-forget emit per
  // PRD Q4 (full-auto must never fail-loud on observability). The
  // synchronous `emitObservabilityEvent` returns `{written: false}` on
  // any error path; we deliberately ignore the result so the
  // transition contract remains unchanged.
  emitObservabilityEvent({
    schemaVersion: 1,
    ts: timestamp,
    sessionId: existing.sessionId,
    category: 'slice-transition',
    sliceRid: options.requestId,
    detail: {
      from: previousState,
      to: options.newState,
      artifactRole: options.role,
      reason: reasonForNote
    }
  }, { projectRoot: options.projectRoot });

  const result: TransitionRequestArtifactResult = {
    role: options.role,
    changeId: existing.changeId,
    sessionId: existing.sessionId,
    requestId: options.requestId,
    path: existing.path,
    state: options.newState,
    requestType: existing.requestType,
    previousState,
    content: updated
  };
  if (existing.createdAt !== undefined) {
    result.createdAt = existing.createdAt;
  }
  if (!prerequisiteResult.ok && options.allowIncomplete === true) {
    result.bypassedPrerequisites = prerequisiteResult;
  }
  return result;
}
